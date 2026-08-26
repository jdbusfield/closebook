import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HDR_ENTITY_ID } from "@/lib/inquiries/shared";
import { getGoogleAdsConfig, uploadLeadConversion } from "@/lib/google-ads/conversions";

export const runtime = "nodejs";
export const maxDuration = 300;

// Daily: upload won-rental conversions to Google Ads.
//
// A DB trigger (migration 20260616) flags an inquiry conversion_status='pending'
// the moment a rep moves it into a booked stage (confirmed/out). This job picks
// up those pending rows (plus prior failures, to retry) and reports each to
// Google Ads as an Enhanced Conversion for Leads — matched by hashed
// email/phone, valued at the booking amount, deduped by the HDR-XXXXX ref.
//
// Auth: Bearer CRON_SECRET (same as the other sync crons). Safe to hit manually
// to flush the queue on demand.
const BATCH_LIMIT = 200;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = getGoogleAdsConfig();
  if (!cfg) {
    // Not an error — the loop just isn't wired to Google Ads yet. Leave rows
    // pending so they upload as soon as the credentials are set.
    return NextResponse.json({
      skipped: true,
      reason:
        "Google Ads not configured — set GOOGLE_ADS_* env vars. Won inquiries remain queued.",
    });
  }

  const supabase = createAdminClient();

  // Pending = newly won; failed = a previous attempt errored, retry it.
  const { data: rows, error } = await supabase
    .from("rental_inquiries")
    .select(
      "id, reference, email, phone, gclid, estimated_value, conversion_value, conversion_currency, last_activity_at, updated_at"
    )
    .eq("entity_id", HDR_ENTITY_ID)
    .eq("lane", "inbound")
    .in("conversion_status", ["pending", "failed"])
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ uploaded: 0, failed: 0, message: "Nothing queued" });
  }

  // Resolve the true booked value at UPLOAD time, not when the deal was first
  // marked won. A rep often sets the estimate (or accepts the quote) AFTER moving
  // the stage, so a value frozen at confirm-time is stale or null. Priority:
  //   accepted quote total  →  estimated_value  →  whatever was seeded.
  // The DEPOSIT is deliberately never used — it's a partial auth hold, not the
  // sale value, and using it undervalues the conversion in Google Ads.
  const acceptedQuoteTotal = new Map<string, number>();
  const inquiryIds = rows.map((r) => r.id);
  const { data: quotes } = await supabase
    .from("rental_inquiry_quotes")
    .select("inquiry_id, total, accepted_at")
    .in("inquiry_id", inquiryIds)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false });
  for (const q of quotes ?? []) {
    // Rows are newest-first, so the first total we see per inquiry is the latest
    // accepted quote — keep it and skip older ones.
    if (q.total != null && !acceptedQuoteTotal.has(q.inquiry_id)) {
      acceptedQuoteTotal.set(q.inquiry_id, Number(q.total));
    }
  }
  const resolveValue = (row: (typeof rows)[number]): number | null => {
    const quote = acceptedQuoteTotal.get(row.id);
    if (quote != null && quote > 0) return quote;
    if (row.estimated_value != null && Number(row.estimated_value) > 0) {
      return Number(row.estimated_value);
    }
    if (row.conversion_value != null && Number(row.conversion_value) > 0) {
      return Number(row.conversion_value);
    }
    return null;
  };

  let uploaded = 0;
  let failed = 0;
  const errors: { reference: string; error: string }[] = [];

  for (const row of rows) {
    const occurredAt = row.last_activity_at
      ? new Date(row.last_activity_at)
      : new Date();

    const value = resolveValue(row);

    const result = await uploadLeadConversion(cfg, {
      email: row.email,
      phone: row.phone,
      gclid: row.gclid,
      value,
      currency: row.conversion_currency,
      orderId: row.reference,
      occurredAt: isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    });

    if (result.ok) {
      uploaded++;
      await supabase
        .from("rental_inquiries")
        .update({
          // Persist the value we actually sent so the record matches Google Ads.
          conversion_value: value,
          conversion_status: "uploaded",
          conversion_uploaded_at: new Date().toISOString(),
          conversion_error: null,
        })
        .eq("id", row.id);
    } else {
      failed++;
      errors.push({ reference: row.reference, error: result.error ?? "unknown" });
      await supabase
        .from("rental_inquiries")
        .update({
          conversion_status: "failed",
          conversion_error: result.error ?? "unknown",
        })
        .eq("id", row.id);
    }
  }

  return NextResponse.json({ uploaded, failed, total: rows.length, errors });
}

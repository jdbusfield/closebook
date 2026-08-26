import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HDR_ENTITY_ID } from "@/lib/inquiries/shared";
import { getGoogleAdsConfig, uploadLeadConversion } from "@/lib/google-ads/conversions";
import {
  getMetaCapiConfig,
  uploadMetaPurchase,
  META_MAX_EVENT_AGE_DAYS,
} from "@/lib/meta/capi";

export const runtime = "nodejs";
export const maxDuration = 300;

// Daily: upload won-rental conversions to the ad platforms.
//
// A DB trigger (migration 20260616) flags an inquiry conversion_status='pending'
// the moment a rep moves it into a booked stage (confirmed/out). This job picks
// up those pending rows (plus prior failures, to retry) and reports each to
// Google Ads as an Enhanced Conversion for Leads — matched by hashed
// email/phone, valued at the booking amount, deduped by the HDR-XXXXX ref.
//
// The same run also reports booked deals to the Meta Conversions API (offline
// Purchase events, migration 20260826) so Facebook/Instagram delivery can
// optimize toward bookings. Meta eligibility rides the Google lifecycle: any
// row whose conversion_status shows the deal booked (pending/failed/uploaded)
// and whose meta_conversion_status is still none/failed. Each platform's
// section is independently env-gated.
//
// Auth: Bearer CRON_SECRET (same as the other sync crons). Safe to hit manually
// to flush the queue on demand.
const BATCH_LIMIT = 200;

type InquiryRow = {
  id: string;
  reference: string;
  email: string | null;
  phone: string | null;
  gclid: string | null;
  fbc?: string | null;
  fbp?: string | null;
  estimated_value: number | string | null;
  conversion_value: number | string | null;
  conversion_currency: string | null;
  last_activity_at: string | null;
  updated_at: string | null;
};

// Resolve the true booked value at UPLOAD time, not when the deal was first
// marked won. A rep often sets the estimate (or accepts the quote) AFTER moving
// the stage, so a value frozen at confirm-time is stale or null. Priority:
//   accepted quote total  →  estimated_value  →  whatever was seeded.
// The DEPOSIT is deliberately never used — it's a partial auth hold, not the
// sale value, and using it undervalues the conversion.
async function buildValueResolver(
  supabase: ReturnType<typeof createAdminClient>,
  rows: InquiryRow[]
): Promise<(row: InquiryRow) => number | null> {
  const acceptedQuoteTotal = new Map<string, number>();
  const inquiryIds = rows.map((r) => r.id);
  if (inquiryIds.length) {
    const { data: quotes } = await supabase
      .from("rental_inquiry_quotes")
      .select("inquiry_id, total, accepted_at")
      .in("inquiry_id", inquiryIds)
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false });
    for (const q of quotes ?? []) {
      // Rows are newest-first, so the first total we see per inquiry is the
      // latest accepted quote — keep it and skip older ones.
      if (q.total != null && !acceptedQuoteTotal.has(q.inquiry_id)) {
        acceptedQuoteTotal.set(q.inquiry_id, Number(q.total));
      }
    }
  }
  return (row: InquiryRow): number | null => {
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
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const googleCfg = getGoogleAdsConfig();
  const metaCfg = getMetaCapiConfig();
  if (!googleCfg && !metaCfg) {
    // Not an error — the loop just isn't wired to either platform yet. Rows
    // stay queued and upload as soon as credentials are set.
    return NextResponse.json({
      skipped: true,
      reason:
        "Neither Google Ads nor Meta configured — set GOOGLE_ADS_* / META_* env vars. Won inquiries remain queued.",
    });
  }

  const supabase = createAdminClient();

  /* ============================== Google Ads ============================== */
  let google: Record<string, unknown> = { skipped: true };
  if (googleCfg) {
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

    let uploaded = 0;
    let failed = 0;
    const errors: { reference: string; error: string }[] = [];

    if (rows && rows.length > 0) {
      const resolveValue = await buildValueResolver(supabase, rows);

      for (const row of rows) {
        const occurredAt = row.last_activity_at
          ? new Date(row.last_activity_at)
          : new Date();

        const value = resolveValue(row);

        const result = await uploadLeadConversion(googleCfg, {
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
    }

    google = { uploaded, failed, total: rows?.length ?? 0, errors };
  }

  /* ================================= Meta ================================= */
  let meta: Record<string, unknown> = { skipped: true };
  if (metaCfg) {
    // Booked at some point (the 20260616 trigger moved conversion_status out of
    // 'none') and not yet sent to Meta. 'skipped' Google rows are deals pulled
    // back out of a won stage — excluded here too.
    const { data: rows, error } = await supabase
      .from("rental_inquiries")
      .select(
        "id, reference, email, phone, gclid, fbc, fbp, estimated_value, conversion_value, conversion_currency, last_activity_at, updated_at"
      )
      .eq("entity_id", HDR_ENTITY_ID)
      .eq("lane", "inbound")
      .in("conversion_status", ["pending", "failed", "uploaded"])
      .in("meta_conversion_status", ["none", "failed"])
      .order("updated_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (error) {
      return NextResponse.json({ google, error: error.message }, { status: 500 });
    }

    let uploaded = 0;
    let failed = 0;
    let skippedOld = 0;
    let skippedNoValue = 0;
    const errors: { reference: string; error: string }[] = [];

    if (rows && rows.length > 0) {
      const resolveValue = await buildValueResolver(supabase, rows);
      const maxAgeMs = META_MAX_EVENT_AGE_DAYS * 24 * 60 * 60 * 1000;

      for (const row of rows) {
        const occurredAtRaw = row.last_activity_at
          ? new Date(row.last_activity_at)
          : new Date();
        const occurredAt = isNaN(occurredAtRaw.getTime()) ? new Date() : occurredAtRaw;

        // The CAPI rejects events older than 7 days — bookings that predate the
        // Meta wiring can never be sent. Mark them so the cron stops retrying.
        if (Date.now() - occurredAt.getTime() > maxAgeMs) {
          skippedOld++;
          await supabase
            .from("rental_inquiries")
            .update({
              meta_conversion_status: "skipped",
              meta_conversion_error: `booked >${META_MAX_EVENT_AGE_DAYS}d ago — outside the CAPI event window`,
            })
            .eq("id", row.id);
          continue;
        }

        const value = resolveValue(row);
        if (value == null) {
          // Purchase events require a value. Leave the row at 'none' so it
          // uploads on a later run once the rep sets the estimate/quote.
          skippedNoValue++;
          continue;
        }

        const result = await uploadMetaPurchase(metaCfg, {
          email: row.email,
          phone: row.phone,
          fbc: row.fbc,
          fbp: row.fbp,
          value,
          currency: row.conversion_currency,
          eventId: row.reference,
          occurredAt,
        });

        if (result.ok) {
          uploaded++;
          await supabase
            .from("rental_inquiries")
            .update({
              meta_conversion_status: "uploaded",
              meta_conversion_uploaded_at: new Date().toISOString(),
              meta_conversion_error: null,
            })
            .eq("id", row.id);
        } else {
          failed++;
          errors.push({ reference: row.reference, error: result.error ?? "unknown" });
          await supabase
            .from("rental_inquiries")
            .update({
              meta_conversion_status: "failed",
              meta_conversion_error: result.error ?? "unknown",
            })
            .eq("id", row.id);
        }
      }
    }

    meta = {
      uploaded,
      failed,
      skippedOld,
      skippedNoValue,
      total: rows?.length ?? 0,
      errors,
    };
  }

  return NextResponse.json({ google, meta });
}

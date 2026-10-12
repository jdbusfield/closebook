import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types/database.types";
import { HDR_ENTITY_ID } from "@/lib/inquiries/shared";
import { getMetaCapiConfig, META_MAX_EVENT_AGE_DAYS } from "@/lib/meta/capi";
import {
  buildMetaCrmEvent,
  stagesReached,
  uploadMetaCrmEvents,
  type MetaCrmStage,
} from "@/lib/meta/crm-stages";

export const runtime = "nodejs";
export const maxDuration = 300;

// Hourly: report HDR lead stage changes to Meta (Qualified Leads / CRM
// integration, see src/lib/meta/crm-stages.ts). Each inquiry gets one event
// per stage it reaches (Lead, Quoted, Booked), logged in meta_crm_stage_events
// so nothing is sent twice. Failed sends are retried on the next run.
//
// Stage time = when it happened, from the card's activity log ("Stage moved
// to ...") or quote timestamps; if neither exists, the card's updated_at.
// Stages older than the 7-day Conversions API window are logged 'skipped'.
//
// Auth: Bearer CRON_SECRET. Safe to hit by hand to flush on demand.
const MAX_AGE_MS = META_MAX_EVENT_AGE_DAYS * 24 * 60 * 60 * 1000;
const PAGE = 1000;

type InquiryRow = {
  id: string;
  reference: string;
  status: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  fbc: string | null;
  fbp: string | null;
  estimated_value: number | string | null;
  conversion_value: number | string | null;
  conversion_currency: string | null;
  created_at: string;
  updated_at: string | null;
};

const QUOTED_LABEL = "Quote Sent";
const BOOKED_LABELS = ["Confirmed", "Out", "Returned", "Completed"];

function earliest(a: Date | undefined, b: Date): Date {
  return a && a.getTime() <= b.getTime() ? a : b;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = getMetaCapiConfig();
  if (!cfg) {
    return NextResponse.json({
      skipped: true,
      reason: "Meta not configured — set META_PIXEL_ID and META_CAPI_ACCESS_TOKEN.",
    });
  }

  const supabase = createAdminClient();
  const since = new Date(Date.now() - MAX_AGE_MS).toISOString();

  // Inquiries that could have a stage inside the window: created or touched in
  // the last 7 days. Anything older has nothing Meta will still accept.
  const inquiries: InquiryRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("rental_inquiries")
      .select(
        "id, reference, status, name, email, phone, fbc, fbp, estimated_value, conversion_value, conversion_currency, created_at, updated_at"
      )
      .eq("entity_id", HDR_ENTITY_ID)
      .eq("lane", "inbound")
      .or(`created_at.gte.${since},updated_at.gte.${since}`)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    inquiries.push(...((data ?? []) as InquiryRow[]));
    if (!data || data.length < PAGE) break;
  }
  if (inquiries.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, skipped: 0, inquiries: 0 });
  }
  const ids = inquiries.map((i) => i.id);

  // Stages already sent or skipped. 'failed' rows are retried.
  const done = new Set<string>();
  {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("meta_crm_stage_events")
        .select("inquiry_id, stage, status")
        .in("inquiry_id", ids)
        .in("status", ["sent", "skipped"])
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const r of data ?? []) done.add(`${r.inquiry_id}:${r.stage}`);
      if (!data || data.length < PAGE) break;
    }
  }

  // When each stage happened: activity log moves, then quote timestamps.
  const quotedAt = new Map<string, Date>();
  const bookedAt = new Map<string, Date>();
  {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("rental_inquiry_activity")
        .select("inquiry_id, body, occurred_at")
        .in("inquiry_id", ids)
        .like("body", "Stage moved to%")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const a of data ?? []) {
        const at = new Date(a.occurred_at);
        if (isNaN(at.getTime())) continue;
        const body = a.body ?? "";
        if (body.includes(QUOTED_LABEL)) {
          quotedAt.set(a.inquiry_id, earliest(quotedAt.get(a.inquiry_id), at));
        } else if (BOOKED_LABELS.some((l) => body.includes(`“${l}”`))) {
          bookedAt.set(a.inquiry_id, earliest(bookedAt.get(a.inquiry_id), at));
        }
      }
      if (!data || data.length < PAGE) break;
    }
  }
  const acceptedTotal = new Map<string, number>();
  {
    const quotes: {
      inquiry_id: string;
      status: string;
      total: number | null;
      created_at: string;
      accepted_at: string | null;
    }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("rental_inquiry_quotes")
        .select("inquiry_id, status, total, created_at, accepted_at")
        .in("inquiry_id", ids)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      quotes.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    for (const q of quotes) {
      if (q.status !== "draft" && !quotedAt.has(q.inquiry_id)) {
        quotedAt.set(q.inquiry_id, new Date(q.created_at));
      }
      if (q.status === "accepted") {
        if (q.accepted_at && !bookedAt.has(q.inquiry_id)) {
          bookedAt.set(q.inquiry_id, new Date(q.accepted_at));
        }
        // Ascending order, so the last accepted quote wins.
        if (q.total != null && Number(q.total) > 0) acceptedTotal.set(q.inquiry_id, Number(q.total));
      }
    }
  }

  type Pending = { inquiryId: string; stage: MetaCrmStage; eventTime: Date };
  const toSend: { row: Pending; event: Record<string, unknown> }[] = [];
  const skipped: (Pending & { error: string })[] = [];

  for (const inq of inquiries) {
    const fallback = new Date(inq.updated_at ?? inq.created_at);
    for (const stage of stagesReached(inq.status)) {
      if (done.has(`${inq.id}:${stage}`)) continue;
      const eventTime =
        stage === "Lead"
          ? new Date(inq.created_at)
          : stage === "Quoted"
            ? (quotedAt.get(inq.id) ?? fallback)
            : (bookedAt.get(inq.id) ?? fallback);
      const row: Pending = { inquiryId: inq.id, stage, eventTime };

      if (Date.now() - eventTime.getTime() > MAX_AGE_MS) {
        skipped.push({ ...row, error: `older than ${META_MAX_EVENT_AGE_DAYS} days` });
        continue;
      }
      const value =
        acceptedTotal.get(inq.id) ??
        (Number(inq.estimated_value) > 0 ? Number(inq.estimated_value) : null) ??
        (Number(inq.conversion_value) > 0 ? Number(inq.conversion_value) : null);
      const event = buildMetaCrmEvent({
        stage,
        eventTime,
        eventId: `${inq.reference}-${stage.toLowerCase()}`,
        email: inq.email,
        phone: inq.phone,
        name: inq.name,
        fbc: inq.fbc,
        fbp: inq.fbp,
        value,
        currency: inq.conversion_currency,
      });
      if (!event) {
        skipped.push({ ...row, error: "no email, phone or click id to match on" });
        continue;
      }
      toSend.push({ row, event });
    }
  }

  const now = new Date().toISOString();
  const logRows: Database["public"]["Tables"]["meta_crm_stage_events"]["Insert"][] = skipped.map((s) => ({
    entity_id: HDR_ENTITY_ID,
    inquiry_id: s.inquiryId,
    stage: s.stage,
    event_time: s.eventTime.toISOString(),
    status: "skipped",
    error: s.error,
    updated_at: now,
  }));

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (let i = 0; i < toSend.length; i += 500) {
    const chunk = toSend.slice(i, i + 500);
    const result = await uploadMetaCrmEvents(cfg, chunk.map((c) => c.event));
    if (result.ok) sent += chunk.length;
    else {
      failed += chunk.length;
      errors.push(result.error ?? "unknown");
    }
    for (const c of chunk) {
      logRows.push({
        entity_id: HDR_ENTITY_ID,
        inquiry_id: c.row.inquiryId,
        stage: c.row.stage,
        event_time: c.row.eventTime.toISOString(),
        status: result.ok ? "sent" : "failed",
        error: result.ok ? null : (result.error ?? "unknown"),
        sent_at: result.ok ? now : null,
        updated_at: now,
      });
    }
  }

  if (logRows.length) {
    const { error } = await supabase
      .from("meta_crm_stage_events")
      .upsert(logRows, { onConflict: "inquiry_id,stage" });
    if (error) {
      return NextResponse.json({ sent, failed, errors, logError: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    inquiries: inquiries.length,
    sent,
    failed,
    skipped: skipped.length,
    errors,
    testMode: !!cfg.testEventCode,
  });
}

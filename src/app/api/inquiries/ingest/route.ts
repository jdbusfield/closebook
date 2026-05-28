import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { HDR_ENTITY_ID } from "@/lib/inquiries/shared";
import type { Database } from "@/lib/types/database.types";

type MessageInsert = Database["public"]["Tables"]["rental_inquiry_messages"]["Insert"];

export const runtime = "nodejs";

// Intake endpoint for inbound rental inquiries from the HDR marketing site.
// Authenticated by a shared secret (not a user session) — the /api middleware
// lets this through, matching the /api/sync/cron pattern.

const PayloadSchema = z.object({
  reference: z.string().min(1).max(32),
  // Contact
  name: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  // Request details
  useCase: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  duration: z.string().optional().nullable(),
  units: z.number().int().optional().nullable(),
  attendant: z.string().optional().nullable(),
  guests: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Email metadata captured at send time on the site
  fromEmail: z.string().optional().nullable(),
  toEmail: z.string().optional().nullable(),
  ccEmail: z.string().optional().nullable(),
  internalEmailId: z.string().optional().nullable(),
  customerEmailId: z.string().optional().nullable(),
  internalSubject: z.string().optional().nullable(),
  customerSubject: z.string().optional().nullable(),
  customerHtml: z.string().optional().nullable(),
  customerText: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    !process.env.INQUIRY_INGEST_SECRET ||
    authHeader !== `Bearer ${process.env.INQUIRY_INGEST_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof PayloadSchema>;
  try {
    parsed = PayloadSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid payload", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const reference = parsed.reference.toUpperCase();
  const nowIso = new Date().toISOString();

  // Idempotent upsert of the inquiry on (entity_id, reference).
  const { data: inquiry, error: upsertErr } = await supabase
    .from("rental_inquiries")
    .upsert(
      {
        entity_id: HDR_ENTITY_ID,
        reference,
        source: "website",
        name: parsed.name ?? null,
        email: parsed.email ?? null,
        phone: parsed.phone ?? null,
        use_case: parsed.useCase ?? null,
        start_date: parsed.startDate ?? null,
        end_date: parsed.endDate ?? null,
        duration: parsed.duration ?? null,
        units: parsed.units ?? null,
        attendant: parsed.attendant ?? null,
        guests: parsed.guests ?? null,
        location: parsed.location ?? null,
        notes: parsed.notes ?? null,
        last_activity_at: nowIso,
      },
      { onConflict: "entity_id,reference" }
    )
    .select("id")
    .single();

  if (upsertErr || !inquiry) {
    console.error("[inquiries/ingest] upsert failed", upsertErr);
    return NextResponse.json({ error: "Failed to record inquiry" }, { status: 500 });
  }

  // Record the two automated emails the site sent. Dedupe on resend_email_id so
  // a retried ingest doesn't double-insert.
  const cc = parsed.ccEmail ? [parsed.ccEmail] : [];
  const initialMessages = [
    parsed.internalEmailId || parsed.internalSubject
      ? {
          inquiry_id: inquiry.id,
          direction: "outbound",
          channel: "email",
          kind: "internal_notification",
          from_addr: parsed.fromEmail ?? null,
          to_addrs: parsed.toEmail ? [parsed.toEmail] : [],
          cc_addrs: cc,
          subject: parsed.internalSubject ?? null,
          resend_email_id: parsed.internalEmailId ?? null,
          sent_at: nowIso,
        }
      : null,
    parsed.customerEmailId || parsed.customerSubject
      ? {
          inquiry_id: inquiry.id,
          direction: "outbound",
          channel: "email",
          kind: "customer_autoreply",
          from_addr: parsed.fromEmail ?? null,
          to_addrs: parsed.email ? [parsed.email] : [],
          cc_addrs: cc,
          subject: parsed.customerSubject ?? null,
          body_html: parsed.customerHtml ?? null,
          body_text: parsed.customerText ?? null,
          resend_email_id: parsed.customerEmailId ?? null,
          sent_at: nowIso,
        }
      : null,
  ].filter(Boolean) as MessageInsert[];

  for (const msg of initialMessages) {
    const resendId = msg.resend_email_id ?? null;
    if (resendId) {
      const { data: existing } = await supabase
        .from("rental_inquiry_messages")
        .select("id")
        .eq("resend_email_id", resendId)
        .maybeSingle();
      if (existing) continue;
    }
    const { error: msgErr } = await supabase.from("rental_inquiry_messages").insert(msg);
    if (msgErr) console.error("[inquiries/ingest] message insert failed", msgErr);
  }

  return NextResponse.json({ ok: true, inquiryId: inquiry.id, reference });
}

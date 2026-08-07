// Server-side engine for the automated email funnels. One entry point,
// processEnrollment(), is shared by the enroll API (day-0 send) and the hourly
// cron (/api/cron/funnel-tick). It re-verifies every break condition before
// sending — the DB triggers (pause on inbound reply, stop on stage change) are
// the fast path, this is the guarantee — then renders the step with the same
// {merge} tokens as the follow-up templates, sends via Resend as the brand
// address, and records the send as a rental_inquiry_messages row so it shows
// in the thread timeline and picks up open/click/bounce tracking through the
// existing Resend webhook.

import { Resend } from "resend";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  type Inquiry,
  type InquiryQuote,
  funnelThreadAnchor,
  needsOutreachStatus,
  quoteEmailBlock,
} from "@/lib/inquiries/shared";
import { brandOf, renderTemplate, type MessageTemplate } from "@/lib/inquiries/templates";
import { publicResourceUrl } from "@/lib/inquiries/resources";

type Admin = ReturnType<typeof createAdminClient>;

export interface FunnelStepRow {
  id: string;
  funnel_id: string;
  day_offset: number;
  subject: string;
  body: string;
  resource_ids: string[];
  sort_order: number;
}

export interface EnrollmentRow {
  id: string;
  entity_id: string;
  inquiry_id: string;
  funnel_id: string;
  quote_id: string | null;
  status: string;
  enrolled_at: string;
  steps_sent: number;
  next_send_at: string | null;
}

export const FUNNEL_STEP_COLUMNS =
  "id, funnel_id, day_offset, subject, body, resource_ids, sort_order";

export const ENROLLMENT_COLUMNS =
  "id, entity_id, inquiry_id, funnel_id, quote_id, status, enrolled_at, enrolled_by, steps_sent, next_send_at, replied_at, stopped_reason, created_at";

const QUOTE_COLUMNS =
  "id, inquiry_id, quote_number, status, lines, subtotal, tax_rate, tax, total, valid_until, terms, accepted_at, created_by, created_at, updated_at";

// The quote riding along on an enrollment: the one picked at enroll time,
// falling back to the inquiry's latest saved quote (covers enrollments made
// before a quote existed, or a picked quote that was since deleted).
export async function enrollmentQuote(
  admin: Admin,
  enrollment: Pick<EnrollmentRow, "inquiry_id" | "quote_id">
): Promise<InquiryQuote | null> {
  if (enrollment.quote_id) {
    const { data } = await admin
      .from("rental_inquiry_quotes")
      .select(QUOTE_COLUMNS)
      .eq("id", enrollment.quote_id)
      .maybeSingle();
    if (data) return data as unknown as InquiryQuote;
  }
  const { data } = await admin
    .from("rental_inquiry_quotes")
    .select(QUOTE_COLUMNS)
    .eq("inquiry_id", enrollment.inquiry_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as InquiryQuote) ?? null;
}

// Does any step of this funnel merge the quote in?
export function funnelUsesQuote(steps: Pick<FunnelStepRow, "subject" | "body">[]): boolean {
  return steps.some(
    (s) => s.body.includes("{quote}") || (s.subject ?? "").includes("{quote")
  );
}

export function resendClient(): Resend | null {
  // A dashboard copy-paste can smuggle a BOM/zero-width character into the env
  // var, and the Authorization header then dies ByteString conversion ("the
  // character at index 7 has a value of 65279"). Keys are plain ASCII — strip
  // anything that isn't.
  const key = (process.env.RESEND_API_KEY ?? "").replace(/[^\x21-\x7e]/g, "");
  return key ? new Resend(key) : null;
}

// When (absolute) a step is due for an enrollment: enrollment time + N days.
// Keeping the enrollment's time-of-day means a lead enrolled at 2pm gets every
// follow-up around 2pm, which reads human.
export function stepDueAt(enrolledAt: string, dayOffset: number): string {
  const t = new Date(enrolledAt).getTime() + dayOffset * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Plain-text body -> simple HTML the way a person's mail client would render
// it: escaped, line breaks kept, bare URLs clickable. No marketing chrome —
// these are meant to read like a rep typed them.
function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1">$1</a>'
  );
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;white-space:pre-wrap;">${linked}</div>`;
}

interface ResourceLink {
  label: string;
  url: string;
}

async function loadResourceLinks(
  admin: Admin,
  entityId: string,
  ids: string[]
): Promise<ResourceLink[]> {
  if (!ids || ids.length === 0) return [];
  const { data } = await admin
    .from("rental_inquiry_resources")
    .select("id, label, file_path")
    .eq("entity_id", entityId)
    .in("id", ids);
  const byId = new Map((data ?? []).map((r) => [r.id, r]));
  // Preserve the step's chosen order; silently drop since-deleted resources.
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ label: r.label, url: publicResourceUrl(r.file_path) }));
}

export type ProcessResult =
  | { outcome: "sent"; stepId: string; final: boolean }
  | { outcome: "completed" }
  | { outcome: "paused_replied" }
  | { outcome: "stopped"; reason: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; error: string };

// Send the next due step of an enrollment (if the chain is still unbroken) and
// advance its cursor. Never throws — the cron loops over many enrollments and
// one failure must not stall the rest.
export async function processEnrollment(
  admin: Admin,
  enrollment: EnrollmentRow
): Promise<ProcessResult> {
  try {
    if (enrollment.status !== "active") {
      return { outcome: "skipped", reason: `status ${enrollment.status}` };
    }

    const { data: inquiry } = await admin
      .from("rental_inquiries")
      .select("*")
      .eq("id", enrollment.inquiry_id)
      .maybeSingle();
    if (!inquiry) {
      await admin
        .from("rental_inquiry_funnel_enrollments")
        .update({ status: "stopped", stopped_reason: "inquiry_deleted" })
        .eq("id", enrollment.id);
      return { outcome: "stopped", reason: "inquiry_deleted" };
    }

    // Break condition: inquiry booked/closed/parked in Keep Warm (mirror of
    // the stage trigger) — "not right now" stops the drip too.
    if (!needsOutreachStatus(inquiry.status ?? "new")) {
      await admin
        .from("rental_inquiry_funnel_enrollments")
        .update({ status: "stopped", stopped_reason: `stage:${inquiry.status}` })
        .eq("id", enrollment.id)
        .eq("status", "active");
      return { outcome: "stopped", reason: `stage:${inquiry.status}` };
    }

    // Break condition: the customer wrote back since enrollment (mirror of the
    // inbound-message trigger, catching anything that landed pre-trigger).
    const { data: replies } = await admin
      .from("rental_inquiry_messages")
      .select("id")
      .eq("inquiry_id", enrollment.inquiry_id)
      .eq("direction", "inbound")
      .gt("created_at", enrollment.enrolled_at)
      .limit(1);
    if (replies && replies.length > 0) {
      await admin
        .from("rental_inquiry_funnel_enrollments")
        .update({ status: "paused_replied", replied_at: new Date().toISOString() })
        .eq("id", enrollment.id)
        .eq("status", "active");
      return { outcome: "paused_replied" };
    }

    if (!inquiry.email) {
      await admin
        .from("rental_inquiry_funnel_enrollments")
        .update({ status: "stopped", stopped_reason: "no_email" })
        .eq("id", enrollment.id);
      return { outcome: "stopped", reason: "no_email" };
    }

    const { data: steps } = await admin
      .from("rental_inquiry_funnel_steps")
      .select(FUNNEL_STEP_COLUMNS)
      .eq("funnel_id", enrollment.funnel_id)
      .order("day_offset", { ascending: true })
      .order("sort_order", { ascending: true });
    const ordered = (steps ?? []) as FunnelStepRow[];
    const step = ordered[enrollment.steps_sent];
    if (!step) {
      await admin
        .from("rental_inquiry_funnel_enrollments")
        .update({ status: "completed", next_send_at: null })
        .eq("id", enrollment.id);
      return { outcome: "completed" };
    }

    const resend = resendClient();
    if (!resend) {
      return { outcome: "error", error: "RESEND_API_KEY is not configured" };
    }

    const inq = inquiry as unknown as Inquiry;
    const brand = brandOf(inq);
    const tpl: MessageTemplate = {
      id: `funnel-step-${step.id}`,
      label: "Funnel step",
      channel: "email",
      track: "general",
      stages: [],
      subject: step.subject,
      body: step.body,
    };
    // Resolve the quote riding on this enrollment when the step merges it in.
    let extra: { quote?: string; quote_number?: string } | undefined;
    let quote: InquiryQuote | null = null;
    if (funnelUsesQuote([step])) {
      quote = await enrollmentQuote(admin, enrollment);
      extra = quote
        ? { quote: quoteEmailBlock(quote), quote_number: quote.quote_number }
        : // Enrollment validates a quote exists for quote-led funnels, so this
          // only happens if every quote was deleted mid-funnel. Degrade to a
          // sentence that still reads naturally after "here's your quote:".
          { quote: "I'm finalizing your pricing now — reply here and I'll have the exact number over to you the same day." };
    }

    // Empty rep name falls back to the brand team signature ("the HDR team").
    const rendered = renderTemplate(tpl, inq, "", extra);

    const links = await loadResourceLinks(admin, enrollment.entity_id, step.resource_ids);
    let text = rendered.body;
    if (links.length > 0) {
      text += `\n\nPhotos & resources:\n${links.map((l) => `• ${l.label}: ${l.url}`).join("\n")}`;
    }
    let html = textToHtml(rendered.body);
    if (links.length > 0) {
      html += `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;margin-top:16px;"><strong>Photos &amp; resources</strong><br>${links
        .map((l) => `&bull; <a href="${l.url}">${escapeHtml(l.label)}</a>`)
        .join("<br>")}</div>`;
    }

    // Reply into the customer's existing conversation when there is one — the
    // site confirmation, a rep's hand-written email, or their own last message
    // — instead of opening a new chain. The anchor's subject wins over the
    // step's; In-Reply-To/References only exist for Gmail-captured threads.
    const { data: priorMsgs } = await admin
      .from("rental_inquiry_messages")
      .select(
        "direction, kind, subject, from_addr, provider_message_id, sent_at, received_at, created_at"
      )
      .eq("inquiry_id", enrollment.inquiry_id)
      .eq("channel", "email")
      .order("created_at", { ascending: true })
      .limit(200);
    const anchor = funnelThreadAnchor(priorMsgs ?? []);

    const subject =
      anchor?.subject ||
      rendered.subject ||
      `Following up on your ${brand.company} request`;

    // A step that merges the quote also carries it as the branded PDF — the
    // same document "Download PDF" produces in the drawer. PDF trouble never
    // blocks the send; the quote is in the body text regardless.
    let attachments: { filename: string; content: Buffer }[] | undefined;
    if (quote) {
      try {
        const { buildQuoteDoc } = await import("@/lib/inquiries/quote-pdf");
        const doc = await buildQuoteDoc(quote, inq);
        attachments = [
          {
            filename: `${quote.quote_number}.pdf`,
            content: Buffer.from(doc.output("arraybuffer")),
          },
        ];
      } catch (err) {
        console.error("[funnel-send] quote PDF attachment failed", err);
      }
    }

    const { data: sendData, error: sendError } = await resend.emails.send({
      from: `${brand.company} <${brand.email}>`,
      to: [inquiry.email],
      // The brand inbox gets a copy so funnel mail is visible in Gmail, not
      // just the CRM. The Gmail pipeline re-captures it and adopts it into
      // this send's message row (see ingest-message.ts) instead of duplicating.
      bcc: [brand.email],
      replyTo: brand.email,
      subject,
      text,
      html,
      ...(attachments ? { attachments } : {}),
      ...(anchor?.inReplyTo
        ? {
            headers: {
              "In-Reply-To": anchor.inReplyTo,
              ...(anchor.references.length > 0
                ? { References: anchor.references.join(" ") }
                : {}),
            },
          }
        : {}),
    });
    if (sendError) {
      return { outcome: "error", error: sendError.message };
    }

    const now = new Date().toISOString();
    await admin.from("rental_inquiry_messages").insert({
      inquiry_id: enrollment.inquiry_id,
      entity_id: enrollment.entity_id,
      direction: "outbound",
      channel: "email",
      kind: "funnel",
      from_addr: brand.email,
      to_addrs: [inquiry.email],
      subject,
      body_text: text,
      resend_email_id: sendData?.id ?? null,
      sent_at: now,
    });
    await admin
      .from("rental_inquiries")
      .update({ last_activity_at: now })
      .eq("id", enrollment.inquiry_id);

    const next = ordered[enrollment.steps_sent + 1];
    await admin
      .from("rental_inquiry_funnel_enrollments")
      .update(
        next
          ? {
              steps_sent: enrollment.steps_sent + 1,
              next_send_at: stepDueAt(enrollment.enrolled_at, next.day_offset),
            }
          : { steps_sent: enrollment.steps_sent + 1, status: "completed", next_send_at: null }
      )
      .eq("id", enrollment.id);

    return { outcome: "sent", stepId: step.id, final: !next };
  } catch (err) {
    return {
      outcome: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

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
  normalizeStatus,
  quoteEmailBlock,
} from "@/lib/inquiries/shared";
import { brandOf, renderTemplate, type MessageTemplate } from "@/lib/inquiries/templates";
import { publicResourceUrl } from "@/lib/inquiries/resources";
import {
  assertQuoteActionable,
  assertQuoteTermsCompatible,
  formatQuoteDate,
  quoteIssueDate,
  quoteValidityText,
} from "@/lib/inquiries/quote-validity";

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
// falling back to the inquiry's latest saved quote only when making a new
// selection. An explicitly selected quote must never silently change.
export async function enrollmentQuote(
  admin: Admin,
  enrollment: Pick<EnrollmentRow, "inquiry_id" | "quote_id">
): Promise<InquiryQuote | null> {
  if (enrollment.quote_id) {
    const { data, error } = await admin
      .from("rental_inquiry_quotes")
      .select(QUOTE_COLUMNS)
      .eq("id", enrollment.quote_id)
      .eq("inquiry_id", enrollment.inquiry_id)
      .maybeSingle();
    if (error) throw new Error(`Unable to load the selected quote: ${error.message}`);
    if (!data) throw new Error("The selected quote is missing. Review and select a saved quote again.");
    return data as unknown as InquiryQuote;
  }
  const { data, error } = await admin
    .from("rental_inquiry_quotes")
    .select(QUOTE_COLUMNS)
    .eq("inquiry_id", enrollment.inquiry_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Unable to load the quote: ${error.message}`);
  return (data as unknown as InquiryQuote) ?? null;
}

// Does any step of this funnel merge the quote in?
export function funnelUsesQuote(steps: Pick<FunnelStepRow, "subject" | "body">[]): boolean {
  return steps.some(
    (s) => /\{quote(?:_number|_valid_until|_issued_on|_validity)?\}/i.test(`${s.subject ?? ""}\n${s.body}`)
  );
}

export function assertFunnelTermsCompatible(steps: Pick<FunnelStepRow, "subject" | "body">[]): void {
  for (const step of steps) {
    assertQuoteTermsCompatible(`${step.subject ?? ""}\n${step.body}`);
  }
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
  | { outcome: "sent"; stepId: string; final: boolean; warning?: string }
  | { outcome: "completed" }
  | { outcome: "paused_replied" }
  | { outcome: "stopped"; reason: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; error: string; deliveryMayHaveOccurred?: boolean };

// Send the next due step of an enrollment (if the chain is still unbroken) and
// advance its cursor. Never throws — the cron loops over many enrollments and
// one failure must not stall the rest.
export async function processEnrollment(
  admin: Admin,
  enrollment: EnrollmentRow
): Promise<ProcessResult> {
  let deliveryStarted = false;
  let deliveredStepId: string | null = null;
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

    // Honor "Send on day" edits made while a funnel is in flight: the stored
    // next_send_at was computed from the offsets as they were when the prior
    // email went out, so re-derive this step's due time from its CURRENT
    // offset. Moved later → push the schedule out and wait; moved earlier →
    // it's simply due now and sends on this tick.
    const dueAt = stepDueAt(enrollment.enrolled_at, step.day_offset);
    if (new Date(dueAt).getTime() > Date.now()) {
      await admin
        .from("rental_inquiry_funnel_enrollments")
        .update({ next_send_at: dueAt })
        .eq("id", enrollment.id)
        .eq("status", "active");
      return { outcome: "skipped", reason: "rescheduled_by_step_edit" };
    }

    const inq = inquiry as unknown as Inquiry;
    // Check every quote-linked enrollment, including follow-ups without a
    // {quote} token. NULL also means ON DELETE SET NULL may have removed the
    // selected quote; only a new enrollment may choose the latest quote.
    let quote: InquiryQuote | null = null;
    try {
      assertFunnelTermsCompatible(ordered.slice(enrollment.steps_sent));
      if (enrollment.quote_id || funnelUsesQuote(ordered)) {
        if (!enrollment.quote_id) {
          throw new Error("This funnel has no saved quote selection. Review and enroll it with a quote again.");
        }
        quote = await enrollmentQuote(admin, enrollment);
        if (!quote) throw new Error("The selected quote is missing. Review this funnel before sending.");
        assertQuoteActionable(quote, inq);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Quote requires review";
      const { error } = await admin
        .from("rental_inquiry_funnel_enrollments")
        .update({ status: "stopped", next_send_at: null, stopped_reason: `quote_review:${reason}` })
        .eq("id", enrollment.id)
        .eq("status", "active");
      if (error) return { outcome: "error", error: `${reason} Could not stop the funnel: ${error.message}` };
      return { outcome: "stopped", reason };
    }

    const resend = resendClient();
    if (!resend) {
      return { outcome: "error", error: "RESEND_API_KEY is not configured" };
    }

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
    const stepUsesQuote = funnelUsesQuote([step]);
    const extra = quote ? {
      quote: quoteEmailBlock(quote),
      quote_number: quote.quote_number,
      quote_valid_until: formatQuoteDate(quote.valid_until),
      quote_issued_on: formatQuoteDate(quoteIssueDate(quote.created_at)),
      quote_validity: quoteValidityText(quote),
    } : undefined;

    // Empty rep name falls back to the brand team signature ("the HDR team").
    const rendered = renderTemplate(tpl, inq, "", extra);
    if (quote && !rendered.body.includes(quoteValidityText(quote))) {
      rendered.body += `\n\n${quoteValidityText(quote)}`;
    }
    assertQuoteTermsCompatible(`${rendered.subject ?? ""}\n${rendered.body}`);

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
    if (quote && stepUsesQuote) {
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

    // Persist the delivery claim before contacting the provider. If the DB
    // becomes unavailable after delivery, cron cannot blindly send again.
    // Review must reconcile this state before manually resuming.
    const { data: claimed, error: claimError } = await admin
      .from("rental_inquiry_funnel_enrollments")
      .update({ status: "stopped", stopped_reason: `delivery_pending:${step.id}`, next_send_at: null })
      .eq("id", enrollment.id)
      .eq("status", "active")
      .eq("steps_sent", enrollment.steps_sent)
      .select("id")
      .maybeSingle();
    if (claimError) return { outcome: "error", error: `Could not reserve email delivery: ${claimError.message}` };
    if (!claimed) return { outcome: "skipped", reason: "enrollment_changed_before_send" };

    // PDF generation and DB reads may have crossed the business-calendar
    // midnight boundary. Recheck immediately before contacting the provider.
    try {
      if (quote) assertQuoteActionable(quote, inq);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Quote requires review";
      const { error } = await admin
        .from("rental_inquiry_funnel_enrollments")
        .update({ stopped_reason: `quote_review:${reason}` })
        .eq("id", enrollment.id)
        .eq("stopped_reason", `delivery_pending:${step.id}`);
      if (error) return { outcome: "error", error: `${reason} Could not record review reason: ${error.message}` };
      return { outcome: "stopped", reason };
    }

    deliveryStarted = true;
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
    }, { idempotencyKey: `funnel/${enrollment.id}/${step.id}/${enrollment.steps_sent}` });
    if (sendError) {
      return {
        outcome: "error",
        error: `Email delivery needs review before retrying: ${sendError.message}`,
        deliveryMayHaveOccurred: true,
      };
    }
    deliveredStepId = step.id;

    const now = new Date().toISOString();
    const { error: messageError } = await admin.from("rental_inquiry_messages").insert({
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
    if (messageError) throw new Error(`Could not record sent email: ${messageError.message}`);
    if (quote && stepUsesQuote) {
      const { error: quoteError } = await admin
        .from("rental_inquiry_quotes")
        .update({ status: "sent" })
        .eq("id", quote.id)
        .eq("inquiry_id", enrollment.inquiry_id)
        .eq("status", "draft");
      if (quoteError) throw new Error(`Could not mark quote as sent: ${quoteError.message}`);
    }
    const { error: activityError } = await admin
      .from("rental_inquiries")
      .update({ last_activity_at: now })
      .eq("id", enrollment.inquiry_id);
    if (activityError) throw new Error(`Could not record inquiry activity: ${activityError.message}`);

    // Keep the board honest: each funnel send walks the card down the outreach
    // ladder — the quote email to Quote Sent, every later email to Followed Up
    // 1 / 2 / 3+. Forward-only and ladder-only, so a deal the customer wrote
    // back on (Responded), parked (Keep Warm), or booked never gets dragged
    // backward by the automation.
    const LADDER = ["new", "quoted", "followup", "followup2", "followup3"];
    const followupsSent = ordered
      .slice(0, enrollment.steps_sent + 1)
      .filter((s) => !funnelUsesQuote([s])).length;
    const targetStage = funnelUsesQuote([step])
      ? "quoted"
      : LADDER[Math.min(1 + followupsSent, LADDER.length - 1)];
    const currentStage = normalizeStatus(inquiry.status);
    const curIdx = LADDER.indexOf(currentStage);
    if (curIdx !== -1 && LADDER.indexOf(targetStage) > curIdx) {
      const { error: stageError } = await admin
        .from("rental_inquiries")
        .update({ status: targetStage })
        .eq("id", enrollment.inquiry_id)
        .eq("status", inquiry.status ?? "new");
      if (stageError) throw new Error(`Could not advance inquiry stage: ${stageError.message}`);
    }

    const next = ordered[enrollment.steps_sent + 1];
    const { error: advanceError } = await admin
      .from("rental_inquiry_funnel_enrollments")
      .update(
        next
          ? {
              steps_sent: enrollment.steps_sent + 1,
              status: "active",
              stopped_reason: null,
              next_send_at: stepDueAt(enrollment.enrolled_at, next.day_offset),
            }
          : { steps_sent: enrollment.steps_sent + 1, status: "completed", stopped_reason: null, next_send_at: null }
      )
      .eq("id", enrollment.id)
      .eq("stopped_reason", `delivery_pending:${step.id}`);
    if (advanceError) throw new Error(`Could not advance funnel: ${advanceError.message}`);

    return { outcome: "sent", stepId: step.id, final: !next };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    if (deliveredStepId) {
      console.error("[funnel-send] email sent; reconciliation required", enrollment.id, error);
      return {
        outcome: "sent",
        stepId: deliveredStepId,
        final: false,
        warning: `Email was sent, but the funnel is stopped for review. Do not resend. ${error}`,
      };
    }
    return {
      outcome: "error",
      error,
      ...(deliveryStarted ? { deliveryMayHaveOccurred: true } : {}),
    };
  }
}

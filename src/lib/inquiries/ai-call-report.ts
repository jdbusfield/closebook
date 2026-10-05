// Internal AI call report: one email to sales@ after every HDR AI callback,
// answered or not. JD's inbox agent reads these and drafts the customer email
// and the quote, so the report spells out what was agreed (the exact price the
// agent quoted, taken from its get_price tool result) and ends with a JSON
// block the agent can parse. Closebook sends nothing to the customer here.
//
// Sent from inquiries@ to sales@: both are staff addresses, so the Gmail
// capture skips it as internal mail and it never lands on a timeline.

import type { Resend } from "resend";

export const REPORT_FROM = "HDR AI Calls <inquiries@hdrsiteservices.com>";
export const REPORT_TO_DEFAULT = "sales@hdrsiteservices.com";
const APP_URL = "https://closebook.vercel.app";

/** The get_price result the agent heard, parsed from the call transcript. */
export interface QuotedPrice {
  trailers: number;
  days: number;
  rate_category: string | null;
  discount_pct: number;
  attendant_hours: number;
  total: number;
  say_total: number;
  per_trailer_list: number | null;
  per_trailer: number | null;
  attendant_total: number | null;
}

interface RawToolResult {
  tool_name?: string;
  result_value?: string;
  is_error?: boolean;
}
export interface RawTranscriptTurn {
  role: string;
  message: string | null;
  time_in_call_secs?: number;
  tool_results?: RawToolResult[] | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** The last successful get_price result in the call, or null if the agent never got a price. */
export function extractQuotedPrice(turns: RawTranscriptTurn[]): QuotedPrice | null {
  let found: QuotedPrice | null = null;
  for (const t of turns) {
    for (const r of t.tool_results ?? []) {
      if (r.tool_name !== "get_price" || r.is_error || !r.result_value) continue;
      let v: Record<string, unknown>;
      try {
        v = JSON.parse(r.result_value) as Record<string, unknown>;
      } catch {
        continue;
      }
      const trailers = num(v.trailers);
      const total = num(v.total);
      const sayTotal = num(v.say_total);
      if (trailers == null || total == null || sayTotal == null) continue;
      found = {
        trailers,
        days: num(v.days) ?? 1,
        rate_category: typeof v.rate_category === "string" ? v.rate_category : null,
        discount_pct: num(v.discount_pct) ?? 0,
        attendant_hours: num(v.attendant_hours) ?? 0,
        total,
        say_total: sayTotal,
        per_trailer_list: num(v.per_trailer_list),
        per_trailer: num(v.per_trailer),
        attendant_total: num(v.attendant_total),
      };
    }
  }
  return found;
}

export type ReportKind = "answered" | "voicemail" | "no_answer" | "failed";

export interface ReportInquiry {
  id: string;
  entity_id: string;
  reference: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  use_case: string | null;
  start_date: string | null;
  end_date: string | null;
  guests: string | null;
  location: string | null;
  notes: string | null;
}

export interface ReportInput {
  kind: ReportKind;
  inquiry: ReportInquiry;
  attempt: number;
  failureReason?: string | null;
  outcome?: string | null;
  collected?: Record<string, unknown>;
  summary?: string | null;
  durationSecs?: number | null;
  transcript?: RawTranscriptTurn[];
  conversationId?: string | null;
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

type Response = "accepted" | "hesitant" | "declined" | "not_quoted";

function responseOf(collected: Record<string, unknown>, quoted: QuotedPrice | null): Response {
  const r = str(collected.quote_response);
  if (r === "accepted" || r === "hesitant" || r === "declined") return quoted ? r : "not_quoted";
  return "not_quoted";
}

/** The one-line headline and the suggested next step. */
function headline(input: ReportInput, quoted: QuotedPrice | null, response: Response): { result: string; next: string } {
  const c = input.collected ?? {};
  const budget = num(c.customer_budget);
  const callback = str(c.callback_time);
  if (input.kind === "no_answer") {
    return {
      result: `No answer after ${input.attempt} ${input.attempt === 1 ? "try" : "tries"}`,
      next: "Send a \"sorry we missed you\" email asking for guest count and location.",
    };
  }
  if (input.kind === "failed") {
    return {
      result: `Call failed (${input.failureReason ?? "unknown"})`,
      next: "Follow up by email from the form details.",
    };
  }
  if (input.kind === "voicemail") {
    return { result: "Voicemail left", next: "Send a \"sorry we missed you\" email asking for guest count and location." };
  }
  if (c.do_not_call === true || input.outcome === "do_not_call") {
    return { result: "DO NOT CONTACT", next: "Customer asked us not to contact them again. Send nothing." };
  }
  if (input.outcome === "wrong_number") return { result: "Wrong number", next: "Follow up by email from the form details." };
  if (input.outcome === "callback_requested") {
    return {
      result: `Callback requested${callback ? `: ${callback}` : ""}`,
      next: `Call the customer back${callback ? ` (${callback})` : ""}.${quoted ? ` The AI quoted around ${money(quoted.say_total)}.` : ""}`,
    };
  }
  if (quoted && response === "accepted") {
    return {
      result: `Accepted around ${money(quoted.say_total)} (${quoted.trailers} trailer${quoted.trailers === 1 ? "" : "s"})`,
      next: "Send the written quote at the price below; the agent told them it was coming by email.",
    };
  }
  if (quoted && response === "hesitant") {
    return {
      result: `Wants a better price: quoted around ${money(quoted.say_total)}${budget != null ? `, budget ${money(budget)}` : ""}`,
      next: "Send a written quote with the best price we can do; the agent promised the team would look at every option.",
    };
  }
  if (quoted && response === "declined") {
    return { result: `Declined at around ${money(quoted.say_total)}`, next: "Optional: one written quote with our best price." };
  }
  if (input.outcome === "not_interested") return { result: "Not interested", next: "No follow-up needed." };
  if (input.outcome === "hung_up_early") return { result: "Hung up early", next: "Follow up by email from the form details." };
  return { result: "Talked, no price quoted", next: "Send a written quote from the details below." };
}

/** Quote lines exactly as the AI priced them, for drafting the written quote. */
export function priceLines(q: QuotedPrice): string[] {
  const lines: string[] = [];
  const unit = `4-stall restroom trailer, ${q.days} day${q.days === 1 ? "" : "s"}${q.rate_category ? ` (${q.rate_category} rate)` : ""}`;
  if (q.per_trailer_list != null) {
    lines.push(`${q.trailers} x ${unit} at ${money(q.per_trailer_list)} each = ${money(q.trailers * q.per_trailer_list)}`);
    if (q.discount_pct > 0 && q.per_trailer != null) {
      const off = q.trailers * (q.per_trailer_list - q.per_trailer);
      lines.push(`Multi-trailer discount ${q.discount_pct}% = -${money(Math.round(off * 100) / 100)}`);
    }
  } else {
    lines.push(`${q.trailers} x ${unit}${q.discount_pct ? `, ${q.discount_pct}% multi-trailer discount` : ""}`);
  }
  if (q.attendant_hours > 0) {
    lines.push(`Attendant, ${q.attendant_hours} hours${q.attendant_total != null ? ` = ${money(q.attendant_total)}` : ""}`);
  }
  lines.push(`TOTAL ${money(q.total)} (the agent said "around ${money(q.say_total)}")`);
  return lines;
}

export function buildAiCallReport(input: ReportInput): { subject: string; text: string; data: Record<string, unknown> } {
  const inq = input.inquiry;
  const c = input.collected ?? {};
  const quoted = input.kind === "answered" ? extractQuotedPrice(input.transcript ?? []) : null;
  const response = responseOf(c, quoted);
  const { result, next } = headline(input, quoted, response);
  const who = inq.name?.trim() || inq.email || inq.phone || "Unknown";
  const subject = `[AI CALL] ${inq.reference} · ${who} · ${result}`;

  const dates = inq.start_date ? (inq.end_date && inq.end_date !== inq.start_date ? `${inq.start_date} to ${inq.end_date}` : inq.start_date) : "unknown";
  const out: string[] = [
    `AI CALL REPORT · ${inq.reference}`,
    "",
    `Result: ${result}`,
    `Next step: ${next}`,
    "",
    "CUSTOMER",
    `  Name: ${inq.name ?? "unknown"}`,
    `  Email: ${inq.email ?? "none"}`,
    `  Phone: ${inq.phone ?? "none"}`,
    "",
    "FROM THE WEBSITE FORM",
    `  Event: ${inq.use_case ?? "unknown"}`,
    `  Dates: ${dates}`,
    `  Location: ${inq.location ?? "unknown"}`,
    `  Guests: ${inq.guests ?? "unknown"}`,
  ];
  if (inq.notes) out.push(`  Notes: ${inq.notes}`);

  if (input.kind === "answered") {
    out.push("", "CONFIRMED ON THE CALL");
    out.push(`  Date: ${str(c.event_date) ?? "not confirmed"}`);
    out.push(`  Guests: ${str(c.guest_count) ?? "not confirmed"}`);
    out.push(`  Location: ${str(c.location) ?? "not confirmed"}`);
    if (str(c.callback_time)) out.push(`  Callback time: ${str(c.callback_time)}`);
    out.push("", "PRICE QUOTED ON THE CALL");
    if (quoted) {
      for (const l of priceLines(quoted)) out.push(`  ${l}`);
      const budget = num(c.customer_budget);
      out.push(`  Customer response: ${response}${budget != null ? ` (budget ${money(budget)})` : ""}`);
    } else {
      out.push("  None. The agent did not quote a price, so any quote is up to us.");
    }
    if (input.summary) out.push("", "SUMMARY", `  ${input.summary}`);
    if (str(c.notes)) out.push(`  Agent notes: ${str(c.notes)}`);
  }

  out.push("", `Open in Closebook: ${APP_URL}/${inq.entity_id}/inquiries/${inq.id}`);

  const turns = (input.transcript ?? []).filter((t) => t.message && t.message.trim());
  if (turns.length) {
    out.push("", "TRANSCRIPT");
    for (const t of turns) out.push(`  ${t.role === "agent" ? "AI" : "Customer"}: ${t.message!.trim()}`);
  }

  const data: Record<string, unknown> = {
    reference: inq.reference,
    inquiry_id: inq.id,
    kind: input.kind,
    attempt: input.attempt,
    result,
    call_outcome: input.outcome ?? null,
    failure_reason: input.failureReason ?? null,
    do_not_contact: c.do_not_call === true || input.outcome === "do_not_call",
    customer: { name: inq.name, email: inq.email, phone: inq.phone },
    form: { event: inq.use_case, start_date: inq.start_date, end_date: inq.end_date, location: inq.location, guests: inq.guests },
    confirmed:
      input.kind === "answered"
        ? { event_date: str(c.event_date), guests: str(c.guest_count), location: str(c.location), callback_time: str(c.callback_time) }
        : null,
    quoted_price: quoted,
    quote_response: input.kind === "answered" ? response : null,
    customer_budget: num(c.customer_budget),
    duration_secs: input.durationSecs ?? null,
    conversation_id: input.conversationId ?? null,
  };
  out.push("", "DATA (JSON)", JSON.stringify(data, null, 2));

  return { subject, text: out.join("\n"), data };
}

/** Send the report; never throws (a failed alert must not fail the webhook). */
export async function sendAiCallReport(resend: Resend | null, input: ReportInput): Promise<void> {
  if (!resend) {
    console.error("[ai-call-report] RESEND_API_KEY not set; report not sent", input.inquiry.reference);
    return;
  }
  try {
    const { subject, text } = buildAiCallReport(input);
    const to = (process.env.AI_CALL_REPORT_TO || REPORT_TO_DEFAULT).split(",").map((s) => s.trim()).filter(Boolean);
    const { error } = await resend.emails.send({ from: REPORT_FROM, to, subject, text });
    if (error) console.error("[ai-call-report] send failed", input.inquiry.reference, error.message);
  } catch (err) {
    console.error("[ai-call-report] send threw", input.inquiry.reference, err instanceof Error ? err.message : err);
  }
}

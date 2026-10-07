// Evening digest of the day's HDR AI calls, emailed to JD. A Claude routine
// reads it from Gmail and writes the daily quality review, so the ElevenLabs
// key never has to leave Vercel. The digest is raw material for that review:
// every conversation of the day with its form details, the form price the
// agent was given, every get_price call and result, the transcript, the
// collected fields and the scoring results.

export const DIGEST_FROM = "HDR AI Calls <inquiries@hdrsiteservices.com>";
export const DIGEST_TO_DEFAULT = "jd@avonrents.com";
export const DIGEST_SUBJECT_TAG = "[AI CALL DIGEST]";

interface ToolCall {
  tool_name?: string;
  params_as_json?: string;
}
interface ToolResult {
  tool_name?: string;
  result_value?: string;
  is_error?: boolean;
}
export interface DigestTurn {
  role: string;
  message?: string | null;
  time_in_call_secs?: number;
  tool_calls?: ToolCall[] | null;
  tool_results?: ToolResult[] | null;
}

/** The parts of an ElevenLabs conversation the digest uses. */
export interface DigestConversation {
  conversation_id: string;
  start_time_unix_secs: number;
  status?: string;
  direction?: string | null;
  call_duration_secs?: number | null;
  transcript: DigestTurn[];
  dynamic_variables: Record<string, unknown>;
  collected: Record<string, unknown>;
  evaluation: Record<string, { result?: string; rationale?: string }>;
  summary?: string | null;
  phone_number?: string | null;
}

/** Closebook's side of a call, when the call came from a form. */
export interface DigestInquiry {
  reference: string;
  name: string | null;
}

const fmtTime = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  });

export const maskPhone = (n: string | null | undefined) => {
  const d = (n ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `...${d.slice(-4)}` : "none";
};

const val = (v: unknown) =>
  v === null || v === undefined || v === "" ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

/** Phone calls dial out; text-only test conversations have no direction. */
export const isPhoneCall = (c: DigestConversation) => c.direction === "outbound" || !!c.phone_number;

export function formatConversation(
  c: DigestConversation,
  index: number,
  total: number,
  inquiry: DigestInquiry | null
): string {
  const dv = c.dynamic_variables;
  const lines: string[] = [
    `=== CALL ${index} of ${total} · ${fmtTime(c.start_time_unix_secs)} PT · ${isPhoneCall(c) ? "phone call" : "TEST (text, not a real call)"} · ${c.call_duration_secs ?? 0}s · ${c.conversation_id}`,
    `Inquiry: ${inquiry ? `${inquiry.reference} (${inquiry.name?.trim().split(/\s+/)[0] ?? "unknown"})` : "none (not from a form)"} · phone ${maskPhone(c.phone_number)}`,
    `Form: event ${val(dv.event_type)} · dates ${val(dv.start_date)} to ${val(dv.end_date)} · guests ${val(dv.guests)} · location ${val(dv.event_location)}`,
    `form_price given to the agent: ${val(dv.form_price)}`,
    `Outcome: ${val(c.collected.call_outcome)} · quote_response ${val(c.collected.quote_response)} · budget ${val(c.collected.customer_budget)} · callback ${val(c.collected.callback_time)} · do_not_call ${val(c.collected.do_not_call)} · hot_lead ${val(c.collected.hot_lead)}`,
    `Confirmed: date ${val(c.collected.event_date)} · guests ${val(c.collected.guest_count)} · location ${val(c.collected.location)}`,
    `Scoring: ${Object.entries(c.evaluation).map(([k, v]) => `${k}=${v.result ?? "?"}`).join(", ") || "-"}`,
  ];
  const failed = Object.entries(c.evaluation).filter(([, v]) => v.result === "failure");
  for (const [k, v] of failed) lines.push(`  ${k} rationale: ${clip(v.rationale ?? "", 300)}`);
  if (c.summary) lines.push(`Summary: ${clip(c.summary, 600)}`);
  lines.push("Transcript:");
  for (const t of c.transcript) {
    const at = `[${t.time_in_call_secs ?? "?"}s]`;
    for (const tc of t.tool_calls ?? []) lines.push(`  ${at} TOOL CALL ${tc.tool_name}: ${clip(tc.params_as_json ?? "", 300)}`);
    for (const tr of t.tool_results ?? []) {
      lines.push(`  ${at} TOOL RESULT ${tr.tool_name}${tr.is_error ? " (ERROR)" : ""}: ${clip(tr.result_value ?? "", 400)}`);
    }
    const m = (t.message ?? "").trim();
    if (m) lines.push(`  ${at} ${t.role === "agent" ? "AI" : "Caller"}: ${m}`);
  }
  return lines.join("\n");
}

export function buildDigest(
  dayLabel: string,
  conversations: DigestConversation[],
  inquiries: Map<string, DigestInquiry>
): { subject: string; text: string } {
  const sorted = [...conversations].sort((a, b) => a.start_time_unix_secs - b.start_time_unix_secs);
  const phone = sorted.filter(isPhoneCall).length;
  const tests = sorted.length - phone;
  const subject = `${DIGEST_SUBJECT_TAG} ${dayLabel} · ${phone} call${phone === 1 ? "" : "s"}${tests ? ` · ${tests} test${tests === 1 ? "" : "s"}` : ""}`;
  const head = [
    `AI CALL DIGEST · ${dayLabel} (Pacific)`,
    `Agent: agent_1001m3wdbaxzfw9vn5ac57nmb4ch · ${phone} phone call(s), ${tests} text test(s)`,
    "Raw material for the daily review. Prices may only come from form_price (when the caller confirms the form unchanged) or a get_price TOOL RESULT.",
    "",
  ];
  if (!sorted.length) head.push("No conversations today.");
  // Real calls in full; text tests (Claude/JD testing the agent) as one line each.
  const real = sorted.filter(isPhoneCall);
  const body = real.map((c, i) => formatConversation(c, i + 1, real.length, inquiries.get(c.conversation_id) ?? null));
  const testLines = sorted
    .filter((c) => !isPhoneCall(c))
    .map((c) => `  ${fmtTime(c.start_time_unix_secs)} PT · ${c.call_duration_secs ?? 0}s · ${c.conversation_id} · outcome ${val(c.collected.call_outcome)}`);
  if (testLines.length) body.push(["TEXT TESTS (not real calls, not reviewed):", ...testLines].join("\n"));
  return { subject, text: [...head, ...body].join("\n\n") };
}

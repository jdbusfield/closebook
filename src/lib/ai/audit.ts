import type { SupabaseClient } from "@supabase/supabase-js";

interface AuditEntry {
  organizationId: string | null;
  userId: string;
  entityId: string | null;
  question: string;
  pathname: string | null;
  model: string;
  toolCalls: { name: string; input: unknown; ms: number; ok: boolean }[];
  answerPreview: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
  error: string | null;
}

export async function logAi(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  entry: AuditEntry,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("ai_audit_log").insert({
    organization_id: entry.organizationId,
    user_id: entry.userId,
    entity_id: entry.entityId,
    question: entry.question,
    pathname: entry.pathname,
    model: entry.model,
    tool_calls: entry.toolCalls,
    answer_preview: entry.answerPreview.slice(0, 1000),
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
    cache_read_tokens: entry.cacheReadTokens,
    cache_write_tokens: entry.cacheWriteTokens,
    duration_ms: entry.durationMs,
    error: entry.error,
  });
}

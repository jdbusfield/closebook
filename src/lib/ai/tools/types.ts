import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";

export interface ToolContext {
  // RLS-scoped client created from the user's session cookies. All tools
  // MUST use this — never the service-role client — so the assistant can
  // only see what the calling user is allowed to see.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>;
  userId: string;
  organizationId: string | null;
  currentEntityId: string | null;
  pathname: string | null;
  // For tools that delegate to existing internal API routes — forward the
  // user's session so the called route runs as the same user.
  baseUrl: string;
  cookieHeader: string;
}

export interface AiTool {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool.InputSchema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (input: any, ctx: ToolContext) => Promise<unknown>;
}

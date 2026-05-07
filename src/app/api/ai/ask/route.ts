import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { TOOLS, TOOL_BY_NAME, type ToolContext } from "@/lib/ai/tools";
import { logAi } from "@/lib/ai/audit";
import { detectEntityId } from "@/lib/utils/entity-context";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 6;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  messages: ChatMessage[];
  pathname?: string;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("ANTHROPIC_API_KEY not configured", { status: 500 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.messages || body.messages.length === 0) {
    return new Response("messages required", { status: 400 });
  }

  const lastUserMessage =
    [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const organizationId =
    (membership as { organization_id: string } | null)?.organization_id ?? null;

  const currentEntityId = body.pathname ? detectEntityId(body.pathname) ?? null : null;

  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host = request.headers.get("host") ?? "localhost:3000";
  const baseUrl = `${proto}://${host}`;
  const cookieHeader = request.headers.get("cookie") ?? "";

  const ctx: ToolContext = {
    supabase,
    userId: user.id,
    organizationId,
    currentEntityId,
    pathname: body.pathname ?? null,
    baseUrl,
    cookieHeader,
  };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const anthropicTools = TOOLS.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
    // Cache the entire tool block list (cache point on last tool).
    ...(i === TOOLS.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));

  const contextLines: string[] = [];
  if (body.pathname) contextLines.push(`Current page: ${body.pathname}`);
  if (currentEntityId) contextLines.push(`Current entity_id: ${currentEntityId}`);
  contextLines.push(`Today's date: ${new Date().toISOString().slice(0, 10)}`);
  const contextPrompt = contextLines.join("\n");

  const system: Anthropic.MessageCreateParams["system"] = [
    {
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: contextPrompt },
  ];

  const conversation: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const start = Date.now();
  const toolCallLog: { name: string; input: unknown; ms: number; ok: boolean }[] = [];
  let answerText = "";
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  let errorText: string | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const messageStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            system,
            tools: anthropicTools,
            messages: conversation,
          });

          for await (const event of messageStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              answerText += event.delta.text;
              send({ type: "text", delta: event.delta.text });
            }
          }

          const final = await messageStream.finalMessage();
          if (final.usage) {
            usage.input += final.usage.input_tokens ?? 0;
            usage.output += final.usage.output_tokens ?? 0;
            usage.cacheRead += final.usage.cache_read_input_tokens ?? 0;
            usage.cacheWrite += final.usage.cache_creation_input_tokens ?? 0;
          }

          if (final.stop_reason !== "tool_use") {
            break;
          }

          const toolUseBlocks = final.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );

          conversation.push({ role: "assistant", content: final.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
            toolUseBlocks.map(async (tu) => {
              send({ type: "tool_start", name: tu.name });
              const t0 = Date.now();
              const tool = TOOL_BY_NAME[tu.name];
              if (!tool) {
                const ms = Date.now() - t0;
                toolCallLog.push({ name: tu.name, input: tu.input, ms, ok: false });
                send({ type: "tool_end", name: tu.name, error: true });
                return {
                  type: "tool_result" as const,
                  tool_use_id: tu.id,
                  content: JSON.stringify({ error: `unknown tool: ${tu.name}` }),
                  is_error: true,
                };
              }
              try {
                const result = await tool.run(tu.input, ctx);
                const ms = Date.now() - t0;
                toolCallLog.push({ name: tu.name, input: tu.input, ms, ok: true });
                send({ type: "tool_end", name: tu.name });
                return {
                  type: "tool_result" as const,
                  tool_use_id: tu.id,
                  content: JSON.stringify(result),
                };
              } catch (e) {
                const ms = Date.now() - t0;
                toolCallLog.push({ name: tu.name, input: tu.input, ms, ok: false });
                send({ type: "tool_end", name: tu.name, error: true });
                return {
                  type: "tool_result" as const,
                  tool_use_id: tu.id,
                  content: JSON.stringify({ error: String(e) }),
                  is_error: true,
                };
              }
            }),
          );

          conversation.push({ role: "user", content: toolResults });
        }

        send({ type: "done" });
      } catch (e) {
        errorText = e instanceof Error ? e.message : String(e);
        send({ type: "error", message: errorText });
      } finally {
        controller.close();

        // Fire-and-forget audit (don't block close)
        logAi(supabase, {
          organizationId,
          userId: user.id,
          entityId: currentEntityId,
          question: lastUserMessage,
          pathname: body.pathname ?? null,
          model: MODEL,
          toolCalls: toolCallLog,
          answerPreview: answerText,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheReadTokens: usage.cacheRead,
          cacheWriteTokens: usage.cacheWrite,
          durationMs: Date.now() - start,
          error: errorText,
        }).catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewProductionItem, ParsedReportRow, ProductionResearch } from "./import-types";

const RESEARCH_SYSTEM_PROMPT = `You are a film and television production researcher. Given a production name + production company, you search public sources (Deadline, Variety, Hollywood Reporter, Production Weekly, The Wrap, IMDbPro public pages, studio press releases, state film commission announcements) to find:

1. Estimated shoot start date
2. Estimated wrap/end date
3. The parent studio or distributor (Netflix, Apple TV+, Hulu, HBO Max, Paramount+, NBC, CBS, Amazon, etc.)

You ALWAYS use the web_search tool to find current information. Do not rely on training-data knowledge alone — production schedules change.

Return your final answer as JSON only (no markdown, no preamble), shaped like:

{
  "estimated_start_date": "2026-05-04" or null,
  "estimated_end_date": "2026-09-15" or null,
  "parent_studio_name": "Netflix" or null,
  "confidence": "high" | "medium" | "low",
  "source_note": "1-line citation, e.g. 'Deadline Mar 2026'",
  "source_url": "the most relevant URL you found"
}

Rules:
- If you cannot find a piece of info, use null. Do not invent dates.
- Confidence: "high" if a trade publication explicitly stated the dates; "medium" if inferred from a launch/wrap window; "low" if loosely sourced.
- parent_studio_name should be the canonical short name (e.g. "Apple TV+", "Warner Bros. Television", "Netflix", "Paramount+", "Disney").`;

interface ResearchInput {
  production_name: string;
  alias_name: string | null;
  production_company: string | null;
  show_type: string | null;
}

async function researchOne(input: ResearchInput): Promise<ProductionResearch> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      estimated_start_date: null,
      estimated_end_date: null,
      parent_studio_name: null,
      matched_studio_id: null,
      confidence: "low",
      source_note: "ANTHROPIC_API_KEY missing",
      failed: true,
    };
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userMessage = `Research this production. Use web_search.

Production: "${input.production_name}"${input.alias_name ? ` (aka "${input.alias_name}")` : ""}
Production Company: ${input.production_company ?? "Unknown"}
Show Type: ${input.show_type ?? "Unknown"}

Find: estimated shoot start date, estimated wrap date, and the parent studio/distributor (the streamer or network the show is for).`;

  try {
    let messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
      { role: "user", content: userMessage },
    ];

    // Run a short tool-use loop (max 4 turns)
    for (let turn = 0; turn < 4; turn++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await (anthropic.messages.create as any)({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: RESEARCH_SYSTEM_PROMPT,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 4,
          },
        ],
        messages,
      });
      messages = [...messages, { role: "assistant", content: resp.content }];

      if (resp.stop_reason === "end_turn") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textBlock = resp.content.find((b: any) => b.type === "text");
        if (!textBlock) break;
        const raw = (textBlock as { text: string }).text.trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) break;
        const parsed = JSON.parse(jsonMatch[0]) as Omit<ProductionResearch, "matched_studio_id">;
        return { ...parsed, matched_studio_id: null };
      }
      // If the model is still using tools, the SDK auto-handles web_search results
      // by appending them — we just loop and let it run.
      if (resp.stop_reason !== "tool_use") break;
    }
  } catch (err) {
    return {
      estimated_start_date: null,
      estimated_end_date: null,
      parent_studio_name: null,
      matched_studio_id: null,
      confidence: "low",
      source_note: `Research error: ${(err as Error).message}`,
      failed: true,
    };
  }
  return {
    estimated_start_date: null,
    estimated_end_date: null,
    parent_studio_name: null,
    matched_studio_id: null,
    confidence: "low",
    source_note: "No structured answer from research agent",
    failed: true,
  };
}

/**
 * Run research in parallel for every new production. Caps concurrency at 5.
 * Mutates the items in place by setting .research.
 */
export async function researchNewProductions(
  supabase: SupabaseClient,
  organizationId: string,
  items: NewProductionItem[],
): Promise<void> {
  if (items.length === 0) return;

  // Load existing studios to attempt matching parent_studio_name against them
  const { data: studiosData } = await supabase
    .from("crm_companies")
    .select("id, name, type")
    .eq("organization_id", organizationId)
    .eq("type", "studio");
  const studios = (studiosData ?? []) as Array<{ id: string; name: string; type: string }>;

  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const studioByName = new Map<string, { id: string; name: string }>();
  for (const s of studios) studioByName.set(normalize(s.name), s);

  // Concurrency cap
  const concurrency = 5;
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      const row: ParsedReportRow = item.pdf_row;
      const research = await researchOne({
        production_name: row.production_name,
        alias_name: row.alias_name,
        production_company: row.production_company,
        show_type: row.show_type,
      });
      if (research.parent_studio_name) {
        const match = studioByName.get(normalize(research.parent_studio_name));
        if (match) research.matched_studio_id = match.id;
      }
      item.research = research;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

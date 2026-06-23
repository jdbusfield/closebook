import type { AiTool } from "./types";

export const getEntities: AiTool = {
  name: "get_entities",
  description:
    "List the entities (companies) the current user has access to in CloseBook. Use this first whenever a question references a company by name to resolve it to an entity_id.",
  inputSchema: {
    type: "object",
    properties: {
      include_inactive: {
        type: "boolean",
        description: "If true, include inactive entities. Defaults to false.",
      },
    },
  },
  async run(input: { include_inactive?: boolean }, ctx) {
    let q = ctx.supabase
      .from("entities")
      .select("id, name, code, currency, fiscal_year_end_month, is_active")
      .order("name");

    if (!input.include_inactive) {
      q = q.eq("is_active", true);
    }

    const { data, error } = await q;
    if (error) return { error: error.message };
    return { entities: data ?? [] };
  },
};

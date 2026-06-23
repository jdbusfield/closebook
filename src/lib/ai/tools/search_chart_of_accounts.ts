import type { AiTool } from "./types";

interface AccountRow {
  id: string;
  account_number: string | null;
  name: string;
  fully_qualified_name: string | null;
  classification: string;
  account_type: string;
  account_sub_type: string | null;
  is_active: boolean;
}

export const searchChartOfAccounts: AiTool = {
  name: "search_chart_of_accounts",
  description:
    "Search the chart of accounts for an entity by name, account number, classification, or account type. Use this to look up an account before drilling into its balance.",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "UUID of the entity. Defaults to current entity." },
      query: {
        type: "string",
        description: "Case-insensitive substring matched against name and account_number.",
      },
      classification: {
        type: "string",
        enum: ["Asset", "Liability", "Equity", "Revenue", "Expense"],
      },
      include_inactive: { type: "boolean", description: "Default false." },
      limit: { type: "integer", description: "Default 25, max 100." },
    },
  },
  async run(
    input: {
      entity_id?: string;
      query?: string;
      classification?: string;
      include_inactive?: boolean;
      limit?: number;
    },
    ctx,
  ) {
    const entityId = input.entity_id ?? ctx.currentEntityId;
    if (!entityId) {
      return { error: "No entity_id provided. Call get_entities first." };
    }
    const limit = Math.min(input.limit ?? 25, 100);

    let q = ctx.supabase
      .from("accounts")
      .select(
        "id, account_number, name, fully_qualified_name, classification, account_type, account_sub_type, is_active",
      )
      .eq("entity_id", entityId)
      .order("account_number", { ascending: true })
      .limit(limit);

    if (!input.include_inactive) q = q.eq("is_active", true);
    if (input.classification) q = q.eq("classification", input.classification);
    if (input.query) {
      const safe = input.query.replace(/[%_]/g, "");
      q = q.or(`name.ilike.%${safe}%,account_number.ilike.%${safe}%`);
    }

    const { data, error } = await q;
    if (error) return { error: error.message };
    const rows = (data ?? []) as unknown as AccountRow[];

    return { entity_id: entityId, count: rows.length, accounts: rows };
  },
};

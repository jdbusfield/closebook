import type { AiTool } from "./types";

interface AccountRow {
  id: string;
  account_number: string | null;
  name: string;
  classification: string;
  account_type: string;
}

interface BalanceRow {
  account_id: string;
  ending_balance: number | null;
  net_change: number | null;
}

export const getTrialBalance: AiTool = {
  name: "get_trial_balance",
  description:
    "Return the GROSS, UNADJUSTED trial balance straight from QuickBooks for one entity. Pro forma adjustments and allocations are NOT applied. DO NOT use this for income / EBITDA / margin / revenue / expense questions — use get_income_statement instead. Use this only when (a) the user explicitly asks for the unadjusted / gross / QuickBooks / pre-pro-forma view, or (b) the user wants to drill into a specific account's QB-level balance for reconciliation. Returns totals by classification plus an optional account-level drilldown.",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: {
        type: "string",
        description:
          "UUID of the entity. If omitted and the user is viewing an entity, the current entity is used.",
      },
      period_year: { type: "integer", description: "4-digit year, e.g. 2026." },
      period_month: { type: "integer", description: "1-12." },
      classification: {
        type: "string",
        enum: ["Asset", "Liability", "Equity", "Revenue", "Expense"],
        description: "If set, return account-level rows only for this classification.",
      },
      name_contains: {
        type: "string",
        description: "Optional case-insensitive account name filter.",
      },
      limit: {
        type: "integer",
        description: "Max account rows to return when drilling down. Default 50.",
      },
    },
    required: ["period_year", "period_month"],
  },
  async run(
    input: {
      entity_id?: string;
      period_year: number;
      period_month: number;
      classification?: string;
      name_contains?: string;
      limit?: number;
    },
    ctx,
  ) {
    const entityId = input.entity_id ?? ctx.currentEntityId;
    if (!entityId) {
      return {
        error:
          "No entity_id provided and no current entity in context. Call get_entities first.",
      };
    }
    const limit = Math.min(input.limit ?? 50, 200);

    const { data: accounts, error: accErr } = await ctx.supabase
      .from("accounts")
      .select("id, account_number, name, classification, account_type")
      .eq("entity_id", entityId);

    if (accErr) return { error: accErr.message };
    if (!accounts || accounts.length === 0) {
      return { error: "No accounts found for this entity." };
    }
    const accountsTyped = accounts as unknown as AccountRow[];

    const { data: balances, error: balErr } = await ctx.supabase
      .from("gl_balances")
      .select("account_id, ending_balance, net_change")
      .eq("entity_id", entityId)
      .eq("period_year", input.period_year)
      .eq("period_month", input.period_month);

    if (balErr) return { error: balErr.message };
    const balancesTyped = (balances ?? []) as unknown as BalanceRow[];

    const balanceByAccount = new Map<string, BalanceRow>();
    for (const b of balancesTyped) balanceByAccount.set(b.account_id, b);

    const totals: Record<string, { ending: number; net_change: number; count: number }> = {
      Asset: { ending: 0, net_change: 0, count: 0 },
      Liability: { ending: 0, net_change: 0, count: 0 },
      Equity: { ending: 0, net_change: 0, count: 0 },
      Revenue: { ending: 0, net_change: 0, count: 0 },
      Expense: { ending: 0, net_change: 0, count: 0 },
    };

    const drilldown: {
      account_number: string | null;
      name: string;
      classification: string;
      ending_balance: number;
      net_change: number;
    }[] = [];

    for (const a of accountsTyped) {
      const b = balanceByAccount.get(a.id);
      const ending = Number(b?.ending_balance ?? 0);
      const net = Number(b?.net_change ?? 0);
      if (totals[a.classification]) {
        totals[a.classification].ending += ending;
        totals[a.classification].net_change += net;
        totals[a.classification].count += 1;
      }

      const matchesClass = !input.classification || a.classification === input.classification;
      const matchesName =
        !input.name_contains ||
        a.name.toLowerCase().includes(input.name_contains.toLowerCase());
      if (matchesClass && matchesName && ending !== 0) {
        drilldown.push({
          account_number: a.account_number,
          name: a.name,
          classification: a.classification,
          ending_balance: ending,
          net_change: net,
        });
      }
    }

    drilldown.sort((a, b) => Math.abs(b.ending_balance) - Math.abs(a.ending_balance));

    const netIncome = totals.Revenue.ending - totals.Expense.ending;

    return {
      entity_id: entityId,
      period: { year: input.period_year, month: input.period_month },
      totals,
      net_income: netIncome,
      drilldown: drilldown.slice(0, limit),
      drilldown_truncated: drilldown.length > limit,
    };
  },
};

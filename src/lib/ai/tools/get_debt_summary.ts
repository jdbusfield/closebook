import type { AiTool } from "./types";

interface DebtInstrument {
  id: string;
  entity_id: string;
  instrument_name: string;
  lender_name: string | null;
  debt_type: string;
  original_amount: number;
  interest_rate: number;
  start_date: string;
  maturity_date: string | null;
  payment_amount: number | null;
  credit_limit: number | null;
  current_draw: number | null;
  status: string;
}

interface AmortRow {
  debt_instrument_id: string;
  period_year: number;
  period_month: number;
  beginning_balance: number;
  payment: number;
  principal: number;
  interest: number;
  ending_balance: number;
}

export const getDebtSummary: AiTool = {
  name: "get_debt_summary",
  description:
    "Summarize debt instruments (term loans and lines of credit) for an entity, with optional period-month amortization detail. Returns each instrument's outstanding balance, rate, maturity, and payment due.",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "UUID of the entity. Defaults to current entity." },
      period_year: {
        type: "integer",
        description: "If supplied with period_month, also returns amortization for that month.",
      },
      period_month: { type: "integer", description: "1-12." },
      include_paid_off: {
        type: "boolean",
        description: "Include paid_off / inactive instruments. Defaults false.",
      },
    },
  },
  async run(
    input: {
      entity_id?: string;
      period_year?: number;
      period_month?: number;
      include_paid_off?: boolean;
    },
    ctx,
  ) {
    const entityId = input.entity_id ?? ctx.currentEntityId;
    if (!entityId) {
      return { error: "No entity_id provided. Call get_entities first." };
    }

    let q = ctx.supabase
      .from("debt_instruments")
      .select(
        "id, entity_id, instrument_name, lender_name, debt_type, original_amount, interest_rate, start_date, maturity_date, payment_amount, credit_limit, current_draw, status",
      )
      .eq("entity_id", entityId);

    if (!input.include_paid_off) {
      q = q.eq("status", "active");
    }

    const { data: instruments, error } = await q;
    if (error) return { error: error.message };
    const instrumentsTyped = (instruments ?? []) as unknown as DebtInstrument[];

    const amortByInstrument: Record<string, AmortRow> = {};
    if (input.period_year && input.period_month && instrumentsTyped.length > 0) {
      const ids = instrumentsTyped.map((i) => i.id);
      const { data: amort } = await ctx.supabase
        .from("debt_amortization")
        .select(
          "debt_instrument_id, period_year, period_month, beginning_balance, payment, principal, interest, ending_balance",
        )
        .in("debt_instrument_id", ids)
        .eq("period_year", input.period_year)
        .eq("period_month", input.period_month);

      const amortTyped = (amort ?? []) as unknown as AmortRow[];
      for (const r of amortTyped) amortByInstrument[r.debt_instrument_id] = r;
    }

    let totalOutstanding = 0;
    let totalMonthlyPayment = 0;
    const rows = instrumentsTyped.map((i) => {
      const amort = amortByInstrument[i.id];
      const outstanding =
        i.debt_type === "line_of_credit"
          ? Number(i.current_draw ?? 0)
          : Number(amort?.ending_balance ?? i.original_amount);
      totalOutstanding += outstanding;
      const monthlyPayment = Number(amort?.payment ?? i.payment_amount ?? 0);
      totalMonthlyPayment += monthlyPayment;
      return {
        id: i.id,
        instrument_name: i.instrument_name,
        lender_name: i.lender_name,
        debt_type: i.debt_type,
        interest_rate_pct: Number(i.interest_rate) * 100,
        maturity_date: i.maturity_date,
        original_amount: Number(i.original_amount),
        credit_limit: i.credit_limit ? Number(i.credit_limit) : null,
        outstanding_balance: outstanding,
        period_payment: amort
          ? {
              payment: Number(amort.payment),
              principal: Number(amort.principal),
              interest: Number(amort.interest),
            }
          : null,
        status: i.status,
      };
    });

    return {
      entity_id: entityId,
      instrument_count: rows.length,
      total_outstanding: totalOutstanding,
      total_monthly_payment: totalMonthlyPayment,
      instruments: rows,
    };
  },
};

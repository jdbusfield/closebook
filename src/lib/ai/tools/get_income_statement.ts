import type { AiTool } from "./types";

interface LineItem {
  id: string;
  label: string;
  accountNumber?: string;
  amounts: Record<string, number>;
  indent: number;
  isTotal: boolean;
  isGrandTotal: boolean;
  isHeader: boolean;
  isSeparator: boolean;
}

interface StatementSection {
  id: string;
  title: string;
  lines: LineItem[];
  subtotalLine?: LineItem;
}

interface StatementData {
  id: string;
  title: string;
  sections: StatementSection[];
}

interface FinancialStatementsResponse {
  periods: { key: string; label: string; year: number; startMonth: number; endMonth: number }[];
  incomeStatement: StatementData;
  metadata: {
    entityName?: string;
    organizationName?: string;
    reportingEntityName?: string;
    scope: string;
    granularity: string;
    startPeriod: string;
    endPeriod: string;
  };
  proFormaAdjustments?: {
    entityCode: string;
    accountName: string;
    description: string;
    amount: number;
    bucketKey: string;
  }[];
}

function sumLine(line: LineItem, periodKey: string): number {
  return Number(line.amounts[periodKey] ?? 0);
}

interface PeriodSummary {
  period_key: string;
  period_label: string;
  revenue: number;
  direct_operating_costs: number;
  other_operating_costs: number;
  ebitda: number;
  ebitda_margin_pct: number;
  pro_forma_total_impact: number;
  allocation_impact_note: string;
}

export const getIncomeStatement: AiTool = {
  name: "get_income_statement",
  description:
    "PRIMARY tool for any income / P&L / EBITDA / margin / revenue / expense question. Returns the income statement WITH pro forma adjustments AND allocations applied — the financial-model view, not the gross QuickBooks trial balance. Supports single entity, reporting entity, or organization-wide (use organization for 'all companies' questions). EBITDA is defined here as Revenue − Direct Operating Costs − Other Operating Costs (= Total Operating Margin). No D&A add-back is performed; that is already CloseBook's working definition.",
  inputSchema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["entity", "organization", "reporting_entity"],
        description:
          "Use 'organization' for 'all companies' / consolidated questions. Use 'entity' for a single company. Use 'reporting_entity' for a roll-up.",
      },
      entity_id: { type: "string", description: "Required when scope=entity. Defaults to current entity." },
      reporting_entity_id: { type: "string", description: "Required when scope=reporting_entity." },
      organization_id: {
        type: "string",
        description: "Required when scope=organization. Defaults to the user's organization.",
      },
      start_year: { type: "integer" },
      start_month: { type: "integer", description: "1-12." },
      end_year: { type: "integer" },
      end_month: { type: "integer", description: "1-12." },
      granularity: {
        type: "string",
        enum: ["monthly", "quarterly", "yearly"],
        description: "Default monthly.",
      },
      include_pro_forma: {
        type: "boolean",
        description:
          "Default TRUE. Only set false if the user explicitly asks for the unadjusted / pre-pro-forma view.",
      },
      include_allocations: {
        type: "boolean",
        description:
          "Default TRUE. Only set false if the user explicitly asks for pre-allocation numbers.",
      },
    },
    required: ["start_year", "start_month", "end_year", "end_month"],
  },
  async run(
    input: {
      scope?: "entity" | "organization" | "reporting_entity";
      entity_id?: string;
      reporting_entity_id?: string;
      organization_id?: string;
      start_year: number;
      start_month: number;
      end_year: number;
      end_month: number;
      granularity?: "monthly" | "quarterly" | "yearly";
      include_pro_forma?: boolean;
      include_allocations?: boolean;
    },
    ctx,
  ) {
    const scope = input.scope ?? (ctx.currentEntityId ? "entity" : "organization");
    const params = new URLSearchParams();
    params.set("scope", scope);
    params.set("startYear", String(input.start_year));
    params.set("startMonth", String(input.start_month));
    params.set("endYear", String(input.end_year));
    params.set("endMonth", String(input.end_month));
    params.set("granularity", input.granularity ?? "monthly");
    params.set("includeProForma", String(input.include_pro_forma ?? true));
    params.set("includeAllocations", String(input.include_allocations ?? true));

    if (scope === "entity") {
      const entityId = input.entity_id ?? ctx.currentEntityId;
      if (!entityId) {
        return { error: "scope=entity but no entity_id provided. Call get_entities first." };
      }
      params.set("entityId", entityId);
    } else if (scope === "reporting_entity") {
      if (!input.reporting_entity_id) {
        return { error: "scope=reporting_entity requires reporting_entity_id." };
      }
      params.set("reportingEntityId", input.reporting_entity_id);
    } else if (scope === "organization") {
      const orgId = input.organization_id ?? ctx.organizationId;
      if (!orgId) {
        return { error: "scope=organization but organization_id is unknown." };
      }
      params.set("organizationId", orgId);
    }

    const url = `${ctx.baseUrl}/api/financial-statements?${params.toString()}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { cookie: ctx.cookieHeader },
        cache: "no-store",
      });
    } catch (e) {
      return { error: `Failed to call financial-statements: ${String(e)}` };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: `financial-statements ${res.status}: ${text.slice(0, 300)}` };
    }

    let data: FinancialStatementsResponse;
    try {
      data = (await res.json()) as FinancialStatementsResponse;
    } catch (e) {
      return { error: `Bad JSON from financial-statements: ${String(e)}` };
    }

    const sections = data.incomeStatement?.sections ?? [];
    const byId = (id: string) => sections.find((s) => s.id === id);

    const revenueSection = byId("revenue");
    const directOpSection = byId("direct_operating_costs");
    const otherOpSection = byId("other_operating_costs");

    const periodSummaries: PeriodSummary[] = data.periods.map((p) => {
      const sumSection = (sec?: StatementSection) => {
        if (!sec) return 0;
        if (sec.subtotalLine) return sumLine(sec.subtotalLine, p.key);
        return sec.lines.reduce((s, l) => {
          if (l.isHeader || l.isSeparator || l.isTotal || l.isGrandTotal) return s;
          return s + sumLine(l, p.key);
        }, 0);
      };

      const revenue = sumSection(revenueSection);
      const directOp = sumSection(directOpSection);
      const otherOp = sumSection(otherOpSection);
      const ebitda = revenue - directOp - otherOp;
      const ebitdaMargin = revenue !== 0 ? (ebitda / revenue) * 100 : 0;

      const proFormaImpact = (data.proFormaAdjustments ?? [])
        .filter((adj) => adj.bucketKey === p.key)
        .reduce((s, adj) => s + Number(adj.amount), 0);

      return {
        period_key: p.key,
        period_label: p.label,
        revenue,
        direct_operating_costs: directOp,
        other_operating_costs: otherOp,
        ebitda,
        ebitda_margin_pct: ebitdaMargin,
        pro_forma_total_impact: proFormaImpact,
        allocation_impact_note:
          (input.include_allocations ?? true)
            ? "Allocations applied. Allocations net to zero across entities; org-scope totals are unaffected by allocations themselves but entity-scope numbers reflect them."
            : "Allocations NOT applied (excluded by request).",
      };
    });

    const sectionSubtotalsById: Record<string, Record<string, number>> = {};
    for (const sec of sections) {
      const perPeriod: Record<string, number> = {};
      for (const p of data.periods) {
        perPeriod[p.key] = sec.subtotalLine
          ? sumLine(sec.subtotalLine, p.key)
          : sec.lines.reduce(
              (s, l) =>
                l.isHeader || l.isSeparator || l.isTotal || l.isGrandTotal
                  ? s
                  : s + sumLine(l, p.key),
              0,
            );
      }
      sectionSubtotalsById[sec.id] = perPeriod;
    }

    return {
      scope,
      metadata: data.metadata,
      include_pro_forma: input.include_pro_forma ?? true,
      include_allocations: input.include_allocations ?? true,
      periods: periodSummaries,
      section_subtotals_by_id: sectionSubtotalsById,
      sections: sections.map((s) => ({ id: s.id, title: s.title, line_count: s.lines.length })),
      pro_forma_adjustment_count: (data.proFormaAdjustments ?? []).length,
    };
  },
};

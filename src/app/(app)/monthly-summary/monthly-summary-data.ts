"use client";

/**
 * Fetches the consolidated P&L (via /api/financial-statements) and fleet KPIs
 * (via /api/rental-assets/monthly-summary) and maps them into the shared
 * MonthlySummaryInput model consumed by both the on-page preview and the PDF.
 */

import type {
  StatementSection,
  LineItem,
} from "@/components/financial-statements/types";
import type {
  CellValues,
  MonthlySummaryInput,
  SummaryRow,
  SummarySection,
} from "./monthly-summary-model";

export const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MONTH_SHORT = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

// ── KPI endpoint response shape ──
interface KpiTriple {
  month: number;
  ytd: number;
  pyMonth: number;
  pyYtd: number;
}
interface KpiSegment {
  util: KpiTriple;
  rate: KpiTriple;
  onRent: KpiTriple;
  fleet: { month: number; pyMonth: number };
}
interface KpiResponse {
  segments: { vehicle: KpiSegment; trailer: KpiSegment; total: KpiSegment };
}

export interface BuildParams {
  organizationId: string;
  organizationName: string;
  year: number;
  month: number;
  includeService: boolean;
}

export async function buildMonthlySummary(
  p: BuildParams
): Promise<MonthlySummaryInput> {
  const { organizationId, organizationName, year, month, includeService } = p;
  const mKey = monthKey(year, month);
  const ytdKey = month > 1 ? "TOTAL" : mKey;

  const finUrl =
    `/api/financial-statements?scope=organization&organizationId=${organizationId}` +
    `&startYear=${year}&startMonth=1&endYear=${year}&endMonth=${month}` +
    `&granularity=monthly&includeTotal=true&includeYoY=true&includeBudget=true` +
    `&includeProForma=true&includeAllocations=true`;
  const kpiUrl =
    `/api/rental-assets/monthly-summary?organization_id=${organizationId}` +
    `&year=${year}&month=${month}&include_service=${includeService}`;

  const [finRes, kpiRes] = await Promise.all([fetch(finUrl), fetch(kpiUrl)]);
  if (!finRes.ok) {
    throw new Error(`Financial statements failed: ${(await finRes.json()).error ?? finRes.status}`);
  }
  if (!kpiRes.ok) {
    throw new Error(`Fleet KPIs failed: ${(await kpiRes.json()).error ?? kpiRes.status}`);
  }
  const fin = await finRes.json();
  const kpi: KpiResponse = await kpiRes.json();

  // ── P&L extraction ──
  const sections = (fin.incomeStatement?.sections ?? []) as StatementSection[];
  const byId = new Map(sections.map((s) => [s.id, s]));
  const lineOf = (id: string): LineItem | undefined => byId.get(id)?.subtotalLine;

  function moneyVals(id: string): { month: CellValues; ytd: CellValues } {
    const l = lineOf(id);
    const pick = (key: string): CellValues => ({
      actual: l?.amounts?.[key] ?? null,
      py: l?.priorYearAmounts?.[key] ?? null,
      budget: l?.budgetAmounts?.[key] ?? null,
    });
    return { month: pick(mKey), ytd: pick(ytdKey) };
  }
  function pctVals(id: string): { month: CellValues; ytd: CellValues } {
    const l = lineOf(id);
    const x100 = (n: number | null | undefined) => (n == null ? null : n * 100);
    const pick = (key: string): CellValues => ({
      actual: x100(l?.amounts?.[key]),
      py: x100(l?.priorYearAmounts?.[key]),
      budget: x100(l?.budgetAmounts?.[key]),
    });
    return { month: pick(mKey), ytd: pick(ytdKey) };
  }

  // Combine the two operating-cost sections (direct + fixed) into a single line.
  function combineVals(
    a: { month: CellValues; ytd: CellValues },
    b: { month: CellValues; ytd: CellValues }
  ): { month: CellValues; ytd: CellValues } {
    const add = (x: number | null, y: number | null) =>
      x == null && y == null ? null : (x ?? 0) + (y ?? 0);
    const cv = (q: CellValues, r: CellValues): CellValues => ({
      actual: add(q.actual, r.actual),
      py: add(q.py, r.py),
      budget: add(q.budget, r.budget),
    });
    return { month: cv(a.month, b.month), ytd: cv(a.ytd, b.ytd) };
  }
  const totalOperatingCosts = combineVals(
    moneyVals("direct_operating_costs"),
    moneyVals("other_operating_costs")
  );

  const mkRow = (
    label: string,
    kind: SummaryRow["kind"],
    vals: { month: CellValues; ytd: CellValues },
    opts: Partial<SummaryRow> = {}
  ): SummaryRow => ({ label, kind, ...vals, ...opts });

  const emptyVals = (): CellValues => ({ actual: null, py: null, budget: null });

  const performance: SummarySection = {
    title: "Month Performance",
    showBudget: true,
    rows: [
      mkRow("Total Revenue", "money", moneyVals("revenue")),
      mkRow("Total Operating Costs", "money", totalOperatingCosts, { invert: true }),
      { label: "", kind: "money", spacer: true, month: emptyVals(), ytd: emptyVals() },
      mkRow("EBITDA", "money", moneyVals("operating_margin"), { bold: true }),
      mkRow("EBITDA %", "pct", pctVals("operating_margin_pct"), { sub: true }),
    ],
  };

  // ── KPI sections ──
  const seg = kpi.segments;
  const utilRow = (label: string, s: KpiSegment): SummaryRow =>
    mkRow(label, "pct", {
      month: { actual: s.util.month, py: s.util.pyMonth, budget: null },
      ytd: { actual: s.util.ytd, py: s.util.pyYtd, budget: null },
    });
  const rateRow = (label: string, s: KpiSegment): SummaryRow =>
    mkRow(label, "rate", {
      month: { actual: s.rate.month, py: s.rate.pyMonth, budget: null },
      ytd: { actual: s.rate.ytd, py: s.rate.pyYtd, budget: null },
    });
  const fleetRow = (label: string, s: KpiSegment): SummaryRow =>
    mkRow(label, "count", {
      month: { actual: s.fleet.month, py: s.fleet.pyMonth, budget: null },
      ytd: emptyVals(),
    });
  const onRentRow = (label: string, s: KpiSegment): SummaryRow =>
    mkRow(label, "avg", {
      month: { actual: s.onRent.month, py: s.onRent.pyMonth, budget: null },
      ytd: { actual: s.onRent.ytd, py: s.onRent.pyYtd, budget: null },
    });

  const utilization: SummarySection = {
    title: "Month Utilization",
    showBudget: false,
    rows: [
      utilRow("Total Vehicle", seg.vehicle),
      utilRow("Total Trailer", seg.trailer),
      { ...utilRow("Total Fleet Util %", seg.total), label: "Total Fleet Util %", bold: true },
    ],
  };
  const avgOnRent: SummarySection = {
    title: "Average Vehicles on Rent",
    showBudget: false,
    rows: [
      onRentRow("Total Vehicle", seg.vehicle),
      onRentRow("Total Trailer", seg.trailer),
      { ...onRentRow("Total", seg.total), bold: true },
    ],
  };
  const rates: SummarySection = {
    title: "Month Rates",
    showBudget: false,
    rows: [
      rateRow("Total Vehicle", seg.vehicle),
      rateRow("Total Trailer", seg.trailer),
      rateRow("Total", seg.total),
    ],
  };
  const fleet: SummarySection = {
    title: "End of Month Fleet Size",
    showBudget: false,
    rows: [
      fleetRow("Total Vehicle", seg.vehicle),
      fleetRow("Total Trailer", seg.trailer),
      fleetRow("Total", seg.total),
    ],
  };

  return {
    organizationName,
    monthLabel: `${MONTH_NAMES[month]} ${year}`,
    monthShort: `${MONTH_SHORT[month]}-${String(year).slice(2)}`,
    pyShort: `${MONTH_SHORT[month]}-${String(year - 1).slice(2)}`,
    ytdShort: `YTD-${String(year).slice(2)}`,
    ytdPyShort: `YTD-${String(year - 1).slice(2)}`,
    generatedAtIso: new Date().toISOString(),
    scopeNote: "Consolidated",
    sections: [performance, utilization, avgOnRent, rates, fleet],
  };
}

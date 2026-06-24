"use client";

/**
 * Fetches the consolidated P&L (via /api/financial-statements) and fleet KPIs
 * (via /api/rental-assets/monthly-summary) and maps them into the shared
 * MonthlySummaryInput model consumed by both the on-page preview and the PDF.
 *
 * The heavy network fetch (fetchSummaryBase) is separate from the cheap
 * assembly of manually-entered panels (buildManualPanels) so editing the
 * manual data points re-renders the preview without re-fetching.
 */

import type {
  StatementSection,
  LineItem,
} from "@/components/financial-statements/types";
import type {
  CellValues,
  MonthlySummaryInput,
  PanelRow,
  SummaryPanel,
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

// ── Manually-entered data points (persisted in localStorage per period) ──
export interface ManualInputs {
  /** keyed by entity id → { current, prior-year } headcount */
  headcount: Record<string, { current: number | null; py: number | null }>;
  caShows: { current: number | null; py: number | null };
}

export function emptyManualInputs(): ManualInputs {
  return { headcount: {}, caShows: { current: null, py: null } };
}

const manualKey = (orgId: string, year: number, month: number) =>
  `closebook:monthly-summary-manual:${orgId}:${year}-${month}`;

export function loadManualInputs(
  orgId: string,
  year: number,
  month: number
): ManualInputs {
  try {
    const raw = localStorage.getItem(manualKey(orgId, year, month));
    if (raw) return { ...emptyManualInputs(), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return emptyManualInputs();
}

export function saveManualInputs(
  orgId: string,
  year: number,
  month: number,
  inputs: ManualInputs
): void {
  try {
    localStorage.setItem(manualKey(orgId, year, month), JSON.stringify(inputs));
  } catch {
    /* ignore */
  }
}

export interface BuildParams {
  organizationId: string;
  organizationName: string;
  year: number;
  month: number;
  includeService: boolean;
}

/**
 * Fetches and maps the data-driven part of the report: the P&L / KPI sections
 * plus the (data-driven) End of Month Fleet Size panel. The manual panels are
 * appended later by buildManualPanels.
 */
export async function fetchSummaryBase(
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

  const monthShort = `${MONTH_SHORT[month]}-${String(year).slice(2)}`;
  const pyShort = `${MONTH_SHORT[month]}-${String(year - 1).slice(2)}`;

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
    title: "Financial performance",
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
  const onRentRow = (label: string, s: KpiSegment): SummaryRow =>
    mkRow(label, "avg", {
      month: { actual: s.onRent.month, py: s.onRent.pyMonth, budget: null },
      ytd: { actual: s.onRent.ytd, py: s.onRent.pyYtd, budget: null },
    });

  const utilization: SummarySection = {
    title: "Vehicle utilization",
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
    title: "Average daily rate",
    showBudget: false,
    rows: [
      rateRow("Total Vehicle", seg.vehicle),
      rateRow("Total Trailer", seg.trailer),
      rateRow("Total", seg.total),
    ],
  };

  // ── Fleet size as a compact bottom panel (was a full-width section) ──
  const fleetPanel: SummaryPanel = {
    title: "End of period fleet size",
    kind: "count",
    showPy: true,
    colorVariance: true,
    currentLabel: monthShort,
    pyLabel: pyShort,
    rows: [
      { label: "Vehicle", current: seg.vehicle.fleet.month, py: seg.vehicle.fleet.pyMonth },
      { label: "Trailer", current: seg.trailer.fleet.month, py: seg.trailer.fleet.pyMonth },
      { label: "Total", current: seg.total.fleet.month, py: seg.total.fleet.pyMonth, bold: true },
    ],
  };

  return {
    organizationName,
    monthLabel: `${MONTH_NAMES[month]} ${year}`,
    monthShort,
    pyShort,
    ytdShort: `YTD-${String(year).slice(2)}`,
    ytdPyShort: `YTD-${String(year - 1).slice(2)}`,
    generatedAtIso: new Date().toISOString(),
    scopeNote: "Consolidated",
    sections: [performance, utilization, avgOnRent, rates],
    panels: [fleetPanel],
  };
}

/** Sum a list of nullable numbers; returns null only when every value is null. */
function sumOrNull(vals: Array<number | null>): number | null {
  if (vals.every((v) => v == null)) return null;
  return vals.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

/**
 * Builds the manually-entered panels (Headcount by Entity, California Shows)
 * from the user's inputs. Cheap and pure so it can run on every edit.
 */
export function buildManualPanels(
  entities: Array<{ id: string; name: string; code: string }>,
  manual: ManualInputs,
  currentLabel: string,
  pyLabel: string
): SummaryPanel[] {
  const headRows: PanelRow[] = entities.map((e) => ({
    label: e.code || e.name,
    current: manual.headcount[e.id]?.current ?? null,
    py: manual.headcount[e.id]?.py ?? null,
  }));
  headRows.push({
    label: "Total",
    current: sumOrNull(headRows.map((r) => r.current)),
    py: sumOrNull(headRows.map((r) => r.py)),
    bold: true,
  });

  const headcount: SummaryPanel = {
    title: "End of period head count",
    // One decimal so employees allocated across two entities can show as 0.5.
    kind: "avg",
    showPy: true,
    colorVariance: false, // headcount up/down isn't inherently good/bad
    currentLabel,
    pyLabel,
    rows: headRows,
  };

  const caShows: SummaryPanel = {
    title: "California Shows",
    kind: "count",
    showPy: true,
    colorVariance: true, // more shows = favorable
    currentLabel,
    pyLabel,
    rows: [
      { label: "Shows", current: manual.caShows.current, py: manual.caShows.py, bold: true },
    ],
  };

  return [headcount, caShows];
}

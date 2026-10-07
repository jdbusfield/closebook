/**
 * One budget version as the Model page shows it: every top-level master
 * that rolls up to EBITDA, in statement order, with the items beneath each
 * one (payroll from the plan, rent from the leases, run rates, and the
 * items typed here with a method and a reason), prior-year actuals for the
 * comparison rows, and one net figure for everything below EBITDA.
 * Shared by GET /api/budget/lines and the consolidated model.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import type { VersionOwner } from "@/lib/budget/access";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { loadMasters, loadMonthlyActuals, monthKey, rollupActualsToParents, type MasterInfo } from "@/lib/budget/actuals";
import { loadMemberEntityIds, resolveVersionChartId } from "@/lib/budget/recompute";
import { INCOME_STATEMENT_SECTIONS } from "@/lib/config/statement-sections";
import { describeMethod, readMethod, type LineMethod } from "@/lib/budget/line-methods";
import { loadFinancialModelYear } from "@/lib/budget/fm-actuals";
import { loadOverriddenMasters } from "@/lib/budget/line-overrides";
import { loadZeroMonths } from "@/lib/budget/line-zero-months";

const NIL_CLASS = "00000000-0000-0000-0000-000000000000";

/** The sections that roll up to EBITDA, in Financial Model order. */
export const MODEL_SECTIONS = new Set(["revenue", "direct_operating_costs", "other_operating_costs"]);

export type ItemKind = "payroll" | "schedule" | "driver" | "capex" | "run_rate" | "method" | "manual" | "entered" | "zeroed";

export interface ModelItem {
  id: string;
  kind: ItemKind;
  label: string;
  /** Where the number comes from: Payroll plan, Real Estate, Insurance, ... */
  source: string;
  sourceHref: string | null;
  /** Plain-English method for method and run-rate items */
  methodText: string | null;
  method: LineMethod | null;
  note: string | null;
  /** People, leases or policies behind a grouped item */
  count: number | null;
  months: number[];
  total: number;
  /** Edited here (items) or through its source */
  editable: boolean;
  /** Last year's total (and months, once the item has been recomputed) for the item's own history */
  history: { priorYear: number; trailing12: number; priorYearMonths?: number[] } | null;
  /** A pod: the pieces that net to this item (a lease and its subleases) */
  parts?: Array<{ label: string; months: number[]; total: number; note: string | null }>;
  /** Built from last year by "Build from last year" (replaced, not stacked, when built again) */
  priorBase?: boolean;
}

interface BuildRow {
  id: string;
  master_account_id: string;
  qbo_class_id: string | null;
  build_type: string;
  source_table: string | null;
  source_id: string | null;
  component: string | null;
  label: string;
  note: string | null;
  amounts: unknown;
  meta: unknown;
}
const metaOf = (b: BuildRow) => (b.meta && typeof b.meta === "object" ? (b.meta as Record<string, unknown>) : {});

const SOURCE_BY_TABLE: Record<string, { label: string; href: (fy: number, entityId: string | null) => string | null }> = {
  budget_headcount: { label: "Payroll plan", href: (fy) => `/budget/payroll/${fy}` },
  leases: { label: "Real Estate", href: (_fy, e) => (e ? `/${e}/real-estate` : null) },
  subleases: { label: "Real Estate", href: (_fy, e) => (e ? `/${e}/real-estate` : null) },
  debt_instruments: { label: "Debt schedule", href: () => "/debt" },
  fixed_assets: { label: "Rental assets", href: () => "/rental-assets" },
  insurance_policies: { label: "Insurance", href: (_fy, e) => (e ? `/${e}/insurance` : null) },
  allocation_adjustments: { label: "IC allocations", href: () => "/ic-eliminations" },
  capex_plan_items: { label: "Capex plan", href: () => "/capex-plan" },
  disposal_plan_items: { label: "Capex plan", href: () => "/capex-plan" },
  rental_asset_kpis: { label: "Fleet driver", href: () => null },
  gl_balances: { label: "Run rate", href: () => null },
};

function monthsOf(b: { amounts: unknown }): number[] {
  const a = (b.amounts ?? {}) as Record<string, unknown>;
  return Array.from({ length: 12 }, (_, i) => Math.round(Number(a[String(i + 1)] ?? 0) * 100) / 100);
}
function addInto(target: number[], src: number[]) {
  for (let i = 0; i < 12; i++) target[i] += src[i];
}
const total = (a: number[]) => Math.round(a.reduce((t, v) => t + v, 0) * 100) / 100;

export async function buildVersionModel(admin: ReturnType<typeof createAdminClient>, owner: VersionOwner, opts: { withActuals: boolean }) {
  const withActuals = opts.withActuals;
  const [memberSet, chartId] = await Promise.all([loadMemberEntityIds(admin, owner), resolveVersionChartId(admin, owner)]);
  const memberEntityIds = [...memberSet];
  const masters = await loadMasters(admin, chartId);
  const masterById = new Map(masters.map((m) => [m.id, m]));
  const topOf = (id: string) => masterById.get(id)?.parentAccountId ?? id;

  const [cells, builds, notes, actuals] = await Promise.all([
    fetchAllPaginated<{ master_account_id: string; period_month: number; amount: number; source: string }>((o, l) =>
      admin
        .from("budget_amounts")
        .select("master_account_id, period_month, amount, source")
        .eq("budget_version_id", owner.id)
        .eq("period_year", owner.fiscalYear)
        .range(o, o + l - 1),
    ),
    fetchAllPaginated<BuildRow>((o, l) =>
      admin
        .from("budget_builds")
        .select("id, master_account_id, qbo_class_id, build_type, source_table, source_id, component, label, note, amounts, meta")
        .eq("budget_version_id", owner.id)
        .order("build_type")
        .order("label")
        .range(o, o + l - 1),
    ),
    fetchAllPaginated<{ master_account_id: string; class_key: string; note: string | null; review_flag: string | null }>((o, l) =>
      admin.from("budget_line_notes").select("master_account_id, class_key, note, review_flag").eq("budget_version_id", owner.id).range(o, o + l - 1),
    ),
    withActuals && memberEntityIds.length > 0
      ? loadMonthlyActuals(admin, { chartId, entityIds: memberEntityIds, startYear: owner.fiscalYear - 2, startMonth: 1, endYear: owner.fiscalYear - 1, endMonth: 12, masters })
      : Promise.resolve(null),
  ]);

  // Lines: cells summed to the top-level master (children and classes fold in)
  const lineMonths = new Map<string, number[]>();
  const enteredMonths = new Map<string, number[]>();
  for (const c of cells) {
    const top = topOf(c.master_account_id);
    const s = lineMonths.get(top) ?? new Array(12).fill(0);
    s[c.period_month - 1] += Number(c.amount ?? 0);
    lineMonths.set(top, s);
    if (c.source !== "build") {
      const e = enteredMonths.get(top) ?? new Array(12).fill(0);
      e[c.period_month - 1] += Number(c.amount ?? 0);
      enteredMonths.set(top, e);
    }
  }

  // Items beneath each master
  const items = new Map<string, ModelItem[]>();
  const push = (top: string, item: ModelItem) => items.set(top, [...(items.get(top) ?? []), item]);
  const entityForHref = owner.entityId ?? memberEntityIds[0] ?? null;
  const sourceOf = (b: BuildRow) => SOURCE_BY_TABLE[b.source_table ?? ""] ?? { label: b.build_type === "driver" ? "Fleet driver" : "Schedule", href: () => null };

  // Payroll: one item per component (sub-master), people counted
  const payroll = new Map<string, { top: string; label: string; months: number[]; people: Set<string> }>();
  // Leases and other schedules: one item per source row, components summed
  const grouped = new Map<string, { top: string; b: BuildRow; months: number[]; count: number }>();
  for (const b of builds) {
    const top = topOf(b.master_account_id);
    const m = monthsOf(b);
    if (b.build_type === "headcount") {
      const sub = masterById.get(b.master_account_id);
      const key = `${top}|${b.master_account_id}`;
      const g = payroll.get(key) ?? { top, label: sub?.name ?? "Personnel", months: new Array(12).fill(0), people: new Set<string>() };
      addInto(g.months, m);
      g.people.add(b.label.replace(/\s*\([^)]*\)\s*$/, ""));
      payroll.set(key, g);
      continue;
    }
    if (b.build_type === "schedule" && b.source_id) {
      const key = `${top}|${b.source_table}|${b.source_id}`;
      const g = grouped.get(key) ?? { top, b, months: new Array(12).fill(0), count: 0 };
      addInto(g.months, m);
      g.count++;
      grouped.set(key, g);
      continue;
    }
    const method = b.build_type === "manual" ? readMethod(metaOf(b).method) : null;
    const src = sourceOf(b);
    const kind: ItemKind = b.build_type === "trend" ? "run_rate" : b.build_type === "manual" ? (method ? "method" : "manual") : b.build_type === "driver" ? "driver" : b.build_type === "capex" ? "capex" : "schedule";
    let methodText: string | null = null;
    if (kind === "run_rate") {
      const meta = metaOf(b) as { basis?: string; factor?: number };
      const pct = meta.factor ? Math.round((meta.factor - 1) * 1000) / 10 : 0;
      methodText = `${meta.basis === "trailing_3_annualized" ? "Last three months annualized" : "Trailing twelve months"} × seasonality, ${pct ? `${pct > 0 ? "+" : ""}${pct}%` : "flat"}`;
    } else if (method) {
      methodText = describeMethod(method, {
        year: owner.fiscalYear,
        accountCount: method.account_ids?.length,
        sourceLineName: method.source_master_id ? masterById.get(method.source_master_id)?.name : undefined,
      });
    }
    const hist = (metaOf(b).history ?? null) as { priorYear?: number; priorYearMonths?: number[]; trailing12?: number } | null;
    push(top, {
      id: b.id,
      kind,
      label: kind === "run_rate" ? "Run rate" : b.label,
      source: kind === "method" || kind === "manual" ? "Item" : src.label,
      sourceHref: src.href(owner.fiscalYear, entityForHref),
      methodText,
      method,
      note: b.note,
      count: null,
      months: m,
      total: total(m),
      editable: kind === "method" || kind === "manual",
      priorBase: !!metaOf(b).prior_base,
      history: hist && (hist.priorYear != null || hist.trailing12 != null)
        ? { priorYear: Number(hist.priorYear ?? 0), trailing12: Number(hist.trailing12 ?? 0), ...(Array.isArray(hist.priorYearMonths) && hist.priorYearMonths.length === 12 ? { priorYearMonths: hist.priorYearMonths.map(Number) } : {}) }
        : null,
    });
  }
  for (const [key, g] of payroll) {
    push(g.top, {
      id: `payroll:${key}`,
      kind: "payroll",
      label: g.label,
      source: "Payroll plan",
      sourceHref: `/budget/payroll/${owner.fiscalYear}`,
      methodText: null,
      method: null,
      note: null,
      count: g.people.size,
      months: g.months.map((v) => Math.round(v * 100) / 100),
      total: total(g.months),
      editable: false,
      history: null,
    });
  }
  // Each location is one pod (JD): the lease with its subleases beneath it, net on the pod line
  const cleanLabel = (l: string) => l.replace(/\s*\((base rent|cam|property tax|insurance|utilities|other|sublease income|sublease, nets against rent)\)\s*$/i, "");
  const subleasesOfLease = new Map<string, Array<{ b: BuildRow; months: number[] }>>();
  for (const g of grouped.values()) {
    if (g.b.source_table !== "subleases") continue;
    const leaseId = metaOf(g.b).leaseId;
    if (typeof leaseId !== "string" || !leaseId) continue;
    const parentKey = `${g.top}|leases|${leaseId}`;
    if (!grouped.has(parentKey)) continue;
    subleasesOfLease.set(parentKey, [...(subleasesOfLease.get(parentKey) ?? []), { b: g.b, months: g.months }]);
  }
  const foldedIn = new Set([...subleasesOfLease.values()].flat().map((s) => s.b.id));
  for (const [key, g] of grouped) {
    if (foldedIn.has(g.b.id)) continue;
    const src = sourceOf(g.b);
    const subs = subleasesOfLease.get(key) ?? [];
    const netMonths = g.months.slice();
    for (const s of subs) addInto(netMonths, s.months);
    const parts = subs.length
      ? [
          { label: cleanLabel(g.b.label), months: g.months.map((v) => Math.round(v * 100) / 100), total: total(g.months), note: "Lease" },
          ...subs.map((s) => ({ label: cleanLabel(s.b.label), months: s.months.map((v) => Math.round(v * 100) / 100), total: total(s.months), note: "Sublease, nets against rent" })),
        ]
      : undefined;
    push(g.top, {
      id: `schedule:${key}`,
      kind: "schedule",
      label: cleanLabel(g.b.label),
      source: src.label,
      sourceHref: src.href(owner.fiscalYear, entityForHref),
      methodText: subs.length ? `Net of ${subs.length} sublease${subs.length === 1 ? "" : "s"}` : null,
      method: null,
      note: g.b.note ?? (g.b.component === "sublease_income" ? "Sublease income, netted against rent" : null),
      count: g.count > 1 ? g.count : null,
      months: netMonths.map((v) => Math.round(v * 100) / 100),
      total: total(netMonths),
      editable: false,
      history: null,
      parts,
    });
  }
  // Amounts typed straight into cells on masters that have no builds (the older way)
  for (const [top, e] of enteredMonths) {
    if ((items.get(top) ?? []).length > 0) continue;
    if (e.every((v) => Math.abs(v) < 0.005)) continue;
    push(top, {
      id: `entered:${top}`,
      kind: "entered",
      label: "Entered amounts",
      source: "Typed",
      sourceHref: null,
      methodText: "Typed into the line before items existed",
      method: null,
      note: null,
      count: null,
      months: e.map((v) => Math.round(v * 100) / 100),
      total: total(e),
      editable: false,
      history: null,
    });
  }

  // Notes and flags live on the top master
  const lineNotes = new Map<string, { note: string | null; reviewFlag: string | null }>();
  for (const n of notes) if (n.class_key === NIL_CLASS || !n.class_key) lineNotes.set(n.master_account_id, { note: n.note, reviewFlag: n.review_flag });

  // Prior-year actuals, rolled to parents so they line up with the masters shown
  let priorYear: Record<string, number[]> = {};
  let priorYear2: Record<string, number[]> = {};
  if (actuals) {
    const byMaster = rollupActualsToParents(actuals.byMaster, masters);
    const toArr = (year: number) => {
      const out: Record<string, number[]> = {};
      for (const [id, series] of byMaster) out[id] = Array.from({ length: 12 }, (_, i) => Math.round((series.get(monthKey(year, i + 1)) ?? 0) * 100) / 100);
      return out;
    };
    priorYear = toArr(owner.fiscalYear - 1);
    priorYear2 = toArr(owner.fiscalYear - 2);
  }
  // Last year as the Financial Model shows it (pro forma and allocations on) for every
  // income-statement line; the raw GL stays as the fallback when it can't be built
  let priorYearSource: "financial_model" | "gl" = "gl";
  if (actuals && owner.reportingEntityId) {
    try {
      const fm = await loadFinancialModelYear(admin, owner, owner.fiscalYear - 1);
      if (fm) {
        for (const m of masters) {
          if ((m.classification === "Revenue" || m.classification === "Expense") && !m.parentAccountId) priorYear[m.id] = fm[m.id] ?? new Array(12).fill(0);
        }
        priorYearSource = "financial_model";
      }
    } catch (err) {
      console.error("budget model: Financial Model actuals failed, using the GL", err);
    }
  }
  // Months of last year that are booked: through the last month with any activity, but never
  // the month in progress (its early syncs would drag every average down). Close status is not
  // used because periods are often closed well after the books are usable.
  let priorYearMonths = 0;
  for (const series of Object.values(priorYear)) {
    for (let i = 11; i >= priorYearMonths; i--) {
      if (series[i]) {
        priorYearMonths = i + 1;
        break;
      }
    }
  }
  const today = new Date();
  if (owner.fiscalYear - 1 === today.getUTCFullYear()) priorYearMonths = Math.min(priorYearMonths, today.getUTCMonth());
  else if (owner.fiscalYear - 1 > today.getUTCFullYear()) priorYearMonths = 0;

  // Lines set to "Use my own number" (no fleet driver or schedules)
  const ownNumber = await loadOverriddenMasters(admin as unknown as Parameters<typeof loadOverriddenMasters>[0], owner.id);
  // Months a line is held at $0 (the line cells already are); a row under the items shows what was taken out
  const zeroMonths = await loadZeroMonths(admin as unknown as Parameters<typeof loadZeroMonths>[0], owner.id);
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const itemsWithZeroed = (masterId: string): ModelItem[] => {
    const list = items.get(masterId) ?? [];
    const zero = zeroMonths.get(masterId);
    if (!zero?.length) return list;
    const z = new Set(zero);
    const built = new Array(12).fill(0) as number[];
    for (const it of list) if (it.kind !== "entered") it.months.forEach((v, i) => (built[i] += v));
    const months = built.map((v, i) => (z.has(i + 1) ? Math.round(-v * 100) / 100 : 0));
    return [
      ...list,
      {
        id: `zeroed-${masterId}`,
        kind: "zeroed",
        label: `Zeroed months (${zero.map((m) => MONTH_SHORT[m - 1]).join(", ")})`,
        source: "Zero months",
        sourceHref: null,
        methodText: "The line is held at $0 in these months, whatever the items above say",
        method: null,
        note: null,
        count: null,
        months,
        total: Math.round(months.reduce((t, v) => t + v, 0) * 100) / 100,
        editable: false,
        history: null,
      },
    ];
  };

  const sectionOf = (m: MasterInfo) => INCOME_STATEMENT_SECTIONS.find((s) => s.classification === m.classification && s.accountTypes.includes(m.accountType))?.id ?? null;
  const topMasters = masters.filter((m) => (m.classification === "Revenue" || m.classification === "Expense") && !m.parentAccountId);
  // Every section, so Review keeps its below-EBITDA lines; the model page shows the three that reach EBITDA
  const sections = INCOME_STATEMENT_SECTIONS.map((s) => ({
    id: s.id,
    title: s.title || (s.id === "other_expense" ? "Other Expense" : s.id === "other_income" ? "Other Income" : s.id),
    model: MODEL_SECTIONS.has(s.id),
    masters: topMasters
      .filter((m) => sectionOf(m) === s.id)
      .map((m) => ({
        id: m.id,
        accountNumber: m.accountNumber,
        name: m.name,
        parentAccountId: null,
        months: (lineMonths.get(m.id) ?? new Array(12).fill(0)).map((v) => Math.round(v * 100) / 100),
        items: itemsWithZeroed(m.id).sort((a, b) => (a.kind === "zeroed" ? 1 : b.kind === "zeroed" ? -1 : Math.abs(b.total) - Math.abs(a.total))),
        note: lineNotes.get(m.id)?.note ?? null,
        reviewFlag: lineNotes.get(m.id)?.reviewFlag ?? null,
        ownNumber: ownNumber.has(m.id),
        zeroMonths: zeroMonths.get(m.id) ?? [],
      })),
  }));

  // Below EBITDA, net, so the page can close to net income without listing schedules
  const below = new Array(12).fill(0);
  const belowPrior = new Array(12).fill(0);
  for (const m of topMasters) {
    const sec = sectionOf(m);
    if (sec !== "other_expense" && sec !== "other_income") continue;
    const sign = sec === "other_expense" ? 1 : -1;
    const s = lineMonths.get(m.id);
    if (s) for (let i = 0; i < 12; i++) below[i] += s[i] * sign;
    const p = priorYear[m.id];
    if (p) for (let i = 0; i < 12; i++) belowPrior[i] += p[i] * sign;
  }

  // The older line list (one per master, no classes), for the Review page
  const lines = sections.flatMap((s) =>
    s.masters.map((m) => ({
      masterAccountId: m.id,
      classId: null,
      months: m.months,
      sources: m.items.length ? ["build"] : [],
      builds: m.items.reduce<Record<string, number>>((acc, it) => ({ ...acc, [it.kind]: (acc[it.kind] ?? 0) + 1 }), {}),
      note: m.note,
      reviewFlag: m.reviewFlag,
    })),
  );
  return {
    version: owner,
    sections,
    lines,
    priorYear,
    priorYear2,
    priorYearMonths,
    priorYearSource,
    belowEbitda: { months: below.map((v) => Math.round(v * 100) / 100), priorYear: belowPrior.map((v) => Math.round(v * 100) / 100) },
    lineMasters: topMasters.filter((m) => MODEL_SECTIONS.has(sectionOf(m) ?? "")).map((m) => ({ id: m.id, name: m.name, accountNumber: m.accountNumber })),
  };
}

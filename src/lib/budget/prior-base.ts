/**
 * "Build from last year" for revenue lines: a typed item whose twelve months are
 * last year's, either the actuals (booked months as they were, the rest at the
 * booked-month average) or the active budget version, moved by a percent.
 *
 * The item is an ordinary manual build tagged meta.prior_base, so building again
 * replaces it instead of stacking a second base on the line.
 */
import type { VersionOwner } from "./access";
import type { Admin, BuildInsert } from "./build-types";
import { loadMasters } from "./actuals";
import { buildVersionModel } from "./model";
import { loadMemberEntityIds, resolveVersionChartId } from "./recompute";
import { fetchBudgetAmountRows, resolveActiveVersions, rollupBudgetToParents } from "./versions";
import { actualsBase, applyPct } from "./prior-base-math";

export type PriorBasis = "actuals" | "budget";

/** Item kinds whose months come from another module; a base on top would double the line */
const FED_KINDS = new Set(["driver", "schedule", "payroll", "capex"]);

export interface PriorBaseLine {
  masterId: string;
  accountNumber: string | null;
  name: string;
  /** Why this line can't take a base (fed by the fleet driver, a schedule, ...); null when it can */
  blockedBy: string | null;
  /** Typed and method items on the line other than an earlier base (the ones "replace" removes) */
  otherItems: number;
  /** An earlier base on this line, replaced when building again */
  hasBase: boolean;
  /** Last year's booked months only, then the twelve-month base built from them */
  actualBooked: number;
  actualMonths: number[];
  /** Last year's active budget version, null when there is none for this line */
  budgetMonths: number[] | null;
}

export interface PriorBasePreview {
  priorYear: number;
  /** Where last year's actuals came from on this load */
  actualsSource: "financial_model" | "gl";
  bookedMonths: number;
  budgetVersions: number;
  lines: PriorBaseLine[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);

export async function loadPriorBase(admin: Admin, owner: VersionOwner): Promise<PriorBasePreview> {
  const model = await buildVersionModel(admin, owner, { withActuals: true });
  const booked = model.priorYearMonths;
  const revenue = model.sections.find((s) => s.id === "revenue");

  // Last year's active budget for this group (reporting-entity version first, entity versions for the rest)
  const [memberSet, chartId] = await Promise.all([loadMemberEntityIds(admin, owner), resolveVersionChartId(admin, owner)]);
  const priorVersions = await resolveActiveVersions(admin, {
    organizationId: owner.organizationId!,
    years: [owner.fiscalYear - 1],
    scope: owner.reportingEntityId ? "reporting_entity" : "entity",
    entityId: owner.entityId ?? undefined,
    reportingEntityId: owner.reportingEntityId ?? undefined,
    entityIds: [...memberSet],
  });
  const budgetByMaster = new Map<string, Record<string, number>>();
  if (priorVersions.length) {
    const rows = await fetchBudgetAmountRows(admin, priorVersions.map((v) => v.id), { years: [owner.fiscalYear - 1] });
    for (const r of rows) {
      const m = budgetByMaster.get(r.master_account_id) ?? {};
      m[String(r.period_month)] = (m[String(r.period_month)] ?? 0) + Number(r.amount);
      budgetByMaster.set(r.master_account_id, m);
    }
    const masters = await loadMasters(admin, chartId);
    rollupBudgetToParents(budgetByMaster, masters.map((m) => ({ id: m.id, parentAccountId: m.parentAccountId })));
  }

  const lines: PriorBaseLine[] = (revenue?.masters ?? []).map((m) => {
    const fed = m.items.find((it) => FED_KINDS.has(it.kind));
    const bases = m.items.filter((it) => it.priorBase);
    const others = m.items.filter((it) => !it.priorBase && (it.kind === "manual" || it.kind === "method"));
    const prior = model.priorYear[m.id] ?? new Array(12).fill(0);
    const b = budgetByMaster.get(m.id);
    const budgetMonths = b ? Array.from({ length: 12 }, (_, i) => round2(b[String(i + 1)] ?? 0)) : null;
    return {
      masterId: m.id,
      accountNumber: m.accountNumber,
      name: m.name,
      blockedBy: fed ? `${fed.source} feeds this line` : null,
      otherItems: others.length,
      hasBase: bases.length > 0,
      actualBooked: round2(sum(prior.slice(0, booked))),
      actualMonths: actualsBase(prior, booked),
      budgetMonths: budgetMonths && budgetMonths.some((v) => v !== 0) ? budgetMonths : null,
    };
  });
  return { priorYear: owner.fiscalYear - 1, actualsSource: model.priorYearSource, bookedMonths: booked, budgetVersions: priorVersions.length, lines };
}

/** The build row for one line's base */
export function priorBaseRow(owner: VersionOwner, line: PriorBaseLine, basis: PriorBasis, pct: number, bookedMonths: number, actualsSource: "financial_model" | "gl" = "financial_model"): BuildInsert & { note: string } {
  const prior = owner.fiscalYear - 1;
  const source = basis === "actuals" ? line.actualMonths : (line.budgetMonths ?? new Array(12).fill(0));
  const months = applyPct(source, pct);
  const pctText = pct ? ` ${pct > 0 ? "+" : ""}${pct}%` : "";
  const span = bookedMonths > 0 && bookedMonths < 12 ? `; months ${bookedMonths + 1}-12 at the Jan-${bookedMonths} average` : "";
  return {
    budget_version_id: owner.id,
    reporting_entity_id: owner.reportingEntityId,
    entity_id: owner.entityId,
    master_account_id: line.masterId,
    qbo_class_id: null,
    build_type: "manual",
    source_table: null,
    source_id: null,
    component: "manual",
    label: `${prior} ${basis === "actuals" ? "actuals" : "budget"} base${pctText}`,
    amounts: Object.fromEntries(months.map((v, i) => [String(i + 1), v])),
    assumption_keys: [],
    is_computed: false,
    meta: { prior_base: { basis, pct, year: prior, booked_months: basis === "actuals" ? bookedMonths : null, source: basis === "actuals" ? actualsSource : "budget" } },
    note: basis === "actuals" ? `Built from ${prior} actuals (${actualsSource === "financial_model" ? "Financial Model" : "general ledger"})${span}.` : `Built from the active ${prior} budget version.`,
    computed_at: new Date().toISOString(),
  };
}

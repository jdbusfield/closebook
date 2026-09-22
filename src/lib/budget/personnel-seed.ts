/**
 * Seeds headcount rows from the live Paylocity roster and twelve months of
 * stored paycheck lines. Pure helpers here; the route does the I/O.
 *
 * Run rates come from history, the base rate comes from the roster:
 *   ot_pct / dt_pct / meal_pct  = premium dollars / regular dollars
 *   bonus_target                = bonus dollars annualized
 *   commission_annual           = commission dollars annualized
 *   benefits_monthly            = employer health (ERMED) per covered month
 *   match_pct                   = 401(k) employer match / gross
 *   other_earnings_monthly      = retro, severance, fringe, other per month
 * Paid time off, sick and holiday pay count as base wages (they replace
 * regular hours), so they do not inflate the premium ratios.
 */
import type { Employee } from "@/lib/paylocity/types";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";
import { getClassSplits, getEntitySplits, type AllocationRow } from "@/lib/paylocity/allocation-resolver";

export interface EarningCodeRow {
  paylocity_company_id: string;
  code: string;
  effective_category: string | null;
  effective_subcategory: string | null;
}

export interface PaycheckRow {
  employee_id: string;
  paylocity_company_id: string;
  check_date: string;
  gross_pay: number | null;
  regular_dollars: number | null;
  overtime_dollars: number | null;
  doubletime_dollars: number | null;
  meal_dollars: number | null;
  other_earnings_dollars: number | null;
  er_benefit_detail: Record<string, number> | null;
  detail_lines: Array<{ detType?: string; detCode?: string; amount?: number; hours?: number; rate?: number }> | null;
  workers_comp_code?: string | null;
  excluded?: boolean | null;
}

export interface RunRate {
  monthsCovered: number;
  checks: number;
  gross: number;
  regular: number;
  overtime: number;
  doubletime: number;
  meal: number;
  bonus: number;
  commission: number;
  other: number;
  erHealth: number;
  erMatch: number;
  wcClassCode: string | null;
  lastCheckDate: string | null;
  firstCheckDate: string | null;
}

type CodeLookup = Map<string, { category: string; sub: string }>;

export function buildCodeLookup(codes: EarningCodeRow[]): CodeLookup {
  const m: CodeLookup = new Map();
  for (const c of codes) {
    m.set(`${c.paylocity_company_id}|${c.code.toUpperCase()}`, {
      category: c.effective_category ?? "other",
      sub: c.effective_subcategory ?? "",
    });
  }
  return m;
}

function classify(lookup: CodeLookup, companyId: string, detType: string, detCode: string): { category: string; sub: string } {
  const hit = lookup.get(`${companyId}|${detCode.toUpperCase()}`);
  if (hit) return hit;
  const t = detType.toLowerCase();
  const c = detCode.toUpperCase();
  if (t === "memo") return { category: "er_contribution", sub: "health_er" };
  if (t === "memoermatch") return { category: "er_contribution", sub: "retirement_er" };
  if (c === "REG" || c === "SALRY") return { category: "earning", sub: "regular" };
  if (c === "OT" || c === "FQOT" || t === "ot") return { category: "earning", sub: "overtime" };
  if (c === "DT" || t === "dt") return { category: "earning", sub: "doubletime" };
  if (c === "MEAL") return { category: "earning", sub: "meal_premium" };
  if (/BON|INCEN/.test(c)) return { category: "earning", sub: "bonus" };
  if (/COMM/.test(c)) return { category: "earning", sub: "commission" };
  if (/PTO|VAC/.test(c)) return { category: "earning", sub: "pto" };
  if (/HOL/.test(c)) return { category: "earning", sub: "holiday" };
  if (/SICK/.test(c)) return { category: "earning", sub: "sick" };
  if (["reg", "standard", "earning"].includes(t)) return { category: "earning", sub: "other_earning" };
  return { category: "other", sub: "" };
}

const BASE_SUBS = new Set(["regular", "pto", "holiday", "sick"]);
const OTHER_SUBS = new Set(["retro", "severance", "fringe", "other_earning"]);

/** Trailing-window run rate per employee from stored paycheck rows. */
export function deriveRunRates(checks: PaycheckRow[], codes: EarningCodeRow[]): Map<string, RunRate> {
  const lookup = buildCodeLookup(codes);
  const out = new Map<string, RunRate>();
  const months = new Map<string, Set<string>>();

  for (const ck of checks) {
    if (ck.excluded) continue;
    const key = `${ck.paylocity_company_id}:${ck.employee_id}`;
    let rr = out.get(key);
    if (!rr) {
      rr = {
        monthsCovered: 0, checks: 0, gross: 0, regular: 0, overtime: 0, doubletime: 0, meal: 0,
        bonus: 0, commission: 0, other: 0, erHealth: 0, erMatch: 0, wcClassCode: null,
        lastCheckDate: null, firstCheckDate: null,
      };
      out.set(key, rr);
      months.set(key, new Set());
    }
    rr.checks++;
    rr.gross += Number(ck.gross_pay ?? 0);
    months.get(key)!.add(ck.check_date.slice(0, 7));
    if (!rr.lastCheckDate || ck.check_date > rr.lastCheckDate) {
      rr.lastCheckDate = ck.check_date;
      if (ck.workers_comp_code) rr.wcClassCode = ck.workers_comp_code;
    }
    if (!rr.firstCheckDate || ck.check_date < rr.firstCheckDate) rr.firstCheckDate = ck.check_date;

    const lines = ck.detail_lines ?? [];
    if (lines.length === 0) {
      // Older rows without line detail: fall back to the summary columns
      rr.regular += Number(ck.regular_dollars ?? 0);
      rr.overtime += Number(ck.overtime_dollars ?? 0);
      rr.doubletime += Number(ck.doubletime_dollars ?? 0);
      rr.meal += Number(ck.meal_dollars ?? 0);
      rr.other += Number(ck.other_earnings_dollars ?? 0);
      const bd = ck.er_benefit_detail ?? {};
      rr.erHealth += Number(bd.ERMED ?? 0);
      rr.erMatch += Number(bd["401ER"] ?? 0);
      continue;
    }
    for (const d of lines) {
      const amt = Number(d.amount ?? 0);
      if (!amt) continue;
      const { category, sub } = classify(lookup, ck.paylocity_company_id, d.detType ?? "", d.detCode ?? "");
      if (category === "earning") {
        if (BASE_SUBS.has(sub)) rr.regular += amt;
        else if (sub === "overtime") rr.overtime += amt;
        else if (sub === "doubletime") rr.doubletime += amt;
        else if (sub === "meal_premium") rr.meal += amt;
        else if (sub === "bonus") rr.bonus += amt;
        else if (sub === "commission") rr.commission += amt;
        else if (OTHER_SUBS.has(sub)) rr.other += amt;
        // reimbursement and 1099 lines are not wages
      } else if (category === "er_contribution") {
        if (sub === "retirement_er") rr.erMatch += amt;
        else rr.erHealth += amt;
      }
    }
  }
  for (const [key, rr] of out) rr.monthsCovered = Math.max(1, Math.min(12, months.get(key)?.size ?? 1));
  return out;
}

export interface SeedRow {
  employeeId: string;
  paylocityCompanyId: string;
  name: string;
  title: string | null;
  department: string | null;
  payType: "Hourly" | "Salary";
  baseRate: number | null;
  annualSalary: number | null;
  stdHoursWeek: number;
  startMonth: number;
  meritPct: number;
  meritMonth: number | null;
  bonusTarget: number;
  commissionAnnual: number;
  otPct: number;
  dtPct: number;
  mealPct: number;
  otherEarningsMonthly: number;
  benefitsMonthly: number;
  matchPct: number;
  wcClassCode: string | null;
  entityAllocations: Array<{ entity_id: string; pct: number }>;
  classAllocations: Array<{ class: string; pct: number }>;
  reShare: number;
  seededFrom: Record<string, unknown>;
  warnings: string[];
}

function round(n: number, d = 2): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

/** Weekly hours from Paylocity defaultHours, which is often per pay period. */
export function weeklyHoursFrom(defaultHours: number | undefined | null): number {
  if (!defaultHours || defaultHours <= 0) return 40;
  if (defaultHours > 60) return round(defaultHours / 2, 2); // biweekly period hours
  return defaultHours;
}

export interface SeedContext {
  year: number;
  memberEntityIds: Set<string>;
  allocationFor: (employeeId: string, companyId: string) => AllocationRow | null;
  runRates: Map<string, RunRate>;
  /** Fallback workers comp code by employee key (from older statements). */
  wcCodes?: Map<string, string>;
}

/** Builds one seed row for an employee, or null when they do not belong to the RE. */
export function seedRowForEmployee(emp: Employee, ctx: SeedContext): SeedRow | null {
  const companyId = emp.companyId;
  const key = `${companyId}:${emp.id}`;
  const warnings: string[] = [];
  const firstName = emp.info?.firstName ?? "";
  const lastName = emp.info?.lastName ?? emp.lastName ?? "";
  const name = emp.displayName ?? (`${firstName} ${lastName}`.trim() || `Employee ${emp.id}`);

  const costCenter = emp.position?.costCenter1 ?? null;
  const cc = getOperatingEntityForCostCenter(costCenter ?? "", companyId);
  const alloc = ctx.allocationFor(emp.id, companyId);
  let entityAllocations = getEntitySplits(alloc).map((s) => ({ entity_id: s.entityId, pct: round(s.pct, 2) }));
  if (entityAllocations.length === 0) {
    entityAllocations = [{ entity_id: cc.operatingEntityId, pct: 100 }];
    if (!alloc) warnings.push("No allocation row; entity assumed from cost center");
  }
  const classAllocations = getClassSplits(alloc).map((s) => ({ class: s.className, pct: round(s.pct, 2) }));

  const total = entityAllocations.reduce((t, a) => t + a.pct, 0) || 100;
  const reShare = entityAllocations.filter((a) => ctx.memberEntityIds.has(a.entity_id)).reduce((t, a) => t + a.pct, 0) / total;
  if (reShare <= 0) return null;

  // Pay rate: current, or a future rate already effective on Jan 1
  const jan1 = `${ctx.year}-01-01`;
  let rate = emp.currentPayRate;
  let meritPct = 0;
  let meritMonth: number | null = null;
  const futures = [...(emp.futurePayRates ?? [])].sort((a, b) => (a.effectiveDate ?? "").localeCompare(b.effectiveDate ?? ""));
  for (const f of futures) {
    const eff = (f.effectiveDate ?? "").slice(0, 10);
    if (!eff) continue;
    if (eff <= jan1) {
      rate = f;
    } else if (eff.startsWith(String(ctx.year)) && rate) {
      const current = rate.annualSalary || (rate.baseRate ?? 0);
      const next = f.annualSalary || (f.baseRate ?? 0);
      if (current > 0 && next > 0) {
        meritPct = round(((next - current) / current) * 100, 3);
        meritMonth = Number(eff.slice(5, 7));
      }
      break;
    }
  }
  const payType: "Hourly" | "Salary" = rate?.payType === "Salary" ? "Salary" : "Hourly";
  const stdHoursWeek = weeklyHoursFrom(rate?.defaultHours);
  const baseRate = rate?.baseRate && rate.baseRate > 0 ? round(rate.baseRate, 4) : null;
  const annualSalary = rate?.annualSalary && rate.annualSalary > 0
    ? round(rate.annualSalary, 2)
    : rate?.salary && rate.salary > 0 ? round(rate.salary, 2) : null;
  if (!baseRate && !annualSalary) warnings.push("No pay rate on the roster");

  const rr = ctx.runRates.get(key);
  const months = rr?.monthsCovered ?? 0;
  const annualize = (v: number) => (months > 0 ? (v / months) * 12 : 0);
  const pctOf = (v: number) => (rr && rr.regular > 0 ? round((v / rr.regular) * 100, 4) : 0);

  const hireDate = (emp.info?.hireDate ?? "").slice(0, 10);
  let startMonth = 1;
  if (hireDate && hireDate.startsWith(String(ctx.year))) startMonth = Number(hireDate.slice(5, 7));

  return {
    employeeId: emp.id,
    paylocityCompanyId: companyId,
    name,
    title: emp.info?.jobTitle ?? null,
    department: alloc?.department ?? cc.department ?? null,
    payType,
    baseRate,
    annualSalary,
    stdHoursWeek,
    startMonth,
    meritPct,
    meritMonth,
    bonusTarget: rr ? round(annualize(rr.bonus)) : 0,
    commissionAnnual: rr ? round(annualize(rr.commission)) : 0,
    otPct: rr ? pctOf(rr.overtime) : 0,
    dtPct: rr ? pctOf(rr.doubletime) : 0,
    mealPct: rr ? pctOf(rr.meal) : 0,
    otherEarningsMonthly: rr ? round(rr.other / months) : 0,
    benefitsMonthly: rr ? round(rr.erHealth / months) : 0,
    // JD (Sep 2026): anyone who takes the 401(k) match is budgeted at 4%, not their trailing rate
    matchPct: rr && rr.gross > 0 && rr.erMatch > 0 ? 4 : 0,
    wcClassCode: rr?.wcClassCode ?? ctx.wcCodes?.get(key) ?? null,
    entityAllocations,
    classAllocations,
    reShare: round(reShare, 4),
    seededFrom: {
      seededAt: new Date().toISOString(),
      statusType: emp.statusType,
      costCenter,
      hireDate: hireDate || null,
      payRateEffective: rate?.effectiveDate ?? null,
      runRate: rr
        ? {
            monthsCovered: rr.monthsCovered,
            checks: rr.checks,
            gross: round(rr.gross),
            regular: round(rr.regular),
            overtime: round(rr.overtime),
            doubletime: round(rr.doubletime),
            meal: round(rr.meal),
            bonus: round(rr.bonus),
            commission: round(rr.commission),
            other: round(rr.other),
            erHealth: round(rr.erHealth),
            erMatch: round(rr.erMatch),
            firstCheckDate: rr.firstCheckDate,
            lastCheckDate: rr.lastCheckDate,
          }
        : null,
    },
    warnings: rr ? warnings : [...warnings, "No paychecks in the trailing twelve months"],
  };
}

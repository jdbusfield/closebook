import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { AllocationResolver } from "@/lib/paylocity/allocation-resolver";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";
import {
  buildOrgEstimate,
  monthBounds,
  type PaycheckRow,
  type EmployeeMeta,
} from "@/lib/utils/payroll-monthly-estimate";

export const maxDuration = 60;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/paylocity/monthly-estimate?year=2026&month=3
 *
 * Org-level accrual-basis payroll estimate for a single month, with the
 * cash → accrual bridge, per-entity breakdown, employee detail, exceptions,
 * and reconciliation flags. Reads employee_paycheck_details only (actual
 * Paylocity checks); no Paylocity API calls.
 */
export async function GET(request: NextRequest) {
  const now = new Date();
  const year = Number(request.nextUrl.searchParams.get("year")) || now.getFullYear();
  const month = Number(request.nextUrl.searchParams.get("month")) || now.getMonth() + 1;

  if (month < 1 || month > 12) {
    return NextResponse.json({ error: "month must be 1-12" }, { status: 400 });
  }

  try {
    const supabase = getSupabase();

    // ── Paginated loaders (Supabase 1000-row cap) ──
    async function fetchAllEq(
      table: string,
      filters: Record<string, string> = {}
    ): Promise<Record<string, unknown>[]> {
      const all: Record<string, unknown>[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        let q = supabase.from(table).select("*").range(from, from + pageSize - 1);
        for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
        const { data, error } = await q;
        if (error) throw new Error(`Query ${table} failed: ${error.message}`);
        all.push(...((data as Record<string, unknown>[]) ?? []));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    }

    async function fetchPaychecksForYears(years: number[]): Promise<Record<string, unknown>[]> {
      const all: Record<string, unknown>[] = [];
      const pageSize = 1000;
      let fromIdx = 0;
      while (true) {
        const { data, error } = await supabase
          .from("employee_paycheck_details")
          .select("*")
          .in("year", years)
          .range(fromIdx, fromIdx + pageSize - 1);
        if (error) throw new Error(`Query employee_paycheck_details failed: ${error.message}`);
        all.push(...((data as Record<string, unknown>[]) ?? []));
        if (!data || data.length < pageSize) break;
        fromIdx += pageSize;
      }
      return all;
    }

    const [rawChecks, allocations, monthlyCosts] = await Promise.all([
      fetchPaychecksForYears([year - 1, year, year + 1]),
      fetchAllEq("employee_allocations"),
      fetchAllEq("employee_monthly_costs", { year: String(year) }),
    ]);

    // ── Window + dedupe checks ──
    const { mStart, mEnd } = monthBounds(year, month);
    const windowStart = new Date(mStart.getTime() - 31 * 86400000); // periods straddling month start
    const windowEnd = new Date(mEnd.getTime() + 62 * 86400000);     // biweekly tail paid after month
    const toDate = (s: unknown): Date | null => {
      if (typeof s !== "string" || !s) return null;
      const p = s.includes("T") ? s.split("T")[0] : s;
      const [y, m, d] = p.split("-").map(Number);
      if (!y || !m || !d) return null;
      return new Date(y, m - 1, d);
    };

    const seen = new Set<string>();
    const checksByEmployee = new Map<string, PaycheckRow[]>();
    // Earliest period-begin per employee across the FULL fetch (pre-window),
    // used to spot brand-new hires whose first activity is this month.
    const earliestBegin = new Map<string, Date>();
    let maxEndDate: Date | null = null;

    for (const row of rawChecks) {
      if (row.excluded === true) continue; // manually excluded paycheck
      const endD = toDate(row.end_date);
      const checkD = toDate(row.check_date);
      const beginD = toDate(row.begin_date);
      if (!endD || !checkD || !beginD) continue;

      const empId = String(row.employee_id);
      const companyId = String(row.paylocity_company_id);
      const firstKey = `${empId}:${companyId}`;
      const prevFirst = earliestBegin.get(firstKey);
      if (!prevFirst || beginD < prevFirst) earliestBegin.set(firstKey, beginD);

      // Keep checks whose period could touch the month and that were paid within the window
      if (endD < windowStart) continue;
      if (checkD > windowEnd) continue;
      const dedupeKey = `${empId}:${companyId}:${row.check_date}:${row.transaction_number ?? ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (!maxEndDate || endD > maxEndDate) maxEndDate = endD;

      // Meal premium count = sum of hours on MEAL-coded detail lines (each = 1 premium).
      const lines = Array.isArray(row.detail_lines)
        ? (row.detail_lines as Array<{ detCode?: string; hours?: number }>)
        : [];
      const mealCount = lines.reduce(
        (s, l) => s + (/meal/i.test(l?.detCode ?? "") ? Number(l?.hours ?? 0) : 0),
        0
      );

      const key = `${empId}:${companyId}`;
      const check: PaycheckRow = {
        employee_id: empId,
        paylocity_company_id: companyId,
        employee_name: String(row.employee_name ?? ""),
        check_date: String(row.check_date).split("T")[0],
        begin_date: String(row.begin_date).split("T")[0],
        end_date: String(row.end_date).split("T")[0],
        transaction_number: row.transaction_number == null ? null : String(row.transaction_number),
        gross_pay: Number(row.gross_pay ?? 0),
        er_taxes_estimated: Number(row.er_taxes_estimated ?? 0),
        er_benefits: Number(row.er_benefits ?? 0),
        overtime_hours: Number(row.overtime_hours ?? 0),
        overtime_dollars: Number(row.overtime_dollars ?? 0),
        doubletime_hours: Number(row.doubletime_hours ?? 0),
        doubletime_dollars: Number(row.doubletime_dollars ?? 0),
        meal_dollars: Number(row.meal_dollars ?? 0),
        meal_count: mealCount,
      };
      const arr = checksByEmployee.get(key);
      if (arr) arr.push(check);
      else checksByEmployee.set(key, [check]);
    }

    // ── Per-employee metadata from monthly costs ──
    // annual_comp + cost center from the selected month's row (fallback: latest
    // month present); ytdGrossThroughMEnd = Σ gross_pay for months ≤ selected.
    interface MCRow {
      key: string; month: number; annual_comp: number; cost_center_code: string | null;
      employee_name: string; gross_pay: number;
    }
    const mcByEmployee = new Map<string, MCRow[]>();
    for (const r of monthlyCosts) {
      const key = `${String(r.employee_id)}:${String(r.paylocity_company_id)}`;
      const row: MCRow = {
        key,
        month: Number(r.month),
        annual_comp: Number(r.annual_comp ?? 0),
        cost_center_code: (r.cost_center_code as string) || null,
        employee_name: String(r.employee_name ?? ""),
        gross_pay: Number(r.gross_pay ?? 0),
      };
      const arr = mcByEmployee.get(key);
      if (arr) arr.push(row);
      else mcByEmployee.set(key, [row]);
    }

    const metaByEmployee = new Map<string, EmployeeMeta>();
    for (const [key, checks] of checksByEmployee) {
      const [employeeId, companyId] = key.split(":");
      const mcRows = mcByEmployee.get(key) ?? [];
      const monthRow =
        mcRows.find((r) => r.month === month) ??
        mcRows.slice().sort((a, b) => b.month - a.month)[0] ??
        null;
      const ytdGross = mcRows
        .filter((r) => r.month <= month)
        .reduce((s, r) => s + r.gross_pay, 0);
      metaByEmployee.set(key, {
        employeeId,
        companyId,
        employeeName: monthRow?.employee_name || checks[0]?.employee_name || `Employee ${employeeId}`,
        costCenterCode: monthRow?.cost_center_code ?? null,
        annualComp: monthRow?.annual_comp ?? 0,
        ytdGrossThroughMEnd: ytdGross,
      });
    }

    const resolver = new AllocationResolver(
      allocations.map((a) => ({
        employee_id: String(a.employee_id),
        paylocity_company_id: String(a.paylocity_company_id),
        department: (a.department as string) ?? null,
        class: (a.class as string) ?? null,
        class_allocations: Array.isArray(a.class_allocations)
          ? (a.class_allocations as { class: string; pct: number }[])
          : null,
        entity_allocations: Array.isArray(a.entity_allocations)
          ? (a.entity_allocations as { entity_id: string; entity_name?: string | null; pct: number }[])
          : null,
        allocated_entity_id: (a.allocated_entity_id as string) ?? null,
        allocated_entity_name: (a.allocated_entity_name as string) ?? null,
        effective_date: String(a.effective_date ?? "2000-01-01"),
      }))
    );

    const isClosedMonth =
      year < now.getFullYear() ||
      (year === now.getFullYear() && month < now.getMonth() + 1);

    const estimate = buildOrgEstimate({
      year,
      month,
      isClosedMonth,
      checksByEmployee,
      metaByEmployee,
      resolver,
    });

    // ── New hires needing allocation ──
    // Employees whose first-ever paycheck activity starts in the viewed month
    // (with a 21-day lookback for late-prior-month hires whose data lands now)
    // and who have NO allocation row: the estimate silently assumes their
    // cost-center default entity, so surface them for an explicit org-level
    // allocation decision. Saving any allocation removes them from this list.
    const isoStr = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const allocatedKeys = new Set(
      allocations.map((a) => `${String(a.employee_id)}:${String(a.paylocity_company_id)}`)
    );
    const lookbackStart = new Date(mStart.getTime() - 21 * 86400000);
    const newHires: {
      employeeId: string;
      companyId: string;
      employeeName: string;
      department: string;
      costCenterCode: string | null;
      firstActivityDate: string;
      assumedEntityId: string;
      assumedEntityCode: string;
      assumedEntityName: string;
      earnedInMonth: number;
    }[] = [];
    for (const key of checksByEmployee.keys()) {
      if (allocatedKeys.has(key)) continue;
      const first = earliestBegin.get(key);
      if (!first || first < lookbackStart || first > mEnd) continue;
      const empMeta = metaByEmployee.get(key);
      if (!empMeta) continue;
      const cc = getOperatingEntityForCostCenter(empMeta.costCenterCode, empMeta.companyId);
      let earnedInMonth = 0;
      for (const ent of estimate.entities) {
        for (const emp of ent.employees) {
          if (emp.employeeId === empMeta.employeeId && emp.companyId === empMeta.companyId) {
            earnedInMonth +=
              emp.earnedInMonth.wages + emp.earnedInMonth.erTaxes + emp.earnedInMonth.erBenefits;
          }
        }
      }
      newHires.push({
        employeeId: empMeta.employeeId,
        companyId: empMeta.companyId,
        employeeName: empMeta.employeeName,
        department: cc.department,
        costCenterCode: empMeta.costCenterCode,
        firstActivityDate: isoStr(first),
        assumedEntityId: cc.operatingEntityId,
        assumedEntityCode: cc.operatingEntityCode,
        assumedEntityName: cc.operatingEntityName,
        earnedInMonth: Math.round(earnedInMonth * 100) / 100,
      });
    }
    newHires.sort(
      (a, b) => b.earnedInMonth - a.earnedInMonth || a.employeeName.localeCompare(b.employeeName)
    );

    // Data freshness / month-end coverage
    const lastSynced = monthlyCosts.reduce((latest: string, r) => {
      const t = (r.synced_at as string) ?? "";
      return t > latest ? t : latest;
    }, "");
    const monthEndCovered = maxEndDate ? maxEndDate >= mEnd : false;

    return NextResponse.json({
      ...estimate,
      newHires,
      meta: {
        lastSynced: lastSynced || null,
        monthEndCovered,
        checksLoaded: seen.size,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build monthly estimate" },
      { status: 500 }
    );
  }
}

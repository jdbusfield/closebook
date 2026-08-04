import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateEmployerTaxes } from "@/lib/utils/payroll-calculations";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/paylocity/monthly-costs/detail?employeeId=...&companyId=...&year=...&month=...
 *
 * Returns per-paycheck detail for a specific employee and month.
 * Computes pro-rata fractions for pay periods that span month boundaries.
 */
export async function GET(request: NextRequest) {
  const employeeId = request.nextUrl.searchParams.get("employeeId");
  const companyId = request.nextUrl.searchParams.get("companyId");
  const year = Number(request.nextUrl.searchParams.get("year"));
  const month = Number(request.nextUrl.searchParams.get("month"));

  if (!employeeId || !companyId || !year || !month) {
    return NextResponse.json(
      { error: "Missing required params: employeeId, companyId, year, month" },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabase();

    // Fetch all paychecks for this employee/year (need all to find cross-month periods)
    const { data: paychecks, error } = await supabase
      .from("employee_paycheck_details")
      .select("*")
      .eq("employee_id", employeeId)
      .eq("paylocity_company_id", companyId)
      .eq("year", year)
      .order("check_date", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch all monthly cost rows for the employee/year: the target-month row
    // for context, and prior months to derive YTD gross for tax-cap accuracy.
    const { data: monthlyRows } = await supabase
      .from("employee_monthly_costs")
      .select("*")
      .eq("employee_id", employeeId)
      .eq("paylocity_company_id", companyId)
      .eq("year", year);

    const monthlyCost = (monthlyRows ?? []).find((r) => Number(r.month) === month) ?? null;
    const ytdGrossPrior = (monthlyRows ?? [])
      .filter((r) => Number(r.month) < month)
      .reduce((s, r) => s + Number(r.gross_pay ?? 0), 0);

    // Filter to paychecks whose pay period overlaps the target month
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0); // last day of month
    const daysInMonth = monthEnd.getDate();

    const allocatedPaychecks = [];

    for (const pc of paychecks ?? []) {
      const begin = parseDate(pc.begin_date);
      const end = parseDate(pc.end_date);
      const totalPeriodDays = daysBetween(begin, end);
      if (totalPeriodDays <= 0) continue;

      // How many days of this pay period fall in the target month?
      const overlapStart = begin < monthStart ? monthStart : begin;
      const overlapEnd = end > monthEnd ? monthEnd : end;
      const overlapDays = daysBetween(overlapStart, overlapEnd);

      if (overlapDays <= 0) continue;

      const fraction = overlapDays / totalPeriodDays;

      allocatedPaychecks.push({
        checkDate: pc.check_date,
        beginDate: pc.begin_date,
        endDate: pc.end_date,
        transactionNumber: pc.transaction_number ?? null,
        excluded: pc.excluded === true,
        excludedReason: pc.excluded_reason ?? null,
        payPeriodDays: totalPeriodDays,
        daysInMonth: overlapDays,
        proRataFraction: Math.round(fraction * 10000) / 10000,
        full: {
          grossPay: pc.gross_pay,
          hours: pc.hours,
          regularHours: pc.regular_hours,
          regularDollars: pc.regular_dollars,
          overtimeHours: pc.overtime_hours,
          overtimeDollars: pc.overtime_dollars,
          doubletimeHours: pc.doubletime_hours,
          doubletimeDollars: pc.doubletime_dollars,
          mealDollars: pc.meal_dollars,
          otherEarningsDollars: pc.other_earnings_dollars,
          erTaxes: pc.er_taxes_estimated,
          erBenefits: pc.er_benefits,
          erBenefitDetail: pc.er_benefit_detail ?? {},
        },
        allocated: {
          grossPay: round(pc.gross_pay * fraction),
          hours: round(pc.hours * fraction),
          regularHours: round(pc.regular_hours * fraction),
          regularDollars: round(pc.regular_dollars * fraction),
          overtimeHours: round(pc.overtime_hours * fraction),
          overtimeDollars: round(pc.overtime_dollars * fraction),
          doubletimeHours: round(pc.doubletime_hours * fraction),
          doubletimeDollars: round(pc.doubletime_dollars * fraction),
          mealDollars: round(pc.meal_dollars * fraction),
          otherEarningsDollars: round(pc.other_earnings_dollars * fraction),
          erTaxes: round(pc.er_taxes_estimated * fraction),
          erBenefits: round(pc.er_benefits * fraction),
          erBenefitDetail: Object.fromEntries(
            Object.entries(pc.er_benefit_detail ?? {}).map(([k, v]) => [k, round((v as number) * fraction)])
          ),
        },
        detailLines: pc.detail_lines ?? [],
      });
    }

    // Calculate accrual for current month if applicable
    let accrual = null;
    const now = new Date();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

    // Excluded paychecks stay visible in the list but contribute nothing to
    // totals or the accrual estimate.
    const countedPaychecks = allocatedPaychecks.filter((pc) => !pc.excluded);

    if (isCurrentMonth && monthlyCost?.is_accrual !== undefined) {
      const daysCoveredByChecks = countedPaychecks.reduce(
        (sum, pc) => sum + pc.daysInMonth, 0
      );
      const daysUncovered = Math.max(0, daysInMonth - daysCoveredByChecks);

      if (daysUncovered > 0 && monthlyCost?.annual_comp > 0) {
        const dailyRate = monthlyCost.annual_comp / 365;
        const accrualGross = round(dailyRate * daysUncovered);
        // Average monthly benefit from actual paycheck data
        const totalAllocBenefits = countedPaychecks.reduce(
          (sum, pc) => sum + pc.allocated.erBenefits, 0
        );
        const avgDailyBenefit = daysCoveredByChecks > 0
          ? totalAllocBenefits / daysCoveredByChecks
          : 0;

        accrual = {
          daysUncovered,
          daysInMonth,
          dailyRate: round(dailyRate),
          estimatedGross: accrualGross,
          // Canonical capped employer-tax engine (respects YTD wage-base caps)
          estimatedErTaxes: round(calculateEmployerTaxes(accrualGross, ytdGrossPrior).total),
          estimatedErBenefits: round(avgDailyBenefit * daysUncovered),
        };
      }
    }

    // Totals (excluded paychecks contribute nothing)
    const totalAllocated = {
      grossPay: round(countedPaychecks.reduce((s, p) => s + p.allocated.grossPay, 0) + (accrual?.estimatedGross ?? 0)),
      regularDollars: round(countedPaychecks.reduce((s, p) => s + p.allocated.regularDollars, 0)),
      overtimeDollars: round(countedPaychecks.reduce((s, p) => s + p.allocated.overtimeDollars, 0)),
      doubletimeDollars: round(countedPaychecks.reduce((s, p) => s + p.allocated.doubletimeDollars, 0)),
      mealDollars: round(countedPaychecks.reduce((s, p) => s + p.allocated.mealDollars, 0)),
      otherEarningsDollars: round(countedPaychecks.reduce((s, p) => s + p.allocated.otherEarningsDollars, 0)),
      erTaxes: round(countedPaychecks.reduce((s, p) => s + p.allocated.erTaxes, 0) + (accrual?.estimatedErTaxes ?? 0)),
      erBenefits: round(countedPaychecks.reduce((s, p) => s + p.allocated.erBenefits, 0) + (accrual?.estimatedErBenefits ?? 0)),
    };

    return NextResponse.json({
      employeeId,
      companyId,
      year,
      month,
      employeeName: monthlyCost?.employee_name ?? null,
      annualComp: monthlyCost?.annual_comp ?? null,
      payType: monthlyCost?.pay_type ?? null,
      daysInMonth,
      paychecks: allocatedPaychecks,
      accrual,
      totalAllocated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch detail" },
      { status: 500 }
    );
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseDate(dateStr: string): Date {
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(start: Date, end: Date): number {
  if (end < start) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

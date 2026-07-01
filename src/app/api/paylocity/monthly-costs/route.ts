import { NextRequest, NextResponse } from "next/server";

// Allow up to 5 minutes for the sync (fetches pay statements for all employees)
export const maxDuration = 300;
import { createClient } from "@supabase/supabase-js";
import { getAllCompanyClients } from "@/lib/paylocity";
import {
  getAnnualComp,
  calculateEmployerTaxes,
} from "@/lib/utils/payroll-calculations";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";
import { AllocationResolver } from "@/lib/paylocity/allocation-resolver";

// Use an untyped Supabase client since the table isn't in generated types yet
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/paylocity/monthly-costs?year=2026&entityId=...
 *
 * Reads monthly employee costs from Supabase (no Paylocity API calls).
 * Applies allocation overrides to filter by entity.
 */
export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year")) || new Date().getFullYear();
  const entityId = request.nextUrl.searchParams.get("entityId");

  try {
    const supabase = getSupabase();

    // Paginate to avoid the Supabase 1000-row hard cap
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function fetchAll(table: string, filters: Record<string, string> = {}): Promise<any[]> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all: any[] = [];
      const pageSize = 1000;
      let from = 0;

      while (true) {
        let q = supabase.from(table).select("*").range(from, from + pageSize - 1);
        for (const [key, val] of Object.entries(filters)) {
          q = q.eq(key, val);
        }
        const { data, error } = await q;
        if (error) throw new Error(`Query ${table} failed: ${error.message}`);
        all.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }

      return all;
    }

    const [costs, allocations] = await Promise.all([
      fetchAll("employee_monthly_costs", { year: String(year) }),
      fetchAll("employee_allocations"),
    ]);

    // Build date-aware allocation resolver
    const resolver = new AllocationResolver(allocations);

    // Apply allocation overrides to determine effective entity per row.
    // Uses the first day of each row's month to resolve the active allocation.
    const enriched = costs.map((row) => {
      const firstOfMonth = `${row.year}-${String(row.month).padStart(2, "0")}-01`;
      const override = resolver.getForDate(
        row.employee_id,
        row.paylocity_company_id,
        firstOfMonth
      );
      const defaultEntity = getOperatingEntityForCostCenter(
        row.cost_center_code,
        row.paylocity_company_id
      );

      const effectiveEntityId = override?.allocated_entity_id || defaultEntity.operatingEntityId;
      const effectiveDepartment = override?.department || defaultEntity.department;

      return {
        ...row,
        effective_entity_id: effectiveEntityId,
        effective_department: effectiveDepartment,
      };
    });

    // Filter by entity if requested
    const filtered = entityId
      ? enriched.filter((r) => r.effective_entity_id === entityId)
      : enriched;

    // Get last sync timestamp
    const lastSynced = costs.length > 0
      ? costs.reduce((latest, r) => {
          const t = r.synced_at ?? "";
          return t > latest ? t : latest;
        }, "")
      : null;

    return NextResponse.json({
      year,
      entityId: entityId ?? null,
      lastSynced,
      rows: filtered,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch monthly costs" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/paylocity/monthly-costs?year=2026
 *
 * Syncs pay statement data from Paylocity into Supabase using accrual
 * accounting. Pay periods that span month boundaries are pro-rated by
 * calendar days. Months (or partial months) not covered by any pay
 * period are filled with accrual estimates based on the employee's
 * annual comp rate.
 */
export async function POST(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year")) || new Date().getFullYear();

  try {
    const supabase = getSupabase();
    const clients = getAllCompanyClients();
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const syncedAt = now.toISOString();

    // Determine which months to generate (through current month for current year, all 12 for past years)
    const lastMonth = year < currentYear ? 12 : year === currentYear ? currentMonth : 0;

    const upsertRows: {
      employee_id: string;
      paylocity_company_id: string;
      employee_name: string;
      job_title: string;
      pay_type: string;
      cost_center_code: string;
      annual_comp: number;
      year: number;
      month: number;
      gross_pay: number;
      er_taxes: number;
      er_benefits: number;
      total_cost: number;
      hours_worked: number;
      regular_hours: number;
      overtime_hours: number;
      check_count: number;
      is_accrual: boolean;
      synced_at: string;
      updated_at: string;
    }[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paycheckDetailRows: any[] = [];

    let totalEmployees = 0;
    let totalSummaries = 0;
    let totalDetails = 0;
    let summaryErrors = 0;
    let detailErrors = 0;
    const sampleErrors: string[] = [];

    for (const client of clients) {
      const companyId = client.companyId;

      // Fetch ALL employees (including terminated) so anyone who was paid
      // during the year shows up. The hasAnyActual check filters out
      // employees with zero pay statements.
      const rawEmployees = await client.getEmployees({
        activeOnly: false,
        include: ["info", "position", "payrate", "status"],
      });

      totalEmployees += rawEmployees.length;

      const batchSize = 5;

      for (let i = 0; i < rawEmployees.length; i += batchSize) {
        const batch = rawEmployees.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (emp) => {
            const firstName = emp.info?.firstName ?? "";
            const lastName = emp.info?.lastName ?? emp.lastName ?? "";
            const displayName =
              emp.displayName ?? (`${firstName} ${lastName}`.trim() || `Employee ${emp.id}`);

            const annualComp = getAnnualComp(emp);
            const costCenterCode = emp.position?.costCenter1 ?? null;
            const jobTitle = emp.info?.jobTitle ?? "";
            const payType = emp.currentPayRate?.payType ?? "Unknown";
            const isActive = emp.statusType === "A";

            // Daily rate for accrual estimates (calendar days)
            const dailyRate = annualComp / 365;

            // Fetch pay statements for the target year AND the next year.
            // Paychecks issued in early Jan of year+1 may cover a Dec pay
            // period — the Paylocity API only returns them under year+1.
            let summaries: Awaited<ReturnType<typeof client.getPayStatementSummary>> = [];
            let details: Awaited<ReturnType<typeof client.getPayStatementDetails>> = [];

            try {
              const [s1, s2] = await Promise.all([
                client.getPayStatementSummary(emp.id, year),
                client.getPayStatementSummary(emp.id, year + 1).catch(() => []),
              ]);
              summaries = [...s1, ...s2];
              totalSummaries += summaries.length;
            } catch (err) {
              summaryErrors++;
              if (sampleErrors.length < 3) {
                sampleErrors.push(`Summary ${emp.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }

            try {
              const [d1, d2] = await Promise.all([
                client.getPayStatementDetails(emp.id, year),
                client.getPayStatementDetails(emp.id, year + 1).catch(() => []),
              ]);
              details = [...d1, ...d2];
              totalDetails += details.length;
            } catch (err) {
              detailErrors++;
              if (sampleErrors.length < 5) {
                sampleErrors.push(`Detail ${emp.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }

            // ── Pro-rate each pay period across months ──
            //
            // For each pay statement, split gross pay, hours, and benefits
            // proportionally by how many calendar days of the pay period
            // fall in each month within the target year.

            interface MonthBucket {
              actualGross: number;
              actualHours: number;
              actualRegHours: number;
              actualOtHours: number;
              actualBenefits: number;
              actualErTaxes: number;
              checks: number;
              daysCovered: number;
            }

            const buckets: Record<number, MonthBucket> = {};
            for (let m = 1; m <= 12; m++) {
              buckets[m] = {
                actualGross: 0, actualHours: 0, actualRegHours: 0,
                actualOtHours: 0, actualBenefits: 0, actualErTaxes: 0,
                checks: 0, daysCovered: 0,
              };
            }

            // Track actual ER taxes per checkDate for pro-rating into months
            const erTaxesByCheck: Record<string, number> = {};

            // ── Group detail lines by checkDate for paycheck-level storage ──

            const detailsByCheck: Record<string, typeof details> = {};
            const benefitsByCheck: Record<string, number> = {};
            const benefitDetailByCheck: Record<string, Record<string, number>> = {};

            for (const d of details) {
              const ck = stripTime(d.checkDate);
              if (!detailsByCheck[ck]) detailsByCheck[ck] = [];
              detailsByCheck[ck].push(d);

              const detTypeLower = (d.detType ?? "").toLowerCase();
              if (detTypeLower === "memo" || detTypeLower === "memoermatch") {
                const amount = d.amount ?? 0;
                if (amount > 0) {
                  benefitsByCheck[d.checkDate] = (benefitsByCheck[d.checkDate] ?? 0) + amount;
                  if (!benefitDetailByCheck[ck]) benefitDetailByCheck[ck] = {};
                  const code = d.detCode ?? "OTHER";
                  benefitDetailByCheck[ck][code] = (benefitDetailByCheck[ck][code] ?? 0) + amount;
                }
              }
            }

            // Running YTD gross before each check (for the capped ER-tax
            // estimate fallback when Paylocity -R codes are absent).
            const ytdBeforeCheck: Record<string, number> = {};
            {
              const sortedByDate = [...summaries].sort((a, b) =>
                stripTime(a.checkDate).localeCompare(stripTime(b.checkDate))
              );
              let ytdRunning = 0;
              for (const ps of sortedByDate) {
                if (!(ps.checkDate in ytdBeforeCheck)) ytdBeforeCheck[ps.checkDate] = ytdRunning;
                ytdRunning += ps.grossPay || 0;
              }
            }

            // Build per-paycheck detail rows
            for (const ps of summaries) {
              const ck = stripTime(ps.checkDate);
              const checkDetails = detailsByCheck[ck] ?? [];

              let regHrs = 0, regDollars = 0;
              let otHrs = 0, otDollars = 0;
              let dtHrs = 0, dtDollars = 0;
              let mealDollars = 0;
              let otherDollars = 0;
              let erTaxesActual = 0;

              // Employer tax codes: -R suffix (SS-R, MED-R) and FUTA, CASUI, CAETT
              const ER_TAX_CODES = new Set(["SS-R", "MED-R", "FUTA", "CASUI", "CAETT"]);

              for (const d of checkDetails) {
                const detTypeLower = (d.detType ?? "").toLowerCase();
                const code = (d.detCode ?? "").toUpperCase();
                const hrs = d.hours ?? 0;
                const amt = d.amount ?? 0;

                // Earnings — detType varies: Reg, OT, Standard, DT, Earning
                const isEarning = ["earning", "reg", "standard", "ot", "dt"].includes(detTypeLower);
                if (isEarning) {
                  // Classify by detCode first, then fall back to detType
                  if (code === "REG") {
                    regHrs += hrs; regDollars += amt;
                  } else if (code === "OT" || code === "FQOT" || detTypeLower === "ot") {
                    otHrs += hrs; otDollars += amt;
                  } else if (code === "DT" || detTypeLower === "dt") {
                    dtHrs += hrs; dtDollars += amt;
                  } else if (code === "MEAL") {
                    mealDollars += amt;
                  } else {
                    otherDollars += amt;
                  }
                }

                // Employer taxes (actual from Paylocity)
                if ((detTypeLower === "fed" || detTypeLower === "sui") && ER_TAX_CODES.has(code)) {
                  erTaxesActual += amt;
                }
              }

              const erBenefitsCheck = benefitsByCheck[ps.checkDate] ?? 0;
              const erTaxes = erTaxesActual > 0
                ? round(erTaxesActual)
                : round(
                    calculateEmployerTaxes(ps.grossPay || 0, ytdBeforeCheck[ps.checkDate] ?? 0).total
                  );

              // Store for monthly bucket pro-rating
              erTaxesByCheck[ps.checkDate] = erTaxes;

              paycheckDetailRows.push({
                employee_id: emp.id,
                paylocity_company_id: companyId,
                employee_name: displayName,
                year,
                check_date: ck,
                begin_date: stripTime(ps.beginDate || ps.checkDate),
                end_date: stripTime(ps.endDate || ps.checkDate),
                transaction_number: String(ps.transactionNumber ?? ck),
                gross_pay: round(ps.grossPay || 0),
                net_pay: round(ps.netPay || 0),
                hours: round(ps.hours || 0),
                regular_hours: round(regHrs),
                regular_dollars: round(regDollars),
                overtime_hours: round(otHrs),
                overtime_dollars: round(otDollars),
                doubletime_hours: round(dtHrs),
                doubletime_dollars: round(dtDollars),
                meal_dollars: round(mealDollars),
                other_earnings_dollars: round(otherDollars),
                er_taxes_estimated: erTaxes,
                er_benefits: round(erBenefitsCheck),
                er_benefit_detail: benefitDetailByCheck[ck] ?? {},
                detail_lines: checkDetails.map((d) => ({
                  detType: d.detType, detCode: d.detCode,
                  amount: d.amount, hours: d.hours, rate: d.rate,
                })),
                synced_at: syncedAt,
              });
            }

            for (const ps of summaries) {
              const begin = parseDate(ps.beginDate || ps.checkDate);
              const end = parseDate(ps.endDate || ps.checkDate);
              const totalDays = daysBetween(begin, end);
              if (totalDays <= 0) continue;

              const checkBenefits = benefitsByCheck[ps.checkDate] ?? 0;

              // Walk each month the pay period touches
              const startMonth = begin.getMonth() + 1;
              const startYear = begin.getFullYear();
              const endMonth = end.getMonth() + 1;
              const endYear = end.getFullYear();

              // Iterate from the begin date's month to the end date's month
              let cursor = new Date(begin);
              while (cursor <= end) {
                const curMonth = cursor.getMonth() + 1;
                const curYear = cursor.getFullYear();

                // Only count days that fall within the target year
                if (curYear === year) {
                  // First day of this month portion
                  const monthStart = (curYear === startYear && curMonth === startMonth)
                    ? begin
                    : new Date(curYear, curMonth - 1, 1);
                  // Last day of this month portion
                  const monthEnd = (curYear === endYear && curMonth === endMonth)
                    ? end
                    : new Date(curYear, curMonth, 0); // last day of month

                  const daysInMonth = daysBetween(monthStart, monthEnd);
                  const fraction = daysInMonth / totalDays;

                  if (curMonth >= 1 && curMonth <= 12 && daysInMonth > 0) {
                    buckets[curMonth].actualGross += (ps.grossPay || 0) * fraction;
                    buckets[curMonth].actualHours += (ps.hours || 0) * fraction;
                    buckets[curMonth].actualRegHours += (ps.regularHours || 0) * fraction;
                    buckets[curMonth].actualOtHours += (ps.overtimeHours || 0) * fraction;
                    buckets[curMonth].actualBenefits += checkBenefits * fraction;
                    buckets[curMonth].actualErTaxes += (erTaxesByCheck[ps.checkDate] ?? 0) * fraction;
                    buckets[curMonth].daysCovered += daysInMonth;
                    buckets[curMonth].checks++;
                  }
                }

                // Advance to the first day of the next month
                cursor = new Date(curYear, curMonth, 1);
              }
            }

            // ── Build monthly rows: actual pro-rated data + accrual for gaps ──

            // Skip employees with zero actual paycheck data for the entire year
            const hasAnyActual = Object.values(buckets).some((b) => b.checks > 0);
            if (!hasAnyActual) return;

            // Average monthly benefit from actual data for current-month accrual
            const totalActualBenefits = Object.values(buckets).reduce((s, b) => s + b.actualBenefits, 0);
            const monthsWithActual = Object.values(buckets).filter((b) => b.checks > 0).length;
            const avgMonthlyBenefit = monthsWithActual > 0 ? totalActualBenefits / monthsWithActual : 0;

            // Only accrue gaps for the current month (not past months)
            const isCurrentYearMonth = (m: number) =>
              year === currentYear && m === currentMonth;

            // Running YTD actual gross (for the capped ER-tax estimate on the
            // current-month accrual gap).
            let ytdActualGross = 0;

            for (let m = 1; m <= lastMonth; m++) {
              const b = buckets[m];

              // Skip months with no actual data (unless it's the current month)
              if (b.checks === 0 && !isCurrentYearMonth(m)) continue;

              const daysInCalendarMonth = new Date(year, m, 0).getDate();
              const daysCovered = Math.min(b.daysCovered, daysInCalendarMonth);
              const daysUncovered = daysInCalendarMonth - daysCovered;

              // Actual portion (from pro-rated pay periods)
              let grossPay = b.actualGross;
              const hours = b.actualHours;
              const regHours = b.actualRegHours;
              const otHours = b.actualOtHours;
              let benefits = b.actualBenefits;
              let erTaxes = b.actualErTaxes;
              let isAccrual = false;

              // Only accrue the gap for the CURRENT month, and only for active employees
              if (isCurrentYearMonth(m) && isActive && daysUncovered > 0 && annualComp > 0) {
                const accrualGross = dailyRate * daysUncovered;
                grossPay += accrualGross;
                isAccrual = daysCovered === 0;
                // Canonical capped employer-tax engine on the accrued portion,
                // respecting YTD wage-base caps (not a flat FICA rate).
                erTaxes += calculateEmployerTaxes(accrualGross, ytdActualGross + b.actualGross).total;
                if (avgMonthlyBenefit > 0) {
                  benefits += avgMonthlyBenefit * (daysUncovered / daysInCalendarMonth);
                }
              }

              // Advance YTD actual gross for the next month's cap calculation.
              ytdActualGross += b.actualGross;

              grossPay = round(grossPay);
              benefits = round(benefits);
              erTaxes = round(erTaxes);

              upsertRows.push({
                employee_id: emp.id,
                paylocity_company_id: companyId,
                employee_name: displayName,
                job_title: jobTitle,
                pay_type: payType,
                cost_center_code: costCenterCode ?? "",
                annual_comp: round(annualComp),
                year,
                month: m,
                gross_pay: grossPay,
                er_taxes: erTaxes,
                er_benefits: benefits,
                total_cost: round(grossPay + erTaxes + benefits),
                hours_worked: round(hours),
                regular_hours: round(regHours),
                overtime_hours: round(otHours),
                check_count: b.checks,
                is_accrual: isAccrual,
                synced_at: syncedAt,
                updated_at: syncedAt,
              });
            }
          })
        );
      }
    }

    // Upsert fresh data in batches of 500
    const upsertBatchSize = 500;
    let upsertedCount = 0;

    for (let i = 0; i < upsertRows.length; i += upsertBatchSize) {
      const batch = upsertRows.slice(i, i + upsertBatchSize);
      const { error } = await supabase
        .from("employee_monthly_costs")
        .upsert(batch, {
          onConflict: "employee_id,paylocity_company_id,year,month",
        });

      if (error) {
        return NextResponse.json(
          { error: `Upsert failed: ${error.message}` },
          { status: 500 }
        );
      }
      upsertedCount += batch.length;
    }

    // Upsert paycheck details in batches
    for (let i = 0; i < paycheckDetailRows.length; i += upsertBatchSize) {
      const batch = paycheckDetailRows.slice(i, i + upsertBatchSize);
      const { error } = await supabase
        .from("employee_paycheck_details")
        .upsert(batch, {
          onConflict: "employee_id,paylocity_company_id,year,check_date,transaction_number",
        });
      if (error) {
        // Non-fatal — monthly data is already saved
        console.error("Paycheck detail upsert error:", error.message);
      }
    }

    // Clean up stale rows for both tables
    await Promise.all([
      supabase
        .from("employee_monthly_costs")
        .delete()
        .eq("year", year)
        .lt("synced_at", syncedAt),
      supabase
        .from("employee_paycheck_details")
        .delete()
        .eq("year", year)
        .lt("synced_at", syncedAt),
    ]);

    // Grab a sample pay statement for diagnostics
    let sampleStatement = null;
    for (const client of clients) {
      try {
        const emps = await client.getEmployees({ activeOnly: true, include: ["info"] });
        if (emps.length > 0) {
          const stmts = await client.getPayStatementSummary(emps[0].id, year);
          if (stmts.length > 0) {
            sampleStatement = {
              beginDate: stmts[0].beginDate,
              endDate: stmts[0].endDate,
              checkDate: stmts[0].checkDate,
              grossPay: stmts[0].grossPay,
              beginDateType: typeof stmts[0].beginDate,
              endDateType: typeof stmts[0].endDate,
            };
            break;
          }
        }
      } catch { /* ignore */ }
    }

    return NextResponse.json({
      success: true,
      year,
      employeesProcessed: totalEmployees,
      rowsUpserted: upsertedCount,
      syncedAt,
      debug: {
        totalSummaries,
        totalDetails,
        summaryErrors,
        detailErrors,
        sampleErrors,
        sampleStatement,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Strip time portion from ISO date string */
function stripTime(dateStr: string): string {
  return dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
}

/** Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS" to a Date at midnight local time */
function parseDate(dateStr: string): Date {
  // Strip any time portion
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Count calendar days between two dates, inclusive of both endpoints */
function daysBetween(start: Date, end: Date): number {
  if (end < start) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

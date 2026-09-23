import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllCompanyClients } from "@/lib/paylocity";
import { AllocationResolver, type AllocationRow } from "@/lib/paylocity/allocation-resolver";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { accessErrorResponse, getBudgetActor, requirePlanAccess, assertOrgManager } from "@/lib/budget/access";
import { functionFromDepartment, locationFromDepartment } from "@/lib/budget/tagging";
import { snapshotFields } from "@/lib/budget/baseline";
import {
  deriveRunRates,
  seedRowForEmployee,
  type EarningCodeRow,
  type PaycheckRow,
  type SeedRow,
} from "@/lib/budget/personnel-seed";

export const maxDuration = 300; // live roster pull from both Paylocity companies

/**
 * POST /api/budget/headcount/seed
 * Body: { planId, mode: "preview" | "commit", overwrite?: boolean }
 *
 * Builds one row per active employee across every Paylocity company for the
 * organization's shared payroll plan, from the live roster plus the trailing
 * twelve months of stored paychecks. The HR allocation seeds each row's
 * entity split; the plan can override it. Commit inserts rows that do not exist
 * yet; with overwrite=true existing seeded rows are refreshed too (rows
 * edited by hand keep their edits unless overwrite is set).
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json().catch(() => ({}));
    const planId: string | undefined = body?.planId;
    const mode: "preview" | "commit" = body?.mode === "commit" ? "commit" : "preview";
    const overwrite = body?.overwrite === true;
    if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

    const admin = createAdminClient();
    // Paginated reads return shapes (jsonb columns) the generated types do not narrow.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const plan = await requirePlanAccess(admin, actor, planId, mode === "commit");
    assertOrgManager(actor, plan.organizationId);
    // The shared plan takes everyone: every entity of the organization counts as "ours"
    const { data: orgEntities } = await admin.from("entities").select("id").eq("organization_id", plan.organizationId);
    const memberEntityIds = new Set((orgEntities ?? []).map((e) => e.id));
    const owner = { fiscalYear: plan.fiscalYear };

    // Trailing twelve months of paychecks (not excluded)
    const since = new Date();
    since.setUTCFullYear(since.getUTCFullYear() - 1);
    const sinceIso = since.toISOString().slice(0, 10);
    const checks = await fetchAllPaginated<PaycheckRow>((offset, limit) =>
      db
        .from("employee_paycheck_details")
        .select("employee_id, paylocity_company_id, check_date, gross_pay, regular_dollars, overtime_dollars, doubletime_dollars, meal_dollars, other_earnings_dollars, er_benefit_detail, detail_lines, workers_comp_code, excluded")
        .gte("check_date", sinceIso)
        .range(offset, offset + limit - 1),
    );
    // The same transaction can be stored under two `year` copies; keep one.
    const seen = new Set<string>();
    const uniqueChecks = checks.filter((c) => {
      const key = `${c.paylocity_company_id}|${c.employee_id}|${c.check_date}|${(c as unknown as { transaction_number?: string }).transaction_number ?? ""}|${c.gross_pay}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const { data: codes } = await admin
      .from("payroll_earning_codes")
      .select("paylocity_company_id, code, effective_category, effective_subcategory");
    const runRates = deriveRunRates(uniqueChecks, (codes ?? []) as EarningCodeRow[]);

    // Workers comp fallback from older stored statements
    const wcCodes = new Map<string, string>();
    const { data: wcRows } = await admin
      .from("payroll_pay_statements")
      .select("employee_id, paylocity_company_id, workers_comp_code, check_date")
      .not("workers_comp_code", "is", null)
      .order("check_date", { ascending: false })
      .limit(5000);
    for (const r of (wcRows ?? []) as { employee_id: string; paylocity_company_id: string; workers_comp_code: string }[]) {
      const key = `${r.paylocity_company_id}:${r.employee_id}`;
      if (!wcCodes.has(key)) wcCodes.set(key, r.workers_comp_code);
    }

    const allocRows = await fetchAllPaginated<AllocationRow>((offset, limit) =>
      db
        .from("employee_allocations")
        .select("employee_id, paylocity_company_id, department, class, class_allocations, entity_allocations, allocated_entity_id, allocated_entity_name, effective_date")
        .range(offset, offset + limit - 1),
    );
    const resolver = new AllocationResolver(allocRows);
    const asOf = `${owner.fiscalYear}-01-01`;

    // Live roster from every Paylocity company
    const clients = getAllCompanyClients();
    const roster = (
      await Promise.all(
        clients.map((c) =>
          c.getEmployees({ activeOnly: true, include: ["info", "position", "payrate", "status", "futurePayrates"] }).catch((err) => {
            console.error(`Roster fetch failed for company ${c.companyId}:`, err);
            return [];
          }),
        ),
      )
    ).flat();

    const rows: SeedRow[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    for (const emp of roster) {
      // Paylocity returns system accounts, test records and removed employees
      // even with activeOnly=true (same guard as the payroll sync).
      if (emp.status === "Removed") continue;
      if (!emp.info?.firstName && !emp.info?.lastName) continue;
      if (typeof emp.id === "string" && /^(P\d|coRpt)/i.test(emp.id)) continue;
      // Only active employees are seeded. The status object is the reliable
      // source; the top-level statusType is not always populated.
      const statusType = emp.currentStatus?.statusType ?? emp.statusType;
      if (statusType !== "A") {
        skipped.push({ name: emp.displayName ?? emp.id, reason: statusType === "L" ? "on leave" : "terminated" });
        continue;
      }
      const row = seedRowForEmployee(emp, {
        year: owner.fiscalYear,
        memberEntityIds,
        allocationFor: (id, company) => resolver.getForDate(id, company, asOf) ?? resolver.getForDate(id, company, "2999-12-31"),
        runRates,
        wcCodes,
      });
      if (!row) {
        skipped.push({ name: emp.displayName ?? emp.id, reason: "no entity allocation in HR" });
        continue;
      }
      rows.push(row);
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));

    if (mode === "preview") {
      return NextResponse.json({ mode, rows, skipped, checksUsed: uniqueChecks.length, rosterSize: roster.length });
    }

    // Commit: insert new rows; overwrite refreshes existing employee rows
    const { data: existing } = await admin
      .from("budget_headcount")
      .select("id, employee_id, paylocity_company_id")
      .eq("payroll_plan_id", plan.id);
    const existingByKey = new Map<string, string>();
    for (const e of existing ?? []) {
      if (e.employee_id) existingByKey.set(`${e.paylocity_company_id}:${e.employee_id}`, e.id);
    }

    let inserted = 0;
    let updated = 0;
    for (const r of rows) {
      const key = `${r.paylocityCompanyId}:${r.employeeId}`;
      // The seeded values are the baseline every later change is measured against
      const fieldsForSnapshot = {
        pay_type: r.payType,
        base_rate: r.baseRate,
        annual_salary: r.annualSalary,
        amount_monthly: null,
        std_hours_week: r.stdHoursWeek,
        fte_pct: 100,
        start_month: r.startMonth,
        end_month: null,
        bonus_target: r.bonusTarget,
        commission_annual: r.commissionAnnual,
        ot_pct: r.otPct,
        dt_pct: r.dtPct,
        meal_pct: r.mealPct,
        benefits_monthly: r.benefitsMonthly,
        match_pct: r.matchPct,
        life_disability_monthly: 0,
        pto_hours_per_period: 0,
        other_costs_monthly: 0,
      };
      const payload = {
        payroll_plan_id: plan.id,
        allocation_mode: "manual",
        employee_id: r.employeeId,
        paylocity_company_id: r.paylocityCompanyId,
        name: r.name,
        title: r.title,
        department: r.department,
        is_requisition: false,
        status: "active",
        pay_type: r.payType,
        base_rate: r.baseRate,
        annual_salary: r.annualSalary,
        std_hours_week: r.stdHoursWeek,
        fte_pct: 100,
        start_month: r.startMonth,
        merit_pct: r.meritPct,
        merit_month: r.meritMonth,
        // A future pay rate in Paylocity becomes the row's adjustment
        comp_adj_kind: r.meritPct ? "percent" : null,
        comp_adj_value: r.meritPct ? r.meritPct : null,
        comp_adj_month: r.meritPct ? r.meritMonth ?? 1 : null,
        comp_adj_reason: r.meritPct ? "Scheduled pay change in Paylocity" : null,
        bonus_target: r.bonusTarget,
        commission_annual: r.commissionAnnual,
        ot_pct: r.otPct,
        dt_pct: r.dtPct,
        meal_pct: r.mealPct,
        other_earnings_monthly: r.otherEarningsMonthly,
        benefits_monthly: r.benefitsMonthly,
        match_pct: r.matchPct,
        wc_class_code: r.wcClassCode,
        entity_allocations: r.entityAllocations,
        // Tags: a first pass from the Paylocity department; accounting sets them once per person
        function_allocations: functionFromDepartment(r.department) ? [{ key: functionFromDepartment(r.department), pct: 100 }] : [],
        location_allocations: locationFromDepartment(r.department) ? [{ key: locationFromDepartment(r.department), pct: 100 }] : [],
        class_allocations: r.classAllocations,
        seeded_from: { ...r.seededFrom, warnings: r.warnings, fields: snapshotFields(fieldsForSnapshot) },
      };
      const existingId = existingByKey.get(key);
      if (existingId) {
        if (!overwrite) continue;
        const { error } = await admin.from("budget_headcount").update(payload).eq("id", existingId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        updated++;
      } else {
        const { error } = await admin.from("budget_headcount").insert(payload);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        inserted++;
      }
    }

    return NextResponse.json({ mode, inserted, updated, unchanged: rows.length - inserted - updated, skipped: skipped.length });
  } catch (err) {
    console.error("POST /api/budget/headcount/seed error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

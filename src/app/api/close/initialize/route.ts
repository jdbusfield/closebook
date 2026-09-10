import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GATE_CHECKS } from "@/lib/utils/close-management";
import type { Database } from "@/lib/types/database.types";

type CloseTaskInsert = Database["public"]["Tables"]["close_tasks"]["Insert"];

// ---------------------------------------------------------------------------
// POST /api/close/initialize
// Creates a close period with auto-discovered tasks from existing modules
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { entityId, periodYear, periodMonth } = body;

  if (!entityId || !periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "entityId, periodYear, and periodMonth are required" },
      { status: 400 }
    );
  }

  // Get user's organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  // 1. Create the close period
  const { data: period, error: periodError } = await supabase
    .from("close_periods")
    .insert({
      entity_id: entityId,
      period_year: periodYear,
      period_month: periodMonth,
      status: "open",
    })
    .select()
    .single();

  if (periodError) {
    return NextResponse.json({ error: periodError.message }, { status: 400 });
  }

  // 2. Load templates and create template-based tasks
  const { data: templates } = await supabase
    .from("close_task_templates")
    .select("*")
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true)
    .order("display_order");

  const tasksToInsert: CloseTaskInsert[] = [];
  let displayOrder = 0;

  if (templates && templates.length > 0) {
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, classification, account_type")
      .eq("entity_id", entityId)
      .eq("is_active", true);

    for (const template of templates) {
      // Skip templates scoped to other entities
      if (template.entity_ids && !template.entity_ids.includes(entityId)) {
        continue;
      }

      if (template.account_classification || template.account_type) {
        const matchingAccounts = (accounts ?? []).filter(
          (a) =>
            (!template.account_classification ||
              a.classification === template.account_classification) &&
            (!template.account_type || a.account_type === template.account_type)
        );

        for (const account of matchingAccounts) {
          tasksToInsert.push({
            close_period_id: period.id,
            template_id: template.id,
            account_id: account.id,
            name: template.name,
            description: template.description,
            category: template.category,
            display_order: displayOrder++,
            phase: template.phase ?? 3,
            source_module: template.source_module ?? null,
            is_auto_generated: false,
          });
        }
      } else {
        tasksToInsert.push({
          close_period_id: period.id,
          template_id: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          display_order: displayOrder++,
          phase: template.phase ?? 3,
          source_module: template.source_module ?? null,
          is_auto_generated: false,
        });
      }
    }
  }

  // 3. Auto-discover tasks from existing modules

  // 3a. Debt instruments → reconciliation tasks
  const { data: debtInstruments } = await supabase
    .from("debt_instruments")
    .select("id, instrument_name")
    .eq("entity_id", entityId)
    .eq("status", "active");

  if (debtInstruments && debtInstruments.length > 0) {
    for (const instrument of debtInstruments) {
      tasksToInsert.push({
        close_period_id: period.id,
        name: `Debt Reconciliation: ${instrument.instrument_name}`,
        description: "Reconcile debt GL accounts to amortization schedule",
        category: "Reconciliation",
        display_order: displayOrder++,
        phase: 3,
        source_module: "debt",
        source_record_id: instrument.id,
        is_auto_generated: true,
      });
    }
  }

  // 3b. Asset reconciliation groups
  const { data: assetReconGroups } = await supabase
    .from("asset_reconciliations")
    .select("gl_account_group")
    .eq("entity_id", entityId)
    .eq("period_year", periodYear)
    .eq("period_month", periodMonth);

  // If no recon rows yet for this period, check if entity has any active fixed assets
  if (!assetReconGroups || assetReconGroups.length === 0) {
    const { count } = await supabase
      .from("fixed_assets")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", entityId)
      .eq("status", "active");

    if (count && count > 0) {
      tasksToInsert.push({
        close_period_id: period.id,
        name: "Fixed Asset Reconciliation",
        description: "Reconcile fixed asset GL groups to asset register",
        category: "Reconciliation",
        display_order: displayOrder++,
        phase: 3,
        source_module: "assets",
        is_auto_generated: true,
      });
    }
  } else {
    const uniqueGroups = [
      ...new Set(assetReconGroups.map((r) => r.gl_account_group)),
    ];
    for (const group of uniqueGroups) {
      tasksToInsert.push({
        close_period_id: period.id,
        name: `Asset Reconciliation: ${group}`,
        description: "Reconcile fixed asset GL group to asset register",
        category: "Reconciliation",
        display_order: displayOrder++,
        phase: 3,
        source_module: "assets",
        is_auto_generated: true,
      });
    }
  }

  // 3c. Active leases → reconciliation tasks
  const { data: activeLeases } = await supabase
    .from("leases")
    .select("id, lease_name")
    .eq("entity_id", entityId)
    .eq("status", "active");

  if (activeLeases && activeLeases.length > 0) {
    for (const lease of activeLeases) {
      tasksToInsert.push({
        close_period_id: period.id,
        name: `Lease Reconciliation: ${lease.lease_name}`,
        description:
          "Reconcile ROU asset and lease liability to ASC 842 schedules",
        category: "Reconciliation",
        display_order: displayOrder++,
        phase: 3,
        source_module: "leases",
        source_record_id: lease.id,
        is_auto_generated: true,
      });
    }
  }

  // 3d. Payroll connection → accrual task
  const { data: payrollConn } = await supabase
    .from("paylocity_connections")
    .select("id")
    .eq("entity_id", entityId)
    .limit(1);

  if (payrollConn && payrollConn.length > 0) {
    tasksToInsert.push({
      close_period_id: period.id,
      name: "Record Payroll Accruals",
      description: "Record and verify payroll accrual entries for the period",
      category: "Accruals",
      display_order: displayOrder++,
      phase: 2,
      source_module: "payroll",
      is_auto_generated: true,
    });
  }

  // 3e. Multiple entities in org → intercompany review
  const { data: orgEntities } = await supabase
    .from("entities")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true);

  if (orgEntities && orgEntities.length > 1) {
    tasksToInsert.push({
      close_period_id: period.id,
      name: "Intercompany Elimination Review",
      description:
        "Verify intercompany eliminations net to zero across all entities",
      category: "Review",
      display_order: displayOrder++,
      phase: 4,
      source_module: "intercompany",
      is_auto_generated: true,
    });
  }

  // 3f. Always create TB Review and Financial Statement Review tasks
  tasksToInsert.push({
    close_period_id: period.id,
    name: "Trial Balance Review",
    description:
      "Review trial balance for anomalies and resolve unmatched accounts",
    category: "Review",
    display_order: displayOrder++,
    phase: 4,
    source_module: "tb",
    is_auto_generated: true,
  });

  tasksToInsert.push({
    close_period_id: period.id,
    name: "Financial Statement Review & Sign-off",
    description:
      "Review income statement, balance sheet, and cash flow statement",
    category: "Reporting",
    display_order: displayOrder++,
    phase: 4,
    source_module: "financial_statements",
    is_auto_generated: true,
  });

  // 4. Insert all tasks
  if (tasksToInsert.length > 0) {
    const { error: taskError } = await supabase
      .from("close_tasks")
      .insert(tasksToInsert);

    if (taskError) {
      console.error("Error inserting close tasks:", taskError);
    }
  }

  // 5. Create gate check rows
  const gateChecksToInsert = GATE_CHECKS.map((gc) => ({
    close_period_id: period.id,
    check_type: gc.checkType,
    status: "pending",
    is_critical: gc.isCritical,
  }));

  const { error: gateError } = await supabase
    .from("close_gate_checks")
    .insert(gateChecksToInsert);

  if (gateError) {
    console.error("Error inserting gate checks:", gateError);
  }

  return NextResponse.json({
    period,
    taskCount: tasksToInsert.length,
    gateCheckCount: gateChecksToInsert.length,
  });
}

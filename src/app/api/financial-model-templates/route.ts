import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Shape returned to / accepted from the client
// ---------------------------------------------------------------------------

export interface FinancialModelTemplate {
  id: string;
  name: string;
  isFavorite: boolean;
  scope: "organization" | "entity" | "reporting_entity";
  entityId: string | null;
  reportingEntityId: string | null;
  chartId: string | null;
  periodMode: "static" | "dynamic";
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  dynamicPreset: string | null;
  granularity: "monthly" | "quarterly" | "yearly";
  includeBudget: boolean;
  includeYoY: boolean;
  includeProForma: boolean;
  includeAllocations: boolean;
  includeTotal: boolean;
  ebitdaOnly: boolean;
  varianceDisplay: "dollars" | "percentage";
  includeIncomeStatement: boolean;
  includeBalanceSheet: boolean;
  includeCashFlow: boolean;
  includeProFormaSchedule: boolean;
  activeTab:
    | "all"
    | "income-statement"
    | "balance-sheet"
    | "cash-flow"
    | "pro-forma"
    | "allocations"
    | "entity-breakdown"
    | "re-breakdown"
    | "bridge";
  displayOrder: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTemplate(row: any): FinancialModelTemplate {
  return {
    id: row.id,
    name: row.name,
    isFavorite: !!row.is_favorite,
    scope: row.scope,
    entityId: row.entity_id,
    reportingEntityId: row.reporting_entity_id,
    chartId: row.chart_id,
    periodMode: row.period_mode,
    startYear: row.start_year,
    startMonth: row.start_month,
    endYear: row.end_year,
    endMonth: row.end_month,
    dynamicPreset: row.dynamic_preset,
    granularity: row.granularity,
    includeBudget: !!row.include_budget,
    includeYoY: !!row.include_yoy,
    includeProForma: !!row.include_pro_forma,
    includeAllocations: !!row.include_allocations,
    includeTotal: !!row.include_total,
    ebitdaOnly: !!row.ebitda_only,
    varianceDisplay: row.variance_display,
    includeIncomeStatement: !!row.include_income_statement,
    includeBalanceSheet: !!row.include_balance_sheet,
    includeCashFlow: !!row.include_cash_flow,
    includeProFormaSchedule: !!row.include_pro_forma_schedule,
    activeTab: row.active_tab ?? "all",
    displayOrder: row.display_order ?? 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function templateToRow(t: Partial<FinancialModelTemplate>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (t.name !== undefined) row.name = t.name;
  if (t.isFavorite !== undefined) row.is_favorite = !!t.isFavorite;
  if (t.scope !== undefined) row.scope = t.scope;
  if (t.entityId !== undefined) row.entity_id = t.entityId;
  if (t.reportingEntityId !== undefined) row.reporting_entity_id = t.reportingEntityId;
  if (t.chartId !== undefined) row.chart_id = t.chartId;
  if (t.periodMode !== undefined) row.period_mode = t.periodMode;
  if (t.startYear !== undefined) row.start_year = t.startYear;
  if (t.startMonth !== undefined) row.start_month = t.startMonth;
  if (t.endYear !== undefined) row.end_year = t.endYear;
  if (t.endMonth !== undefined) row.end_month = t.endMonth;
  if (t.dynamicPreset !== undefined) row.dynamic_preset = t.dynamicPreset;
  if (t.granularity !== undefined) row.granularity = t.granularity;
  if (t.includeBudget !== undefined) row.include_budget = !!t.includeBudget;
  if (t.includeYoY !== undefined) row.include_yoy = !!t.includeYoY;
  if (t.includeProForma !== undefined) row.include_pro_forma = !!t.includeProForma;
  if (t.includeAllocations !== undefined) row.include_allocations = !!t.includeAllocations;
  if (t.includeTotal !== undefined) row.include_total = !!t.includeTotal;
  if (t.ebitdaOnly !== undefined) row.ebitda_only = !!t.ebitdaOnly;
  if (t.varianceDisplay !== undefined) row.variance_display = t.varianceDisplay;
  if (t.includeIncomeStatement !== undefined) row.include_income_statement = !!t.includeIncomeStatement;
  if (t.includeBalanceSheet !== undefined) row.include_balance_sheet = !!t.includeBalanceSheet;
  if (t.includeCashFlow !== undefined) row.include_cash_flow = !!t.includeCashFlow;
  if (t.includeProFormaSchedule !== undefined) row.include_pro_forma_schedule = !!t.includeProFormaSchedule;
  if (t.activeTab !== undefined) row.active_tab = t.activeTab;
  if (t.displayOrder !== undefined) row.display_order = t.displayOrder;
  return row;
}

// ---------------------------------------------------------------------------
// GET — list templates for an organization
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required" },
      { status: 400 }
    );
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();
  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("financial_model_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .order("is_favorite", { ascending: false })
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    templates: (data ?? []).map((row: any) => rowToTemplate(row)),
  });
}

// ---------------------------------------------------------------------------
// POST — create a new template
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { organizationId, template } = body as {
    organizationId: string;
    template: Partial<FinancialModelTemplate>;
  };

  if (!organizationId || !template?.name) {
    return NextResponse.json(
      { error: "organizationId and template.name are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .single();
  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const row = {
    ...templateToRow(template),
    organization_id: organizationId,
    created_by: user.id,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("financial_model_templates")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ template: rowToTemplate(data) });
}

// ---------------------------------------------------------------------------
// PUT — update template (partial)
// ---------------------------------------------------------------------------

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { templateId, template } = body as {
    templateId: string;
    template: Partial<FinancialModelTemplate>;
  };

  if (!templateId) {
    return NextResponse.json(
      { error: "templateId is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from("financial_model_templates")
    .select("id, organization_id")
    .eq("id", templateId)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", existing.organization_id)
    .eq("user_id", user.id)
    .single();
  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const row = templateToRow(template);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("financial_model_templates")
    .update(row)
    .eq("id", templateId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ template: rowToTemplate(data) });
}

// ---------------------------------------------------------------------------
// DELETE — remove a template
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const templateId = searchParams.get("templateId");
  if (!templateId) {
    return NextResponse.json(
      { error: "templateId is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from("financial_model_templates")
    .select("id, organization_id")
    .eq("id", templateId)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", existing.organization_id)
    .eq("user_id", user.id)
    .single();
  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("financial_model_templates")
    .delete()
    .eq("id", templateId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

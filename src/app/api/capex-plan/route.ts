import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, assertOrgEditor, assertOrgMember, getBudgetActor } from "@/lib/budget/access";
import { computeCapexMonthly, type CapexItemInput, type DisposalItemInput } from "@/lib/budget/capex-engine";

const ITEM_FIELDS = new Set([
  "reporting_entity_id", "entity_id", "description", "asset_group", "vehicle_class", "quantity", "unit_cost",
  "in_service_year", "in_service_month", "useful_life_months", "salvage_pct", "depreciation_method", "funding",
  "debt_rate", "debt_term_months", "debt_pct", "status", "fixed_asset_id", "cost_account_id", "notes",
]);
const DISPOSAL_FIELDS = new Set([
  "reporting_entity_id", "entity_id", "fixed_asset_id", "description", "asset_group", "quantity", "disposal_year",
  "disposal_month", "expected_proceeds", "nbv_at_disposal", "monthly_depreciation", "status", "notes",
]);

function pick(body: Record<string, unknown>, allowed: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (allowed.has(k)) out[k] = v === "" ? null : v;
  return out;
}

function toItem(r: Record<string, unknown>): CapexItemInput {
  return {
    id: String(r.id),
    description: String(r.description ?? ""),
    assetGroup: (r.asset_group as string | null) ?? null,
    quantity: Number(r.quantity ?? 1),
    unitCost: Number(r.unit_cost ?? 0),
    inServiceYear: Number(r.in_service_year),
    inServiceMonth: Number(r.in_service_month),
    usefulLifeMonths: (r.useful_life_months as number | null) ?? null,
    salvagePct: (r.salvage_pct as number | null) ?? null,
    funding: (r.funding as "cash" | "debt" | "lease") ?? "cash",
    debtRate: (r.debt_rate as number | null) ?? null,
    debtTermMonths: (r.debt_term_months as number | null) ?? null,
    debtPct: (r.debt_pct as number | null) ?? null,
    status: String(r.status ?? "planned"),
  };
}

function toDisposal(r: Record<string, unknown>): DisposalItemInput {
  return {
    id: String(r.id),
    description: (r.description as string | null) ?? null,
    assetGroup: (r.asset_group as string | null) ?? null,
    quantity: Number(r.quantity ?? 1),
    disposalYear: Number(r.disposal_year),
    disposalMonth: Number(r.disposal_month),
    expectedProceeds: Number(r.expected_proceeds ?? 0),
    nbvAtDisposal: (r.nbv_at_disposal as number | null) ?? null,
    monthlyDepreciation: (r.monthly_depreciation as number | null) ?? null,
    status: String(r.status ?? "planned"),
  };
}

/**
 * GET /api/capex-plan?year=&organizationId=
 * Items, disposals, reference lists and the monthly summary for the year.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId") ?? [...actor.orgRoles.keys()][0];
    const year = Number(searchParams.get("year") ?? new Date().getFullYear() + 1);
    assertOrgMember(actor, organizationId);
    const admin = createAdminClient();
    // rental_asset_kpis and asset_depreciation_rules are outside the generated types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;

    const [{ data: items }, { data: disposals }, { data: res }, { data: ents }, { data: rules }, { data: kpiGroups }] = await Promise.all([
      admin.from("capex_plan_items").select("*").eq("organization_id", organizationId).order("in_service_year").order("in_service_month").order("description"),
      admin.from("disposal_plan_items").select("*").eq("organization_id", organizationId).order("disposal_year").order("disposal_month").order("description"),
      admin.from("reporting_entities").select("id, name, code, exclude_from_breakdown").eq("organization_id", organizationId).eq("is_active", true),
      admin.from("entities").select("id, name, code").eq("organization_id", organizationId).eq("is_active", true).order("name"),
      db.from("asset_depreciation_rules").select("entity_id, reporting_group, book_useful_life_months, book_salvage_pct") as Promise<{ data: Array<{ entity_id: string; reporting_group: string; book_useful_life_months: number | null; book_salvage_pct: number | null }> | null }>,
      db.from("rental_asset_kpis").select("reporting_group").eq("organization_id", organizationId).eq("grain", "asset").not("reporting_group", "is", null).limit(2000) as Promise<{ data: Array<{ reporting_group: string | null }> | null }>,
    ]);

    const groups = new Set<string>();
    for (const r of rules ?? []) groups.add(r.reporting_group);
    for (const k of kpiGroups ?? []) if (k.reporting_group) groups.add(k.reporting_group);
    const defaultsByGroup = new Map<string, { usefulLifeMonths: number; salvagePct: number }>();
    for (const r of rules ?? []) {
      if (!defaultsByGroup.has(r.reporting_group)) {
        defaultsByGroup.set(r.reporting_group, { usefulLifeMonths: r.book_useful_life_months ?? 60, salvagePct: Number(r.book_salvage_pct ?? 0) });
      }
    }
    const defaultsFor = (g: string | null) => (g && defaultsByGroup.get(g)) || { usefulLifeMonths: 60, salvagePct: 0 };

    const allItems = (items ?? []) as Array<Record<string, unknown>>;
    const allDisposals = (disposals ?? []) as Array<Record<string, unknown>>;
    const summary = computeCapexMonthly(year, allItems.map(toItem), allDisposals.map(toDisposal), defaultsFor);

    // Per reporting entity summary
    const byRe: Record<string, ReturnType<typeof computeCapexMonthly>> = {};
    for (const re of (res ?? []).filter((r) => !r.exclude_from_breakdown)) {
      byRe[re.id] = computeCapexMonthly(
        year,
        allItems.filter((i) => i.reporting_entity_id === re.id).map(toItem),
        allDisposals.filter((d) => d.reporting_entity_id === re.id).map(toDisposal),
        defaultsFor,
      );
    }

    return NextResponse.json({
      organizationId,
      year,
      items: allItems,
      disposals: allDisposals,
      reportingEntities: (res ?? []).filter((r) => !r.exclude_from_breakdown),
      entities: ents ?? [],
      assetGroups: [...groups].sort(),
      defaultsByGroup: Object.fromEntries(defaultsByGroup),
      summary,
      byReportingEntity: byRe,
      canEdit: ["admin", "controller", "preparer"].includes(actor.orgRoles.get(organizationId!) ?? ""),
    });
  } catch (err) {
    console.error("GET /api/capex-plan error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** POST { kind: "item" | "disposal", organizationId?, ...fields } */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const organizationId = body?.organizationId ?? [...actor.orgRoles.keys()][0];
    assertOrgEditor(actor, organizationId);
    // Inserts carry a picked Record<string, unknown>, which the typed client rejects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const kind = body?.kind === "disposal" ? "disposal" : "item";

    if (kind === "item") {
      if (!body?.description || !body?.in_service_year || !body?.in_service_month) {
        return NextResponse.json({ error: "description, in_service_year and in_service_month are required" }, { status: 400 });
      }
      const { data, error } = await admin
        .from("capex_plan_items")
        .insert({ organization_id: organizationId, created_by: actor.userId, ...pick(body, ITEM_FIELDS) })
        .select("*")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ item: data }, { status: 201 });
    }
    if (!body?.disposal_year || !body?.disposal_month) {
      return NextResponse.json({ error: "disposal_year and disposal_month are required" }, { status: 400 });
    }
    const { data, error } = await admin
      .from("disposal_plan_items")
      .insert({ organization_id: organizationId, created_by: actor.userId, ...pick(body, DISPOSAL_FIELDS) })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ disposal: data }, { status: 201 });
  } catch (err) {
    console.error("POST /api/capex-plan error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** PATCH { kind, id, ...fields } */
export async function PATCH(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const kind = body?.kind === "disposal" ? "disposal" : "item";
    const id: string | undefined = body?.id;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const admin = createAdminClient();
    const table = kind === "item" ? "capex_plan_items" : "disposal_plan_items";
    const { data: existing } = await admin.from(table).select("id, organization_id").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    assertOrgEditor(actor, existing.organization_id);
    const fields = pick(body, kind === "item" ? ITEM_FIELDS : DISPOSAL_FIELDS);
    if (Object.keys(fields).length === 0) return NextResponse.json({ error: "No editable fields" }, { status: 400 });
    const { data, error } = await admin.from(table).update(fields).eq("id", id).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ row: data });
  } catch (err) {
    console.error("PATCH /api/capex-plan error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** DELETE /api/capex-plan?kind=item|disposal&id= */
export async function DELETE(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind") === "disposal" ? "disposal" : "item";
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const admin = createAdminClient();
    const table = kind === "item" ? "capex_plan_items" : "disposal_plan_items";
    const { data: existing } = await admin.from(table).select("id, organization_id").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    assertOrgEditor(actor, existing.organization_id);
    const { error } = await admin.from(table).delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/capex-plan error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

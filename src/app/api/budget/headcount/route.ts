import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import {
  loadAssumptions,
  loadMemberEntityIds,
  toEngineRow,
  type HeadcountDbRow,
} from "@/lib/budget/recompute";
import { pricePosition, reportingEntityShare, sumPositions } from "@/lib/budget/personnel-engine";

const EDITABLE_FIELDS = new Set([
  "name", "title", "department", "is_requisition", "status", "pay_type", "base_rate", "annual_salary",
  "std_hours_week", "fte_pct", "start_month", "end_month", "merit_pct", "merit_month", "bonus_target",
  "commission_annual", "ot_pct", "dt_pct", "meal_pct", "other_earnings_monthly", "benefits_monthly",
  "match_pct", "life_disability_monthly", "wc_class_code", "pto_hours_per_period", "other_costs_monthly",
  "entity_allocations", "class_allocations", "notes", "reporting_entity_id",
]);

function pickEditable(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (EDITABLE_FIELDS.has(k)) out[k] = v;
  return out;
}

/**
 * GET /api/budget/headcount?versionId=
 * Rows plus their priced components for the version's year and assumptions.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get("versionId");
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, false);
    const [assumptions, memberEntityIds] = await Promise.all([
      loadAssumptions(admin, owner.id),
      loadMemberEntityIds(admin, owner),
    ]);
    const rows = await fetchAllPaginated<HeadcountDbRow>((offset, limit) =>
      admin
        .from("budget_headcount")
        .select("*")
        .eq("budget_version_id", owner.id)
        .order("name")
        .range(offset, offset + limit - 1),
    );

    const priced = rows.map((r) => {
      const input = toEngineRow(r);
      const reShare = reportingEntityShare(input, memberEntityIds);
      return pricePosition(input, { year: owner.fiscalYear, assumptions, reShare });
    });
    const totals = sumPositions(priced);

    return NextResponse.json({
      version: owner,
      memberEntityIds: [...memberEntityIds],
      rows,
      priced,
      totals,
    });
  } catch (err) {
    console.error("GET /api/budget/headcount error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** POST: add a row (requisition or manual employee). Body: { versionId, ...fields } */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const versionId: string | undefined = body?.versionId;
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });
    if (!body?.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);
    const fields = pickEditable(body);
    const { data, error } = await admin
      .from("budget_headcount")
      .insert({
        budget_version_id: owner.id,
        reporting_entity_id: owner.reportingEntityId,
        is_requisition: body.is_requisition ?? true,
        status: body.status ?? (body.is_requisition === false ? "active" : "planned"),
        ...fields,
        name: String(body.name),
      })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ row: data }, { status: 201 });
  } catch (err) {
    console.error("POST /api/budget/headcount error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** PATCH: update fields. Body: { id, ...fields } */
export async function PATCH(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const id: string | undefined = body?.id;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("budget_headcount")
      .select("id, budget_version_id")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Row not found" }, { status: 404 });
    await requireVersionAccess(admin, actor, existing.budget_version_id, true);

    const fields = pickEditable(body);
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "No editable fields in request" }, { status: 400 });
    }
    const { data, error } = await admin
      .from("budget_headcount")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ row: data });
  } catch (err) {
    console.error("PATCH /api/budget/headcount error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** DELETE /api/budget/headcount?id= */
export async function DELETE(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("budget_headcount")
      .select("id, budget_version_id")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Row not found" }, { status: 404 });
    await requireVersionAccess(admin, actor, existing.budget_version_id, true);

    const { error } = await admin.from("budget_headcount").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/budget/headcount error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

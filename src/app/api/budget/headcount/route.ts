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
import { effectiveCompAdj, pricePosition, reportingEntityShare, sumPositions, withoutCompAdj } from "@/lib/budget/personnel-engine";

const EDITABLE_FIELDS = new Set([
  "name", "title", "department", "is_requisition", "status", "pay_type", "base_rate", "annual_salary",
  "std_hours_week", "fte_pct", "start_month", "end_month", "merit_pct", "merit_month", "bonus_target",
  "commission_annual", "ot_pct", "dt_pct", "meal_pct", "other_earnings_monthly", "benefits_monthly",
  "match_pct", "life_disability_monthly", "wc_class_code", "pto_hours_per_period", "other_costs_monthly",
  "entity_allocations", "class_allocations", "notes", "reporting_entity_id",
  "comp_adj_kind", "comp_adj_value", "comp_adj_month", "comp_adj_reason",
  "amount_monthly", "amount_is_loaded", "open_role",
  "location_allocations", "function_allocations",
]);

const GROSS_COMPONENTS = ["wages", "overtime", "doubletime", "meal", "bonus", "commission", "other_earnings"] as const;

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

    // Baseline = the same row priced without its adjustment (default merit still applies),
    // so Change on the page is what the adjustment alone does to the year.
    const baselines: Record<string, { total: number; gross: number }> = {};
    const priced = rows.map((r) => {
      const input = toEngineRow(r);
      const reShare = reportingEntityShare(input, memberEntityIds);
      const ctx = { year: owner.fiscalYear, assumptions, reShare };
      const p = pricePosition(input, ctx);
      if (effectiveCompAdj(input)) {
        const b = pricePosition(withoutCompAdj(input), ctx);
        baselines[r.id] = {
          total: b.total,
          gross: GROSS_COMPONENTS.reduce((t, c) => t + (b.componentTotals[c] ?? 0), 0),
        };
      }
      return p;
    });
    const totals = sumPositions(priced);

    return NextResponse.json({
      version: owner,
      memberEntityIds: [...memberEntityIds],
      rows,
      priced,
      totals,
      baselines,
      meritDefault: { pct: assumptions.get("merit_pct_default"), month: assumptions.get("merit_month_default") },
    });
  } catch (err) {
    console.error("GET /api/budget/headcount error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * POST: add a row (requisition or manual employee).
 * Body: { versionId, ...fields }. An open role sends { open_role: true, title: <role>, count?: n }
 * and gets named "Open role: <role>" (numbered when count > 1) until a person is filled in.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const versionId: string | undefined = body?.versionId;
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });
    const openRole = body?.open_role === true;
    const role = typeof body?.title === "string" ? body.title.trim() : "";
    if (!openRole && !body?.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (openRole && !role) return NextResponse.json({ error: "Give the open role a title" }, { status: 400 });
    const count = openRole ? Math.min(50, Math.max(1, Math.floor(Number(body.count ?? 1)) || 1)) : 1;

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);
    const fields = pickEditable(body);
    const base = {
      budget_version_id: owner.id,
      reporting_entity_id: owner.reportingEntityId,
      is_requisition: body.is_requisition ?? true,
      status: body.status ?? (body.is_requisition === false ? "active" : "planned"),
      ...fields,
    };
    const inserts = Array.from({ length: count }, (_, i) => ({
      ...base,
      open_role: openRole,
      name: openRole ? `Open role: ${role}${count > 1 ? ` (${i + 1})` : ""}` : String(body.name),
    }));
    const { data, error } = await admin.from("budget_headcount").insert(inserts).select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ row: data?.[0] ?? null, rows: data ?? [], inserted: data?.length ?? 0 }, { status: 201 });
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

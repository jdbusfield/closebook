import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, assertOrgEditor, assertOrgMember, getBudgetActor, organizationForReportingEntity } from "@/lib/budget/access";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { cleanSplitsInput } from "@/lib/budget/item-tags";
import type { Json } from "@/lib/types/database.types";

/**
 * Function / location / class rules for budget items that are rebuilt on every recompute
 * (leases, run rates, schedules) and defaults for whole GL accounts. docs/budget-dashboard-plan.md
 *
 * GET    /api/budget/tag-rules?organizationId=
 * PUT    /api/budget/tag-rules { organizationId, reportingEntityId?, masterAccountId | (sourceTable, sourceId),
 *                                functionAllocations?, locationAllocations?, classId?, note? }   one rule, created or replaced
 * DELETE /api/budget/tag-rules?id=
 */
const SELECT = "id, organization_id, reporting_entity_id, master_account_id, source_table, source_id, function_allocations, location_allocations, qbo_class_id, note, updated_at";

export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId") ?? [...actor.orgRoles.keys()][0];
    assertOrgMember(actor, organizationId);
    const admin = createAdminClient();
    const rules = await fetchAllPaginated<Record<string, unknown>>((o, l) =>
      admin.from("budget_tag_rules").select(SELECT).eq("organization_id", organizationId as string).order("created_at").range(o, o + l - 1),
    );
    return NextResponse.json({ rules });
  } catch (err) {
    console.error("GET /api/budget/tag-rules error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const organizationId: string | undefined = body?.organizationId;
    if (!organizationId) return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    assertOrgEditor(actor, organizationId);
    const admin = createAdminClient();

    const reportingEntityId: string | null = body?.reportingEntityId ?? null;
    if (reportingEntityId) {
      const org = await organizationForReportingEntity(admin, reportingEntityId);
      if (org !== organizationId) return NextResponse.json({ error: "That reporting group is not in this organization" }, { status: 400 });
    }
    const masterAccountId: string | null = body?.masterAccountId ?? null;
    const sourceTable: string | null = body?.sourceTable ?? null;
    const sourceId: string | null = body?.sourceId != null ? String(body.sourceId) : null;
    if (!!masterAccountId === !!(sourceTable && sourceId)) {
      return NextResponse.json({ error: "Give either masterAccountId or sourceTable + sourceId" }, { status: 400 });
    }
    const fn = cleanSplitsInput(body?.functionAllocations, "function");
    const loc = cleanSplitsInput(body?.locationAllocations, "location");
    if (!fn.ok) return NextResponse.json({ error: fn.error }, { status: 400 });
    if (!loc.ok) return NextResponse.json({ error: loc.error }, { status: 400 });

    const fields = {
      organization_id: organizationId,
      reporting_entity_id: reportingEntityId,
      master_account_id: masterAccountId,
      source_table: masterAccountId ? null : sourceTable,
      source_id: masterAccountId ? null : sourceId,
      function_allocations: fn.value as unknown as Json,
      location_allocations: loc.value as unknown as Json,
      qbo_class_id: body?.classId ?? null,
      note: typeof body?.note === "string" ? body.note : null,
      updated_at: new Date().toISOString(),
    };
    // One rule per target: find it (NULLs compare with IS) and replace it
    let q = admin.from("budget_tag_rules").select("id").eq("organization_id", organizationId);
    q = reportingEntityId ? q.eq("reporting_entity_id", reportingEntityId) : q.is("reporting_entity_id", null);
    q = masterAccountId ? q.eq("master_account_id", masterAccountId) : q.is("master_account_id", null).eq("source_table", sourceTable as string).eq("source_id", sourceId as string);
    const { data: existing } = await q.maybeSingle();
    const empty = !fn.value && !loc.value && !fields.qbo_class_id;
    if (empty) {
      if (existing) await admin.from("budget_tag_rules").delete().eq("id", existing.id);
      return NextResponse.json({ rule: null, removed: !!existing });
    }
    const res = existing
      ? await admin.from("budget_tag_rules").update(fields).eq("id", existing.id).select(SELECT).single()
      : await admin.from("budget_tag_rules").insert([{ ...fields, created_by: actor.userId }]).select(SELECT).single();
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ rule: res.data });
  } catch (err) {
    console.error("PUT /api/budget/tag-rules error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await getBudgetActor();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const admin = createAdminClient();
    const { data: rule } = await admin.from("budget_tag_rules").select("id, organization_id").eq("id", id).maybeSingle();
    if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    assertOrgEditor(actor, rule.organization_id);
    const { error } = await admin.from("budget_tag_rules").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/budget/tag-rules error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

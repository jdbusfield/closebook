import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  accessErrorResponse,
  assertOrgEditor,
  assertOrgMember,
  getBudgetActor,
  organizationForEntity,
  requireVersionAccess,
} from "@/lib/budget/access";

// GET — list budget versions for an entity
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entityId");

    if (!entityId) {
      return NextResponse.json(
        { error: "entityId is required" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    assertOrgMember(actor, await organizationForEntity(admin, entityId));

    const { data: versions, error } = await admin
      .from("budget_versions")
      .select("*")
      .eq("entity_id", entityId)
      .order("fiscal_year", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ versions: versions ?? [] });
  } catch (err) {
    console.error("GET /api/budgets error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// POST — create a new budget version (legacy entity-owned)
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();

    const body = await request.json();
    const { entityId, name, fiscalYear, notes } = body;

    if (!entityId || !name || !fiscalYear) {
      return NextResponse.json(
        { error: "entityId, name, and fiscalYear are required" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const organizationId = await organizationForEntity(admin, entityId);
    assertOrgEditor(actor, organizationId);

    const { data: version, error } = await admin
      .from("budget_versions")
      .insert({
        entity_id: entityId,
        organization_id: organizationId,
        name,
        fiscal_year: fiscalYear,
        notes: notes ?? null,
        created_by: actor.userId,
      })
      .select()
      .single();

    if (error) {
      console.error("POST /api/budgets supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ version });
  } catch (err) {
    console.error("POST /api/budgets error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// PATCH — update a budget version (status, is_active, name, notes)
export async function PATCH(request: Request) {
  try {
    const actor = await getBudgetActor();

    const body = await request.json();
    const { versionId, ...updates } = body;

    if (!versionId) {
      return NextResponse.json(
        { error: "versionId is required" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    // Status / active flips are allowed on a locked version; content is not.
    const owner = await requireVersionAccess(admin, actor, versionId, false);
    assertOrgEditor(actor, owner.organizationId);

    // If setting is_active = true, deactivate the other versions of the same
    // owner, year and kind.
    if (updates.is_active === true) {
      let q = admin
        .from("budget_versions")
        .update({ is_active: false })
        .eq("fiscal_year", owner.fiscalYear)
        .eq("kind", owner.kind)
        .neq("id", versionId);
      q = owner.reportingEntityId
        ? q.eq("reporting_entity_id", owner.reportingEntityId)
        : q.eq("entity_id", owner.entityId!);
      await q;
    }

    const allowedFields: Record<string, unknown> = {};
    if ("name" in updates) allowedFields.name = updates.name;
    if ("notes" in updates) allowedFields.notes = updates.notes;
    if ("status" in updates) allowedFields.status = updates.status;
    if ("is_active" in updates) allowedFields.is_active = updates.is_active;

    const { data: updated, error } = await admin
      .from("budget_versions")
      .update(allowedFields)
      .eq("id", versionId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ version: updated });
  } catch (err) {
    console.error("PATCH /api/budgets error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// DELETE — delete a budget version and its amounts
export async function DELETE(request: Request) {
  try {
    const actor = await getBudgetActor();

    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get("versionId");

    if (!versionId) {
      return NextResponse.json(
        { error: "versionId is required" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    await requireVersionAccess(admin, actor, versionId, true);

    // Children cascade from the version row.
    const { error } = await admin
      .from("budget_versions")
      .delete()
      .eq("id", versionId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/budgets error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

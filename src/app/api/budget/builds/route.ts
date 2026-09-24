import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { syncLinesFromBuilds } from "@/lib/budget/recompute";
import { buildContext } from "@/lib/budget/builds";
import { clearTrendForMaster, methodBuild, recomputeMethodBuilds } from "@/lib/budget/method-builds";
import { readMethod } from "@/lib/budget/line-methods";
import type { BuildInsert } from "@/lib/budget/build-types";

/**
 * GET /api/budget/builds?versionId=&masterAccountId=&type=
 * Builds for a version, optionally filtered, with master names.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get("versionId");
    const masterAccountId = searchParams.get("masterAccountId");
    const type = searchParams.get("type");
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, false);
    const builds = await fetchAllPaginated<Record<string, unknown>>((o, l) => {
      let q = admin.from("budget_builds").select("*").eq("budget_version_id", owner.id);
      if (masterAccountId) q = q.eq("master_account_id", masterAccountId);
      if (type) q = q.eq("build_type", type);
      return q.order("build_type").order("label").range(o, o + l - 1);
    });
    const masterIds = [...new Set(builds.map((b) => String(b.master_account_id)))];
    const { data: masters } = masterIds.length
      ? await admin.from("master_accounts").select("id, account_number, name, classification, account_type").in("id", masterIds)
      : { data: [] };
    const classIds = [...new Set(builds.map((b) => b.qbo_class_id).filter(Boolean))] as string[];
    const { data: classes } = classIds.length ? await admin.from("qbo_classes").select("id, name").in("id", classIds) : { data: [] };
    return NextResponse.json({ builds, masters: masters ?? [], classes: classes ?? [] });
  } catch (err) {
    console.error("GET /api/budget/builds error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

function cleanAmounts(amounts: unknown): Record<string, number> {
  const a = (amounts ?? {}) as Record<string, unknown>;
  const clean: Record<string, number> = {};
  for (let m = 1; m <= 12; m++) clean[String(m)] = Math.round(Number(a[String(m)] ?? 0) * 100) / 100;
  return clean;
}

/**
 * POST /api/budget/builds
 *   { versionId, masterAccountId, label, note?, method }          an item priced by its method
 *   { versionId, masterAccountId, label, note?, amounts: {"1":..} } a typed item
 * Either way the master's run-rate build steps aside: the line is now its items.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const { versionId, masterAccountId, classId, label, amounts, note } = body ?? {};
    if (!versionId || !masterAccountId || !label) {
      return NextResponse.json({ error: "versionId, masterAccountId and label are required" }, { status: 400 });
    }
    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);
    const method = readMethod(body?.method);
    if (body?.method && !method) return NextResponse.json({ error: "Unknown method" }, { status: 400 });

    let row: BuildInsert & { note: string | null };
    if (method) {
      const ctx = await buildContext(admin, owner);
      row = methodBuild(ctx, masterAccountId, String(label), method, note ?? null);
    } else {
      row = {
        budget_version_id: owner.id,
        reporting_entity_id: owner.reportingEntityId,
        entity_id: owner.entityId,
        master_account_id: masterAccountId,
        qbo_class_id: (classId as string | undefined) ?? null,
        build_type: "manual" as const,
        source_table: null,
        source_id: null,
        component: "manual",
        label: String(label),
        amounts: cleanAmounts(amounts),
        assumption_keys: [],
        is_computed: false,
        meta: null,
        note: note ?? null,
        computed_at: new Date().toISOString(),
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await admin.from("budget_builds").insert([row as any]).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await clearTrendForMaster(admin, owner.id, masterAccountId);
    if (method) await recomputeMethodBuilds(await buildContext(admin, owner));
    const lines = await syncLinesFromBuilds(admin, owner);
    const { data: fresh } = await admin.from("budget_builds").select("*").eq("id", data.id).single();
    return NextResponse.json({ build: fresh ?? data, ...lines }, { status: 201 });
  } catch (err) {
    console.error("POST /api/budget/builds error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** PATCH { id, label?, note?, classId?, method? | amounts? } (manual items only) */
export async function PATCH(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const id: string | undefined = body?.id;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const admin = createAdminClient();
    const { data: existing } = await admin.from("budget_builds").select("id, budget_version_id, build_type, meta").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Build not found" }, { status: 404 });
    if (existing.build_type !== "manual") return NextResponse.json({ error: "Only items can be edited; computed builds change through their source" }, { status: 400 });
    const owner = await requireVersionAccess(admin, actor, existing.budget_version_id, true);
    const fields: Record<string, unknown> = {};
    if ("label" in body) fields.label = String(body.label);
    if ("note" in body) fields.note = body.note ?? null;
    if ("classId" in body) fields.qbo_class_id = body.classId ?? null;
    let hasMethod = false;
    if ("method" in body) {
      const method = readMethod(body.method);
      if (body.method && !method) return NextResponse.json({ error: "Unknown method" }, { status: 400 });
      const meta = (existing.meta ?? {}) as Record<string, unknown>;
      if (method) {
        fields.meta = { ...meta, method };
        fields.is_computed = true;
        fields.component = "method";
        hasMethod = true;
      } else {
        const { method: _drop, history: _h, ...rest } = meta as Record<string, unknown> & { method?: unknown; history?: unknown };
        void _drop;
        void _h;
        fields.meta = Object.keys(rest).length ? rest : null;
        fields.is_computed = false;
        fields.component = "manual";
      }
    }
    if ("amounts" in body && !hasMethod) fields.amounts = cleanAmounts(body.amounts);
    const { error } = await admin.from("budget_builds").update(fields).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (hasMethod) await recomputeMethodBuilds(await buildContext(admin, owner));
    const lines = await syncLinesFromBuilds(admin, owner);
    const { data } = await admin.from("budget_builds").select("*").eq("id", id).single();
    return NextResponse.json({ build: data, ...lines });
  } catch (err) {
    console.error("PATCH /api/budget/builds error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** DELETE /api/budget/builds?id= (manual items only) */
export async function DELETE(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const admin = createAdminClient();
    const { data: existing } = await admin.from("budget_builds").select("id, budget_version_id, build_type").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Build not found" }, { status: 404 });
    if (existing.build_type !== "manual") return NextResponse.json({ error: "Only items can be removed here" }, { status: 400 });
    const owner = await requireVersionAccess(admin, actor, existing.budget_version_id, true);
    const { error } = await admin.from("budget_builds").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Items that follow other lines may move
    await recomputeMethodBuilds(await buildContext(admin, owner));
    const lines = await syncLinesFromBuilds(admin, owner);
    return NextResponse.json({ success: true, ...lines });
  } catch (err) {
    console.error("DELETE /api/budget/builds error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

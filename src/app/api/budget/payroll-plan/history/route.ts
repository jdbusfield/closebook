import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requirePlanAccess } from "@/lib/budget/access";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";

export interface HistoryEntry {
  id: string;
  at: string;
  user: string;
  action: "create" | "update" | "delete" | string;
  resourceType: string;
  rowId: string | null;
  label: string;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
}

const MAX_ROWS = 3000;

/**
 * GET /api/budget/payroll-plan/history?planId=&rowId=&q=&limit=&offset=
 * Every audited add, edit and delete on the plan's rows (and the plan
 * itself), newest first, from the database audit log. Deleted rows are
 * found through the delete entry's own values.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get("planId");
    const rowId = searchParams.get("rowId");
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));
    if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });
    const admin = createAdminClient();
    const plan = await requirePlanAccess(admin, actor, planId, false);

    const { data: current } = await admin.from("budget_headcount").select("id, name").eq("payroll_plan_id", plan.id);
    const nameById = new Map((current ?? []).map((r) => [r.id, r.name]));
    const planRowIds = new Set(nameById.keys());

    type Raw = {
      id: string; user_id: string | null; action: string; resource_type: string; resource_id: string | null;
      resource_label: string | null; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null;
      created_at: string; profiles: { full_name: string } | null;
    };
    // The profiles join is not in the generated types; the audit-log page reads it the same way.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const raw = await fetchAllPaginated<Raw>((o, l) =>
      db
        .from("audit_log")
        .select("id, user_id, action, resource_type, resource_id, resource_label, old_values, new_values, created_at, profiles(full_name)")
        .eq("organization_id", plan.organizationId)
        .in("resource_type", ["budget_headcount", "budget_payroll_plans"])
        .gte("created_at", "2026-09-01")
        .order("created_at", { ascending: false })
        .range(o, Math.min(o + l - 1, MAX_ROWS - 1)),
    );

    // Rows that belong to this plan: current ones, plus any whose add or delete entry names the plan
    const belongs = new Set<string>(planRowIds);
    for (const e of raw) {
      if (e.resource_type !== "budget_headcount" || !e.resource_id) continue;
      const pid = (e.new_values?.payroll_plan_id ?? e.old_values?.payroll_plan_id) as string | undefined;
      if (pid === plan.id) belongs.add(e.resource_id);
    }
    const labelFor = (e: Raw) =>
      (e.resource_id && nameById.get(e.resource_id)) ||
      (e.new_values?.name as string | undefined) ||
      (e.old_values?.name as string | undefined) ||
      e.resource_label ||
      (e.resource_type === "budget_payroll_plans" ? `Payroll plan ${plan.fiscalYear}` : "Position");

    const entries: HistoryEntry[] = [];
    for (const e of raw) {
      const isPlanRow = e.resource_type === "budget_payroll_plans" && e.resource_id === plan.id;
      const isRow = e.resource_type === "budget_headcount" && !!e.resource_id && belongs.has(e.resource_id);
      if (!isPlanRow && !isRow) continue;
      if (rowId && e.resource_id !== rowId) continue;
      const label = labelFor(e);
      const changes: HistoryEntry["changes"] = [];
      const keys = new Set([...Object.keys(e.new_values ?? {}), ...Object.keys(e.old_values ?? {})]);
      for (const k of keys) {
        if (["updated_at", "created_at", "id", "payroll_plan_id", "budget_version_id", "seeded_from"].includes(k)) continue;
        changes.push({ field: k, from: e.old_values?.[k] ?? null, to: e.new_values?.[k] ?? null });
      }
      if (q && !label.toLowerCase().includes(q) && !changes.some((c) => c.field.includes(q))) continue;
      entries.push({
        id: e.id,
        at: e.created_at,
        user: e.profiles?.full_name ?? (e.user_id ? "Member" : "System"),
        action: e.action,
        resourceType: e.resource_type,
        rowId: e.resource_id,
        label,
        changes,
      });
    }
    return NextResponse.json({ entries: entries.slice(offset, offset + limit), total: entries.length, capped: raw.length >= MAX_ROWS });
  } catch (err) {
    console.error("GET /api/budget/payroll-plan/history error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

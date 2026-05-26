import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../../_lib/org";

interface Params {
  params: Promise<{ id: string }>;
}

const VALID_STATUSES = new Set(["open", "in_progress", "done", "cancelled"]);

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    description?: string | null;
    status?: string;
    due_date?: string | null;
    assignee_id?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "Empty body" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (body.title !== undefined) update.title = body.title.trim();
  if (body.description !== undefined) update.description = body.description?.trim() || null;
  if (body.due_date !== undefined) update.due_date = body.due_date || null;
  if (body.assignee_id !== undefined) update.assignee_id = body.assignee_id;
  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
    update.status = body.status;
    update.completed_at = body.status === "done" ? new Date().toISOString() : null;
  }

  const { error } = await ctx.supabase.from("crm_tasks").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { error } = await ctx.supabase.from("crm_tasks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

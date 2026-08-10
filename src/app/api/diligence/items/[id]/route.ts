import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../../_lib/org";

interface Params {
  params: Promise<{ id: string }>;
}

const VALID_STATUSES = new Set([
  "not_requested",
  "requested",
  "received",
  "in_review",
  "follow_up",
  "complete",
  "not_applicable",
]);

const VALID_PRIORITIES = new Set(["high", "medium", "low"]);

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    details?: string | null;
    status?: string;
    priority?: string;
    internal_owner?: string | null;
    counterparty_owner?: string | null;
    requested_date?: string | null;
    received_date?: string | null;
    due_date?: string | null;
    red_flag?: boolean;
    finding?: string | null;
    doc_url?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "Empty body" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (body.title !== undefined) update.title = body.title.trim();
  if (body.details !== undefined) update.details = body.details?.trim() || null;
  if (body.internal_owner !== undefined) update.internal_owner = body.internal_owner?.trim() || null;
  if (body.counterparty_owner !== undefined) update.counterparty_owner = body.counterparty_owner?.trim() || null;
  if (body.requested_date !== undefined) update.requested_date = body.requested_date || null;
  if (body.received_date !== undefined) update.received_date = body.received_date || null;
  if (body.due_date !== undefined) update.due_date = body.due_date || null;
  if (body.red_flag !== undefined) update.red_flag = body.red_flag;
  if (body.finding !== undefined) update.finding = body.finding?.trim() || null;
  if (body.doc_url !== undefined) update.doc_url = body.doc_url?.trim() || null;
  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
    update.status = body.status;
    // Stamp request/receipt dates on first transition into those states.
    if (body.status === "requested" && body.requested_date === undefined) {
      update.requested_date = new Date().toISOString().slice(0, 10);
    }
    if (body.status === "received" && body.received_date === undefined) {
      update.received_date = new Date().toISOString().slice(0, 10);
    }
  }
  if (body.priority !== undefined) {
    if (!VALID_PRIORITIES.has(body.priority)) return NextResponse.json({ error: "invalid priority" }, { status: 400 });
    update.priority = body.priority;
  }

  const { error } = await ctx.supabase.from("diligence_items").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { error } = await ctx.supabase.from("diligence_items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../../_lib/org";

interface Params {
  params: Promise<{ id: string }>;
}

const VALID_STAGES = new Set([
  "target",
  "nda",
  "data_request",
  "diligence",
  "proposal",
  "loi",
  "closing",
  "closed",
  "passed",
  "on_hold",
]);

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    counterparty?: string | null;
    deal_type?: string;
    stage?: string;
    description?: string | null;
    target_close_date?: string | null;
    nda_date?: string | null;
    notes?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "Empty body" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name.trim();
  if (body.counterparty !== undefined) update.counterparty = body.counterparty?.trim() || null;
  if (body.deal_type !== undefined) update.deal_type = body.deal_type;
  if (body.description !== undefined) update.description = body.description?.trim() || null;
  if (body.target_close_date !== undefined) update.target_close_date = body.target_close_date || null;
  if (body.nda_date !== undefined) update.nda_date = body.nda_date || null;
  if (body.notes !== undefined) update.notes = body.notes?.trim() || null;
  if (body.stage !== undefined) {
    if (!VALID_STAGES.has(body.stage)) return NextResponse.json({ error: "invalid stage" }, { status: 400 });
    update.stage = body.stage;
  }

  const { error } = await ctx.supabase.from("diligence_deals").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { error } = await ctx.supabase.from("diligence_deals").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

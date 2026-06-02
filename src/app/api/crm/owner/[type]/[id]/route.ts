import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../../../_lib/org";

const TYPE_TABLE: Record<string, string> = {
  production: "crm_productions",
  company: "crm_companies",
  opportunity: "crm_opportunities",
};

interface Params {
  params: Promise<{ type: string; id: string }>;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { type, id } = await params;
  const table = TYPE_TABLE[type];
  if (!table) return NextResponse.json({ error: `Unknown entity type: ${type}` }, { status: 400 });
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { owner_id?: string | null } | null;
  const ownerId = body?.owner_id ?? null;

  const { error } = await ctx.supabase
    .from(table)
    .update({ owner_id: ownerId })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getCallerOrg } from "../../../../_lib/org";

interface Params {
  params: Promise<{ id: string; linkId: string }>;
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id: productionId, linkId } = await params;
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await ctx.supabase
    .from("crm_production_rw_customers")
    .delete()
    .eq("id", linkId)
    .eq("production_id", productionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

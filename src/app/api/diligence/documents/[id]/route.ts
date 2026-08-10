import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCallerOrg } from "../../_lib/org";
import { DILIGENCE_BUCKET } from "@/lib/diligence/storage";

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch through the RLS-scoped client so callers can only touch their org's
  // rows; only then remove the storage object with the admin client.
  const { data: doc, error: fetchError } = await ctx.supabase
    .from("diligence_documents")
    .select("id, file_path")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 400 });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error: deleteError } = await ctx.supabase.from("diligence_documents").delete().eq("id", id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 });

  const admin = createAdminClient();
  const { error: storageError } = await admin.storage
    .from(DILIGENCE_BUCKET)
    .remove([(doc as { file_path: string }).file_path]);
  // Row is gone either way; report storage failures without failing the call.
  if (storageError) console.error("diligence doc storage removal failed:", storageError.message);

  return NextResponse.json({ ok: true });
}

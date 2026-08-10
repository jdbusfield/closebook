import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../_lib/org";

// Records document metadata after the client has uploaded the file to the
// diligence-docs bucket via /api/storage/signed-upload-url.
export async function POST(req: NextRequest) {
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    deal_id?: string;
    item_id?: string;
    file_name?: string;
    file_path?: string;
    mime_type?: string;
    size_bytes?: number;
  } | null;
  if (!body?.deal_id || !body.item_id || !body.file_name?.trim() || !body.file_path) {
    return NextResponse.json(
      { error: "deal_id, item_id, file_name, and file_path are required" },
      { status: 400 }
    );
  }

  const { data, error } = await ctx.supabase
    .from("diligence_documents")
    .insert({
      organization_id: ctx.organizationId,
      deal_id: body.deal_id,
      item_id: body.item_id,
      file_name: body.file_name.trim(),
      file_path: body.file_path,
      mime_type: body.mime_type || null,
      size_bytes: body.size_bytes ?? null,
      uploaded_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id });
}

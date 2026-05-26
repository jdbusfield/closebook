import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../../../_lib/org";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: productionId } = await params;
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    external_customer_id?: string;
    label?: string;
    source?: string;
  } | null;
  const extId = body?.external_customer_id?.trim();
  if (!extId) return NextResponse.json({ error: "external_customer_id required" }, { status: 400 });
  const source = body?.source?.trim() || "cars_plus";

  const { supabase, organizationId, userId } = ctx;
  const { data, error } = await supabase
    .from("crm_production_external_customers")
    .insert({
      organization_id: organizationId,
      production_id: productionId,
      source,
      external_customer_id: extId,
      label: body?.label?.trim() || null,
      created_by: userId,
    })
    .select("id, source, external_customer_id, label, created_at")
    .single();

  if (error) {
    const code = (error as { code?: string }).code;
    const msg = code === "23505"
      ? `That ${source.replace("_", " ")} customer # is already linked to a production.`
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ link: data });
}

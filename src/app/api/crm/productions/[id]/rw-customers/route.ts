import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../../../_lib/org";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: productionId } = await params;
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { rw_customer_id?: string; label?: string } | null;
  const rwCustomerId = body?.rw_customer_id?.trim();
  if (!rwCustomerId) return NextResponse.json({ error: "rw_customer_id required" }, { status: 400 });

  const { supabase, organizationId, userId } = ctx;
  const { data, error } = await supabase
    .from("crm_production_rw_customers")
    .insert({
      organization_id: organizationId,
      production_id: productionId,
      rw_customer_id: rwCustomerId,
      label: body?.label?.trim() || null,
      created_by: userId,
    })
    .select("id, rw_customer_id, label, created_at")
    .single();

  if (error) {
    const code = (error as { code?: string }).code;
    const msg = code === "23505"
      ? "That RentalWorks customer is already linked to a production."
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ link: data });
}

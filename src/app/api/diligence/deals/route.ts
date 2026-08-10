import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../_lib/org";
import { DEFAULT_REQUEST_LIST } from "@/lib/diligence/template";

export async function POST(req: NextRequest) {
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    counterparty?: string;
    deal_type?: string;
    description?: string;
    target_close_date?: string;
    seed_template?: boolean;
  } | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data: deal, error } = await ctx.supabase
    .from("diligence_deals")
    .insert({
      organization_id: ctx.organizationId,
      name,
      counterparty: body?.counterparty?.trim() || null,
      deal_type: body?.deal_type?.trim() || "acquisition",
      description: body?.description?.trim() || null,
      target_close_date: body?.target_close_date || null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (body?.seed_template) {
    const items = DEFAULT_REQUEST_LIST.map((item, i) => ({
      organization_id: ctx.organizationId,
      deal_id: deal.id,
      category: item.category,
      title: item.title,
      details: item.details ?? null,
      priority: item.priority ?? "medium",
      sort_order: i,
      created_by: ctx.userId,
    }));
    const { error: itemsError } = await ctx.supabase.from("diligence_items").insert(items);
    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 400 });
  }

  return NextResponse.json({ id: deal.id });
}

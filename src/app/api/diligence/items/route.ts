import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../_lib/org";

export async function POST(req: NextRequest) {
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    deal_id?: string;
    category?: string;
    title?: string;
    details?: string;
    priority?: string;
  } | null;
  const dealId = body?.deal_id;
  const category = body?.category?.trim();
  const title = body?.title?.trim();
  if (!dealId || !category || !title) {
    return NextResponse.json({ error: "deal_id, category, and title are required" }, { status: 400 });
  }

  // Append after the deal's current max sort_order so new items land at the
  // bottom of their category group.
  const { data: last } = await ctx.supabase
    .from("diligence_items")
    .select("sort_order")
    .eq("deal_id", dealId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { data, error } = await ctx.supabase
    .from("diligence_items")
    .insert({
      organization_id: ctx.organizationId,
      deal_id: dealId,
      category,
      title,
      details: body?.details?.trim() || null,
      priority: body?.priority ?? "medium",
      sort_order: sortOrder,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id });
}

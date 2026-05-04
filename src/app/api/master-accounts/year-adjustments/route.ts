import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireMembership(supabase: Awaited<ReturnType<typeof createClient>>, organizationId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Unauthorized" as const, status: 401, userId: null };
  }
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();
  if (!membership) {
    return { error: "Access denied" as const, status: 403, userId: null };
  }
  return { error: null, status: 200, userId: user.id, role: membership.role };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  const chartId = searchParams.get("chartId");

  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }
  const ctx = await requireMembership(supabase, organizationId);
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("master_account_year_adjustments")
    .select("id, master_account_id, chart_id, period_year, amount, note, created_at, updated_at")
    .eq("organization_id", organizationId)
    .order("period_year", { ascending: false });
  if (chartId) query = query.eq("chart_id", chartId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ adjustments: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json();
  const { organizationId, masterAccountId, chartId, periodYear, amount, note } = body ?? {};

  if (!organizationId || !masterAccountId || !chartId || !periodYear) {
    return NextResponse.json(
      { error: "organizationId, masterAccountId, chartId, periodYear are required" },
      { status: 400 },
    );
  }
  const ctx = await requireMembership(supabase, organizationId);
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.role !== "admin" && ctx.role !== "controller") {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("master_account_year_adjustments")
    .upsert(
      {
        organization_id: organizationId,
        chart_id: chartId,
        master_account_id: masterAccountId,
        period_year: Number(periodYear),
        amount: Number(amount) || 0,
        note: note || null,
        created_by: ctx.userId,
      },
      { onConflict: "chart_id,master_account_id,period_year" },
    )
    .select("id, master_account_id, chart_id, period_year, amount, note")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ adjustment: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const body = await request.json();
  const { id, organizationId } = body ?? {};
  if (!id || !organizationId) {
    return NextResponse.json({ error: "id and organizationId are required" }, { status: 400 });
  }
  const ctx = await requireMembership(supabase, organizationId);
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.role !== "admin" && ctx.role !== "controller") {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("master_account_year_adjustments")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

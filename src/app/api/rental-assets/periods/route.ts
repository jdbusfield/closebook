import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/rental-assets/periods?organization_id=...
 *
 * Returns distinct (period_year, period_month) combos that have at least
 * one rental_asset_kpis row for the given organization. Pages through the
 * table server-side so the browser gets a small sorted array instead of
 * 50k+ rows.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const organizationId = request.nextUrl.searchParams.get("organization_id");
  if (!organizationId) {
    return NextResponse.json(
      { error: "organization_id required" },
      { status: 400 }
    );
  }

  // Membership check
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const seen = new Set<string>();
  const batch = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from("rental_asset_kpis")
      .select("period_year, period_month")
      .eq("organization_id", organizationId)
      .range(offset, offset + batch - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const rows = (data ?? []) as Array<{
      period_year: number;
      period_month: number;
    }>;
    for (const r of rows) seen.add(`${r.period_year}-${r.period_month}`);
    if (rows.length < batch) break;
    offset += batch;
  }

  const periods = [...seen]
    .map((k) => {
      const [y, m] = k.split("-").map(Number);
      return { year: y, month: m };
    })
    .sort((a, b) =>
      a.year !== b.year ? b.year - a.year : b.month - a.month
    );

  return NextResponse.json({ periods });
}

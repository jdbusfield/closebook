import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  customRowsToClassifications,
  getEffectiveMasterType,
  type CustomVehicleClassRow,
  type VehicleClassification,
} from "@/lib/utils/vehicle-classification";
import { rwSupplementClass } from "@/lib/utils/rw-supplement";

/**
 * GET /api/rental-assets/monthly-summary
 *
 * Single-month + year-to-date fleet KPIs (utilization, average daily rate,
 * end-of-month fleet size) split by master type (Vehicle / Trailer / Total),
 * with the same metrics for the prior year so the monthly summary PDF can
 * show "A v PY" columns. There is no budget/target source for these KPIs, so
 * this endpoint intentionally returns actuals + prior-year only.
 *
 * Utilization mirrors the rental-asset dashboard's DBR utilization:
 *   util% = sum(rental_dbr_days) / sum(fleet_days) * 100
 * Average daily rate is revenue-weighted:
 *   rate  = sum(total_revenue) / sum(rental_act_days)
 * Fleet size is the count of assets with fleet_days > 0 in that single month.
 *
 * Params:
 *   organization_id   (required)
 *   year              (required) — the reporting month's year
 *   month             (required) — 1..12
 *   include_service   "true"/"false" (default false) — include service-category assets
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const organizationId = sp.get("organization_id");
  const yearStr = sp.get("year");
  const monthStr = sp.get("month");
  if (!organizationId || !yearStr || !monthStr) {
    return NextResponse.json(
      { error: "organization_id, year, month required" },
      { status: 400 }
    );
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "month must be 1..12" }, { status: 400 });
  }
  const includeService = sp.get("include_service") === "true";
  const pyYear = year - 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ────────── Asset context (class → master type, category guardrail) ──────────
  const categoriesAllowed = includeService ? ["rental", "service"] : ["rental"];

  // Scope assets to the organization's entities.
  const { data: orgEntities, error: entErr } = await admin
    .from("entities")
    .select("id")
    .eq("organization_id", organizationId);
  if (entErr) {
    return NextResponse.json({ error: entErr.message }, { status: 500 });
  }
  const orgEntityIds = (orgEntities ?? []).map((e: { id: string }) => e.id);

  const { data: assetsRaw, error: assetsErr } = await admin
    .from("fixed_assets")
    .select("id, rental_category, vehicle_class, master_type_override")
    .in("entity_id", orgEntityIds.length ? orgEntityIds : ["__none__"])
    .in("rental_category", categoriesAllowed);
  if (assetsErr) {
    return NextResponse.json({ error: assetsErr.message }, { status: 500 });
  }
  const assets = (assetsRaw ?? []) as Array<{
    id: string;
    rental_category: string;
    vehicle_class: string | null;
    master_type_override: string | null;
  }>;

  const { data: classRows, error: classErr } = await admin
    .from("custom_vehicle_classes")
    .select("*")
    .eq("organization_id", organizationId);
  if (classErr) {
    return NextResponse.json({ error: classErr.message }, { status: 500 });
  }
  const customClasses: VehicleClassification[] = customRowsToClassifications(
    (classRows ?? []) as CustomVehicleClassRow[]
  );

  // asset id → "Vehicle" | "Trailer" | null
  const masterTypeByAsset = new Map<string, "Vehicle" | "Trailer" | null>();
  for (const a of assets) {
    masterTypeByAsset.set(
      a.id,
      getEffectiveMasterType(a.vehicle_class, a.master_type_override, customClasses)
    );
  }
  const allowedAssetIds = new Set(assets.map((a) => a.id));

  // ────────── KPI rows: current + prior year, months 1..month ──────────
  type KpiRow = {
    period_year: number;
    period_month: number;
    fixed_asset_id: string | null;
    orphan_veh_number: string | null;
    rental_dbr_days: number | null;
    rental_act_days: number | null;
    fleet_days: number | null;
    total_revenue: number | null;
  };
  const kpis: KpiRow[] = [];
  {
    const batch = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await admin
        .from("rental_asset_kpis")
        .select(
          "period_year, period_month, fixed_asset_id, orphan_veh_number, rental_dbr_days, rental_act_days, fleet_days, total_revenue"
        )
        .eq("organization_id", organizationId)
        .eq("grain", "asset")
        .in("period_year", [year, pyYear])
        .gte("period_month", 1)
        .lte("period_month", month)
        .range(offset, offset + batch - 1);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const rows = (data ?? []) as KpiRow[];
      kpis.push(...rows);
      if (rows.length < batch) break;
      offset += batch;
    }
  }

  // ────────── Aggregate ──────────
  type Accum = { dbrDays: number; actDays: number; fleetDays: number; revenue: number };
  type Segment = {
    month: Accum;
    ytd: Accum;
    pyMonth: Accum;
    pyYtd: Accum;
    fleetMonth: Set<string>;
    fleetPyMonth: Set<string>;
  };
  const newAccum = (): Accum => ({ dbrDays: 0, actDays: 0, fleetDays: 0, revenue: 0 });
  const newSegment = (): Segment => ({
    month: newAccum(),
    ytd: newAccum(),
    pyMonth: newAccum(),
    pyYtd: newAccum(),
    fleetMonth: new Set(),
    fleetPyMonth: new Set(),
  });
  const segments: Record<"vehicle" | "trailer" | "total", Segment> = {
    vehicle: newSegment(),
    trailer: newSegment(),
    total: newSegment(),
  };

  const addTo = (acc: Accum, k: KpiRow) => {
    acc.dbrDays += Number(k.rental_dbr_days ?? 0);
    acc.actDays += Number(k.rental_act_days ?? 0);
    acc.fleetDays += Number(k.fleet_days ?? 0);
    acc.revenue += Number(k.total_revenue ?? 0);
  };

  for (const k of kpis) {
    // Unmatched rows are excluded — except RentalWorks class-revenue
    // supplements ("RW-13"), whose class routes them to a master type. They
    // carry revenue only (no days, no fleet count), so utilization and
    // fleet-size stay DBR-derived while ADR reflects combined revenue.
    let mt: "Vehicle" | "Trailer" | null | undefined;
    if (k.fixed_asset_id) {
      if (!allowedAssetIds.has(k.fixed_asset_id)) continue;
      mt = masterTypeByAsset.get(k.fixed_asset_id);
    } else {
      const rwCls = rwSupplementClass(k.orphan_veh_number);
      if (!rwCls) continue;
      mt = getEffectiveMasterType(rwCls, null, customClasses);
    }
    const targets: Segment[] = [segments.total];
    if (mt === "Vehicle") targets.push(segments.vehicle);
    else if (mt === "Trailer") targets.push(segments.trailer);

    const isCur = k.period_year === year;
    const isPy = k.period_year === pyYear;
    const isMonth = k.period_month === month;
    const hasFleet = Number(k.fleet_days ?? 0) > 0;

    for (const seg of targets) {
      if (isCur) {
        addTo(seg.ytd, k);
        if (isMonth) {
          addTo(seg.month, k);
          if (hasFleet && k.fixed_asset_id) seg.fleetMonth.add(k.fixed_asset_id);
        }
      } else if (isPy) {
        addTo(seg.pyYtd, k);
        if (isMonth) {
          addTo(seg.pyMonth, k);
          if (hasFleet && k.fixed_asset_id)
            seg.fleetPyMonth.add(k.fixed_asset_id);
        }
      }
    }
  }

  const util = (a: Accum) => (a.fleetDays > 0 ? (a.dbrDays / a.fleetDays) * 100 : 0);
  const rate = (a: Accum) => (a.actDays > 0 ? a.revenue / a.actDays : 0);

  // Average units on rent over a period = rented unit-days / calendar days in
  // the period. Uses rental_dbr_days (the same numerator as utilization) so
  // avg-on-rent reconciles with the utilization %: util ~= avgOnRent / avgFleet.
  const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
  const daysYtd = (y: number, upToMonth: number) => {
    let d = 0;
    for (let m = 1; m <= upToMonth; m++) d += daysInMonth(y, m);
    return d;
  };
  const monthDays = daysInMonth(year, month);
  const ytdDays = daysYtd(year, month);
  const pyMonthDays = daysInMonth(pyYear, month);
  const pyYtdDays = daysYtd(pyYear, month);
  const avgOnRent = (days: number, dbrDays: number) => (days > 0 ? dbrDays / days : 0);

  const serializeSegment = (s: Segment) => ({
    util: {
      month: util(s.month),
      ytd: util(s.ytd),
      pyMonth: util(s.pyMonth),
      pyYtd: util(s.pyYtd),
    },
    rate: {
      month: rate(s.month),
      ytd: rate(s.ytd),
      pyMonth: rate(s.pyMonth),
      pyYtd: rate(s.pyYtd),
    },
    onRent: {
      month: avgOnRent(monthDays, s.month.dbrDays),
      ytd: avgOnRent(ytdDays, s.ytd.dbrDays),
      pyMonth: avgOnRent(pyMonthDays, s.pyMonth.dbrDays),
      pyYtd: avgOnRent(pyYtdDays, s.pyYtd.dbrDays),
    },
    fleet: {
      month: s.fleetMonth.size,
      pyMonth: s.fleetPyMonth.size,
    },
  });

  return NextResponse.json({
    period: { year, month },
    includeService,
    segments: {
      vehicle: serializeSegment(segments.vehicle),
      trailer: serializeSegment(segments.trailer),
      total: serializeSegment(segments.total),
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as XLSX from "xlsx";

// Server-side port of scripts/ingest-kpis.mjs. Lets users refresh a month's
// rental_asset_kpis from the UI — most useful for partial/in-progress months
// (e.g. uploading a mid-April DBR before month-end).
//
// Spreadsheet shape (from "JAN 2026" / "APR 2026" tabs):
//   A=Veh_number, B=License_no, C=Status, D=Year, E=Class, F=Model,
//   G=Purch_date, H=Sale_date, I=Fleet_days, J=Rental_DBR_days,
//   K=Rental_act_days, L=Total_rev, M=Avg_rev, N=Chg_rate, O=Std_rate,
//   P=Chg_loc, Q=DBR_util, R=Act_util, S=Rev_util, T=Subrental
//
// Workbooks may contain one tab per month — every sheet whose name matches a
// MMM YYYY pattern is processed.

export const runtime = "nodejs";
export const maxDuration = 120;

const EQU_PREFIX = /^(BATH$|EQU$|KSCF\d+$)/i;

const MONTH_NAMES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

const CLASS_TO_GROUP: Record<string, string> = {
  "1R": "Cast Trailer",  "2": "Studio Box Truck", "2R": "Cast Trailer",
  "3": "Car",            "3R": "Cast Trailer",    "4": "Car",
  "5": "Car",            "6": "Car",              "7": "Car",
  "8": "Passenger Van",  "8MU": "Makeup Trailer", "9": "Studio Box Truck",
  "11": "Cargo Van",     "12": "Car",             "13": "Box Truck",
  "13T": "Box Truck",    "13W": "Box Truck",      "14": "Box Truck",
  "15": "Stakebed",      "15I": "Stakebed",       "15L": "Stakebed",
  "16": "Stakebed",      "17": "Car",             "18": "Car",
  "20": "Box Truck",     "20T": "Box Truck",      "21": "Car",
  "22": "Box Truck",     "23": "Stakebed",        "24": "Box Truck",
  "26": "Cargo Van",     "27": "Studio Box Truck", "28": "Passenger Van",
  "28P": "Passenger Van", "28S": "Passenger Van", "29": "Cargo Van",
  "30": "Cargo Van",     "31": "Cargo Van",       "32": "Cargo Van",
  "33": "Cargo Van",     "34": "Cargo Van",       "40": "Studio Box Truck",
  "51": "Stakebed",      "52": "Stakebed",        "4BR": "Cast Trailer",
};

function classToGroup(cls: string | null): string | null {
  if (!cls) return null;
  const key = String(cls).trim().toUpperCase();
  if (CLASS_TO_GROUP[key]) return CLASS_TO_GROUP[key];
  if (/^\d+TB/.test(key)) return "Cast Trailer";
  return null;
}

function detectPeriod(
  filename: string,
  sheetName: string
): { year: number; month: number } | null {
  const text = `${filename} ${sheetName}`.toUpperCase();
  const m1 = text.match(
    /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*(\d{2,4})\b/
  );
  if (m1) {
    const month = MONTH_NAMES.indexOf(m1[1]) + 1;
    let year = Number(m1[2]);
    if (year < 100) year += 2000;
    return { year, month };
  }
  const m2 = text.match(/\b(20\d{2})[\.\-_ ](0?[1-9]|1[0-2])\b/);
  if (m2) return { year: Number(m2[1]), month: Number(m2[2]) };
  const m3 = text.match(/\b(0?[1-9]|1[0-2])[\.\-_](20\d{2})\b/);
  if (m3) return { year: Number(m3[2]), month: Number(m3[1]) };
  return null;
}

function toIsoDate(d: unknown): string | null {
  if (d === null || d === undefined || d === "") return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + d * 86400000).toISOString().slice(0, 10);
  }
  const parsed = new Date(String(d));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// dbr/act/rev_util_pct columns are numeric(7,4) — max 999.9999. Outlier rows
// with a tiny denominator (mid-period sale) can blow past that ceiling. Null
// rather than truncate so it's obvious in the data.
function pctSafe(v: unknown): number | null {
  const n = num(v);
  if (n === null) return null;
  if (Math.abs(n) >= 1000) return null;
  return n;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim();
}

interface KpiRow {
  organization_id: string;
  period_year: number;
  period_month: number;
  grain: "asset" | "equipment_pool";
  fixed_asset_id: string | null;
  reporting_group: string | null;
  entity_id: string | null;
  equipment_pool_key: string | null;
  orphan_bridge_vin: string | null;
  orphan_veh_number: string | null;
  dbr_status: string | null;
  sale_date: string | null;
  fleet_days: number | null;
  rental_dbr_days: number | null;
  rental_act_days: number | null;
  total_revenue: number | null;
  avg_revenue_per_day: number | null;
  charged_rate: number | null;
  standard_rate: number | null;
  charged_location: string | null;
  dbr_util_pct: number | null;
  act_util_pct: number | null;
  rev_util_pct: number | null;
  subrental_flag: string | null;
  source_filename: string;
  uploaded_by: string | null;
}

interface SheetResult {
  sheetName: string;
  period: { year: number; month: number };
  matched: number;
  collapsed: number;
  equipment: number;
  orphans: number;
  upserted: number;
  deduped: number;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const organizationId = formData.get("organization_id") as string | null;

  if (!file || !organizationId) {
    return NextResponse.json(
      { error: "Missing required fields: file, organization_id" },
      { status: 400 }
    );
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    !membership ||
    !["admin", "controller", "preparer"].includes(membership.role as string)
  ) {
    return NextResponse.json(
      { error: "Forbidden — admin, controller, or preparer role required" },
      { status: 403 }
    );
  }

  // Use admin client for the bulk delete + insert. RLS would also allow this
  // for the user's role, but bulk operations are simpler with the service
  // role and the role check above is the source of truth.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ─── Parse workbook ───
  const buffer = await file.arrayBuffer();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Could not parse spreadsheet: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      },
      { status: 400 }
    );
  }

  // Pick which sheets to process. Multi-tab workbooks: every sheet whose
  // name matches a month-year pattern. Single-tab workbooks: fall back to
  // the filename.
  const MONTH_NAME_RE =
    /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s*\d{2,4}\b/i;
  const filename = file.name;

  const sheetsToProcess: { sheetName: string; period: { year: number; month: number } }[] =
    [];
  for (const name of workbook.SheetNames) {
    const fromName = detectPeriod("", name);
    if (MONTH_NAME_RE.test(name) && fromName) {
      sheetsToProcess.push({ sheetName: name, period: fromName });
    }
  }
  if (sheetsToProcess.length === 0 && workbook.SheetNames.length === 1) {
    const fromFile = detectPeriod(filename, "");
    if (fromFile) {
      sheetsToProcess.push({ sheetName: workbook.SheetNames[0], period: fromFile });
    }
  }
  if (sheetsToProcess.length === 0) {
    return NextResponse.json(
      {
        error:
          "No month-tagged sheets found. Tab names must include a month and year (e.g. \"APR 2026\"), or the filename must contain one for single-tab workbooks.",
      },
      { status: 400 }
    );
  }

  // ─── Reference data: fixed_assets + VIN bridge ───
  // Page through both with .range() because either could exceed 1000 rows.
  const byTag = new Map<string, { id: string; vin: string | null }[]>();
  const byVin = new Map<string, { id: string; vin: string | null }[]>();

  {
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await admin
        .from("fixed_assets")
        .select("id, asset_tag, vin")
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const a of data) {
        const t = String(a.asset_tag || "").trim().toUpperCase();
        if (t) {
          if (!byTag.has(t)) byTag.set(t, []);
          byTag.get(t)!.push({ id: a.id as string, vin: a.vin as string | null });
        }
        const v = String(a.vin || "").trim().toUpperCase();
        if (v) {
          if (!byVin.has(v)) byVin.set(v, []);
          byVin.get(v)!.push({ id: a.id as string, vin: a.vin as string | null });
        }
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  const vehToBridgeVin = new Map<string, string>();
  {
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await admin
        .from("rental_asset_vin_bridge")
        .select("veh_number, vin")
        .eq("organization_id", organizationId)
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const b of data) {
        vehToBridgeVin.set(
          String(b.veh_number).toUpperCase(),
          String(b.vin).toUpperCase()
        );
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  // ─── Process each sheet ───
  const results: SheetResult[] = [];
  let totalUpserted = 0;

  for (const { sheetName, period } of sheetsToProcess) {
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
    });

    // Find the header row — first row whose A column contains "Veh_number".
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const r = rawRows[i] as unknown[] | undefined;
      if (r && typeof r[0] === "string" && /veh.?number/i.test(r[0] as string)) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) {
      results.push({
        sheetName,
        period,
        matched: 0,
        collapsed: 0,
        equipment: 0,
        orphans: 0,
        upserted: 0,
        deduped: 0,
      });
      continue;
    }

    const dataRows = rawRows.slice(headerIdx + 1).filter((r) => {
      const row = r as unknown[];
      return row && row[0] != null && row[0] !== "";
    }) as unknown[][];

    const kpis: KpiRow[] = [];
    let matched = 0;
    let collapsed = 0;
    let equipment = 0;
    let orphans = 0;

    for (const r of dataRows) {
      const vehRaw = str(r[0]);
      if (!vehRaw) continue;
      const veh = vehRaw.toUpperCase();
      const cls = str(r[4]);
      const plate = str(r[1]);

      const isEquipment =
        EQU_PREFIX.test(veh) ||
        (cls && cls.toUpperCase() === "EQU") ||
        (plate &&
          plate.toUpperCase() === "NA" &&
          cls &&
          cls.toUpperCase() === "BATH");

      const common = {
        organization_id: organizationId,
        period_year: period.year,
        period_month: period.month,
        dbr_status: str(r[2]),
        sale_date: toIsoDate(r[7]),
        fleet_days: num(r[8]),
        rental_dbr_days: num(r[9]),
        rental_act_days: num(r[10]),
        total_revenue: num(r[11]),
        avg_revenue_per_day: num(r[12]),
        charged_rate: num(r[13]),
        standard_rate: num(r[14]),
        charged_location: str(r[15]),
        dbr_util_pct: pctSafe(r[16]),
        act_util_pct: pctSafe(r[17]),
        rev_util_pct: pctSafe(r[18]),
        subrental_flag: str(r[19]),
        source_filename: filename,
        uploaded_by: user.id,
      };

      const base: KpiRow = {
        ...common,
        grain: "asset",
        fixed_asset_id: null,
        reporting_group: null,
        entity_id: null,
        equipment_pool_key: null,
        orphan_bridge_vin: null,
        orphan_veh_number: null,
      };

      if (isEquipment) {
        equipment++;
        kpis.push({
          ...base,
          grain: "equipment_pool",
          equipment_pool_key: veh,
        });
        continue;
      }

      let assetMatches = byTag.get(veh);
      let bridgeVin: string | null = null;
      if (!assetMatches || assetMatches.length === 0) {
        bridgeVin = vehToBridgeVin.get(veh) ?? null;
        if (bridgeVin) {
          assetMatches = byVin.get(bridgeVin);
        }
      }

      const reportingGroup = classToGroup(cls);

      if (assetMatches && assetMatches.length > 0) {
        if (assetMatches.length > 1) collapsed++;
        matched++;
        const primary = assetMatches.find((a) => a.vin) ?? assetMatches[0];
        kpis.push({
          ...base,
          grain: "asset",
          fixed_asset_id: primary.id,
          reporting_group: reportingGroup,
        });
      } else {
        orphans++;
        kpis.push({
          ...base,
          grain: "asset",
          orphan_bridge_vin: bridgeVin,
          orphan_veh_number: veh,
          reporting_group: reportingGroup,
        });
      }
    }

    // Dedupe within-batch: same (org, period, grain anchor) collapsed by
    // summing additive fields. Postgres rejects an INSERT with conflicting
    // rows in a single ON CONFLICT DO UPDATE, and historical sheets do
    // contain duplicate Veh_numbers.
    const bucket = new Map<string, KpiRow>();
    for (const row of kpis) {
      const key = [
        row.grain,
        row.fixed_asset_id ?? "",
        row.reporting_group ?? "",
        row.entity_id ?? "",
        row.equipment_pool_key ?? "",
        row.orphan_bridge_vin ?? "",
        row.orphan_veh_number ?? "",
      ].join("|");
      const existing = bucket.get(key);
      if (!existing) {
        bucket.set(key, { ...row });
        continue;
      }
      existing.fleet_days = (existing.fleet_days ?? 0) + (row.fleet_days ?? 0);
      existing.rental_dbr_days =
        (existing.rental_dbr_days ?? 0) + (row.rental_dbr_days ?? 0);
      existing.rental_act_days =
        (existing.rental_act_days ?? 0) + (row.rental_act_days ?? 0);
      existing.total_revenue =
        (existing.total_revenue ?? 0) + (row.total_revenue ?? 0);
    }
    const deduped = [...bucket.values()];
    const dedupedCount = kpis.length - deduped.length;

    // Replace-per-period: drop existing rows for this (org, period) so
    // re-uploading produces the same result regardless of prior state.
    const { error: delErr } = await admin
      .from("rental_asset_kpis")
      .delete()
      .eq("organization_id", organizationId)
      .eq("period_year", period.year)
      .eq("period_month", period.month);
    if (delErr) {
      return NextResponse.json(
        {
          error: `Failed to clear existing KPIs for ${period.year}-${period.month}: ${delErr.message}`,
        },
        { status: 500 }
      );
    }

    // Insert in chunks so we don't blow PostgREST's payload cap on big
    // workbooks (Avon's full DBR is ~400 rows so a single chunk is fine,
    // but 500 is a safer ceiling for future growth).
    const CHUNK = 500;
    for (let i = 0; i < deduped.length; i += CHUNK) {
      const part = deduped.slice(i, i + CHUNK);
      const { error: insErr } = await admin
        .from("rental_asset_kpis")
        .insert(part);
      if (insErr) {
        return NextResponse.json(
          {
            error: `Failed to insert KPIs for ${period.year}-${period.month}: ${insErr.message}`,
          },
          { status: 500 }
        );
      }
    }

    results.push({
      sheetName,
      period,
      matched,
      collapsed,
      equipment,
      orphans,
      upserted: deduped.length,
      deduped: dedupedCount,
    });
    totalUpserted += deduped.length;
  }

  return NextResponse.json({
    ok: true,
    sheets: results,
    totalUpserted,
  });
}

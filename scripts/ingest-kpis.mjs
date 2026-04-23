// Ingest one or more DBR utilization spreadsheets into rental_asset_kpis.
//
// Usage:
//   node scripts/ingest-kpis.mjs "Jan 2026 utilization data.xlsx"
//   node scripts/ingest-kpis.mjs scripts/kpi-history/*.xlsx
//
// Handles:
//   • Direct asset_tag match (384 rows on Jan 2026)
//   • V-prefixed / HT / PML tags via rental_asset_vin_bridge → VIN (31 rows)
//   • Orphans with bridge VIN but no fixed_assets row (stored with orphan_bridge_vin)
//   • Equipment pool (BATH, EQU, KSCF01..) stored with grain='equipment_pool'
//   • Ambiguous tags (same tag, >1 closebook row) collapsed into ONE logical
//     KPI anchored on the first closebook asset — per user directive
//
// Prerequisites:
//   1. Migration applied
//   2. scripts/backfill-vin-bridge.mjs has populated the bridge table
//
// Column layout (from "JAN 2026 (2)" sheet):
//   A=Veh_number, B=License_no, C=Status, D=Year, E=Class, F=Model,
//   G=Purch_date, H=Sale_date, I=Fleet_days, J=Rental_DBR_days,
//   K=Rental_act_days, L=Total_rev, M=Avg_rev, N=Chg_rate, O=Std_rate,
//   P=Chg_loc, Q=DBR_util, R=Act_util, S=Rev_util, T=Subrental
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return i === -1 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
    .filter(Boolean)
);

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const hdr = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

const EQU_PREFIX = /^(BATH$|EQU$|KSCF\d+$)/i;

async function sbGet(tbl, select = "*", filter = "") {
  const batch = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const u = new URL(`${SB}/rest/v1/${tbl}`);
    u.searchParams.set("select", select);
    u.searchParams.set("limit", String(batch));
    u.searchParams.set("offset", String(offset));
    if (filter) {
      for (const part of filter.split("&")) {
        const [k, v] = part.split("=");
        u.searchParams.set(k, v);
      }
    }
    const r = await fetch(u, { headers: hdr });
    if (!r.ok) throw new Error(`GET ${tbl}: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    all.push(...rows);
    if (rows.length < batch) break;
    offset += batch;
  }
  return all;
}

async function sbUpsert(tbl, rows, onConflict) {
  if (!rows.length) return;
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const u = new URL(`${SB}/rest/v1/${tbl}`);
    if (onConflict) u.searchParams.set("on_conflict", onConflict);
    const r = await fetch(u, {
      method: "POST",
      headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(part),
    });
    if (!r.ok) throw new Error(`UPSERT ${tbl}: ${r.status} ${await r.text()}`);
  }
}

async function sbDelete(tbl, filter) {
  const u = new URL(`${SB}/rest/v1/${tbl}`);
  for (const part of filter.split("&")) {
    const [k, v] = part.split("=");
    u.searchParams.set(k, v);
  }
  const r = await fetch(u, {
    method: "DELETE",
    headers: { ...hdr, Prefer: "return=minimal" },
  });
  if (!r.ok) throw new Error(`DELETE ${tbl}: ${r.status} ${await r.text()}`);
}

// ─── detect sheet period ───
// Try: filename ("Jan 2026", "2024-07"), then sheet name, fallback to today.
const MONTH_NAMES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];
function detectPeriod(filename, sheetName) {
  const text = `${filename} ${sheetName}`.toUpperCase();
  const m1 = text.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*(\d{2,4})\b/);
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

function toIsoDate(d) {
  if (d === null || d === undefined || d === "") return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + d * 86400000).toISOString().slice(0, 10);
  }
  const parsed = new Date(String(d));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Utilization % columns are numeric(7,4) — max 999.9999. Outlier rows (tiny
// denominator during a disposal week) can explode past that. Null rather
// than truncate so it's obvious in the data.
function pctSafe(v) {
  const n = num(v);
  if (n === null) return null;
  if (Math.abs(n) >= 1000) return null;
  return n;
}

function str(v) {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim();
}

// ─── Class → Reporting Group map (mirrors VEHICLE_CLASSIFICATIONS) ───
const CLASS_TO_GROUP = {
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
function classToGroup(cls) {
  if (!cls) return null;
  const key = String(cls).trim().toUpperCase();
  if (CLASS_TO_GROUP[key]) return CLASS_TO_GROUP[key];
  if (/^\d+TB/.test(key)) return "Cast Trailer";
  return null;
}

// ─── load reference data from DB ───
const orgs = await sbGet("organizations", "id,name");
const ORG_ID = process.env.ORG_ID || orgs[0].id;
console.log(`Organization: ${orgs.find((o) => o.id === ORG_ID)?.name} (${ORG_ID})`);

const assets = await sbGet(
  "fixed_assets",
  "id,asset_tag,vin"
);
const byTag = new Map(); // UPPER(asset_tag) → [assets]
const byVin = new Map(); // UPPER(vin) → [assets]
for (const a of assets) {
  const t = String(a.asset_tag || "").trim().toUpperCase();
  if (t) {
    if (!byTag.has(t)) byTag.set(t, []);
    byTag.get(t).push(a);
  }
  const v = String(a.vin || "").trim().toUpperCase();
  if (v) {
    if (!byVin.has(v)) byVin.set(v, []);
    byVin.get(v).push(a);
  }
}

const bridge = await sbGet("rental_asset_vin_bridge", "veh_number,vin");
const vehToBridgeVin = new Map();
for (const b of bridge) vehToBridgeVin.set(b.veh_number.toUpperCase(), b.vin.toUpperCase());
console.log(`Reference: ${assets.length} fixed_assets, ${bridge.length} bridge rows`);

// ─── process each input file ───
const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.log("\nUsage: node scripts/ingest-kpis.mjs <file.xlsx> [<file2.xlsx> ...]");
  console.log("       node scripts/ingest-kpis.mjs scripts/kpi-history/*.xlsx");
  process.exit(1);
}

const totals = { files: 0, kpiRowsUpserted: 0, orphans: 0, collapsed: 0, equipment: 0, skipped: 0 };

for (const inputPath of inputs) {
  const absolutePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(ROOT, inputPath);
  if (!fs.existsSync(absolutePath)) {
    console.log(`Skipping (not found): ${inputPath}`);
    continue;
  }

  console.log(`\n── ${path.basename(absolutePath)} ──`);
  const wb = XLSX.readFile(absolutePath, { cellDates: true });

  // Which sheets should we process? Any whose name matches a month-year
  // pattern (MAY 2024, JAN 2026, etc.). Filename period is a fallback for
  // single-tab workbooks.
  const MONTH_NAME_RE =
    /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s*\d{2,4}\b/i;
  const sheetsToProcess = [];
  for (const name of wb.SheetNames) {
    const fromName = detectPeriod("", name);
    const fromFile = detectPeriod(path.basename(absolutePath), "");
    if (MONTH_NAME_RE.test(name) && fromName) {
      sheetsToProcess.push({ sheetName: name, period: fromName });
    } else if (wb.SheetNames.length === 1 && fromFile) {
      sheetsToProcess.push({ sheetName: name, period: fromFile });
    }
  }
  if (sheetsToProcess.length === 0) {
    console.log(`  skip — no sheets with month-year names (e.g. "JAN 2026")`);
    continue;
  }
  console.log(`  ${sheetsToProcess.length} monthly sheets to process`);

  for (const { sheetName, period } of sheetsToProcess) {
    console.log(
      `  → ${period.year}-${String(period.month).padStart(2, "0")} ("${sheetName}")`
    );
    const sheet = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    });
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const r = rawRows[i];
      if (r && typeof r[0] === "string" && /veh.?number/i.test(r[0])) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) {
      console.log(`      skip — no "Veh_number" header row found`);
      continue;
    }
    const dataRows = rawRows
      .slice(headerIdx + 1)
      .filter((r) => r && r[0]);
    console.log(`      data rows: ${dataRows.length}`);

  const kpis = [];
  let orphans = 0;
  let collapsed = 0;
  let equipment = 0;
  let matched = 0;

  for (const r of dataRows) {
    const vehRaw = str(r[0]);
    if (!vehRaw) continue;
    const veh = vehRaw.toUpperCase();
    const cls = str(r[4]);
    const plate = str(r[1]);
    const model = str(r[5]);

    const isEquipment =
      EQU_PREFIX.test(veh) || (cls && cls.toUpperCase() === "EQU") || (plate && plate.toUpperCase() === "NA" && cls && cls.toUpperCase() === "BATH");

    // common fields
    const common = {
      organization_id: ORG_ID,
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
      source_filename: path.basename(absolutePath),
    };

    // Normalised row template — every key present so PostgREST bulk upsert
    // is happy ("All object keys must match").
    const base = {
      ...common,
      grain: null,
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

    // Try direct asset_tag match
    let assetMatches = byTag.get(veh);

    // Fall back to VIN bridge
    let bridgeVin = null;
    if (!assetMatches || assetMatches.length === 0) {
      bridgeVin = vehToBridgeVin.get(veh);
      if (bridgeVin) {
        assetMatches = byVin.get(bridgeVin);
      }
    }

    // Derive reporting group from class for both matched and orphan rows —
    // lets the dashboard aggregate orphans into the right bucket without a
    // joined fixed_asset.
    const reportingGroup = classToGroup(cls);

    if (assetMatches && assetMatches.length > 0) {
      if (assetMatches.length > 1) collapsed++;
      matched++;
      const primary =
        assetMatches.find((a) => a.vin) || assetMatches[0];
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

    console.log(
      `      matched to asset: ${matched}, collapsed: ${collapsed}, equipment: ${equipment}, orphans: ${orphans}`
    );

    // Normalize every row to the EXACT same key set, in the same order, so
    // PostgREST's bulk upsert validator is happy.
    const columns = [
      "organization_id",
      "period_year",
      "period_month",
      "grain",
      "fixed_asset_id",
      "reporting_group",
      "entity_id",
      "equipment_pool_key",
      "orphan_bridge_vin",
      "orphan_veh_number",
      "dbr_status",
      "sale_date",
      "fleet_days",
      "rental_dbr_days",
      "rental_act_days",
      "total_revenue",
      "avg_revenue_per_day",
      "charged_rate",
      "standard_rate",
      "charged_location",
      "dbr_util_pct",
      "act_util_pct",
      "rev_util_pct",
      "subrental_flag",
      "source_filename",
    ];
    const normalized = kpis.map((k) => {
      const out = {};
      for (const col of columns) out[col] = k[col] ?? null;
      return out;
    });

    // Dedupe within-batch: PostgreSQL rejects an INSERT with conflicting
    // rows in a single ON CONFLICT DO UPDATE statement. Historical sheets
    // sometimes contain duplicate Veh_numbers (or a tag + an alt tag both
    // resolving to the same fixed_asset). Merge duplicates by summing the
    // additive numeric fields — revenue / days — so nothing is lost.
    const bucket = new Map();
    for (const row of normalized) {
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
        bucket.set(key, row);
        continue;
      }
      // Sum additive fields, max non-additive
      existing.fleet_days = (existing.fleet_days ?? 0) + (row.fleet_days ?? 0);
      existing.rental_dbr_days =
        (existing.rental_dbr_days ?? 0) + (row.rental_dbr_days ?? 0);
      existing.rental_act_days =
        (existing.rental_act_days ?? 0) + (row.rental_act_days ?? 0);
      existing.total_revenue =
        (existing.total_revenue ?? 0) + (row.total_revenue ?? 0);
    }
    const deduped = [...bucket.values()];
    if (deduped.length !== normalized.length) {
      console.log(
        `      deduped ${normalized.length - deduped.length} in-batch duplicate(s)`
      );
    }

    // Replace-per-period: delete existing rows for this (org, period) so
    // a re-ingest with new derived fields (e.g. reporting_group) doesn't
    // double-count through upsert key changes.
    await sbDelete(
      "rental_asset_kpis",
      `organization_id=eq.${ORG_ID}&period_year=eq.${period.year}&period_month=eq.${period.month}`
    );
    await sbUpsert(
      "rental_asset_kpis",
      deduped,
      "organization_id,period_year,period_month,grain,fixed_asset_id,reporting_group,entity_id,equipment_pool_key,orphan_bridge_vin,orphan_veh_number"
    );

    totals.kpiRowsUpserted += kpis.length;
    totals.orphans += orphans;
    totals.collapsed += collapsed;
    totals.equipment += equipment;
  }

  totals.files++;
}

console.log("\n=== INGESTION COMPLETE ===");
console.log(`Files processed:        ${totals.files}`);
console.log(`KPI rows upserted:      ${totals.kpiRowsUpserted}`);
console.log(`  orphans (no register): ${totals.orphans}`);
console.log(`  ambiguous collapsed:   ${totals.collapsed}`);
console.log(`  equipment pool:        ${totals.equipment}`);

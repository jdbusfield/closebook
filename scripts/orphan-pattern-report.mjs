// Build a report of "orphan" Veh_numbers — vehicles that appear on any DBR
// utilization spreadsheet but are NOT in closebook's fixed_assets register.
// For each orphan, aggregate all the KPI rows we've ingested, identify the
// likely class + reporting group from the source data, and write CSV +
// human-readable summary to /scripts/orphan-pattern-report.{csv,md}.
//
// Usage: node scripts/orphan-pattern-report.mjs
//
// Uses the KPI data we already ingested, so re-run whenever new periods are
// added.
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

const hdr = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
};

async function fetchAll(tbl, filter = "") {
  const batch = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const u = new URL(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${tbl}`);
    u.searchParams.set("limit", String(batch));
    u.searchParams.set("offset", String(offset));
    if (filter) {
      for (const part of filter.split("&")) {
        const [k, v] = part.split("=");
        u.searchParams.set(k, v);
      }
    }
    const r = await fetch(u, { headers: hdr });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    const rows = await r.json();
    all.push(...rows);
    if (rows.length < batch) break;
    offset += batch;
  }
  return all;
}

console.log("Loading orphan KPI rows from DB...");
const orphans = await fetchAll(
  "rental_asset_kpis",
  "select=orphan_veh_number,orphan_bridge_vin,period_year,period_month,total_revenue,fleet_days,rental_dbr_days,dbr_status,sale_date&grain=eq.asset&fixed_asset_id=is.null&orphan_veh_number=not.is.null"
);
console.log(`Found ${orphans.length} orphan KPI rows`);

// We also need the class/model/year for each orphan. That data is in the
// source spreadsheets (not stored in rental_asset_kpis). Walk the Historic
// Data workbook to capture it.
console.log("Reading source spreadsheet for class/model metadata...");
const histPath =
  "C:/Users/JDBusfield/Downloads/Current Utilization Revenue Projection Tool - Historic Data.xlsx";
const janPath = path.join(ROOT, "Jan 2026 utilization data.xlsx");

const metaByVeh = new Map();

function absorb(sheet, sourceLabel) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i];
    if (r && typeof r[0] === "string" && /veh.?number/i.test(r[0])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return;
  for (const r of rows.slice(headerIdx + 1)) {
    if (!r || !r[0]) continue;
    const veh = String(r[0]).trim().toUpperCase();
    const year = r[3] ? 2000 + Number(r[3]) : null;
    const cls = r[4] ? String(r[4]).trim() : null;
    const model = r[5] ? String(r[5]).trim() : null;
    const plate = r[1] ? String(r[1]).trim() : null;
    const existing = metaByVeh.get(veh);
    if (!existing) {
      metaByVeh.set(veh, { veh, year, cls, model, plate, source: sourceLabel });
    } else {
      // Prefer the most recent data: overwrite if we have a newer year signal
      if (!existing.cls && cls) existing.cls = cls;
      if (!existing.model && model) existing.model = model;
      if (!existing.plate && plate) existing.plate = plate;
    }
  }
}

if (fs.existsSync(histPath)) {
  const wb = XLSX.readFile(histPath, { cellDates: true });
  const MONTH_RE =
    /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s*\d{2,4}\b/i;
  for (const name of wb.SheetNames) {
    if (!MONTH_RE.test(name)) continue;
    absorb(wb.Sheets[name], `Historic:${name}`);
  }
}
if (fs.existsSync(janPath)) {
  const wb = XLSX.readFile(janPath, { cellDates: true });
  for (const name of wb.SheetNames) {
    absorb(wb.Sheets[name], `Jan2026:${name}`);
  }
}
console.log(`Metadata for ${metaByVeh.size} distinct Veh_numbers`);

// Load Class → Reporting Group map from codebase (VEHICLE_CLASSIFICATIONS).
// Hardcoded here to avoid ESM/TS interop; mirrors
// src/lib/utils/vehicle-classification.ts.
const CLASS_TO_GROUP = {
  "1R": "Cast Trailer",
  2: "Studio Box Truck",
  "2R": "Cast Trailer",
  3: "Car",
  "3R": "Cast Trailer",
  4: "Car",
  5: "Car",
  6: "Car",
  7: "Car",
  8: "Passenger Van",
  "8MU": "Makeup Trailer",
  9: "Studio Box Truck",
  11: "Cargo Van",
  12: "Car",
  13: "Box Truck",
  "13T": "Box Truck",
  14: "Box Truck",
  15: "Stakebed",
  "15I": "Stakebed",
  "15L": "Stakebed",
  16: "Stakebed",
  17: "Car",
  18: "Car",
  20: "Box Truck",
  "20T": "Box Truck",
  21: "Car",
  22: "Box Truck",
  23: "Stakebed",
  24: "Box Truck",
  26: "Cargo Van",
  27: "Studio Box Truck",
  28: "Passenger Van",
  "28P": "Passenger Van",
  "28S": "Passenger Van",
  29: "Cargo Van",
  30: "Cargo Van",
  31: "Cargo Van",
  32: "Cargo Van",
  33: "Cargo Van",
  34: "Cargo Van",
  40: "Studio Box Truck",
  51: "Stakebed",
  52: "Stakebed",
  "13W": "Box Truck",
  "4BR": "Cast Trailer",
  "1TB": "Cast Trailer",
  "2TB": "Cast Trailer",
  "3TB": "Cast Trailer",
};
function classToGroup(cls) {
  if (!cls) return null;
  const key = String(cls).trim().toUpperCase();
  if (CLASS_TO_GROUP[key]) return CLASS_TO_GROUP[key];
  // Try numeric
  const n = Number(key);
  if (!Number.isNaN(n) && CLASS_TO_GROUP[n]) return CLASS_TO_GROUP[n];
  // Patterns for TB* trailers
  if (/^\d+TB/.test(key)) return "Cast Trailer";
  return null;
}

// Aggregate orphan KPI rows by Veh_number
const agg = new Map();
for (const o of orphans) {
  const veh = o.orphan_veh_number;
  let row = agg.get(veh);
  if (!row) {
    row = {
      veh,
      periods: 0,
      first_period: null,
      last_period: null,
      total_revenue: 0,
      total_rental_days: 0,
      total_fleet_days: 0,
      bridge_vin: o.orphan_bridge_vin,
      sale_date: null,
      ever_sold: false,
    };
    agg.set(veh, row);
  }
  row.periods++;
  const pKey = `${o.period_year}-${String(o.period_month).padStart(2, "0")}`;
  if (row.first_period === null || pKey < row.first_period)
    row.first_period = pKey;
  if (row.last_period === null || pKey > row.last_period)
    row.last_period = pKey;
  row.total_revenue += Number(o.total_revenue || 0);
  row.total_rental_days += Number(o.rental_dbr_days || 0);
  row.total_fleet_days += Number(o.fleet_days || 0);
  if (o.sale_date) {
    row.ever_sold = true;
    row.sale_date = o.sale_date;
  }
  if (o.orphan_bridge_vin && !row.bridge_vin) row.bridge_vin = o.orphan_bridge_vin;
}

// Enrich with metadata + reporting group guess
const enriched = [];
for (const row of agg.values()) {
  const meta = metaByVeh.get(row.veh) || {};
  const group = classToGroup(meta.cls);
  enriched.push({
    veh: row.veh,
    bridge_vin: row.bridge_vin || "",
    year: meta.year || "",
    class: meta.cls || "",
    model: meta.model || "",
    plate: meta.plate || "",
    reporting_group_guess: group || "(unknown)",
    first_period: row.first_period,
    last_period: row.last_period,
    periods: row.periods,
    ever_sold: row.ever_sold ? "Y" : "",
    sale_date: row.sale_date || "",
    total_revenue: row.total_revenue.toFixed(2),
    total_rental_days: row.total_rental_days.toFixed(1),
    total_fleet_days: row.total_fleet_days.toFixed(0),
    util_pct:
      row.total_fleet_days > 0
        ? ((row.total_rental_days / row.total_fleet_days) * 100).toFixed(1)
        : "",
  });
}
enriched.sort((a, b) => Number(b.total_revenue) - Number(a.total_revenue));

// Write CSV
const csvPath = path.join(ROOT, "scripts", "orphan-pattern-report.csv");
const cols = Object.keys(enriched[0]);
fs.writeFileSync(
  csvPath,
  [cols.join(",")]
    .concat(
      enriched.map((r) =>
        cols
          .map((c) => {
            const v = r[c];
            const s = String(v ?? "").replace(/"/g, '""');
            return /[",\n]/.test(s) ? `"${s}"` : s;
          })
          .join(",")
      )
    )
    .join("\n")
);

// Write Markdown summary
const mdPath = path.join(ROOT, "scripts", "orphan-pattern-report.md");

// Group distribution
const groupDist = {};
let groupRev = {};
for (const r of enriched) {
  const g = r.reporting_group_guess;
  groupDist[g] = (groupDist[g] || 0) + 1;
  groupRev[g] = (groupRev[g] || 0) + Number(r.total_revenue);
}
const classDist = {};
for (const r of enriched) {
  const c = r.class || "(blank)";
  classDist[c] = (classDist[c] || 0) + 1;
}

const topRevenue = enriched.slice(0, 30);
const unknownGroup = enriched.filter((r) => r.reporting_group_guess === "(unknown)");

const mdSections = [];
mdSections.push("# Orphan Vehicle Pattern Report");
mdSections.push("");
mdSections.push(
  `Generated: ${new Date().toISOString().slice(0, 10)}. "Orphan" = Veh_number that appears on at least one DBR utilization sheet but is not present in \`fixed_assets\`.`
);
mdSections.push("");
mdSections.push(`## Headline numbers`);
mdSections.push("");
mdSections.push(`- Distinct orphan Veh_numbers: **${enriched.length}**`);
const totalOrphanRev = enriched.reduce(
  (a, r) => a + Number(r.total_revenue),
  0
);
mdSections.push(
  `- Total rental revenue attributed to orphans across all history: **$${totalOrphanRev.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**`
);
mdSections.push(
  `- Orphan KPI row count (same vehicle × many months): **${orphans.length}**`
);
mdSections.push("");

mdSections.push(`## Reporting-group distribution (inferred from Class)`);
mdSections.push("");
mdSections.push(`| Reporting Group | Orphan count | Total Revenue |`);
mdSections.push(`|---|---:|---:|`);
for (const [g, n] of Object.entries(groupDist).sort((a, b) => b[1] - a[1])) {
  mdSections.push(
    `| ${g} | ${n} | $${(groupRev[g] || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} |`
  );
}
mdSections.push("");

mdSections.push(`## Class distribution`);
mdSections.push("");
mdSections.push(`| Class | Orphans |`);
mdSections.push(`|---|---:|`);
for (const [c, n] of Object.entries(classDist).sort((a, b) => b[1] - a[1])) {
  mdSections.push(`| ${c} | ${n} |`);
}
mdSections.push("");

mdSections.push(
  `## Top 30 orphans by lifetime revenue`
);
mdSections.push("");
mdSections.push(
  `| Veh# | Year | Class | Model | Group | First | Last | Periods | Sold? | Revenue |`
);
mdSections.push(
  `|---|---|---|---|---|---|---|---:|:---:|---:|`
);
for (const r of topRevenue) {
  mdSections.push(
    `| ${r.veh} | ${r.year} | ${r.class} | ${r.model} | ${r.reporting_group_guess} | ${r.first_period} | ${r.last_period} | ${r.periods} | ${r.ever_sold} | $${Number(r.total_revenue).toLocaleString("en-US", { maximumFractionDigits: 0 })} |`
  );
}
mdSections.push("");

if (unknownGroup.length > 0) {
  mdSections.push(
    `## Orphans with unknown reporting group (${unknownGroup.length})`
  );
  mdSections.push("");
  mdSections.push(
    `These Veh_numbers have a class we couldn't map. Either the class is malformed in the source sheet, or it's a new class we haven't added to the classification table. Top 30 by revenue:`
  );
  mdSections.push("");
  mdSections.push(`| Veh# | Class | Year | Model | Periods | Revenue |`);
  mdSections.push(`|---|---|---|---|---:|---:|`);
  for (const r of unknownGroup.slice(0, 30)) {
    mdSections.push(
      `| ${r.veh} | ${r.class || "(blank)"} | ${r.year} | ${r.model} | ${r.periods} | $${Number(r.total_revenue).toLocaleString("en-US", { maximumFractionDigits: 0 })} |`
    );
  }
  mdSections.push("");
}

mdSections.push(`## Full detail`);
mdSections.push("");
mdSections.push(`CSV: \`scripts/orphan-pattern-report.csv\` (${enriched.length} rows)`);

fs.writeFileSync(mdPath, mdSections.join("\n"));

console.log(`\n=== ORPHAN PATTERN REPORT ===`);
console.log(`Distinct orphans:           ${enriched.length}`);
console.log(
  `Total orphan revenue:       $${totalOrphanRev.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
);
console.log(`\nBy inferred reporting group:`);
for (const [g, n] of Object.entries(groupDist).sort((a, b) => b[1] - a[1])) {
  console.log(
    `  ${g.padEnd(22)} ${String(n).padStart(5)}  $${(groupRev[g] || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
  );
}
console.log(`\nUnknown-group orphans:      ${unknownGroup.length}`);
console.log(`\nOutputs:`);
console.log(`  ${csvPath}`);
console.log(`  ${mdPath}`);

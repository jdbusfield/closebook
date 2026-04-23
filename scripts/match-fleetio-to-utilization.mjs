// One-shot analysis: pull every Fleetio vehicle (active + archived) for the
// account, then attempt to match each row of the January 2026 utilization
// spreadsheet to a Fleetio vehicle. Emits a CSV + summary stats.
//
// Read-only. Only uses GET against Fleetio. No state is written.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");
const SHEET_PATH = path.join(ROOT, "Jan 2026 utilization data.xlsx");
const OUT_CSV = path.join(ROOT, "scripts", "match-report.csv");
const OUT_JSON = path.join(ROOT, "scripts", "match-report.json");

// --- load env ---
const env = Object.fromEntries(
  fs
    .readFileSync(ENV_PATH, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return i === -1 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
    .filter(Boolean)
);

const FLEETIO_BASE = env.FLEETIO_BASE_URL || "https://secure.fleetio.com/api";
const FLEETIO_KEY = env.FLEETIO_API_KEY;
const FLEETIO_TOKEN = env.FLEETIO_ACCOUNT_TOKEN;
const FLEETIO_VERSION = env.FLEETIO_API_VERSION || "2025-05-05";

if (!FLEETIO_KEY || !FLEETIO_TOKEN) {
  console.error("Missing FLEETIO_API_KEY or FLEETIO_ACCOUNT_TOKEN in .env.local");
  process.exit(1);
}

const headers = {
  Authorization: `Token ${FLEETIO_KEY}`,
  "Account-Token": FLEETIO_TOKEN,
  "X-Api-Version": FLEETIO_VERSION,
  Accept: "application/json",
};

// --- helpers ---
function normPlate(p) {
  if (p === null || p === undefined) return "";
  return String(p).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function last6Vin(v) {
  if (!v) return "";
  const s = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.slice(-6);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function get(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, { headers });
    if (r.status === 429) {
      const retry = Number(r.headers.get("retry-after") || 15);
      console.log(`  429 — retry in ${retry}s`);
      await sleep(retry * 1000);
      continue;
    }
    if (!r.ok) throw new Error(`GET ${url} → ${r.status} ${r.statusText}`);
    return r.json();
  }
  throw new Error(`GET ${url} — retries exhausted`);
}

// --- step 1: load spreadsheet ---
console.log("Loading utilization spreadsheet...");
const wb = XLSX.readFile(SHEET_PATH, { cellDates: true });
const sheet = wb.Sheets["JAN 2026 (2)"];
const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
const headerRow = raw[0];
const sheetRows = raw.slice(1).filter((r) => r && r.some((c) => c !== null && c !== ""));
console.log(`  spreadsheet rows: ${sheetRows.length}`);

// --- step 2: pull all Fleetio vehicles (active) ---
console.log("\nPulling Fleetio vehicles (active)...");
const allVehicles = [];
let cursor = null;
let pages = 0;
while (true) {
  const url = new URL(`${FLEETIO_BASE}/v1/vehicles`);
  url.searchParams.set("per_page", "100");
  if (cursor) url.searchParams.set("start_cursor", cursor);
  const j = await get(url.toString());
  allVehicles.push(...j.records);
  pages++;
  console.log(
    `  page ${pages}: +${j.records.length} (total ${allVehicles.length}, est remaining ${j.estimated_remaining_count})`
  );
  if (!j.next_cursor || j.records.length === 0) break;
  cursor = j.next_cursor;
  await sleep(250); // stay under rate limit
}

// --- step 3: try archived vehicles endpoint ---
console.log("\nPulling Fleetio archived vehicles...");
try {
  let archCursor = null;
  let archPages = 0;
  while (true) {
    const url = new URL(`${FLEETIO_BASE}/v1/archived_vehicles`);
    url.searchParams.set("per_page", "100");
    if (archCursor) url.searchParams.set("start_cursor", archCursor);
    const j = await get(url.toString());
    allVehicles.push(...j.records.map((r) => ({ ...r, _archived: true })));
    archPages++;
    console.log(
      `  archived page ${archPages}: +${j.records.length} (total ${allVehicles.length})`
    );
    if (!j.next_cursor || j.records.length === 0) break;
    archCursor = j.next_cursor;
    await sleep(250);
  }
} catch (e) {
  console.log(`  (archived endpoint failed: ${e.message}) — continuing without`);
}

console.log(`\nTotal Fleetio vehicles: ${allVehicles.length}`);

// --- step 4: build lookup indexes ---
const byPlate = new Map(); // normPlate → [vehicles]
const byVin6 = new Map(); // last-6 of VIN → [vehicles]
const byName = new Map(); // external_ids.unit_number or name → [vehicles]
const byPrevUnit = new Map(); // custom_fields.previous_unit_number → [vehicles]

for (const v of allVehicles) {
  const p = normPlate(v.license_plate);
  if (p) {
    if (!byPlate.has(p)) byPlate.set(p, []);
    byPlate.get(p).push(v);
  }
  const v6 = last6Vin(v.vin);
  if (v6) {
    if (!byVin6.has(v6)) byVin6.set(v6, []);
    byVin6.get(v6).push(v);
  }
  const n = (v.external_ids?.unit_number || v.name || "").trim();
  if (n) {
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(v);
  }
  const prev = v.custom_fields?.previous_unit_number?.trim();
  if (prev) {
    if (!byPrevUnit.has(prev)) byPrevUnit.set(prev, []);
    byPrevUnit.get(prev).push(v);
  }
}

console.log(
  `\nIndexes: plates=${byPlate.size}, vin6=${byVin6.size}, names=${byName.size}, prevUnit=${byPrevUnit.size}`
);

// --- step 5: match each spreadsheet row ---
// Col A=Veh_number, B=License_no, D=Year, E=Class, F=Model, H=Sale_date
const matches = [];
let matchByPlate = 0;
let matchByNameNumeric = 0;
let matchByPrevUnit = 0;
let unmatched = 0;

for (const row of sheetRows) {
  const vehNum = row[0]; // numeric or string
  const plate = row[1];
  const status = row[2];
  const year2 = row[3];
  const cls = row[4];
  const model = row[5];
  const saleDate = row[7];
  const fleetDays = row[8];
  const rentalDbr = row[9];
  const totalRev = row[11];

  const vehNumStr = vehNum !== null ? String(vehNum).trim() : "";
  const plateStr = plate !== null ? String(plate).trim() : "";
  const normPlateStr = normPlate(plateStr);

  let candidates = [];
  let matchMethod = null;

  // try license plate (strongest structural match)
  if (normPlateStr && byPlate.has(normPlateStr)) {
    candidates = byPlate.get(normPlateStr);
    matchMethod = "plate";
  }

  // try exact name/unit_number match on veh number
  if (candidates.length === 0 && vehNumStr && byName.has(vehNumStr)) {
    candidates = byName.get(vehNumStr);
    matchMethod = "name";
  }

  // try previous unit number
  if (candidates.length === 0 && vehNumStr && byPrevUnit.has(vehNumStr)) {
    candidates = byPrevUnit.get(vehNumStr);
    matchMethod = "prev_unit";
  }

  // narrow by year/model if multiple
  let match = null;
  if (candidates.length === 1) {
    match = candidates[0];
  } else if (candidates.length > 1 && year2 !== null && model) {
    const fullYear = 2000 + Number(year2);
    const modelUp = String(model).toUpperCase();
    const narrowed = candidates.filter(
      (c) =>
        (c.year === fullYear || c.year === Number(year2)) &&
        (c.model || "").toUpperCase().includes(modelUp.slice(0, 4))
    );
    if (narrowed.length === 1) match = narrowed[0];
    else if (narrowed.length > 0) match = narrowed[0];
    else match = candidates[0];
  } else if (candidates.length > 1) {
    match = candidates[0];
  }

  if (match) {
    if (matchMethod === "plate") matchByPlate++;
    else if (matchMethod === "name") matchByNameNumeric++;
    else if (matchMethod === "prev_unit") matchByPrevUnit++;

    matches.push({
      sheet_veh_number: vehNumStr,
      sheet_plate: plateStr,
      sheet_year: year2 !== null ? 2000 + Number(year2) : null,
      sheet_class: cls,
      sheet_model: model,
      sheet_status: status,
      sheet_sale_date: saleDate ? new Date(saleDate).toISOString().slice(0, 10) : null,
      sheet_fleet_days: fleetDays,
      sheet_rental_dbr_days: rentalDbr,
      sheet_total_rev: totalRev,
      match_method: matchMethod,
      match_ambiguous: candidates.length > 1,
      fleetio_id: match.id,
      fleetio_name: match.name,
      fleetio_vin: match.vin,
      fleetio_plate: match.license_plate,
      fleetio_year: match.year,
      fleetio_make: match.make,
      fleetio_model: match.model,
      fleetio_group_name: match.group_name,
      fleetio_vehicle_type: match.vehicle_type_name,
      fleetio_status: match.vehicle_status_name,
      fleetio_archived: match._archived ? true : match.archived_at != null,
      fleetio_odometer: match.primary_meter_value,
    });
  } else {
    unmatched++;
    matches.push({
      sheet_veh_number: vehNumStr,
      sheet_plate: plateStr,
      sheet_year: year2 !== null ? 2000 + Number(year2) : null,
      sheet_class: cls,
      sheet_model: model,
      sheet_status: status,
      sheet_sale_date: saleDate ? new Date(saleDate).toISOString().slice(0, 10) : null,
      sheet_fleet_days: fleetDays,
      sheet_rental_dbr_days: rentalDbr,
      sheet_total_rev: totalRev,
      match_method: null,
      match_ambiguous: false,
      fleetio_id: null,
      fleetio_name: null,
      fleetio_vin: null,
      fleetio_plate: null,
      fleetio_year: null,
      fleetio_make: null,
      fleetio_model: null,
      fleetio_group_name: null,
      fleetio_vehicle_type: null,
      fleetio_status: null,
      fleetio_archived: null,
      fleetio_odometer: null,
    });
  }
}

// --- step 6: write outputs ---
const matchedIds = new Set(matches.filter((m) => m.fleetio_id).map((m) => m.fleetio_id));
const fleetioOnly = allVehicles.filter((v) => !matchedIds.has(v.id));

const csvCols = Object.keys(matches[0]);
const csvRows = [csvCols.join(",")].concat(
  matches.map((m) =>
    csvCols
      .map((c) => {
        const v = m[c];
        if (v === null || v === undefined) return "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      })
      .join(",")
  )
);
fs.writeFileSync(OUT_CSV, csvRows.join("\n"));
fs.writeFileSync(
  OUT_JSON,
  JSON.stringify(
    {
      summary: {
        spreadsheet_rows: sheetRows.length,
        fleetio_vehicles_total: allVehicles.length,
        matched_total: matches.filter((m) => m.fleetio_id).length,
        unmatched_spreadsheet_rows: unmatched,
        fleetio_vehicles_not_in_spreadsheet: fleetioOnly.length,
        match_by_method: {
          plate: matchByPlate,
          name_numeric: matchByNameNumeric,
          prev_unit: matchByPrevUnit,
        },
      },
      fleetio_only_sample: fleetioOnly.slice(0, 30).map((v) => ({
        id: v.id,
        name: v.name,
        vin: v.vin,
        plate: v.license_plate,
        year: v.year,
        make: v.make,
        model: v.model,
        group: v.group_name,
        type: v.vehicle_type_name,
        status: v.vehicle_status_name,
      })),
    },
    null,
    2
  )
);

console.log("\n=== MATCH SUMMARY ===");
console.log(`Spreadsheet rows:              ${sheetRows.length}`);
console.log(`Fleetio vehicles total:        ${allVehicles.length}`);
console.log(`Matched:                       ${matches.filter((m) => m.fleetio_id).length}`);
console.log(`  via license plate:           ${matchByPlate}`);
console.log(`  via name/unit_number:        ${matchByNameNumeric}`);
console.log(`  via previous_unit_number:    ${matchByPrevUnit}`);
console.log(`Unmatched spreadsheet rows:    ${unmatched}`);
console.log(`Fleetio not in spreadsheet:    ${fleetioOnly.length}`);
console.log(`\nOutputs:\n  ${OUT_CSV}\n  ${OUT_JSON}`);

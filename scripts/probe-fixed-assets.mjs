// Probe CloseBook's fixed_assets register to understand how much data we
// have for the real linking chain: spreadsheet Veh_number -> asset_tag ->
// vin -> Fleetio.vin. Read-only queries via Supabase service-role key.
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

const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !KEY) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}

const supabaseHeaders = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "count=exact",
};

async function sb(path, params = {}) {
  const u = new URL(`${SB_URL}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: supabaseHeaders });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${u.pathname} → ${r.status}: ${text}`);
  }
  const count = r.headers.get("content-range")?.split("/")[1] || null;
  const data = await r.json();
  return { data, count: count ? parseInt(count) : data.length };
}

// Pull paginated
async function sbAll(tbl, select = "*") {
  const batch = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const u = new URL(`${SB_URL}/rest/v1/${tbl}`);
    u.searchParams.set("select", select);
    u.searchParams.set("limit", String(batch));
    u.searchParams.set("offset", String(offset));
    const r = await fetch(u, { headers: supabaseHeaders });
    if (!r.ok) throw new Error(`${u.pathname} → ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    all.push(...rows);
    if (rows.length < batch) break;
    offset += batch;
  }
  return all;
}

console.log("Probing fixed_assets...");
const all = await sbAll(
  "fixed_assets",
  "id,entity_id,asset_tag,vehicle_year,vehicle_make,vehicle_model,vin,license_plate,vehicle_class,status,disposed_date,in_service_date"
);

console.log("\n=== fixed_assets summary ===");
console.log("Total rows:", all.length);

const active = all.filter((a) => a.status !== "disposed");
const disposed = all.filter((a) => a.status === "disposed");
console.log("Active:", active.length);
console.log("Disposed:", disposed.length);

const withTag = all.filter((a) => a.asset_tag && String(a.asset_tag).trim());
const withVin = all.filter((a) => a.vin && String(a.vin).trim());
const withPlate = all.filter((a) => a.license_plate && String(a.license_plate).trim());
const withClass = all.filter((a) => a.vehicle_class && String(a.vehicle_class).trim());
console.log("\nFIELD COVERAGE:");
console.log(`  asset_tag populated:     ${withTag.length} (${Math.round(withTag.length/all.length*100)}%)`);
console.log(`  vin populated:           ${withVin.length} (${Math.round(withVin.length/all.length*100)}%)`);
console.log(`  license_plate populated: ${withPlate.length} (${Math.round(withPlate.length/all.length*100)}%)`);
console.log(`  vehicle_class populated: ${withClass.length} (${Math.round(withClass.length/all.length*100)}%)`);

const tagSample = withTag.slice(0, 10).map((a) => String(a.asset_tag));
console.log("\nasset_tag samples (first 10):", tagSample);

// How many asset_tags are numeric-looking?
const numericTags = withTag.filter((a) => /^\d{5,7}$/.test(String(a.asset_tag).trim()));
console.log(`numeric asset_tags (5-7 digits): ${numericTags.length}`);

// Load the spreadsheet and attempt the REAL match via asset_tag
const wb = XLSX.readFile(path.join(ROOT, "Jan 2026 utilization data.xlsx"), { cellDates: true });
const sheet = wb.Sheets["JAN 2026 (2)"];
const rows = XLSX.utils
  .sheet_to_json(sheet, { header: 1, defval: null })
  .slice(1)
  .filter((r) => r && r.some((c) => c !== null));

const tagIndex = new Map();
for (const a of all) {
  const t = String(a.asset_tag || "").trim().toUpperCase();
  if (t) {
    if (!tagIndex.has(t)) tagIndex.set(t, []);
    tagIndex.get(t).push(a);
  }
}

let matched = 0;
let matchedWithVin = 0;
let ambiguous = 0;
const unmatched = [];
for (const r of rows) {
  const veh = r[0];
  if (veh === null || veh === undefined) continue;
  const key = String(veh).trim().toUpperCase();
  const hits = tagIndex.get(key) || [];
  if (hits.length === 1) {
    matched++;
    if (hits[0].vin) matchedWithVin++;
  } else if (hits.length > 1) {
    ambiguous++;
  } else {
    unmatched.push({ veh: key, year: r[3], cls: r[4], model: r[5], plate: r[1] });
  }
}

console.log(`\n=== Spreadsheet → fixed_assets.asset_tag MATCH ===`);
console.log(`Spreadsheet rows:             ${rows.length}`);
console.log(`Matched to 1 asset:           ${matched}`);
console.log(`  with VIN populated:         ${matchedWithVin} (${Math.round(matchedWithVin/matched*100)}%) — can auto-link to Fleetio`);
console.log(`Ambiguous (>1 asset):         ${ambiguous}`);
console.log(`Unmatched:                    ${unmatched.length}`);
if (unmatched.length) {
  console.log("\nUnmatched sheet rows (first 15):");
  unmatched.slice(0, 15).forEach((u) => console.log(" ", u));
}

// Now: of the VIN-populated asset_tag matches, how many also match Fleetio VIN?
// Load Fleetio vehicles from the prior run if cached; otherwise pull fresh.
const fleetioCache = path.join(ROOT, "scripts", ".fleetio-vehicles-cache.json");
let fleetioVehicles;
if (fs.existsSync(fleetioCache)) {
  fleetioVehicles = JSON.parse(fs.readFileSync(fleetioCache, "utf8"));
  console.log(`\nUsing cached Fleetio vehicles: ${fleetioVehicles.length}`);
} else {
  console.log("\nFetching Fleetio vehicles (fresh)...");
  const fleetioHeaders = {
    Authorization: `Token ${env.FLEETIO_API_KEY}`,
    "Account-Token": env.FLEETIO_ACCOUNT_TOKEN,
    "X-Api-Version": env.FLEETIO_API_VERSION,
    Accept: "application/json",
  };
  fleetioVehicles = [];
  let cursor = null;
  while (true) {
    const u = new URL(`${env.FLEETIO_BASE_URL || "https://secure.fleetio.com/api"}/v1/vehicles`);
    u.searchParams.set("per_page", "100");
    if (cursor) u.searchParams.set("start_cursor", cursor);
    const r = await fetch(u, { headers: fleetioHeaders });
    if (!r.ok) throw new Error("fleetio " + r.status);
    const j = await r.json();
    fleetioVehicles.push(...j.records);
    if (!j.next_cursor || j.records.length === 0) break;
    cursor = j.next_cursor;
    await new Promise((r) => setTimeout(r, 250));
  }
  fs.writeFileSync(fleetioCache, JSON.stringify(fleetioVehicles));
  console.log(`  pulled ${fleetioVehicles.length}`);
}

const fleetioByVin = new Map();
for (const v of fleetioVehicles) {
  if (v.vin) {
    const k = String(v.vin).toUpperCase().replace(/\s/g, "");
    if (!fleetioByVin.has(k)) fleetioByVin.set(k, []);
    fleetioByVin.get(k).push(v);
  }
}

const assetsWithBothTagAndVin = all.filter(
  (a) => a.asset_tag && a.vin && String(a.asset_tag).trim() && String(a.vin).trim()
);
let vinMatchToFleetio = 0;
let vinNotInFleetio = 0;
for (const a of assetsWithBothTagAndVin) {
  const k = String(a.vin).toUpperCase().replace(/\s/g, "");
  if (fleetioByVin.has(k)) vinMatchToFleetio++;
  else vinNotInFleetio++;
}

console.log(`\n=== fixed_assets.vin → Fleetio.vin MATCH ===`);
console.log(`fixed_assets with both asset_tag AND vin: ${assetsWithBothTagAndVin.length}`);
console.log(`  matched to Fleetio by VIN:              ${vinMatchToFleetio}`);
console.log(`  NOT in Fleetio:                         ${vinNotInFleetio}`);

// Full chain: spreadsheet Veh_number -> fixed_assets -> Fleetio
let fullChain = 0;
let partialSheetToAsset = 0;
let partialAssetNoVin = 0;
for (const r of rows) {
  const veh = r[0];
  if (veh === null || veh === undefined) continue;
  const key = String(veh).trim().toUpperCase();
  const hits = tagIndex.get(key) || [];
  if (hits.length >= 1) {
    partialSheetToAsset++;
    const asset = hits[0];
    if (!asset.vin) {
      partialAssetNoVin++;
      continue;
    }
    const vk = String(asset.vin).toUpperCase().replace(/\s/g, "");
    if (fleetioByVin.has(vk)) fullChain++;
  }
}

console.log(`\n=== FULL CHAIN: Spreadsheet -> fixed_assets -> Fleetio ===`);
console.log(`Sheet -> fixed_assets matched:  ${partialSheetToAsset} / ${rows.length}`);
console.log(`  of which no VIN in asset:     ${partialAssetNoVin}`);
console.log(`Sheet -> asset -> Fleetio VIN:  ${fullChain}`);

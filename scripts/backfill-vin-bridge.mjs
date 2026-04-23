// Backfill the VIN bridge + auto-link fixed_assets.fleetio_vehicle_id.
//
// Prerequisites:
//   1. Migration 20260422_rental_asset_dashboard.sql has been applied.
//   2. .env.local has NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      FLEETIO_API_KEY, FLEETIO_ACCOUNT_TOKEN.
//
// Steps:
//   1. Read "C:/Users/JDBusfield/Downloads/vtmp (79).xlsx" (Insurance Fleet Report)
//   2. Upsert each row into rental_asset_vin_bridge (organization-scoped)
//   3. Pull Fleetio vehicles (cached if available) and build VIN→fleetio_id map
//   4. For every fixed_assets row with a VIN, set fleetio_vehicle_id where a
//      Fleetio record exists. Also cache fleetio_group_name.
//   5. Print a reconciliation summary.
//
// Re-runnable. Idempotent. No writes to Fleetio.
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
if (!SB || !KEY) throw new Error("Missing Supabase env");

const hdr = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

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
  if (!rows.length) return { data: [] };
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const u = new URL(`${SB}/rest/v1/${tbl}`);
    if (onConflict) u.searchParams.set("on_conflict", onConflict);
    u.searchParams.set("select", "id");
    const r = await fetch(u, {
      method: "POST",
      headers: {
        ...hdr,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(part),
    });
    if (!r.ok) {
      throw new Error(`UPSERT ${tbl}: ${r.status} ${await r.text()}`);
    }
  }
}

async function sbUpdate(tbl, id, patch) {
  const u = new URL(`${SB}/rest/v1/${tbl}`);
  u.searchParams.set("id", `eq.${id}`);
  const r = await fetch(u, {
    method: "PATCH",
    headers: { ...hdr, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`PATCH ${tbl}: ${r.status} ${await r.text()}`);
}

// ─── step 1: organizations ───
const orgs = await sbGet("organizations", "id,name");
if (orgs.length !== 1) {
  console.log("Organizations found:", orgs);
  console.log("Script assumes a single org. Set ORG_ID env var to pick one.");
}
const ORG_ID = process.env.ORG_ID || orgs[0].id;
console.log(`Using organization: ${orgs.find((o) => o.id === ORG_ID)?.name} (${ORG_ID})`);

// ─── step 2: read Insurance Fleet Report ───
const bridgeFile = "C:/Users/JDBusfield/Downloads/vtmp (79).xlsx";
const wb = XLSX.readFile(bridgeFile, { cellDates: true });
const sheet = wb.Sheets["Insurance Fleet Report"];
const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
const rows = raw.slice(3).filter((r) => r && r[0]);
console.log(`Insurance Fleet Report rows: ${rows.length}`);

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

const bridgeRows = rows
  .filter((r) => r[0] && r[1])
  .map((r) => ({
    organization_id: ORG_ID,
    veh_number: String(r[0]).trim().toUpperCase(),
    vin: String(r[1]).trim().toUpperCase(),
    create_date: toIsoDate(r[2]),
    current_location: r[3] ? String(r[3]).trim() : null,
    make: r[4] ? String(r[4]).trim() : null,
    model: r[5] ? String(r[5]).trim() : null,
    sale_date: toIsoDate(r[6]),
    status_code: r[7] ? String(r[7]).trim() : null,
    last_ra_number: r[8] ? String(r[8]).trim() : null,
    source_filename: path.basename(bridgeFile),
  }));

console.log(`Upserting ${bridgeRows.length} VIN bridge rows...`);
await sbUpsert(
  "rental_asset_vin_bridge",
  bridgeRows,
  "organization_id,veh_number"
);

// ─── step 3: build Fleetio VIN → {id, group_name} map ───
const fleetioCache = path.join(ROOT, "scripts", ".fleetio-vehicles-cache.json");
if (!fs.existsSync(fleetioCache)) {
  throw new Error(
    "Run scripts/match-with-vin-bridge.mjs or scripts/probe-fixed-assets.mjs first to populate .fleetio-vehicles-cache.json"
  );
}
const fleetioVehicles = JSON.parse(fs.readFileSync(fleetioCache, "utf8"));
const fleetioByVin = new Map();
for (const v of fleetioVehicles) {
  if (!v.vin) continue;
  fleetioByVin.set(String(v.vin).trim().toUpperCase(), v);
}
console.log(`Fleetio vehicles: ${fleetioVehicles.length}, with VIN: ${fleetioByVin.size}`);

// ─── step 4: link fixed_assets ───
const assets = await sbGet(
  "fixed_assets",
  "id,asset_tag,vin,fleetio_vehicle_id,fleetio_group_name,status,disposed_date"
);

// Group closebook assets by VIN so we can detect same-VIN duplicates (same
// physical vehicle held across two entities — e.g., NCNT Holdings and Two
// Family Enterprises). Per user's rule, pick ONE asset to own the Fleetio
// link: prefer active over disposed, then prefer the one already linked.
function pickPrimary(rows) {
  const sorted = [...rows].sort((a, b) => {
    const aActive = a.status !== "disposed" ? 0 : 1;
    const bActive = b.status !== "disposed" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const aLinked = a.fleetio_vehicle_id != null ? 0 : 1;
    const bLinked = b.fleetio_vehicle_id != null ? 0 : 1;
    if (aLinked !== bLinked) return aLinked - bLinked;
    return a.id.localeCompare(b.id);
  });
  return sorted[0];
}

const assetsByVin = new Map();
for (const a of assets) {
  if (!a.vin) continue;
  const vin = String(a.vin).trim().toUpperCase();
  if (!assetsByVin.has(vin)) assetsByVin.set(vin, []);
  assetsByVin.get(vin).push(a);
}

// Plan every update up-front. Apply clears first so we don't trip the unique
// constraint when two rows share the same Fleetio id.
const toClear = [];
const toSet = [];
let alreadyLinked = 0;
let notInFleetio = 0;
let noVin = 0;

for (const a of assets) {
  if (!a.vin) {
    noVin++;
    if (a.fleetio_vehicle_id != null) toClear.push(a);
    continue;
  }
  const vin = String(a.vin).trim().toUpperCase();
  const fleetioVeh = fleetioByVin.get(vin);

  const siblings = assetsByVin.get(vin) || [a];
  const winner = pickPrimary(siblings);
  const isWinner = winner.id === a.id;

  if (!fleetioVeh) {
    if (a.fleetio_vehicle_id != null) toClear.push(a);
    notInFleetio++;
    continue;
  }

  if (!isWinner) {
    if (a.fleetio_vehicle_id != null) toClear.push(a);
    continue;
  }

  const needsLink = a.fleetio_vehicle_id !== fleetioVeh.id;
  const needsGroup = a.fleetio_group_name !== (fleetioVeh.group_name ?? null);
  if (needsLink || needsGroup) {
    toSet.push({ asset: a, target: fleetioVeh });
  } else {
    alreadyLinked++;
  }
}

console.log(
  `Plan: clear ${toClear.length}, link/update ${toSet.length}, already OK ${alreadyLinked}`
);

for (const a of toClear) {
  await sbUpdate("fixed_assets", a.id, {
    fleetio_vehicle_id: null,
    fleetio_group_name: null,
  });
}

let linked = 0;
let changed = 0;
let clearedDuplicate = toClear.length;

for (const { asset: a, target } of toSet) {
  await sbUpdate("fixed_assets", a.id, {
    fleetio_vehicle_id: target.id,
    fleetio_group_name: target.group_name ?? null,
    fleetio_last_synced_at: new Date().toISOString(),
  });
  if (a.fleetio_vehicle_id == null) linked++;
  else changed++;
}

console.log("\n=== fixed_assets → Fleetio linking ===");
console.log(`Assets total:                 ${assets.length}`);
console.log(`  already linked (no change): ${alreadyLinked}`);
console.log(`  newly linked:               ${linked}`);
console.log(`  link updated (drift):       ${changed}`);
console.log(`  cleared (dup-VIN / stale):  ${clearedDuplicate}`);
console.log(`  VIN not in Fleetio:         ${notInFleetio}`);
console.log(`  no VIN on asset:            ${noVin}`);

// ─── step 5: reconciliation summary ───
const finalLinked = await sbGet(
  "fixed_assets",
  "id,asset_tag,vin,fleetio_vehicle_id",
  "fleetio_vehicle_id=not.is.null"
);
console.log(`\nTotal fixed_assets linked to Fleetio: ${finalLinked.length}`);

console.log("\nDone. Next: node scripts/ingest-kpis.mjs <file.xlsx>");

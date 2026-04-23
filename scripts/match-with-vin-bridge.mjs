// Final match: use the Insurance Fleet Report as the Veh_number → VIN bridge.
// Chain: Sheet.Veh_number → Bridge.VIN → closebook.fixed_assets.vin → Fleetio.vin.
// For ambiguous closebook tags, collapse duplicates into one logical asset
// (sum their maintenance/util/revenue downstream).
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

// --- load utilization spreadsheet ---
const utilWb = XLSX.readFile(path.join(ROOT, "Jan 2026 utilization data.xlsx"), {
  cellDates: true,
});
const utilRows = XLSX.utils
  .sheet_to_json(utilWb.Sheets["JAN 2026 (2)"], { header: 1, defval: null })
  .slice(1)
  .filter((r) => r && r.some((c) => c !== null));
console.log(`Utilization sheet rows: ${utilRows.length}`);

// --- load VIN bridge (Insurance Fleet Report) ---
const bridgeWb = XLSX.readFile("C:/Users/JDBusfield/Downloads/vtmp (79).xlsx");
const bridgeRows = XLSX.utils
  .sheet_to_json(bridgeWb.Sheets["Insurance Fleet Report"], {
    header: 1,
    defval: null,
  })
  .slice(3) // row 0-2 are title + header
  .filter((r) => r && r[0]);
console.log(`Bridge rows: ${bridgeRows.length}`);

// Build VEH NO → VIN map
const vehToVin = new Map();
for (const r of bridgeRows) {
  const veh = String(r[0] || "").trim().toUpperCase();
  const vin = String(r[1] || "").trim().toUpperCase();
  if (veh && vin) vehToVin.set(veh, vin);
}
console.log(`Bridge entries with VIN: ${vehToVin.size}`);

// --- load closebook fixed_assets ---
const sbHeaders = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
};
async function fetchAll(tbl, select = "*") {
  const batch = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const u = new URL(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${tbl}`);
    u.searchParams.set("select", select);
    u.searchParams.set("limit", String(batch));
    u.searchParams.set("offset", String(offset));
    const r = await fetch(u, { headers: sbHeaders });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    const rows = await r.json();
    all.push(...rows);
    if (rows.length < batch) break;
    offset += batch;
  }
  return all;
}

const assets = await fetchAll(
  "fixed_assets",
  "id,entity_id,asset_tag,vehicle_year,vehicle_make,vehicle_model,vin,vehicle_class,status,disposed_date"
);
const entities = await fetchAll("entities", "id,name");
const entityMap = new Map(entities.map((e) => [e.id, e.name]));
console.log(`closebook assets: ${assets.length}, entities: ${entities.length}`);

const closebookByTag = new Map();
const closebookByVin = new Map();
for (const a of assets) {
  const t = String(a.asset_tag || "").trim().toUpperCase();
  if (t) {
    if (!closebookByTag.has(t)) closebookByTag.set(t, []);
    closebookByTag.get(t).push(a);
  }
  const v = String(a.vin || "").trim().toUpperCase();
  if (v) {
    if (!closebookByVin.has(v)) closebookByVin.set(v, []);
    closebookByVin.get(v).push(a);
  }
}

// --- load Fleetio cache ---
const fleetioCache = path.join(ROOT, "scripts", ".fleetio-vehicles-cache.json");
if (!fs.existsSync(fleetioCache)) {
  console.error("Fleetio cache missing — run probe-fixed-assets.mjs first");
  process.exit(1);
}
const fleetioVehicles = JSON.parse(fs.readFileSync(fleetioCache, "utf8"));
const fleetioByVin = new Map();
for (const v of fleetioVehicles) {
  const k = String(v.vin || "").trim().toUpperCase();
  if (k) fleetioByVin.set(k, v);
}
console.log(`Fleetio vehicles: ${fleetioVehicles.length}, with VIN: ${fleetioByVin.size}`);

// --- Apply the chain to every sheet row ---
const results = [];
const EQU_PREFIXES = /^(BATH$|EQU$|KSCF\d+$)/i;

for (const r of utilRows) {
  const veh = String(r[0] || "").trim().toUpperCase();
  if (!veh) continue;
  const plate = r[1];
  const year = r[3];
  const cls = r[4];
  const model = r[5];
  const saleDate = r[7];
  const fleetDays = r[8];
  const rentalDbr = r[9];
  const totalRev = r[11];

  const isEquipmentPool = EQU_PREFIXES.test(veh) || String(cls).toUpperCase() === "EQU";

  // Step 1: try direct closebook tag match (canonical path)
  let closebook = closebookByTag.get(veh);

  // Step 2: if not in closebook, try bridge (Sheet VEH → VIN → closebook)
  let bridgeVin = null;
  if (!closebook && !isEquipmentPool) {
    bridgeVin = vehToVin.get(veh);
    if (bridgeVin) closebook = closebookByVin.get(bridgeVin);
  }

  // Step 3: Fleetio lookup via closebook VIN (or bridge VIN if still no closebook)
  let fleetio = null;
  let chainVin = null;
  if (closebook && closebook.length > 0) {
    chainVin = closebook[0].vin;
    if (chainVin) fleetio = fleetioByVin.get(String(chainVin).toUpperCase());
  } else if (bridgeVin) {
    chainVin = bridgeVin;
    fleetio = fleetioByVin.get(bridgeVin);
  }

  // Collapse ambiguous closebook (same tag, multiple assets) into one logical
  // asset for KPI purposes. Capture how many were merged.
  const collapsedCount = closebook ? closebook.length : 0;

  results.push({
    sheet_veh_number: veh,
    sheet_plate: plate,
    sheet_year: year != null ? 2000 + Number(year) : null,
    sheet_class: cls,
    sheet_model: model,
    sheet_sale_date: saleDate ? new Date(saleDate).toISOString().slice(0, 10) : null,
    sheet_fleet_days: fleetDays,
    sheet_rental_dbr_days: rentalDbr,
    sheet_total_rev: totalRev,
    is_equipment_pool: isEquipmentPool,
    closebook_matched: closebook != null && closebook.length > 0,
    closebook_count: collapsedCount,
    closebook_collapsed: collapsedCount > 1,
    closebook_path: closebook ? (bridgeVin ? "via_bridge_vin" : "direct_tag") : null,
    closebook_entities: closebook
      ? [...new Set(closebook.map((a) => entityMap.get(a.entity_id) || "?"))].join(" + ")
      : null,
    closebook_primary_id: closebook?.[0]?.id || null,
    closebook_tag: closebook?.[0]?.asset_tag || null,
    chain_vin: chainVin || null,
    bridge_vin: bridgeVin || null,
    fleetio_matched: fleetio != null,
    fleetio_id: fleetio?.id || null,
    fleetio_status: fleetio?.vehicle_status_name || null,
  });
}

// --- Summary ---
const total = results.length;
const totalReal = results.filter((r) => !r.is_equipment_pool).length;
const closebookDirect = results.filter((r) => r.closebook_matched && r.closebook_path === "direct_tag").length;
const closebookBridge = results.filter((r) => r.closebook_matched && r.closebook_path === "via_bridge_vin").length;
const closebookTotal = results.filter((r) => r.closebook_matched).length;
const closebookCollapsed = results.filter((r) => r.closebook_collapsed).length;
const fleetioTotal = results.filter((r) => r.fleetio_matched).length;
const equipment = results.filter((r) => r.is_equipment_pool).length;
const unmatched = results.filter((r) => !r.closebook_matched && !r.is_equipment_pool);

console.log(`\n=== FINAL CHAIN RECONCILIATION ===`);
console.log(`Total sheet rows:              ${total}`);
console.log(`  equipment pool (ignore):     ${equipment}`);
console.log(`  real individual assets:      ${totalReal}`);
console.log(`\nSheet → closebook matched:    ${closebookTotal} / ${totalReal} (${Math.round(closebookTotal/totalReal*100)}%)`);
console.log(`  direct asset_tag:            ${closebookDirect}`);
console.log(`  via bridge VIN:              ${closebookBridge}`);
console.log(`  tags with >1 closebook row:  ${closebookCollapsed} (collapsed per user rule)`);
console.log(`\nClosebook → Fleetio matched:  ${fleetioTotal} / ${closebookTotal} (${Math.round(fleetioTotal/closebookTotal*100)}%)`);
console.log(`\nSTILL UNMATCHED (real assets): ${unmatched.length}`);

if (unmatched.length) {
  console.log("\nStill-unmatched rows:");
  unmatched.forEach((u) =>
    console.log(
      `  ${u.sheet_veh_number.padEnd(10)} ${String(u.sheet_year||'').padEnd(5)} cls=${u.sheet_class} model=${u.sheet_model} plate=${u.sheet_plate}  bridge_vin=${u.bridge_vin || '—'}`
    )
  );
}

// breakdown of bridge hits
const viaBridgeList = results.filter((r) => r.closebook_path === "via_bridge_vin");
console.log(`\nSample rows rescued by bridge (${viaBridgeList.length} total, showing first 10):`);
viaBridgeList.slice(0, 10).forEach((r) =>
  console.log(
    `  sheet ${r.sheet_veh_number.padEnd(8)} → bridge VIN ${r.bridge_vin} → closebook tag ${r.closebook_tag} entity ${r.closebook_entities}`
  )
);

// Save CSV
const csvCols = Object.keys(results[0]);
const csvLines = [csvCols.join(",")].concat(
  results.map((row) =>
    csvCols
      .map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      })
      .join(",")
  )
);
fs.writeFileSync(path.join(ROOT, "scripts", "match-report-v2.csv"), csvLines.join("\n"));
console.log(`\nFull CSV: scripts/match-report-v2.csv`);

// Breakdown of closebook-collapsed (ambiguous tags)
const collapsed = results.filter((r) => r.closebook_collapsed);
if (collapsed.length) {
  console.log(`\n=== COLLAPSED (same closebook tag, multiple assets) ===`);
  collapsed.forEach((r) =>
    console.log(
      `  sheet ${r.sheet_veh_number} → ${r.closebook_count} closebook rows in ${r.closebook_entities}`
    )
  );
}

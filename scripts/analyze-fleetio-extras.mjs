// Follow-up analysis of the 223 Fleetio vehicles that didn't match the
// January 2026 utilization spreadsheet. Segments them by status / group /
// type to help us understand which are service vehicles vs post-January
// additions vs archived/sold.
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

const headers = {
  Authorization: `Token ${env.FLEETIO_API_KEY}`,
  "Account-Token": env.FLEETIO_ACCOUNT_TOKEN,
  "X-Api-Version": env.FLEETIO_API_VERSION || "2025-05-05",
  Accept: "application/json",
};

async function get(url) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json();
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Pull all vehicles again
const vehicles = [];
let cursor = null;
while (true) {
  const url = new URL(`${env.FLEETIO_BASE_URL || "https://secure.fleetio.com/api"}/v1/vehicles`);
  url.searchParams.set("per_page", "100");
  if (cursor) url.searchParams.set("start_cursor", cursor);
  const j = await get(url.toString());
  vehicles.push(...j.records);
  if (!j.next_cursor || j.records.length === 0) break;
  cursor = j.next_cursor;
  await sleep(250);
}
console.log("Fleetio vehicles:", vehicles.length);

// Load matched IDs
const report = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts", "match-report.json"), "utf8")
);

const csv = fs.readFileSync(path.join(ROOT, "scripts", "match-report.csv"), "utf8");
const csvLines = csv.split("\n");
const csvHeader = csvLines[0].split(",");
const fleetioIdIdx = csvHeader.indexOf("fleetio_id");
const matchedIds = new Set(
  csvLines
    .slice(1)
    .map((l) => l.split(",")[fleetioIdIdx])
    .filter(Boolean)
    .map(Number)
);

const notInSheet = vehicles.filter((v) => !matchedIds.has(v.id));
console.log("Fleetio vehicles NOT in spreadsheet:", notInSheet.length);

// By status
const byStatus = {};
for (const v of notInSheet) {
  const s = v.vehicle_status_name || "(null)";
  byStatus[s] = (byStatus[s] || 0) + 1;
}
console.log("\nBy vehicle_status_name:");
for (const [k, c] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${c}`);
}

// By group
const byGroup = {};
for (const v of notInSheet) {
  const g = v.group_name || "(null)";
  byGroup[g] = (byGroup[g] || 0) + 1;
}
console.log("\nBy group_name:");
for (const [k, c] of Object.entries(byGroup).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${c}`);
}

// By ownership
const byOwnership = {};
for (const v of notInSheet) {
  const o = v.ownership || "(null)";
  byOwnership[o] = (byOwnership[o] || 0) + 1;
}
console.log("\nBy ownership:");
for (const [k, c] of Object.entries(byOwnership).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${c}`);
}

// By vehicle_type_name (class)
const byType = {};
for (const v of notInSheet) {
  const t = v.vehicle_type_name || "(null)";
  byType[t] = (byType[t] || 0) + 1;
}
console.log("\nBy vehicle_type_name (class):");
for (const [k, c] of Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${k}: ${c}`);
}

// Created after 2026-02-01?
const afterFeb = notInSheet.filter((v) => v.created_at > "2026-02-01");
console.log(`\nCreated after 2026-02-01 (post-January adds): ${afterFeb.length}`);

// Samples segmented
console.log("\n--- Non-Fleet Asset sample (first 10) ---");
notInSheet
  .filter((v) => v.vehicle_status_name === "Non-Fleet Asset")
  .slice(0, 10)
  .forEach((v) =>
    console.log(
      `  ${v.name} | ${v.year} ${v.make} ${v.model} | type ${v.vehicle_type_name} | plate ${v.license_plate} | group ${v.group_name} | created ${v.created_at?.slice(0, 10)}`
    )
  );

console.log("\n--- Available sample (first 10) ---");
notInSheet
  .filter((v) => v.vehicle_status_name === "Available")
  .slice(0, 10)
  .forEach((v) =>
    console.log(
      `  ${v.name} | ${v.year} ${v.make} ${v.model} | type ${v.vehicle_type_name} | plate ${v.license_plate} | group ${v.group_name} | created ${v.created_at?.slice(0, 10)}`
    )
  );

console.log("\n--- For Sale sample (first 10) ---");
notInSheet
  .filter((v) => v.vehicle_status_name === "For Sale")
  .slice(0, 10)
  .forEach((v) =>
    console.log(
      `  ${v.name} | ${v.year} ${v.make} ${v.model} | type ${v.vehicle_type_name} | plate ${v.license_plate} | group ${v.group_name} | created ${v.created_at?.slice(0, 10)}`
    )
  );

// Check for PML006 specifically (one unmatched sheet row)
console.log("\n--- Searching Fleetio for PML006 ---");
const pml = vehicles.filter((v) => /pml006/i.test(v.name || "") || /pml006/i.test(v.external_ids?.unit_number || ""));
pml.forEach((v) =>
  console.log(
    `  id=${v.id} | ${v.name} | ${v.year} ${v.make} ${v.model} | VIN ${v.vin} | plate ${v.license_plate} | status ${v.vehicle_status_name} | matched=${matchedIds.has(v.id)}`
  )
);

// Status-code decoder hint: pair Fleetio status with the S-code from spreadsheet
console.log("\n--- Status pairing attempt (sheet_status → fleetio_status) ---");
const pairs = {};
csvLines.slice(1).forEach((line) => {
  const cols = line.split(",");
  const sheetStatus = cols[csvHeader.indexOf("sheet_status")];
  const fleetioStatus = cols[csvHeader.indexOf("fleetio_status")];
  if (!sheetStatus || !fleetioStatus) return;
  const key = `${sheetStatus}`;
  if (!pairs[key]) pairs[key] = {};
  pairs[key][fleetioStatus] = (pairs[key][fleetioStatus] || 0) + 1;
});
for (const [sheetStatus, fleetioStatuses] of Object.entries(pairs).sort()) {
  const top = Object.entries(fleetioStatuses).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  sheet '${sheetStatus}' → ${top.map(([s, c]) => `${s} (${c})`).join(", ")}`);
}

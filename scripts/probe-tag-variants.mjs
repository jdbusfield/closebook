// Investigate V-prefix + ambiguous tag collisions between the spreadsheet
// and closebook. Read-only.
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
    const r = await fetch(u, { headers });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    const rows = await r.json();
    all.push(...rows);
    if (rows.length < batch) break;
    offset += batch;
  }
  return all;
}

// pull assets + entities
const assets = await fetchAll(
  "fixed_assets",
  "id,entity_id,asset_tag,vehicle_year,vehicle_make,vehicle_model,vin,vehicle_class,status,disposed_date"
);
const entities = await fetchAll("entities", "id,name,organization_id");
const entityMap = new Map(entities.map((e) => [e.id, e]));

// group assets by tag
const byTag = new Map();
for (const a of assets) {
  const t = String(a.asset_tag || "").trim().toUpperCase();
  if (!t) continue;
  if (!byTag.has(t)) byTag.set(t, []);
  byTag.get(t).push(a);
}

// sheet
const wb = XLSX.readFile(path.join(ROOT, "Jan 2026 utilization data.xlsx"), {
  cellDates: true,
});
const sheet = wb.Sheets["JAN 2026 (2)"];
const rows = XLSX.utils
  .sheet_to_json(sheet, { header: 1, defval: null })
  .slice(1)
  .filter((r) => r && r.some((c) => c !== null));

// AMBIGUOUS tags (same tag, multiple assets)
const dupTags = [...byTag.entries()].filter(([_, a]) => a.length > 1);
console.log(`Ambiguous tags in closebook: ${dupTags.length}`);
for (const [t, arr] of dupTags.slice(0, 15)) {
  console.log(`  tag '${t}':`);
  for (const a of arr) {
    const ent = entityMap.get(a.entity_id);
    console.log(
      `    - entity ${ent?.name}, ${a.vehicle_year} ${a.vehicle_make} ${a.vehicle_model}, VIN ${a.vin}, status ${a.status}`
    );
  }
}

// For V-prefix: test stripping
console.log("\n=== V-prefix test ===");
const vPrefixRows = rows.filter((r) => /^V\d+$/.test(String(r[0] || "").trim()));
console.log(`Sheet rows with V-prefix: ${vPrefixRows.length}`);
let vMatchWithPrefix = 0;
let vMatchStripped = 0;
const stillUnmatched = [];
for (const r of vPrefixRows) {
  const full = String(r[0]).trim().toUpperCase();
  const stripped = full.replace(/^V/, "");
  if (byTag.has(full)) vMatchWithPrefix++;
  else if (byTag.has(stripped)) vMatchStripped++;
  else stillUnmatched.push({ full, stripped, year: r[3], cls: r[4], model: r[5], plate: r[1] });
}
console.log(`  match with V prefix:   ${vMatchWithPrefix}`);
console.log(`  match after strip:     ${vMatchStripped}`);
console.log(`  still unmatched:       ${stillUnmatched.length}`);
if (stillUnmatched.length) {
  console.log("\n  still-unmatched samples (first 15):");
  stillUnmatched.slice(0, 15).forEach((u) => console.log("   ", u));
}

// Try VIN-fallback match for stillUnmatched via year+model narrowing on closebook
// Not strictly necessary; just print a few closebook rows for the first few unmatched
// so we can see if they exist with a different tag
console.log("\n=== Fuzzy lookup for still-unmatched ===");
for (const u of stillUnmatched.slice(0, 5)) {
  const yearFull = 2000 + Number(u.year);
  const model = String(u.model || "").toUpperCase();
  const cands = assets.filter(
    (a) =>
      a.vehicle_year === yearFull &&
      (a.vehicle_model || "").toUpperCase().includes(model.slice(0, 4))
  );
  console.log(`\n  sheet '${u.full}' (${yearFull} ${u.model}): ${cands.length} closebook candidates`);
  cands.slice(0, 3).forEach((c) => {
    const ent = entityMap.get(c.entity_id);
    console.log(
      `    tag=${c.asset_tag} entity=${ent?.name} ${c.vehicle_year} ${c.vehicle_make} ${c.vehicle_model} VIN=${c.vin}`
    );
  });
}

// Combined strategy: exact + strip-V
let match1 = 0,
  matchV = 0,
  unmatchedFinal = 0;
const unmatchedList = [];
for (const r of rows) {
  const full = String(r[0] || "").trim().toUpperCase();
  if (!full) continue;
  if (byTag.has(full)) match1++;
  else if (/^V\d+$/.test(full) && byTag.has(full.slice(1))) matchV++;
  else {
    unmatchedFinal++;
    unmatchedList.push({ full, year: r[3], cls: r[4], model: r[5], plate: r[1] });
  }
}
console.log(`\n=== FINAL RECONCILIATION (exact + V-strip) ===`);
console.log(`Sheet rows:                   ${rows.length}`);
console.log(`Exact asset_tag match:        ${match1}`);
console.log(`V-stripped asset_tag match:   ${matchV}`);
console.log(`Unmatched:                    ${unmatchedFinal}`);
console.log(`Coverage:                     ${Math.round((match1 + matchV) / rows.length * 100)}%`);
console.log("\nFinal-unmatched rows:");
unmatchedList.forEach((u) => console.log("  ", u));

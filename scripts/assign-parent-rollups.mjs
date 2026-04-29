// Assign each TB-derived leaf master account on the Accountant chart to one
// of the FS-* parent rollup accounts.
//
// Mapping derived by reconciling the TB subtotals (scripts/tb-structure.json)
// against the line items on the draft compiled financial statements.
// Numbers tie within rounding for assets, liabilities, revenue, and expenses.
//
// Imperfect cases — flagged with WARN below:
//   - M-01 / M-02 each combine bank LOCs and related-party LOCs that the FS
//     splits onto two separate lines. We default to the notes-payable parent;
//     the user can split the master later if precise reconciliation matters.
//   - S-01 / S1-01 / S2-01 / S3-01 pool equity across 3 entities; the FS
//     breaks each entity onto its own line. Defaulted to the Two Family
//     parents; user can refine per entity.
//
// Usage:
//   node scripts/assign-parent-rollups.mjs            # dry run
//   node scripts/assign-parent-rollups.mjs --commit   # actually patches

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "..", "..", "accounting-app", ".env.local");
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
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const HDR = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};
const COMMIT = process.argv.includes("--commit");

// leaf account_number → parent account_number
const ROLLUPS = {
  // ── ASSETS ─────────────────────────────────────────────────────────
  "B-01": "FS-A-01",  // Cash
  "B-03": "FS-A-02",  // Restricted cash
  "E-01": "FS-A-03",  // AR (gross)
  "E-02": "FS-A-03",  // Allowance (contra) — both roll into AR, net
  "E2-01": "FS-A-06", // Due from related parties
  "E2-02": "FS-A-06", // Due from parent
  "E4-03": "FS-A-05", // Deferred rent receivable
  "G-01": "FS-A-04",  // Prepaid expenses
  "G-02": "FS-A-04",  // Other current assets
  "I-01": "FS-A-08",  // Equipment → property and equipment, net
  "I-02": "FS-A-07",  // Rental Vehicles → revenue generating vehicles, net
  "I-04": "FS-A-07",  // Trailer Equipment → revenue generating vehicles, net
  "I-05": "FS-A-08",  // Leasehold improvement
  "I-06": "FS-A-08",  // Software
  "I1-01": "FS-A-07", // A/D Rental → revenue generating vehicles, net (contra)
  "I1-02": "FS-A-08", // A/D Non-rental → P&E (contra)
  "I2-01": "FS-A-09", // ROU asset & A/D
  "K-01": "FS-IC-A",  // Intercompany balances → IC elimination
  "L-03": "FS-A-10",  // Other (deposits) — matches FS Deposits $759,591

  // ── LIABILITIES ────────────────────────────────────────────────────
  // WARN: M-01 mixes bank LOC ($2.32M, FS-L-05) and RP LOC ($3.65M, FS-L-07).
  //       Defaulting to FS-L-05; split the master if you want clean ties.
  "M-01": "FS-L-05",
  // WARN: M-02 mixes bank LOC ($25.5M, FS-L-09) and RP LOC ($1.25M, FS-L-11).
  //       Defaulting to FS-L-09.
  "M-02": "FS-L-09",
  "N-01": "FS-L-01",  // AP
  "O-01": "FS-L-02",  // Accrued expenses
  "O-02": "FS-L-02",  // Accrued payroll → accrued expenses
  "O-03": "FS-L-02",  // Credit Card → folded into Accrued expenses on FS
  "O-09": "FS-L-02",  // Related party accrued interest
  "O-07": "FS-L-04",  // Sales tax current
  "O-08": "FS-L-08",  // Sales tax LT
  "O1": "FS-L-13",    // Deferred sublease income
  "O2-01": "FS-L-02", // Customer deposits ($0) — folded into accrued
  "O3-01": "FS-L-06", // Lease liab current
  "O3-02": "FS-L-10", // Lease liab LT
  "O4-01": "FS-L-12", // Sublease security deposits
  "O5-01": "FS-L-03", // Due to related party
  "O5-02": "FS-L-03", // Due to parent
  "P-01": "FS-L-02",  // Income tax payable ($0) — accrued
  "P2-01": "FS-L-14", // Deferred income taxes LT

  // ── EQUITY ─────────────────────────────────────────────────────────
  // WARN: equity is broken out per entity on the FS. Our masters pool all
  // three entities together, so these defaults map every entity's portion
  // to the Two Family bucket. Refine per entity if it matters.
  "S-01": "FS-Q-01",  // Common stock
  "S1-01": "FS-Q-02", // Retained earnings
  "S2-01": "FS-Q-01", // APIC
  "S3-01": "FS-Q-02", // Distributions

  // ── REVENUE ────────────────────────────────────────────────────────
  // FS Vehicle rental revenue $10,181,986 = X-01 + X-06 - X1-01 (verified).
  "X-01": "FS-R-01",
  "X-06": "FS-R-01",  // Rental Services Revenue
  "X1-01": "FS-R-01", // Discounts (contra)
  // FS Other revenue $2,611,123 = X-02 + X-03 + X-04 + X-05 + X-08 (verified).
  "X-02": "FS-R-02",  // Customer Insurance Revenue
  "X-03": "FS-R-02",  // Parking Revenue
  "X-04": "FS-R-02",  // Loss/Damage Waiver
  "X-05": "FS-R-02",  // Fuel reimbursement
  "X-07": "FS-R-02",  // Fleet Management ($0)
  "X-08": "FS-R-02",  // Miscellaneous

  // ── EXPENSES ───────────────────────────────────────────────────────
  // FS Direct operating expenses $8,215,530 = Y001..Y007 + Y008 + Y090 (verified).
  "Y001": "FS-E-01",  // M&R
  "Y002": "FS-E-01",  // Vehicle Repairs - Body
  "Y003": "FS-E-01",  // Vehicle Depreciation
  "Y004": "FS-E-01",  // Vehicle Operating Costs
  "Y005": "FS-E-01",  // Parts & Supplies
  "Y006": "FS-E-01",  // Commissions
  "Y007": "FS-E-01",  // Direct Labor
  "Y008": "FS-E-01",  // Gain/loss from sale (offsets direct cost)
  "Y090": "FS-E-01",  // Insurance (vehicle)
  "Y080": "FS-E-01",  // Inventory change ($0)
  "Y-080": "FS-E-01", // Inventory changes ($0)

  // FS G&A expenses $8,211,699 = Y2xx + Y4xx (verified).
  "Y202": "FS-E-02",  // Sales meeting
  "Y203": "FS-E-02",  // Merchant Fees (selling)
  "Y204": "FS-E-02",  // Showroom expenses
  "Y206": "FS-E-02",  // Citation Late Fees
  "Y401": "FS-E-02",  // Auto/Trans expense
  "Y402": "FS-E-02",  // Advertising
  "Y403": "FS-E-02",  // Bad Debt Expense
  "Y404": "FS-E-02",  // Depreciation and amortization
  "Y406": "FS-E-02",  // Dues and subscriptions
  "Y407": "FS-E-02",  // Office Rent
  "Y408": "FS-E-02",  // Utilities
  "Y409": "FS-E-02",  // Employee Benefits
  "Y413": "FS-E-02",  // Administrative Salaries
  "Y415": "FS-E-02",  // Insurance expense
  "Y417": "FS-E-02",  // Office & general expense
  "Y418": "FS-E-02",  // Payroll, payroll taxes and services
  "Y419": "FS-E-02",  // Postage and mailing
  "Y420": "FS-E-02",  // Professional fees
  "Y421": "FS-E-02",  // Outside Services
  "Y422": "FS-E-02",  // Office Utilities
  "Y423": "FS-E-02",  // Repairs and maintenance
  "Y424": "FS-E-02",  // Security
  "Y426": "FS-E-02",  // Taxes and licenses
  "Y430": "FS-E-02",  // Meals and entertainment
  "Y436": "FS-E-02",  // Merchant Fees
  "Y438": "FS-E-02",  // Medical Insurance
  "Y439": "FS-E-02",  // Bank Service Charges

  // FS Other expense ($601) = Y5xx (verified).
  "Y502": "FS-E-03",
  "Y503": "FS-E-03",

  // FS Interest income / expense
  "Y601": "FS-E-04",  // Interest income
  "Y602": "FS-E-05",  // Interest expense

  // FS Income tax provision
  "Y901": "FS-E-06",
};

async function get(table, params) {
  const r = await fetch(`${SB}/rest/v1/${table}?${params}&limit=2000`, { headers: HDR });
  if (!r.ok) throw new Error(`GET ${table} ${r.status}: ${await r.text()}`);
  return r.json();
}
async function patch(table, params, body) {
  const r = await fetch(`${SB}/rest/v1/${table}?${params}`, {
    method: "PATCH",
    headers: { ...HDR, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`PATCH ${table} ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  console.log(`Mode: ${COMMIT ? "COMMIT" : "DRY RUN"}`);
  const orgs = await get("organizations", "select=id,name");
  const org = orgs[0];
  const accChart = (
    await get("master_charts", `select=id,name&organization_id=eq.${org.id}&kind=eq.accountant`)
  )[0];
  const masters = await get(
    "master_accounts",
    `select=id,account_number,name,classification,parent_account_id&chart_id=eq.${accChart.id}`,
  );
  const byNum = new Map(masters.map((m) => [m.account_number, m]));

  let assigned = 0;
  let alreadySet = 0;
  let alreadyOk = 0;
  let mismatch = 0;
  let parentMissing = 0;
  let leafMissing = 0;
  const unmappedLeaves = [];

  for (const [leafNum, parentNum] of Object.entries(ROLLUPS)) {
    const leaf = byNum.get(leafNum);
    const parent = byNum.get(parentNum);
    if (!leaf) {
      console.log(`  - leaf ${leafNum} not found in chart; skipping`);
      leafMissing++;
      continue;
    }
    if (!parent) {
      console.log(`  - parent ${parentNum} not found in chart; cannot assign ${leafNum}`);
      parentMissing++;
      continue;
    }
    if (leaf.parent_account_id === parent.id) {
      alreadyOk++;
      continue;
    }
    if (leaf.parent_account_id) {
      console.log(`  ! ${leafNum} already has a different parent; leaving it alone`);
      mismatch++;
      continue;
    }
    if (COMMIT) {
      await patch(
        "master_accounts",
        `id=eq.${leaf.id}`,
        { parent_account_id: parent.id },
      );
    }
    console.log(`  + ${leafNum.padEnd(7)} → ${parentNum.padEnd(8)} (${parent.name})`);
    assigned++;
  }

  // Find leaves that aren't in the mapping table.
  const mappedSet = new Set(Object.keys(ROLLUPS));
  for (const m of masters) {
    if (m.account_number.startsWith("FS-")) continue; // parent itself
    if (mappedSet.has(m.account_number)) continue;
    unmappedLeaves.push(m);
  }

  console.log(`\n=== RESULT ===`);
  console.log(`Assigned: ${assigned}`);
  console.log(`Already set correctly: ${alreadyOk}`);
  console.log(`Pre-existing different parent (left alone): ${mismatch}`);
  console.log(`Leaves missing in chart: ${leafMissing}`);
  console.log(`Parents missing in chart: ${parentMissing}`);
  console.log(`Leaves not in mapping table: ${unmappedLeaves.length}`);
  for (const m of unmappedLeaves.slice(0, 20)) {
    console.log(`  ? ${m.account_number}  ${m.name}  [${m.classification}]`);
  }
  if (!COMMIT) console.log("\n(re-run with --commit to actually patch)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

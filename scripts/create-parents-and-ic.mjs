// Create the parent rollup ("master-master") accounts and 4 intercompany
// elimination accounts on the Accountant chart.
//
// Parent rollups mirror the line items on the accountant's draft compiled
// financial statements (Avon - Draft Compiled Financial Statements - 2025.pdf).
// Each parent is created EMPTY — the user re-parents existing leaf accounts
// under them in the master GL UI.
//
// IC elimination accounts: one per classification (Asset, Liability, Revenue,
// Expense), tagged is_intercompany=true.
//
// Numbering avoids collision with the TB's letter codes ([B], [E], [P], etc.):
//   FS-A-##  Balance sheet asset line item
//   FS-L-##  Balance sheet liability line item
//   FS-Q-##  Balance sheet equity line item
//   FS-R-##  Income statement revenue line item
//   FS-E-##  Income statement expense / other line item
//   FS-IC-X  Intercompany elimination bucket
//
// Usage:
//   node scripts/create-parents-and-ic.mjs            # dry run
//   node scripts/create-parents-and-ic.mjs --commit   # actually inserts

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

// Parent rollups — line items from the compiled balance sheet & income
// statement. display_order chosen to match presentation order.
const ROLLUPS = [
  // === BALANCE SHEET — ASSETS ============================================
  // Current assets
  { num: "FS-A-01", name: "Cash",                                       cls: "Asset",     type: "Bank",                      order: 100 },
  { num: "FS-A-02", name: "Restricted cash",                            cls: "Asset",     type: "Other Current Asset",       order: 110 },
  { num: "FS-A-03", name: "Accounts receivable, net",                   cls: "Asset",     type: "Accounts Receivable",       order: 120 },
  { num: "FS-A-04", name: "Prepaid expenses and other current assets",  cls: "Asset",     type: "Other Current Asset",       order: 130 },
  // Non-current assets
  { num: "FS-A-05", name: "Deferred rent receivable",                   cls: "Asset",     type: "Other Asset",               order: 140 },
  { num: "FS-A-06", name: "Due from related parties",                   cls: "Asset",     type: "Other Asset",               order: 150 },
  { num: "FS-A-07", name: "Revenue generating vehicles, net",           cls: "Asset",     type: "Fixed Asset",               order: 160 },
  { num: "FS-A-08", name: "Property and equipment, net",                cls: "Asset",     type: "Fixed Asset",               order: 170 },
  { num: "FS-A-09", name: "Operating lease right-of-use assets",        cls: "Asset",     type: "Other Asset",               order: 180 },
  { num: "FS-A-10", name: "Deposits",                                   cls: "Asset",     type: "Other Asset",               order: 190 },

  // === BALANCE SHEET — LIABILITIES =======================================
  // Current liabilities
  { num: "FS-L-01", name: "Accounts payable",                                       cls: "Liability", type: "Accounts Payable",          order: 300 },
  { num: "FS-L-02", name: "Accrued expenses",                                       cls: "Liability", type: "Other Current Liability",   order: 310 },
  { num: "FS-L-03", name: "Due to related parties",                                 cls: "Liability", type: "Other Current Liability",   order: 320 },
  { num: "FS-L-04", name: "Current portion of sales tax liability",                 cls: "Liability", type: "Other Current Liability",   order: 330 },
  { num: "FS-L-05", name: "Current portion of notes payable",                       cls: "Liability", type: "Other Current Liability",   order: 340 },
  { num: "FS-L-06", name: "Current portion of operating lease liabilities",         cls: "Liability", type: "Other Current Liability",   order: 350 },
  { num: "FS-L-07", name: "Current portion of related party lines of credit",       cls: "Liability", type: "Other Current Liability",   order: 360 },
  // Non-current liabilities
  { num: "FS-L-08", name: "Sales tax liability, net of current portion",            cls: "Liability", type: "Long Term Liability",       order: 370 },
  { num: "FS-L-09", name: "Notes payable, net of current portion",                  cls: "Liability", type: "Long Term Liability",       order: 380 },
  { num: "FS-L-10", name: "Operating lease liabilities, net of current portion",    cls: "Liability", type: "Long Term Liability",       order: 390 },
  { num: "FS-L-11", name: "Related party lines of credit, net of current portion",  cls: "Liability", type: "Long Term Liability",       order: 400 },
  { num: "FS-L-12", name: "Sublease security deposits",                             cls: "Liability", type: "Long Term Liability",       order: 410 },
  { num: "FS-L-13", name: "Deferred sublease income",                               cls: "Liability", type: "Long Term Liability",       order: 420 },
  { num: "FS-L-14", name: "Deferred income taxes",                                  cls: "Liability", type: "Long Term Liability",       order: 430 },

  // === BALANCE SHEET — OWNER'S DEFICIT ===================================
  { num: "FS-Q-01", name: "Common stock - Two Family",                  cls: "Equity",    type: "Equity",                    order: 500 },
  { num: "FS-Q-02", name: "Accumulated deficit - Two Family",           cls: "Equity",    type: "Equity",                    order: 510 },
  { num: "FS-Q-03", name: "Member's deficit - Silverco",                cls: "Equity",    type: "Equity",                    order: 520 },
  { num: "FS-Q-04", name: "Member's equity - NCNT",                     cls: "Equity",    type: "Equity",                    order: 530 },

  // === INCOME STATEMENT — REVENUES =======================================
  { num: "FS-R-01", name: "Vehicle rental revenue",                     cls: "Revenue",   type: "Income",                    order: 600 },
  { num: "FS-R-02", name: "Other revenue",                              cls: "Revenue",   type: "Income",                    order: 610 },

  // === INCOME STATEMENT — OPERATING EXPENSES =============================
  { num: "FS-E-01", name: "Direct operating expenses",                  cls: "Expense",   type: "Cost of Goods Sold",        order: 700 },
  { num: "FS-E-02", name: "General and administrative expenses",        cls: "Expense",   type: "Expense",                   order: 710 },

  // === INCOME STATEMENT — INTEREST AND OTHER =============================
  { num: "FS-E-03", name: "Other expense",                              cls: "Expense",   type: "Other Expense",             order: 720 },
  { num: "FS-E-04", name: "Interest income",                            cls: "Expense",   type: "Other Expense",             order: 730 },
  { num: "FS-E-05", name: "Interest expense",                           cls: "Expense",   type: "Other Expense",             order: 740 },
  { num: "FS-E-06", name: "Income tax provision",                       cls: "Expense",   type: "Other Expense",             order: 750 },

  // === INTERCOMPANY ELIMINATIONS =========================================
  { num: "FS-IC-A", name: "Intercompany Eliminations - Asset",          cls: "Asset",     type: "Other Current Asset",       order: 900, ic: true },
  { num: "FS-IC-L", name: "Intercompany Eliminations - Liability",      cls: "Liability", type: "Other Current Liability",   order: 910, ic: true },
  { num: "FS-IC-R", name: "Intercompany Eliminations - Revenue",        cls: "Revenue",   type: "Income",                    order: 920, ic: true },
  { num: "FS-IC-E", name: "Intercompany Eliminations - Expense",        cls: "Expense",   type: "Expense",                   order: 930, ic: true },
];

function normalBalance(cls, name) {
  if (cls === "Asset") {
    if (/accumulated deficit|allowance|accumulated depreciation/i.test(name)) return "credit";
    return "debit";
  }
  if (cls === "Expense") {
    if (/income(?! tax)/i.test(name)) return "credit"; // "Interest income"
    return "debit";
  }
  if (cls === "Revenue" && /discount/i.test(name)) return "debit";
  if (cls === "Liability" || cls === "Equity" || cls === "Revenue") return "credit";
  return "debit";
}

async function sb(method, table, body) {
  const r = await fetch(`${SB}/rest/v1/${table}`, {
    method,
    headers: { ...HDR, Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function get(table, params) {
  const r = await fetch(`${SB}/rest/v1/${table}?${params}&limit=2000`, { headers: HDR });
  if (!r.ok) throw new Error(`GET ${table} ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  console.log(`Mode: ${COMMIT ? "COMMIT" : "DRY RUN"}`);

  const orgs = await get("organizations", "select=id,name");
  if (orgs.length !== 1) throw new Error(`Expected 1 org, got ${orgs.length}`);
  const org = orgs[0];
  console.log(`Organization: ${org.name}`);

  const accChart = (
    await get("master_charts", `select=id,name&organization_id=eq.${org.id}&kind=eq.accountant`)
  )[0];
  if (!accChart) throw new Error("Accountant chart not found");
  console.log(`Accountant chart: ${accChart.name}`);

  const existing = await get(
    "master_accounts",
    `select=id,account_number&chart_id=eq.${accChart.id}`
  );
  const existingByNum = new Map(existing.map((m) => [m.account_number, m.id]));
  console.log(`Existing accountant masters: ${existing.length}`);

  let created = 0;
  let skipped = 0;
  for (const acct of ROLLUPS) {
    if (existingByNum.has(acct.num)) {
      skipped++;
      continue;
    }
    const isIC = !!acct.ic;
    const payload = {
      organization_id: org.id,
      chart_id: accChart.id,
      account_number: acct.num,
      name: acct.name,
      description: isIC
        ? "Intercompany elimination bucket — post elimination amounts here on the accountant view."
        : "Financial statement line item (parent rollup) — assign accountant-chart master accounts as children to roll into this line on the accountant financials.",
      classification: acct.cls,
      account_type: acct.type,
      parent_account_id: null,
      is_active: true,
      display_order: acct.order,
      normal_balance: normalBalance(acct.cls, acct.name),
      is_intercompany: isIC,
    };
    if (COMMIT) await sb("POST", "master_accounts", payload);
    created++;
    console.log(`  + ${acct.num.padEnd(8)} ${acct.name}  [${acct.cls}]`);
  }

  console.log(`\nWould create: ${created}, skipped existing: ${skipped}`);
  if (!COMMIT) console.log("(re-run with --commit to actually insert)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

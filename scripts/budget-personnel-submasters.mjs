// Personnel Costs sub-masters on the Management chart.
//
// Creates 6110-6180 under 6100 (parent_account_id = 6100) and remaps every
// entity account currently mapped to 6100 onto the matching sub-master by
// name pattern. The statements engine rolls children into 6100, so the
// Financial Model keeps a single Personnel Costs line; budgets, drill-down and
// the Master GL page see the categories.
//
//   node scripts/budget-personnel-submasters.mjs           # dry run (prints the plan)
//   node scripts/budget-personnel-submasters.mjs --apply   # writes masters + remaps
//
// Idempotent: existing sub-masters are reused, mappings already on a
// sub-master are left alone.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const dotenv = fs.readFileSync(
  new URL("../.env.local", import.meta.url),
  "utf8",
);
for (const line of dotenv.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
}

const APPLY = process.argv.includes("--apply");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const PARENT_NUMBER = "6100";

export const SUB_MASTERS = [
  { number: "6110", name: "Wages & Salaries", order: 1 },
  { number: "6120", name: "Overtime & Premiums", order: 2 },
  { number: "6130", name: "Bonus & Commissions", order: 3 },
  { number: "6140", name: "Employer Payroll Taxes", order: 4 },
  { number: "6150", name: "Employee Benefits", order: 5 },
  { number: "6160", name: "Workers Comp", order: 6 },
  { number: "6170", name: "PTO", order: 7 },
  { number: "6180", name: "Payroll Fees & Other Personnel", order: 8 },
];

// First match wins. Patterns run against the entity account name.
const RULES = [
  ["6170", /\bPTO\b|Salaries and Wages-PTO/i],
  ["6120", /overtime|double\s*time|meal/i],
  ["6130", /bonus|commission/i],
  ["6150", /401\s*k|health|dental|vision|employee benefits|payroll benefits|medical/i],
  ["6140", /social security|medicare|unemployment|payroll tax|payroll liabilit|\bSUI\b|\bETT\b|\bFUTA\b|\bFICA\b/i],
  ["6160", /workers?\s*comp/i],
  ["6180", /payroll (service )?fees|allowance|reimbursement|contract|day labor|garnish|levy|postage|advances|outside services/i],
  ["6110", /salar|wage|regular pay|payroll|personell|personnel|fleet|sales|lot ops|administrative|officer|covid|holiday/i],
];

function classify(name) {
  for (const [number, re] of RULES) if (re.test(name ?? "")) return number;
  return null;
}

const { data: charts, error: cErr } = await supabase
  .from("master_charts")
  .select("id, organization_id, kind")
  .eq("kind", "management");
if (cErr) throw cErr;
if (!charts || charts.length !== 1) throw new Error(`expected one management chart, got ${charts?.length}`);
const chart = charts[0];

const { data: masters, error: mErr } = await supabase
  .from("master_accounts")
  .select("id, account_number, name, parent_account_id, display_order, is_active")
  .eq("chart_id", chart.id);
if (mErr) throw mErr;

const parent = masters.find((m) => m.account_number === PARENT_NUMBER);
if (!parent) throw new Error(`master ${PARENT_NUMBER} not found on the management chart`);
const byNumber = new Map(masters.map((m) => [m.account_number, m]));

// 1. Ensure sub-masters exist
const created = [];
for (const sm of SUB_MASTERS) {
  if (byNumber.has(sm.number)) continue;
  const row = {
    organization_id: chart.organization_id,
    chart_id: chart.id,
    account_number: sm.number,
    name: sm.name,
    description: `Personnel Costs detail (rolls up to ${PARENT_NUMBER})`,
    classification: "Expense",
    account_type: "Expense",
    parent_account_id: parent.id,
    is_active: true,
    display_order: (parent.display_order ?? 0) + sm.order,
    normal_balance: "debit",
  };
  created.push(row);
  if (APPLY) {
    const { data, error } = await supabase.from("master_accounts").insert(row).select("id, account_number").single();
    if (error) throw error;
    byNumber.set(sm.number, { ...row, id: data.id });
  } else {
    byNumber.set(sm.number, { ...row, id: `(new ${sm.number})` });
  }
}

// 2. Remap entity accounts sitting directly on 6100
const { data: mappings, error: mapErr } = await supabase
  .from("master_account_mappings")
  .select("id, entity_id, account_id, accounts(name, account_number, account_type), entities(code)")
  .eq("master_account_id", parent.id);
if (mapErr) throw mapErr;

const plan = [];
const unmatched = [];
for (const m of mappings) {
  const name = m.accounts?.name ?? "";
  const target = classify(name);
  if (!target) { unmatched.push(m); continue; }
  plan.push({ id: m.id, entity: m.entities?.code, number: m.accounts?.account_number, name, target, targetId: byNumber.get(target).id });
}

console.log(`Management chart ${chart.id}; parent ${PARENT_NUMBER} = ${parent.id}`);
console.log(`Sub-masters to create: ${created.length ? created.map((c) => c.account_number).join(", ") : "none (all exist)"}`);
console.log(`\nMappings on 6100: ${mappings.length}; remap plan: ${plan.length}; unmatched: ${unmatched.length}\n`);
const byTarget = {};
for (const p of plan) (byTarget[p.target] ??= []).push(p);
for (const sm of SUB_MASTERS) {
  const rows = byTarget[sm.number] ?? [];
  console.log(`${sm.number} ${sm.name} (${rows.length})`);
  for (const r of rows) console.log(`   ${r.entity}\t${r.number ?? ""}\t${r.name}`);
}
if (unmatched.length) {
  console.log("\nUNMATCHED (stay on 6100):");
  for (const m of unmatched) console.log(`   ${m.entities?.code}\t${m.accounts?.account_number ?? ""}\t${m.accounts?.name}`);
}

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to write.");
  process.exit(0);
}

let updated = 0;
for (const p of plan) {
  const { error } = await supabase
    .from("master_account_mappings")
    .update({ master_account_id: p.targetId })
    .eq("id", p.id);
  if (error) throw error;
  updated++;
}
console.log(`\nApplied: ${created.length} masters created, ${updated} mappings moved.`);

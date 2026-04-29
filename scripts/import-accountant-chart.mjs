// Import the accountant's chart of accounts and entity-account mappings into
// the closebook Accountant chart, derived from the parsed
// "Combined Working Trial Balance - 2025.xlsx" workpaper.
//
// Usage:
//   node scripts/import-accountant-chart.mjs            # dry-run, prints plan
//   node scripts/import-accountant-chart.mjs --commit   # actually inserts rows
//
// Idempotent: re-running skips master accounts that already exist (matched by
// chart_id + account_number) and mappings that already exist (matched by the
// (entity_id, account_id, chart_id) unique key, which the trigger backfills).
//
// Source: scripts/tb-structure.json (produced by parse-tb.mjs).
//
// Entity mapping from TB suffix → closebook entity name (confirmed by user):
//   -SVC  → Silverco Enterprises, LLC
//   -NCNT → NCNT Holdings, LLC
//   -2F   → Two Family Enterprises, Inc.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.resolve(ROOT, "..", "accounting-app", ".env.local");
const STRUCT_PATH = path.join(__dirname, "tb-structure.json");

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
if (!SB || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const HDR = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

const COMMIT = process.argv.includes("--commit");

const ENTITY_MAP = {
  SVC: "Silverco Enterprises, LLC",
  NCNT: "NCNT Holdings, LLC",
  "2F": "Two Family Enterprises, Inc,", // closebook has a trailing comma here, not a period
};

// account_type heuristic per accountant group letter.
// Matches the conventions used by closebook's existing master_accounts table.
function deriveAccountType(letter, sub, classification) {
  const root = letter.replace(/[0-9]+$/, "");
  if (classification === "Asset") {
    if (root === "B" && sub === "B-01") return "Bank";
    if (root === "B") return "Other Current Asset";
    if (root === "C") return "Other Asset";
    if (root === "E" && sub === "E-01") return "Accounts Receivable";
    if (root === "E") return "Other Current Asset";
    if (root === "F") return "Other Current Asset";
    if (root === "G") return "Other Current Asset";
    if (root === "I" || root === "I1") return "Fixed Asset";
    if (root === "I2") return "Other Asset";
    if (root === "K") return "Other Current Asset";
    if (root === "L") return "Other Asset";
    return "Other Asset";
  }
  if (classification === "Liability") {
    if (letter === "M-02" || sub.endsWith("-02") && root === "M") return "Long Term Liability";
    if (root === "M" && sub === "M-01") return "Other Current Liability";
    if (root === "M") return "Long Term Liability";
    if (root === "N") return "Accounts Payable";
    if (sub === "O3-02" || sub === "O-08") return "Long Term Liability";
    if (root === "O") return "Other Current Liability";
    if (sub === "P2-01") return "Long Term Liability";
    if (root === "P") return "Other Current Liability";
    if (root === "R") return "Long Term Liability";
    return "Other Current Liability";
  }
  if (classification === "Equity") return "Equity";
  if (classification === "Revenue") {
    if (letter.startsWith("X1")) return "Income"; // contra-revenue still typed Income
    return "Income";
  }
  if (classification === "Expense") {
    // Y group: Y001-Y008 are direct/COGS-like; Y090, Y2xx, Y4xx, Y5xx, Y6xx, Y9xx are general
    if (/^Y00[1-8]$/i.test(letter)) return "Cost of Goods Sold";
    if (/^Y08\d$/i.test(letter)) return "Cost of Goods Sold";
    return "Expense";
  }
  return "Other Asset";
}

function deriveNormalBalance(letter, sub, classification, name = "") {
  // Contra-asset accounts: A/D, allowance for doubtful → credit
  if (classification === "Asset") {
    if (sub === "E-02") return "credit"; // Allowance for Doubtful
    if (letter.startsWith("I1")) return "credit"; // Accumulated Depreciation
    return "debit";
  }
  // Contra-revenue: discounts → debit
  if (classification === "Revenue") {
    if (letter.startsWith("X1") || /discount/i.test(name)) return "debit";
    return "credit";
  }
  if (classification === "Expense") return "debit";
  if (classification === "Liability" || classification === "Equity") return "credit";
  return "debit";
}

async function sb(method, table, body, query = "") {
  const url = `${SB}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const opts = { method, headers: { ...HDR, Prefer: "return=representation" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`${method} ${table} ${r.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function sbGetAll(table, params = "") {
  const all = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const url = `${SB}/rest/v1/${table}?${params}&limit=${PAGE}&offset=${offset}`;
    const r = await fetch(url, { headers: HDR });
    if (!r.ok) throw new Error(`GET ${table} ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function main() {
  console.log(`Mode: ${COMMIT ? "COMMIT (will insert rows)" : "DRY RUN"}`);
  const struct = JSON.parse(fs.readFileSync(STRUCT_PATH, "utf8"));

  // 1. Resolve organization
  const orgs = await sbGetAll("organizations", "select=id,name");
  if (orgs.length !== 1) {
    console.error(`Expected exactly 1 organization, found ${orgs.length}: ${orgs.map((o) => o.name).join(", ")}`);
    process.exit(1);
  }
  const org = orgs[0];
  console.log(`Organization: ${org.name} (${org.id})`);

  // 2. Resolve Accountant chart
  const charts = await sbGetAll(
    "master_charts",
    `select=id,name,kind&organization_id=eq.${org.id}`
  );
  const accChart = charts.find((c) => c.kind === "accountant");
  if (!accChart) throw new Error("Accountant chart not found for this organization");
  console.log(`Accountant chart: ${accChart.name} (${accChart.id})`);

  // 3. Resolve entities by name
  const entities = await sbGetAll(
    "entities",
    `select=id,name,code&organization_id=eq.${org.id}&is_active=eq.true`
  );
  const entityByCode = {};
  for (const [code, name] of Object.entries(ENTITY_MAP)) {
    const ent = entities.find((e) => e.name === name);
    if (!ent) {
      console.error(`Could not find entity "${name}" in org. Available: ${entities.map((e) => e.name).join(", ")}`);
      process.exit(1);
    }
    entityByCode[code] = ent;
    console.log(`  ${code} → ${ent.name} (${ent.id}, code=${ent.code})`);
  }

  // 4. Pre-load entity accounts. Silverco uses account_numbers, NCNT and 2F
  //    are name-only — we build both indexes and fall back to name match.
  const entityIds = Object.values(entityByCode).map((e) => e.id);
  let entityAccounts = [];
  for (const id of entityIds) {
    const rows = await sbGetAll(
      "accounts",
      `select=id,entity_id,account_number,name&entity_id=eq.${id}`
    );
    entityAccounts.push(...rows);
  }
  const byNumber = new Map();
  const byName = new Map();
  function normName(s) {
    return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  }
  for (const a of entityAccounts) {
    if (a.account_number) {
      byNumber.set(`${a.entity_id}::${a.account_number}`, a);
    }
    if (a.name) {
      const key = `${a.entity_id}::${normName(a.name)}`;
      // Multiple accounts could share a name across entities — keep the first.
      if (!byName.has(key)) byName.set(key, a);
    }
  }
  console.log(
    `Loaded ${entityAccounts.length} entity accounts (indexed ${byNumber.size} by number, ${byName.size} by name).`,
  );

  // 5. Pre-load existing accountant master accounts (so we can skip duplicates)
  const existingMasters = await sbGetAll(
    "master_accounts",
    `select=id,account_number&organization_id=eq.${org.id}&chart_id=eq.${accChart.id}`
  );
  const existingByNum = new Map(existingMasters.map((m) => [m.account_number, m.id]));
  console.log(`Existing accountant masters: ${existingMasters.length}`);

  // 6. Pre-load existing mappings in the accountant chart so we skip duplicates
  // We page in chunks of master_account_id IN (...) but easier: pull all by chart_id
  const existingMappings = await sbGetAll(
    "master_account_mappings",
    `select=master_account_id,entity_id,account_id&chart_id=eq.${accChart.id}`
  );
  const mappedKeys = new Set(
    existingMappings.map((m) => `${m.entity_id}::${m.account_id}`)
  );
  console.log(`Existing accountant mappings: ${existingMappings.length}`);

  // 7. Plan + (optionally) execute
  const stats = {
    mastersCreated: 0,
    mastersExisted: 0,
    mappingsCreated: 0,
    mappingsExisted: 0,
    mappingsDuplicate: [],
    accountsMissing: [],
  };
  // In-memory dedupe: a single (entity_account) can only map to one master in
  // a chart, but our colon fallback could resolve two different TB rows to the
  // same closebook account. Track and skip the second occurrence.
  const plannedKeys = new Set();

  let displayOrder = 0;
  for (const g of struct) {
    for (const s of g.subgroups) {
      displayOrder += 10;
      const accountNumber = s.code;
      const accountType = deriveAccountType(g.letter, s.code, g.classification);
      const normalBalance = deriveNormalBalance(g.letter, s.code, g.classification, s.title);

      let masterId = existingByNum.get(accountNumber);
      if (!masterId) {
        const payload = {
          organization_id: org.id,
          chart_id: accChart.id,
          account_number: accountNumber,
          name: s.title,
          description: `[${g.letter}] ${g.title} → ${s.code}`,
          classification: g.classification,
          account_type: accountType,
          account_sub_type: null,
          parent_account_id: null,
          is_active: true,
          display_order: displayOrder,
          normal_balance: normalBalance,
        };
        if (COMMIT) {
          const inserted = await sb("POST", "master_accounts", payload);
          masterId = inserted[0].id;
          existingByNum.set(accountNumber, masterId);
        }
        stats.mastersCreated++;
      } else {
        stats.mastersExisted++;
      }

      // Map AD accounts
      for (const a of s.accounts) {
        const ent = entityByCode[a.entity];
        if (!ent) {
          stats.accountsMissing.push({ ad: a.code, reason: `unknown entity tag "${a.entity}"`, sub: s.code });
          continue;
        }
        // Strip entity suffix to get QB account_number ("1100-SVC" → "1100").
        // Skip "NEW-XX" placeholders the accountant created — these don't
        // exist in QuickBooks.
        const qbNumber = a.code.replace(new RegExp(`-${a.entity}$`), "");
        if (qbNumber.startsWith("NEW-")) {
          stats.accountsMissing.push({
            ad: a.code,
            reason: `accountant placeholder (no matching QBO account)`,
            sub: s.code,
          });
          continue;
        }
        // Try number first (Silverco), then full name, then the leaf segment.
        // QBO stores parent:child names with colons, but the closebook sync
        // sometimes strips the prefix and keeps only the leaf (e.g.
        // "Vehicles:Class 13 - Cube Trucks" → "Class 13 - Cube Trucks").
        let ea = byNumber.get(`${ent.id}::${qbNumber}`);
        if (!ea && a.name) {
          ea = byName.get(`${ent.id}::${normName(a.name)}`);
          if (!ea && a.name.includes(":")) {
            const segments = a.name.split(":").map((p) => p.trim());
            for (let i = segments.length - 1; i >= 0 && !ea; i--) {
              ea = byName.get(`${ent.id}::${normName(segments[i])}`);
            }
            // Also try the last two segments joined ("Class 13 - Cube Trucks:Retrofits")
            if (!ea && segments.length >= 2) {
              const tail = segments.slice(-2).join(":");
              ea = byName.get(`${ent.id}::${normName(tail)}`);
            }
          }
        }
        if (!ea) {
          stats.accountsMissing.push({
            ad: a.code,
            reason: `no number ${qbNumber} or name "${a.name}" for entity ${ent.name}`,
            sub: s.code,
          });
          continue;
        }
        const key = `${ent.id}::${ea.id}`;
        if (mappedKeys.has(key)) {
          stats.mappingsExisted++;
          continue;
        }
        if (plannedKeys.has(key)) {
          stats.mappingsDuplicate.push({
            ad: a.code,
            sub: s.code,
            resolvedTo: ea.name,
          });
          continue;
        }
        plannedKeys.add(key);
        if (COMMIT && masterId) {
          await sb("POST", "master_account_mappings", {
            master_account_id: masterId,
            entity_id: ent.id,
            account_id: ea.id,
          });
          mappedKeys.add(key);
        }
        stats.mappingsCreated++;
      }
    }
  }

  console.log("\n=== RESULT ===");
  console.log("Masters to create:", stats.mastersCreated);
  console.log("Masters already existed:", stats.mastersExisted);
  console.log("Mappings to create:", stats.mappingsCreated);
  console.log("Mappings already existed:", stats.mappingsExisted);
  console.log("Mappings skipped (duplicate via fuzzy match):", stats.mappingsDuplicate.length);
  if (stats.mappingsDuplicate.length > 0 && stats.mappingsDuplicate.length <= 30) {
    for (const d of stats.mappingsDuplicate) {
      console.log(`  ${d.ad} (${d.sub}) collided onto "${d.resolvedTo}"`);
    }
  }
  console.log("Entity accounts NOT FOUND in closebook:", stats.accountsMissing.length);
  if (stats.accountsMissing.length > 0) {
    console.log("\nMissing accounts (first 30):");
    for (const m of stats.accountsMissing.slice(0, 30)) {
      console.log(`  ${m.ad} → ${m.sub} : ${m.reason}`);
    }
    if (stats.accountsMissing.length > 30) {
      console.log(`  ... and ${stats.accountsMissing.length - 30} more`);
    }
    fs.writeFileSync(
      path.join(__dirname, "tb-import-missing.json"),
      JSON.stringify(stats.accountsMissing, null, 2)
    );
    console.log(`Wrote scripts/tb-import-missing.json (${stats.accountsMissing.length} entries)`);
  }
  if (!COMMIT) console.log("\n(dry run — re-run with --commit to actually insert)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

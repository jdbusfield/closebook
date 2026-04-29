import * as XLSX from "xlsx";
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:\\Users\\JDBusfield\\Downloads\\Combined Working Trial Balance - 2025.xlsx";
const buffer = readFileSync(path);
const wb = XLSX.read(buffer, { type: "buffer" });
const sheet = wb.Sheets["Account Group Details"];
const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });

// Column map (from header inspection):
// col 4 (E) = code/account number
// col 5 (F) = description
// col 6 (G) = 2nd PP-CONSOL 12/31/2023
// col 8 (I) = 1st PP-CONSOL 12/31/2024
// col 10 (K) = SVC 12/31/2025
// col 12 (M) = NCNT 12/31/2025
// col 14 (O) = 2F 12/31/2025
// col 16 (Q) = PRE-CONSOL 12/31/2025
// col 19 (T) = EJE 12/31/2025
// col 21 (V) = CONSOL 12/31/2025

const COL_CODE = 4;
const COL_DESC = 5;
const COL_SVC = 10;
const COL_NCNT = 12;
const COL_2F = 14;
const COL_PRECONSOL = 16;
const COL_CONSOL = 21;

const groups = [];
let currentGroup = null;
let currentSubgroup = null;

function num(v) {
  if (v == null || v === "") return 0;
  const cleaned = String(v).replace(/,/g, "").replace(/^\((.+)\)$/, "-$1");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

for (const row of aoa) {
  if (!row || row.length === 0) continue;
  const tag = row[0];
  if (!tag || typeof tag !== "string") continue;
  const code = row[COL_CODE];
  const desc = row[COL_DESC];

  if (tag.startsWith("G_{") && !tag.endsWith("_T") && !tag.endsWith("_T_B")) {
    // Group header
    const match = code && /\[([^\]]+)\]/.exec(String(code));
    const letter = match ? match[1] : null;
    currentGroup = {
      tag,
      letter,
      title: desc,
      subgroups: [],
    };
    groups.push(currentGroup);
    currentSubgroup = null;
  } else if (
    tag.startsWith("SG_{") &&
    !tag.endsWith("_T") &&
    !tag.endsWith("_T_B")
  ) {
    // Subgroup header (some are "Subgroup : None" — skip those)
    if (typeof code === "string" && /\[([^\]]+)\]/.test(code)) {
      const match = /\[([^\]]+)\]/.exec(String(code));
      currentSubgroup = {
        tag,
        code: match ? match[1] : null,
        title: desc,
        accounts: [],
      };
      currentGroup?.subgroups.push(currentSubgroup);
    } else {
      currentSubgroup = null;
    }
  } else if (tag.startsWith("AD_{")) {
    if (!currentSubgroup) continue;
    // Account detail
    const codeStr = String(code ?? "").trim();
    // Detect entity from code suffix
    let entity = "OTHER";
    if (codeStr.endsWith("-SVC")) entity = "SVC";
    else if (codeStr.endsWith("-NCNT")) entity = "NCNT";
    else if (codeStr.endsWith("-2F")) entity = "2F";
    else if (codeStr.includes("-")) entity = codeStr.split("-").pop();

    currentSubgroup.accounts.push({
      tag,
      code: codeStr,
      name: desc,
      entity,
      svc: num(row[COL_SVC]),
      ncnt: num(row[COL_NCNT]),
      twof: num(row[COL_2F]),
      preconsol: num(row[COL_PRECONSOL]),
      consol: num(row[COL_CONSOL]),
    });
  }
}

// Classification map calibrated to the groups present in this workbook.
const CLASS_MAP = {
  // Assets
  B: "Asset",                                     // Cash
  C: "Asset",                                     // Investments
  E: "Asset", E1: "Asset", E2: "Asset",           // Receivables
  E3: "Asset", E4: "Asset", E5: "Asset",
  F: "Asset",                                     // Inventories
  G: "Asset", G1: "Asset", G2: "Asset",           // Prepaids / prepaid + deferred taxes (current)
  I: "Asset", I1: "Asset", I2: "Asset",           // Fixed assets / accum depr / ROU asset
  K: "Asset",                                     // Intercompany Balances
  L: "Asset", L1: "Asset", L2: "Asset",           // Other non-current assets / goodwill / intangibles
  L3: "Asset", L4: "Asset",                       // Deferred taxes long-term, investments
  // Liabilities
  M: "Liability", M1: "Liability", M2: "Liability",
  M3: "Liability", M4: "Liability",
  N: "Liability",                                 // Accounts payable
  O: "Liability", O1: "Liability", O2: "Liability",
  O3: "Liability", "O-3": "Liability",
  O4: "Liability", O5: "Liability",
  P: "Liability", P1: "Liability", P2: "Liability",
  R: "Liability", R1: "Liability", R2: "Liability", // Non-recourse debt, deferred income, due to related parties LT
  // Equity
  S: "Equity", S1: "Equity", S2: "Equity", S3: "Equity", S4: "Equity",
  // Revenue
  X: "Revenue", X1: "Revenue", X2: "Revenue",
  // Expense
  Y: "Expense", Y1: "Expense", Y2: "Expense", Y3: "Expense",
  Y4: "Expense", Y5: "Expense", Y6: "Expense", Y9: "Expense",
};

function classify(letter) {
  if (!letter) return "Unknown";
  if (CLASS_MAP[letter]) return CLASS_MAP[letter];
  const root = letter.replace(/[0-9]+$/, "");
  return CLASS_MAP[root] ?? "Unknown";
}

// Summarize
let summary = "";
const populatedGroups = [];

for (const g of groups) {
  const populatedSubs = g.subgroups.filter((s) => s.accounts.length > 0);
  if (populatedSubs.length === 0) continue;
  populatedGroups.push({ ...g, subgroups: populatedSubs });
}

summary += `# Trial Balance Structure (populated only)\n\n`;
summary += `Found ${groups.length} groups total; ${populatedGroups.length} with at least one account.\n\n`;
summary += `Entity columns observed: SVC (Silverco), NCNT, 2F\n\n`;

for (const g of populatedGroups) {
  const cls = classify(g.letter);
  summary += `## [${g.letter}] ${g.title} — ${cls}\n\n`;
  for (const s of g.subgroups) {
    summary += `### [${s.code}] ${s.title}  (${s.accounts.length} account${s.accounts.length === 1 ? "" : "s"})\n\n`;
    for (const a of s.accounts) {
      const balances = [];
      if (a.svc !== 0) balances.push(`SVC ${a.svc.toLocaleString()}`);
      if (a.ncnt !== 0) balances.push(`NCNT ${a.ncnt.toLocaleString()}`);
      if (a.twof !== 0) balances.push(`2F ${a.twof.toLocaleString()}`);
      if (a.consol !== 0) balances.push(`Consol ${a.consol.toLocaleString()}`);
      summary += `- \`${a.code}\` (${a.entity}) — ${a.name}${
        balances.length ? ` — ${balances.join(", ")}` : ""
      }\n`;
    }
    summary += `\n`;
  }
}

// Also produce a structured JSON for programmatic mapping
const jsonOut = populatedGroups.map((g) => ({
  letter: g.letter,
  title: g.title,
  classification: classify(g.letter),
  subgroups: g.subgroups.map((s) => ({
    code: s.code,
    title: s.title,
    accounts: s.accounts.map((a) => ({
      code: a.code,
      name: a.name,
      entity: a.entity,
      consol: a.consol,
    })),
  })),
}));

writeFileSync("scripts/tb-structure.md", summary);
writeFileSync("scripts/tb-structure.json", JSON.stringify(jsonOut, null, 2));
console.log("Wrote scripts/tb-structure.md and scripts/tb-structure.json");
console.log(`Total groups: ${groups.length}, populated: ${populatedGroups.length}`);
const allGroups = groups.map((g) => `[${g.letter}] ${g.title}`).join("\n");
console.log("\n=== ALL GROUPS ===");
console.log(allGroups);

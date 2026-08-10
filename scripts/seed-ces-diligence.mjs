// One-time seed: creates the "CES Studio Services" diligence deal with a
// request list tailored to the 2026-08-10 call with Bart Doll (CES / AIP).
// Run AFTER applying supabase/migrations/20260810_diligence_tracker.sql.
//
// Usage:  node scripts/seed-ces-diligence.mjs
//
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve("./.env.local");
if (!fs.existsSync(envPath)) {
  console.error("Missing .env.local — run:  vercel env pull .env.local");
  process.exit(1);
}
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function rest(method, p, body) {
  const r = await fetch(`${URL}/rest/v1${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${method} ${p}: ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

const TODAY = "2026-08-10";

// status defaults to not_requested; Bart committed on the call to sending
// asset lists, utilization, and fleet data, so those start as "requested".
const ITEMS = [
  // Corporate & Legal
  ["Corporate & Legal", "Confirm NDA coverage (2024 NDA) extends to coordinator and customer data", "James referenced an NDA in place going back to '24. Confirm scope covers the confidential retainer arrangements Bart flagged.", "high"],
  ["Corporate & Legal", "Change-of-control treatment of the MSA in an AIP sale", "AIP intends to sell CES before the 2028 Olympics. MSA must survive a sale or carry a termination fee; ideally ROFR / purchase option on the fleet at debt payoff.", "high"],
  ["Corporate & Legal", "AIP sign-off on multi-year management agreement", "Bart says AIP doesn't care, but confirm sponsor/board approval requirements in writing.", "medium"],
  ["Corporate & Legal", "UCC / lien searches on CES entities and serialized assets", null, "high"],

  // Financial
  ["Financial", "Studio-services-only P&L by location, 3 years + YTD", "Resolve the $1–1.5M/mo vs. $15M ambiguity from the call. Division has been cash-flow negative 2 years — need to see why (utilization vs. cost problem).", "high", "requested"],
  ["Financial", "Monthly revenue by location, trailing 24 months", null, "high", "requested"],
  ["Financial", "Isolation of studio-services results from US Power / corporate", "CES doesn't allocate corporate expense to regions; back-office is 'free' to them. Understand what a standalone view really looks like.", "medium"],
  ["Financial", "AR aging & customer deposits/prepaids on studio services", null, "medium"],

  // Tax
  ["Tax", "Sales/use and property tax status on fleet assets by state", null, "medium"],

  // Debt & Financing
  ["Debt & Financing", "ABL facility terms: covenants, default triggers, transfer/rebrand restrictions", "Does handing possession to Avon, rebranding, or moving collateral across state lines trigger default or require consent? Deal-structure gate — answer first.", "high"],
  ["Debt & Financing", "Per-asset (serialized) debt payoff schedule vs. estimated market value", "Bart: sales must clear loan payoff per unit. Payoff-to-value gap determines whether de-fleeting is feasible and what a purchase option is worth.", "high"],
  ["Debt & Financing", "Refinancing status and expected closing timeline", "Bart is mid-refi, expects done before year-end; can't sell assets for several months. De-fleeting program effective date ties to this.", "high"],
  ["Debt & Financing", "Lender consent requirements for the management structure", null, "high"],

  // Assets & Fleet
  ["Assets & Fleet", "Complete serialized asset list (trucks, trailers, generators) by location", "Promised on the call — arriving via Richard.", "high", "requested"],
  ["Assets & Fleet", "Utilization by asset and by region, trailing 24 months", "The make-or-break item: division economics depend on whether the fleet can earn under better management.", "high", "requested"],
  ["Assets & Fleet", "Maintenance records, deferred maintenance, and condition assessment", null, "high"],
  ["Assets & Fleet", "Titles, registrations, DOT compliance; IRP apportionment and ELD status", "James's 'lifted and apportioned' question; Richard's ELD question — Bart didn't know either answer.", "medium"],
  ["Assets & Fleet", "Parts and shop equipment inventory at each location", "Offered as part of the deal — needs to be scheduled and valued in the agreement.", "medium"],
  ["Assets & Fleet", "Crawford silent generators: count, location, carve-out constraints", "Bart mentioned a large East Coast population that 'can't come back to California.'", "low"],

  // Commercial & Customers
  ["Commercial & Customers", "Customer list, revenue concentration, and pipeline by region", null, "high"],
  ["Commercial & Customers", "Revenue mix and geographic revenue distribution", "James flagged for the follow-up conversation.", "medium"],
  ["Commercial & Customers", "Conflict check vs. Avon / HDR / Versatile customers and markets", "Structure contemplates CES continuing to market film/TV with Avon fulfilling — map any head-to-head exposure.", "high"],
  ["Commercial & Customers", "Rate cards and pricing history for studio services", null, "medium"],
  ["Commercial & Customers", "Live-events dual-use potential", "CES has 'all the right gear' but limited success vs. Coyote at A-list festivals; relationship-dependent.", "low"],

  // Operations
  ["Operations", "Day-one operating plan: LA (Sun Valley), Atlanta, New Orleans", "Atlanta staff being laid off and facility subleased regardless; New Orleans is his best-run location and also on the table.", "high"],
  ["Operations", "Hub network access terms (re-basing assets in other states)", "Bart agreed to let Avon use CES's nationwide hub network — define cost and terms.", "medium"],

  // HR & People
  ["HR & People", "Transportation coordinator arrangements: names, retainers, performance", "Confidential; covered by '24 NDA. Bart: 'not sure you're really supposed to do it that way' — have counsel review before inheriting.", "high"],
  ["HR & People", "Confirm CES bears all layoff / severance / WARN obligations", null, "medium"],

  // Real Estate & Facilities
  ["Real Estate & Facilities", "Facility leases: rent, expiry, sublease and assignment rights", "Position: take no leases day one; CES eats Atlanta/New Orleans as offered. Verify terms anyway.", "medium"],
  ["Real Estate & Facilities", "Santa Clarita storage lot: space rented and utilization", "Richard's open question — Bart didn't know.", "low"],

  // Insurance & Risk
  ["Insurance & Risk", "Current CES policies and certificates; loss runs 5 years", "Bart keeps owner-level coverage short term; won't be sufficient for Avon to operate.", "high"],
  ["Insurance & Risk", "Quote Avon operator coverage for the fleet (cost input to the split)", null, "high"],

  // IT & Systems
  ["IT & Systems", "Rental/inventory system and data export for the studio division", null, "medium"],
  ["IT & Systems", "Telematics/GPS platforms and contracts on the fleet", null, "low"],

  // Regulatory & Compliance
  ["Regulatory & Compliance", "Operating authority, DOT numbers, interstate compliance posture", null, "medium"],
  ["Regulatory & Compliance", "Environmental / CARB exposure on generators returning to CA", null, "low"],
];

async function main() {
  const orgs = await rest("GET", "/organizations?select=id,name&limit=2");
  if (!orgs?.length) throw new Error("No organization found");
  if (orgs.length > 1) console.warn(`Multiple orgs found; using "${orgs[0].name}"`);
  const orgId = orgs[0].id;

  const existing = await rest(
    "GET",
    `/diligence_deals?select=id&organization_id=eq.${orgId}&name=eq.${encodeURIComponent("CES Studio Services")}`
  );
  if (existing?.length) {
    console.log("Deal already exists:", existing[0].id);
    return;
  }

  const [deal] = await rest("POST", "/diligence_deals", {
    organization_id: orgId,
    name: "CES Studio Services",
    counterparty: "Bart Doll — CES (AIP)",
    deal_type: "managed_services",
    stage: "data_request",
    description:
      "Managed services agreement over CES's studio services fleet (LA, Atlanta, New Orleans): Avon operates, maintains, and rents the equipment under Avon branding; CES stays registered owner and debt holder; revenue share on net. De-fleeting program post-refi. Bart targeting 30-60 days.",
    target_close_date: "2026-09-30",
    notes:
      "Division cash-flow negative 2 years; AIP selling CES before 2028 Olympics. All gear on ABL (serialized). NDA in place since 2024. Asset lists / utilization / fleet data promised via Richard on 8/10 call.",
  });
  console.log("Created deal:", deal.id);

  const rows = ITEMS.map(([category, title, details, priority, status], i) => ({
    organization_id: orgId,
    deal_id: deal.id,
    category,
    title,
    details: details ?? null,
    priority: priority ?? "medium",
    status: status ?? "not_requested",
    requested_date: status === "requested" ? TODAY : null,
    sort_order: i,
  }));
  await rest("POST", "/diligence_items", rows);
  console.log(`Inserted ${rows.length} diligence items.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

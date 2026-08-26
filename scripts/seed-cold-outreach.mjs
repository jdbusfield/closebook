// Seed the six launch prospects onto HDR's Cold outreach board (lane='cold',
// status 'not_contacted'). Idempotent: a company whose email already has a cold
// card is skipped. Sends nothing.
//
//   node scripts/seed-cold-outreach.mjs            # dry run
//   node scripts/seed-cold-outreach.mjs --apply    # insert
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
// (same pattern as scripts/probe-followup-contact.mjs).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const getEnv = (k) =>
  (env.match(new RegExp(`^${k}=(.+)$`, "m")) ?? [])[1]?.trim().replace(/^"(.*)"$/, "$1") ?? null;
const db = createClient(
  getEnv("NEXT_PUBLIC_SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? getEnv("SUPABASE_SERVICE_KEY")
);

const HDR = "7529580d-3b44-4a9b-91f4-bc2db25f5211";
const APPLY = process.argv.includes("--apply");

const SEEDS = [
  {
    company: "EventHouseLA",
    vertical: "Property / estate",
    email: "villas@eventhousela.com",
    notes: "Brand activations in private homes. Events only; they also source filming.",
  },
  {
    company: "Sequoia Productions",
    vertical: "Event producer",
    email: "info@sequoiaprod.com",
    notes: "Oscars/Emmys + corporate galas.",
  },
  {
    company: "Sterling Social",
    vertical: "Event producer",
    email: "events@sterlingsocial.com",
    notes: "Brentwood brand/activation producer.",
  },
  {
    company: "AOO Events",
    vertical: "Event producer",
    email: "info@aooevents.com",
    notes: "LA live events since 1989.",
  },
  {
    company: "Command Performance Catering",
    vertical: "Caterer",
    email: "pablo@cpcatering.com",
    notes:
      "Hartley-specific inbox; no general sales email published. House caterer on garden/ranch circuit.",
  },
  {
    company: "SPIRE",
    vertical: "Event producer",
    email: "info@spire.la",
    notes: "Mid-Wilshire brand/nonprofit/corporate.",
  },
];

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genReference = () =>
  "CO-" +
  Array.from({ length: 5 }, () => REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)]).join("");

const { data: existing, error: exErr } = await db
  .from("rental_inquiries")
  .select("email, company, status")
  .eq("entity_id", HDR)
  .eq("lane", "cold");
if (exErr) {
  console.error("Could not read existing cold cards:", exErr.message);
  process.exit(1);
}
const have = new Set((existing ?? []).map((r) => (r.email ?? "").toLowerCase()));

let inserted = 0;
for (const s of SEEDS) {
  if (have.has(s.email.toLowerCase())) {
    console.log(`skip  ${s.company} (${s.email}) — already on the board`);
    continue;
  }
  if (!APPLY) {
    console.log(`would add  ${s.company} (${s.email}) · ${s.vertical}`);
    continue;
  }
  const row = {
    entity_id: HDR,
    lane: "cold",
    source: "outreach",
    status: "not_contacted",
    outreach_source: "Research list",
    last_activity_at: new Date().toISOString(),
    created_by: "seed-cold-outreach",
    ...s,
  };
  let ok = false;
  for (let attempt = 0; attempt < 5 && !ok; attempt++) {
    const { error } = await db.from("rental_inquiries").insert({ ...row, reference: genReference() });
    if (!error) ok = true;
    else if (error.code !== "23505") {
      console.error(`FAILED ${s.company}:`, error.message);
      break;
    }
  }
  if (ok) {
    inserted++;
    console.log(`added ${s.company} (${s.email})`);
  }
}
console.log(APPLY ? `\n${inserted} card(s) inserted.` : "\nDry run — re-run with --apply to insert.");

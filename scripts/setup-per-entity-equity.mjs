// Sets up per-entity equity master accounts on the accountant chart so the
// balance sheet equity section groups by entity (combined-presentation
// layout). Creates one combined leaf master per non-Two-Family equity entity
// under the existing FS-Q-* rollups, and moves stray mappings into them.
//
// Usage:
//   node scripts/setup-per-entity-equity.mjs           # dry run
//   node scripts/setup-per-entity-equity.mjs --apply   # execute
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");

const dotenv = fs.readFileSync(
  "C:/Users/JDBusfield/Documents/MyProjects/Accounting App/.env.local",
  "utf8",
);
for (const line of dotenv.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Per-entity combined leaves to create. Keyed by entity code.
// Each one hangs under the matching FS-Q-* rollup parent (looked up by name).
const PLAN = [
  {
    entityCode: "AVON",
    accountNumber: "S-AVON-01",
    name: "Silverco equity (combined)",
    parentName: "Member's deficit - Silverco",
  },
  {
    entityCode: "NCNT",
    accountNumber: "S-NCNT-01",
    name: "NCNT equity (combined)",
    parentName: "Member's equity - NCNT",
  },
];

// Which entities should keep their mappings on the existing Two Family leaves
// (they're already correctly parented under FS-Q-01/02). Everything else gets
// migrated.
const KEEP_ON_EXISTING = new Set(["2F"]);

async function main() {
  const { data: entities } = await supabase
    .from("entities")
    .select("id, name, code, organization_id");
  const orgId = entities?.[0]?.organization_id;
  if (!orgId) throw new Error("No organization found");

  const { data: charts } = await supabase
    .from("master_charts")
    .select("id, name, kind, organization_id")
    .eq("organization_id", orgId);
  const accChart = (charts ?? []).find((c) => c.kind === "accountant");
  if (!accChart) throw new Error("No accountant chart found");

  console.log(`Org: ${orgId}`);
  console.log(`Accountant chart: ${accChart.id} (${accChart.name})`);
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY RUN");

  const { data: maAccts } = await supabase
    .from("master_accounts")
    .select(
      "id, account_number, name, classification, account_type, is_intercompany, parent_account_id",
    )
    .eq("organization_id", orgId)
    .eq("chart_id", accChart.id);

  const findMaByName = (name) =>
    (maAccts ?? []).find((m) => m.name === name);
  const findEntity = (code) => (entities ?? []).find((e) => e.code === code);

  // Step 1: ensure the combined leaves exist for AVON and NCNT.
  const newLeafByEntity = new Map(); // entityId -> master_account row
  for (const item of PLAN) {
    const ent = findEntity(item.entityCode);
    if (!ent) {
      console.log(`  ! entity ${item.entityCode} not found, skipping`);
      continue;
    }
    const parent = findMaByName(item.parentName);
    if (!parent) {
      console.log(`  ! parent rollup "${item.parentName}" not found, skipping`);
      continue;
    }

    const existing = (maAccts ?? []).find(
      (m) => m.account_number === item.accountNumber,
    );
    if (existing) {
      console.log(
        `  = leaf already exists: [${existing.account_number}] ${existing.name}`,
      );
      newLeafByEntity.set(ent.id, existing);
      continue;
    }

    console.log(
      `  + create leaf: [${item.accountNumber}] ${item.name}  parent=${parent.name}`,
    );
    if (APPLY) {
      const { data: created, error } = await supabase
        .from("master_accounts")
        .insert({
          organization_id: orgId,
          chart_id: accChart.id,
          account_number: item.accountNumber,
          name: item.name,
          classification: "Equity",
          account_type: "Equity",
          is_intercompany: false,
          parent_account_id: parent.id,
        })
        .select(
          "id, account_number, name, classification, account_type, is_intercompany, parent_account_id",
        )
        .single();
      if (error) throw error;
      newLeafByEntity.set(ent.id, created);
    } else {
      // Stub for dry-run accounting only.
      newLeafByEntity.set(ent.id, { id: `(would-create:${item.accountNumber})` });
    }
  }

  // Step 2: walk all equity master accounts and move any non-Two-Family
  // mappings to the matching entity's combined leaf.
  const equityMasters = (maAccts ?? []).filter(
    (m) => (m.classification ?? "").toLowerCase() === "equity",
  );

  let moved = 0;
  for (const m of equityMasters) {
    // Skip the new leaves themselves.
    if (
      PLAN.some((p) => p.accountNumber === m.account_number)
    )
      continue;

    const { data: mappings } = await supabase
      .from("master_account_mappings")
      .select("id, entity_id, account_id, master_account_id")
      .eq("master_account_id", m.id);

    if (!mappings || mappings.length === 0) continue;

    for (const mp of mappings) {
      const ent = entities.find((e) => e.id === mp.entity_id);
      if (!ent) continue;
      if (KEEP_ON_EXISTING.has(ent.code)) continue;
      const target = newLeafByEntity.get(mp.entity_id);
      if (!target) continue;

      console.log(
        `  > move mapping: [${m.account_number}] ${m.name}  --(${ent.code})-->  ${target.account_number ?? target.id}`,
      );
      moved++;
      if (APPLY) {
        const { error } = await supabase
          .from("master_account_mappings")
          .update({ master_account_id: target.id })
          .eq("id", mp.id);
        if (error) throw error;
      }
    }
  }

  console.log(`\n${moved} mapping(s) ${APPLY ? "moved" : "would move"}.`);

  if (!APPLY) {
    console.log(
      "\n=== DRY RUN complete. Re-run with --apply to execute. ===",
    );
  } else {
    console.log("\n=== APPLIED ===");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Probe: list every equity-classification master account in the accountant
// chart with its mappings grouped by entity. Used to plan the per-entity
// equity split for the combined-presentation balance sheet.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

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

async function main() {
  const { data: entities } = await supabase
    .from("entities")
    .select("id, name, code, organization_id");
  const orgId = entities?.[0]?.organization_id;
  console.log("Org:", orgId);
  console.log("Entities:");
  for (const e of entities ?? []) console.log(`  ${e.code}\t${e.name}\t${e.id}`);

  const { data: charts } = await supabase
    .from("master_charts")
    .select("id, name, kind, organization_id")
    .eq("organization_id", orgId);
  const accChart = (charts ?? []).find((c) => c.kind === "accountant");
  console.log("\nAccountant chart:", accChart?.id, accChart?.name);

  const { data: maAccts } = await supabase
    .from("master_accounts")
    .select(
      "id, account_number, name, classification, account_type, is_intercompany, parent_account_id",
    )
    .eq("organization_id", orgId)
    .eq("chart_id", accChart?.id);

  const equityMasters = (maAccts ?? []).filter(
    (m) => (m.classification ?? "").toLowerCase() === "equity",
  );
  console.log(
    `\n=== Equity master accounts in accountant chart (${equityMasters.length}) ===`,
  );

  for (const m of equityMasters) {
    const parent = (maAccts ?? []).find((x) => x.id === m.parent_account_id);
    const { data: mappings } = await supabase
      .from("master_account_mappings")
      .select("id, entity_id, account_id")
      .eq("master_account_id", m.id);

    const byEntity = new Map();
    for (const mp of mappings ?? []) {
      if (!byEntity.has(mp.entity_id)) byEntity.set(mp.entity_id, []);
      byEntity.get(mp.entity_id).push(mp);
    }

    console.log(
      `\n  [${m.account_number}] ${m.name}  type=${m.account_type}  parent=${parent?.name ?? "(none)"}  id=${m.id}`,
    );
    console.log(
      `    ${mappings?.length ?? 0} mappings across ${byEntity.size} entities`,
    );

    for (const [entityId, mps] of byEntity) {
      const ent = entities.find((e) => e.id === entityId);
      const acctIds = mps.map((mp) => mp.account_id);
      const { data: accts } = await supabase
        .from("accounts")
        .select("id, account_number, name, classification, account_type")
        .in("id", acctIds);
      console.log(`    - ${ent?.code} (${ent?.name}):`);
      for (const a of accts ?? []) {
        console.log(
          `        ${a.account_number ?? ""}\t${a.name}\t[${a.classification}/${a.account_type}]`,
        );
      }
    }
  }

  // Also list any rollup parents in the equity classification, so we know
  // where new per-entity masters should hang.
  const equityRollups = (maAccts ?? []).filter(
    (m) =>
      (m.classification ?? "").toLowerCase() === "equity" &&
      (maAccts ?? []).some((x) => x.parent_account_id === m.id),
  );
  console.log("\n=== Equity rollup parents (have children) ===");
  for (const r of equityRollups) {
    console.log(`  [${r.account_number}] ${r.name}  id=${r.id}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

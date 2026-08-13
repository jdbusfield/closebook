// One-off: confirm the four sales_commission_* tables exist (migration 20260813).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const tables = [
  "sales_commission_plans",
  "sales_commission_rate_types",
  "sales_commission_customer_assignments",
  "sales_commission_runs",
];
for (const t of tables) {
  const res = await fetch(`${url}/rest/v1/${t}?select=id&limit=1`, { headers });
  console.log(`${t}: ${res.ok ? "OK" : `FAIL ${res.status} ${await res.text()}`}`);
}

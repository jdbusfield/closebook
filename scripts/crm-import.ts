/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One-shot import of MT-CRM data into Closebook's `crm_*` tables.
 *
 * Usage:
 *   tsx scripts/crm-import.ts \
 *     --dump migrations-from-mt-crm/mt-crm-data-only.sql \
 *     --org-slug silverco
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
 *
 * Strategy:
 *  1. Parse the data-only pg_dump's COPY blocks into rows-by-table.
 *  2. Insert in FK-safe order, stamping organization_id and keeping
 *     legacy_id from the original integer PK so we can resolve FKs.
 *  3. For each child table, look up the parent's new uuid by legacy_id
 *     before inserting.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, string | null>;
type TableData = { columns: string[]; rows: Row[] };
type Dump = Record<string, TableData>;

function parseArgs() {
  const out: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    out[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
  }
  if (!out.dump || !out["org-slug"]) {
    console.error("usage: tsx scripts/crm-import.ts --dump <file> --org-slug <slug>");
    process.exit(1);
  }
  return out;
}

function unescapePg(value: string): string | null {
  if (value === "\\N") return null;
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

function parseDump(file: string): Dump {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const dump: Dump = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^COPY public\.(\w+)\s*\(([^)]+)\)\s+FROM stdin;/.exec(line);
    if (!m) { i++; continue; }
    const table = m[1];
    const columns = m[2].split(",").map(c => c.trim());
    const rows: Row[] = [];
    i++;
    while (i < lines.length && lines[i] !== "\\.") {
      const parts = lines[i].split("\t");
      const row: Row = {};
      columns.forEach((col, idx) => { row[col] = unescapePg(parts[idx] ?? "\\N"); });
      rows.push(row);
      i++;
    }
    dump[table] = { columns, rows };
    i++;
  }
  return dump;
}

function toInt(v: string | null): number | null {
  return v == null ? null : Number.parseInt(v, 10);
}

function toBool(v: string | null): boolean | null {
  if (v == null) return null;
  return v === "t" || v === "true";
}

function toArr(v: string | null): string[] | null {
  if (v == null) return null;
  // pg array literal: {a,b,c}
  const inner = v.replace(/^\{|\}$/g, "");
  if (!inner) return [];
  return inner.split(",").map(s => s.replace(/^"|"$/g, ""));
}

async function getOrgId(sb: SupabaseClient, slug: string): Promise<string> {
  const { data, error } = await sb.from("organizations").select("id").eq("slug", slug).single();
  if (error || !data) throw new Error(`org not found for slug ${slug}: ${error?.message}`);
  return data.id as string;
}

async function insertTable(
  sb: SupabaseClient,
  table: string,
  rows: any[],
): Promise<Map<number, string>> {
  const idMap = new Map<number, string>();
  if (rows.length === 0) return idMap;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await sb.from(table).insert(batch).select("id, legacy_id");
    if (error) throw new Error(`insert ${table}: ${error.message}`);
    for (const row of data ?? []) {
      if (row.legacy_id != null) idMap.set(row.legacy_id as number, row.id as string);
    }
    console.log(`  ${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  return idMap;
}

async function main() {
  const args = parseArgs();
  const dumpFile = path.resolve(args.dump);
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log(`parsing ${dumpFile}`);
  const dump = parseDump(dumpFile);
  for (const [t, d] of Object.entries(dump)) {
    console.log(`  ${t}: ${d.rows.length} rows`);
  }

  const orgId = await getOrgId(sb, args["org-slug"]);
  console.log(`organization_id = ${orgId}`);

  // 1. Companies (self-referential parent_studio_id resolved in 2nd pass)
  const companyMap = await insertTable(sb, "crm_companies", (dump.companies?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    name: r.name,
    type: r.type,
    parent_studio_id: null,
  })));
  // resolve parent_studio_id
  for (const r of dump.companies?.rows ?? []) {
    const parentLegacy = toInt(r.parent_studio_id);
    if (parentLegacy && companyMap.has(parentLegacy) && companyMap.has(toInt(r.id)!)) {
      await sb.from("crm_companies")
        .update({ parent_studio_id: companyMap.get(parentLegacy) })
        .eq("id", companyMap.get(toInt(r.id)!));
    }
  }

  // 2. Commercial companies
  const commCoMap = await insertTable(sb, "crm_commercial_companies", (dump.commercial_companies?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    name: r.name,
    avon_customer_number: r.avon_customer_number,
    location: r.location,
  })));

  // 3. Contacts
  const contactMap = await insertTable(sb, "crm_contacts", (dump.contacts?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    name: r.name,
    role: r.role,
    phone: r.phone,
    email: r.email,
    company_id: companyMap.get(toInt(r.company_id)!) ?? null,
    status: r.status ?? "active",
    last_contact_date: r.last_contact_date,
    last_contact_type: r.last_contact_type,
    avon_source_code: r.avon_source_code,
    salesperson: r.salesperson,
  })));

  // 4. Productions (FK to companies + contacts)
  const productionMap = await insertTable(sb, "crm_productions", (dump.productions?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    name: r.name,
    company_id: companyMap.get(toInt(r.company_id)!) ?? null,
    studio_id: companyMap.get(toInt(r.studio_id)!) ?? null,
    status: r.status ?? "prepping",
    start_date: r.start_date,
    end_date: r.end_date,
    avon_customer_number: r.avon_customer_number,
    production_type: r.production_type ?? "other",
    rental_opportunities: toArr(r.rental_opportunities),
    estimated_trailers_needed: toInt(r.estimated_trailers_needed),
    estimated_vehicles_needed: toInt(r.estimated_vehicles_needed),
    avon_trailers_on_production: toInt(r.avon_trailers_on_production),
    avon_vehicles_on_production: toInt(r.avon_vehicles_on_production),
    state: r.state,
    avon_vehicle_revenue: toInt(r.avon_vehicle_revenue),
    total_hdr_revenue: toInt(r.total_hdr_revenue),
    avon_trailer_revenue: toInt(r.avon_trailer_revenue),
    date_first_appearing_on_report: r.date_first_appearing_on_report,
    is_399_production: toBool(r.is_399_production),
    primary_transportation_contact_id: contactMap.get(toInt(r.primary_transportation_contact_id)!) ?? null,
    primary_locations_contact_id: contactMap.get(toInt(r.primary_locations_contact_id)!) ?? null,
    status_changed_at: r.status_changed_at,
    production_category: r.production_category,
    rental_vehicles_vendor: r.rental_vehicles_vendor,
    rental_trailers_vendor: r.rental_trailers_vendor,
    honeywagon_vendor: r.honeywagon_vendor,
    location_services_vendor: r.location_services_vendor,
    power_distribution_vendor: r.power_distribution_vendor,
    camera_trucks_vendor: r.camera_trucks_vendor,
    production_trucks_vendor: r.production_trucks_vendor,
    ac_equipment_vendor: r.ac_equipment_vendor,
    production_supplies_vendor: r.production_supplies_vendor,
    grip_lighting_vendor: r.grip_lighting_vendor,
    location_services_revenue: toInt(r.location_services_revenue),
    honeywagon_revenue: toInt(r.honeywagon_revenue),
    bathroom_trailer_revenue: toInt(r.bathroom_trailer_revenue),
    power_distribution_revenue: toInt(r.power_distribution_revenue),
    camera_trucks_revenue: toInt(r.camera_trucks_revenue),
    production_trucks_revenue: toInt(r.production_trucks_revenue),
    ac_equipment_revenue: toInt(r.ac_equipment_revenue),
    production_supplies_revenue: toInt(r.production_supplies_revenue),
    grip_lighting_revenue: toInt(r.grip_lighting_revenue),
    ca_spend_level: toInt(r.ca_spend_level),
  })));

  // 5. Production aliases / status history / reports
  await insertTable(sb, "crm_production_aliases", (dump.production_aliases?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    production_id: productionMap.get(toInt(r.production_id)!),
    alias_name: r.alias_name,
  })).filter(r => r.production_id));

  await insertTable(sb, "crm_production_status_history", (dump.production_status_history?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    production_id: productionMap.get(toInt(r.production_id)!),
    old_status: r.old_status,
    new_status: r.new_status,
    changed_at: r.changed_at,
    notes: r.notes,
  })).filter(r => r.production_id));

  // 6. Equipment + bookings + commercial opportunities + opportunities + communications
  const equipmentMap = await insertTable(sb, "crm_equipment", (dump.equipment?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    name: r.name,
    category: r.category,
    segment: r.segment,
    quantity: toInt(r.quantity),
    available_quantity: toInt(r.available_quantity),
    description: r.description,
  })));

  const commercialOpMap = await insertTable(sb, "crm_commercial_opportunities", (dump.commercial_opportunities?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    commercial_company_id: commCoMap.get(toInt(r.commercial_company_id)!),
    job_title: r.job_title,
    amount: toInt(r.amount),
    description: r.description,
    status: r.status,
    status_changed_at: r.status_changed_at,
  })).filter(r => r.commercial_company_id));

  const oppMap = await insertTable(sb, "crm_opportunities", (dump.opportunities?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    production_id: productionMap.get(toInt(r.production_id)!) ?? null,
    contact_id: contactMap.get(toInt(r.contact_id)!),
    current_segment: r.current_segment,
    description: r.description,
    status: r.status,
    priority: r.priority,
    salesperson: r.salesperson,
    amount: toInt(r.amount),
    status_comment: r.status_comment,
  })).filter(r => r.contact_id));

  // 7. Join tables + downstream
  await insertTable(sb, "crm_contact_productions", (dump.contact_productions?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    contact_id: contactMap.get(toInt(r.contact_id)!),
    production_id: productionMap.get(toInt(r.production_id)!),
  })).filter(r => r.contact_id && r.production_id));

  await insertTable(sb, "crm_contact_commercial_companies", (dump.contact_commercial_companies?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    contact_id: contactMap.get(toInt(r.contact_id)!),
    commercial_company_id: commCoMap.get(toInt(r.commercial_company_id)!),
    role: r.role,
    is_primary: toBool(r.is_primary),
  })).filter(r => r.contact_id && r.commercial_company_id));

  await insertTable(sb, "crm_contact_commercial_opportunities", (dump.contact_commercial_opportunities?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    contact_id: contactMap.get(toInt(r.contact_id)!),
    commercial_opportunity_id: commercialOpMap.get(toInt(r.commercial_opportunity_id)!),
    role: r.role,
    is_primary: toBool(r.is_primary),
  })).filter(r => r.contact_id && r.commercial_opportunity_id));

  await insertTable(sb, "crm_corporate_opportunities", (dump.corporate_opportunities?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    company_id: companyMap.get(toInt(r.company_id)!),
    contact_id: contactMap.get(toInt(r.contact_id)!),
    name: r.name,
    type: r.type,
    stage: r.stage,
    description: r.description,
    estimated_value: toInt(r.estimated_value),
    expected_close_date: r.expected_close_date,
    priority: r.priority,
    salesperson: r.salesperson,
    notes: r.notes,
    rental_opportunities: toArr(r.rental_opportunities),
  })).filter(r => r.company_id && r.contact_id));

  await insertTable(sb, "crm_communications", (dump.communications?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    contact_id: contactMap.get(toInt(r.contact_id)!) ?? null,
    type: r.type,
    notes: r.notes,
    date: r.date,
    production_id: productionMap.get(toInt(r.production_id)!) ?? null,
    has_opportunity: toBool(r.has_opportunity),
    opportunity_id: oppMap.get(toInt(r.opportunity_id)!) ?? null,
    salesperson: r.salesperson,
    commercial_company_id: commCoMap.get(toInt(r.commercial_company_id)!) ?? null,
    commercial_opportunity_id: commercialOpMap.get(toInt(r.commercial_opportunity_id)!) ?? null,
  })));

  await insertTable(sb, "crm_bookings", (dump.bookings?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    production_id: productionMap.get(toInt(r.production_id)!),
    contact_id: contactMap.get(toInt(r.contact_id)!),
    equipment_id: equipmentMap.get(toInt(r.equipment_id)!),
    quantity: toInt(r.quantity),
    start_date: r.start_date,
    end_date: r.end_date,
    status: r.status,
    notes: r.notes,
  })).filter(r => r.production_id && r.contact_id && r.equipment_id));

  const eventMap = await insertTable(sb, "crm_entertainment_events", (dump.entertainment_events?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    event_type: r.event_type,
    event_date: r.event_date,
    description: r.description,
    capacity: toInt(r.capacity),
    available_slots: toInt(r.available_slots),
    event_status: r.event_status,
    location: r.location,
    notes: r.notes,
  })));

  await insertTable(sb, "crm_event_bookings", (dump.event_bookings?.rows ?? []).map(r => ({
    organization_id: orgId,
    legacy_id: toInt(r.id),
    event_id: eventMap.get(toInt(r.event_id)!),
    contact_id: contactMap.get(toInt(r.contact_id)!),
    num_guests: toInt(r.num_guests),
    notes: r.notes,
  })).filter(r => r.event_id && r.contact_id));

  console.log("\ndone");
}

main().catch(err => { console.error(err); process.exit(1); });

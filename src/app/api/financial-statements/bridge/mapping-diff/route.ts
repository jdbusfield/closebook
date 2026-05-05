// POST /api/financial-statements/bridge/mapping-diff
//
// For every QBO GL account that's mapped on either chart, return the line
// it feeds on each chart side-by-side so the user can see categorization
// differences. Auditor's running list — the answer to "where does this
// QBO account land on each view, and where do they disagree?"

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveChart } from "@/lib/master-charts/resolve";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";

interface RequestBody {
  organizationId: string;
  /** Optional — when set, only show GL accounts owned by entities in this RE */
  reportingEntityId?: string;
}

interface MasterAccountLite {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
  parent_account_id: string | null;
  chart_id: string;
}

interface MappingRow {
  account_id: string;
  master_account_id: string;
  entity_id: string;
}

interface AccountRow {
  id: string;
  entity_id: string;
  account_number: string | null;
  name: string;
  classification: string;
}

interface EntityRow {
  id: string;
  name: string;
  code: string;
}

interface ResolvedSide {
  masterId: string;
  masterName: string;
  masterNumber: string | null;
  /** Root master = the line displayed in the rendered statement */
  rootMasterId: string;
  rootMasterName: string;
  rootMasterNumber: string | null;
  classification: string;
}

interface MappingDiffRow {
  glAccountId: string;
  glAccountName: string;
  glAccountNumber: string | null;
  glClassification: string;
  entityId: string;
  entityCode: string;
  entityName: string;
  acc: ResolvedSide | null;
  mgt: ResolvedSide | null;
  status: "same" | "different" | "unmapped_acc" | "unmapped_mgt" | "unmapped_both";
}

function buildMasterToRoot(masters: MasterAccountLite[]): Map<string, string> {
  const byId = new Map(masters.map((m) => [m.id, m]));
  const memo = new Map<string, string>();
  function walk(id: string, seen: Set<string>): string {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return id;
    seen.add(id);
    const m = byId.get(id);
    if (!m || !m.parent_account_id) {
      memo.set(id, id);
      return id;
    }
    const r = walk(m.parent_account_id, seen);
    memo.set(id, r);
    return r;
  }
  for (const m of masters) walk(m.id, new Set());
  return memo;
}

function resolveSide(
  masterId: string | undefined,
  byId: Map<string, MasterAccountLite>,
  toRoot: Map<string, string>,
): ResolvedSide | null {
  if (!masterId) return null;
  const m = byId.get(masterId);
  if (!m) return null;
  const rootId = toRoot.get(m.id) ?? m.id;
  const root = byId.get(rootId) ?? m;
  return {
    masterId: m.id,
    masterName: m.name,
    masterNumber: m.account_number,
    rootMasterId: root.id,
    rootMasterName: root.name,
    rootMasterNumber: root.account_number,
    classification: m.classification,
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Resolve both charts
  let mgmtChart, accChart;
  try {
    [mgmtChart, accChart] = await Promise.all([
      resolveChart(admin, body.organizationId, "management"),
      resolveChart(admin, body.organizationId, "accountant"),
    ]);
  } catch (e) {
    return NextResponse.json(
      { error: `Both charts must exist: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  // Optional reporting-entity filter — limit to entities that belong to the RE.
  let entityFilter: string[] | null = null;
  if (body.reportingEntityId) {
    const { data: memberRows } = await admin
      .from("reporting_entity_members")
      .select("entity_id")
      .eq("reporting_entity_id", body.reportingEntityId);
    entityFilter = (memberRows ?? []).map((r: { entity_id: string }) => r.entity_id);
    if (entityFilter && entityFilter.length === 0) {
      return NextResponse.json({ rows: [] });
    }
  }

  // Pull masters for both charts.
  const [mgmtMasters, accMasters] = await Promise.all([
    fetchAllPaginated<MasterAccountLite>((offset, limit) =>
      admin
        .from("master_accounts")
        .select("id, name, account_number, classification, parent_account_id, chart_id")
        .eq("organization_id", body.organizationId)
        .eq("chart_id", mgmtChart.id)
        .eq("is_active", true)
        .range(offset, offset + limit - 1),
    ),
    fetchAllPaginated<MasterAccountLite>((offset, limit) =>
      admin
        .from("master_accounts")
        .select("id, name, account_number, classification, parent_account_id, chart_id")
        .eq("organization_id", body.organizationId)
        .eq("chart_id", accChart.id)
        .eq("is_active", true)
        .range(offset, offset + limit - 1),
    ),
  ]);

  // Pull mappings filtered by master_id (chunked to avoid header blow-out).
  const mgmtMasterIds = mgmtMasters.map((m) => m.id);
  const accMasterIds = accMasters.map((m) => m.id);

  async function fetchMappingsForMasters(masterIds: string[]): Promise<MappingRow[]> {
    const out: MappingRow[] = [];
    const CHUNK = 200;
    for (let i = 0; i < masterIds.length; i += CHUNK) {
      const slice = masterIds.slice(i, i + CHUNK);
      const rows = await fetchAllPaginated<MappingRow>((offset, limit) =>
        admin
          .from("master_account_mappings")
          .select("account_id, master_account_id, entity_id")
          .in("master_account_id", slice)
          .range(offset, offset + limit - 1),
      );
      out.push(...rows);
    }
    return out;
  }

  const [mgmtMappingsReal, accMappingsReal] = await Promise.all([
    fetchMappingsForMasters(mgmtMasterIds),
    fetchMappingsForMasters(accMasterIds),
  ]);

  // Apply RE filter if provided
  const mgmtMaps = entityFilter
    ? mgmtMappingsReal.filter((r) => entityFilter!.includes(r.entity_id))
    : mgmtMappingsReal;
  const accMaps = entityFilter
    ? accMappingsReal.filter((r) => entityFilter!.includes(r.entity_id))
    : accMappingsReal;

  // Build chart context lookups
  const mgmtById = new Map(mgmtMasters.map((m) => [m.id, m]));
  const accById = new Map(accMasters.map((m) => [m.id, m]));
  const mgmtToRoot = buildMasterToRoot(mgmtMasters);
  const accToRoot = buildMasterToRoot(accMasters);

  // Index: (entity_id, account_id) → master_id per chart.
  // Mappings are entity-scoped on the master_account_mappings table.
  const mgmtByEAcc = new Map<string, string>();
  for (const m of mgmtMaps) mgmtByEAcc.set(`${m.entity_id}|${m.account_id}`, m.master_account_id);
  const accByEAcc = new Map<string, string>();
  for (const m of accMaps) accByEAcc.set(`${m.entity_id}|${m.account_id}`, m.master_account_id);

  // Set of all (entity_id, account_id) pairs from either chart.
  const allKeys = new Set<string>([...mgmtByEAcc.keys(), ...accByEAcc.keys()]);

  // Bulk lookup the underlying account + entity rows for display.
  const accountIds = [...new Set([...allKeys].map((k) => k.split("|")[1]))];
  const entityIds = [...new Set([...allKeys].map((k) => k.split("|")[0]))];

  async function fetchAccountsChunked(ids: string[]): Promise<AccountRow[]> {
    const out: AccountRow[] = [];
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const rows = await fetchAllPaginated<AccountRow>((offset, limit) =>
        admin
          .from("accounts")
          .select("id, entity_id, account_number, name, classification")
          .in("id", slice)
          .range(offset, offset + limit - 1),
      );
      out.push(...rows);
    }
    return out;
  }

  const [accountRows, entityRows] = await Promise.all([
    fetchAccountsChunked(accountIds),
    fetchAllPaginated<EntityRow>((offset, limit) =>
      admin
        .from("entities")
        .select("id, name, code")
        .in("id", entityIds)
        .range(offset, offset + limit - 1),
    ),
  ]);

  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const entityById = new Map(entityRows.map((e) => [e.id, e]));

  const rows: MappingDiffRow[] = [];
  for (const key of allKeys) {
    const [entityId, accountId] = key.split("|");
    const mgmt = resolveSide(mgmtByEAcc.get(key), mgmtById, mgmtToRoot);
    const acc = resolveSide(accByEAcc.get(key), accById, accToRoot);

    let status: MappingDiffRow["status"];
    if (!mgmt && !acc) status = "unmapped_both";
    else if (!mgmt) status = "unmapped_mgt";
    else if (!acc) status = "unmapped_acc";
    else if (
      // Same root (line) on both charts AND same classification → "same"
      mgmt.rootMasterName.trim().toLowerCase() ===
        acc.rootMasterName.trim().toLowerCase() &&
      mgmt.classification === acc.classification
    ) {
      status = "same";
    } else {
      status = "different";
    }

    const account = accountById.get(accountId);
    const entity = entityById.get(entityId);

    rows.push({
      glAccountId: accountId,
      glAccountName: account?.name ?? "(unknown)",
      glAccountNumber: account?.account_number ?? null,
      glClassification: account?.classification ?? "",
      entityId,
      entityCode: entity?.code ?? "",
      entityName: entity?.name ?? "",
      acc,
      mgt: mgmt,
      status,
    });
  }

  // Sort: differences first (most actionable), then by entity, then by account number
  rows.sort((a, b) => {
    const statusRank = (s: string) =>
      s === "different" ? 0 :
      s === "unmapped_acc" || s === "unmapped_mgt" ? 1 :
      s === "same" ? 2 : 3;
    const sr = statusRank(a.status) - statusRank(b.status);
    if (sr !== 0) return sr;
    if (a.entityCode !== b.entityCode) return a.entityCode.localeCompare(b.entityCode);
    return (a.glAccountNumber ?? "").localeCompare(b.glAccountNumber ?? "");
  });

  return NextResponse.json({ rows });
}

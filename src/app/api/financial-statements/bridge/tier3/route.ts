// POST /api/financial-statements/bridge/tier3
//
// Lazy fetch — given a master_account_id, return per-GL-account contribution
// to the master's ending balance (BS) or net change (P&L) for the requested
// period buckets.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import type { BridgeTier3Row, BridgeStatement } from "@/lib/financial-statements/bridge-types";

interface Tier3Request {
  organizationId: string;
  masterAccountId: string;
  statement: BridgeStatement;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  periodKeys: Array<{
    key: string;
    year: number;
    startMonth: number;
    endYear: number;
    endMonth: number;
  }>;
}

interface RawGLBalance {
  account_id: string;
  entity_id: string;
  period_year: number;
  period_month: number;
  beginning_balance: number;
  ending_balance: number;
  net_change: number;
}

interface MappingRow {
  account_id: string;
  entity_id: string;
}

interface AccountRow {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
}

interface EntityRow {
  id: string;
  name: string;
  code: string;
}

function findBucketForMonth(
  periods: Tier3Request["periodKeys"],
  year: number,
  month: number,
): string | null {
  for (const p of periods) {
    const startKey = p.year * 12 + (p.startMonth - 1);
    const endKey = p.endYear * 12 + (p.endMonth - 1);
    const k = year * 12 + (month - 1);
    if (k >= startKey && k <= endKey) return p.key;
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Tier3Request;
  try {
    body = (await request.json()) as Tier3Request;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.organizationId || !body.masterAccountId || !body.statement) {
    return NextResponse.json(
      { error: "organizationId, masterAccountId, and statement are required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Resolve mappings: which entity-level account_ids feed this master.
  const mappings: MappingRow[] = await fetchAllPaginated<MappingRow>((offset, limit) =>
    admin
      .from("master_account_mappings")
      .select("account_id, entity_id")
      .eq("master_account_id", body.masterAccountId)
      .range(offset, offset + limit - 1),
  );

  if (mappings.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  const accountIds = [...new Set(mappings.map((m) => m.account_id))];
  const entityIds = [...new Set(mappings.map((m) => m.entity_id))];

  // Fetch GL balances for those accounts in the requested period range.
  // Build the year/month set we need.
  const monthsNeeded: Array<{ year: number; month: number }> = [];
  for (const p of body.periodKeys) {
    let y = p.year;
    let m = p.startMonth;
    const endKey = p.endYear * 12 + (p.endMonth - 1);
    while (y * 12 + (m - 1) <= endKey) {
      monthsNeeded.push({ year: y, month: m });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  const yearsNeeded = [...new Set(monthsNeeded.map((m) => m.year))];
  const monthSet = new Set(monthsNeeded.map((m) => `${m.year}-${m.month}`));

  // Fetch by account_id chunked to avoid huge IN clauses.
  const CHUNK = 100;
  const balances: RawGLBalance[] = [];
  for (let i = 0; i < accountIds.length; i += CHUNK) {
    const slice = accountIds.slice(i, i + CHUNK);
    const rows: RawGLBalance[] = await fetchAllPaginated<RawGLBalance>((offset, limit) =>
      admin
        .from("gl_balances")
        .select("account_id, entity_id, period_year, period_month, beginning_balance, ending_balance, net_change")
        .in("account_id", slice)
        .in("period_year", yearsNeeded)
        .range(offset, offset + limit - 1),
    );
    for (const r of rows) {
      if (monthSet.has(`${r.period_year}-${r.period_month}`)) {
        balances.push({
          account_id: r.account_id,
          entity_id: r.entity_id,
          period_year: Number(r.period_year),
          period_month: Number(r.period_month),
          beginning_balance: Number(r.beginning_balance),
          ending_balance: Number(r.ending_balance),
          net_change: Number(r.net_change),
        });
      }
    }
  }

  // Resolve master classification — needed for sign convention.
  const { data: masterRow } = await admin
    .from("master_accounts")
    .select("classification")
    .eq("id", body.masterAccountId)
    .single();
  const masterClassification = (masterRow?.classification as string) ?? "";
  const isCreditNormal =
    masterClassification === "Revenue" ||
    masterClassification === "Liability" ||
    masterClassification === "Equity";
  const sign = isCreditNormal ? -1 : 1;

  // Aggregate per (entity_id, account_id) per bucket.
  // For BS we use ending_balance (last month of bucket wins).
  // For P&L we sum net_change across the bucket months.
  const accountInfo = new Map<string, AccountRow>();
  {
    const accRows: AccountRow[] = await fetchAllPaginated<AccountRow>((offset, limit) =>
      admin
        .from("accounts")
        .select("id, name, account_number, classification")
        .in("id", accountIds)
        .range(offset, offset + limit - 1),
    );
    for (const a of accRows) accountInfo.set(a.id, a);
  }

  const entityInfo = new Map<string, EntityRow>();
  {
    const entRows: EntityRow[] = await fetchAllPaginated<EntityRow>((offset, limit) =>
      admin
        .from("entities")
        .select("id, name, code")
        .in("id", entityIds)
        .range(offset, offset + limit - 1),
    );
    for (const e of entRows) entityInfo.set(e.id, e);
  }

  // Group balances by (entity_id, account_id).
  type Group = {
    entityId: string;
    accountId: string;
    perBucket: Record<string, { ending: number; netChange: number; lastMonth: number; lastYear: number }>;
  };
  const groups = new Map<string, Group>();
  for (const b of balances) {
    const bucketKey = findBucketForMonth(body.periodKeys, b.period_year, b.period_month);
    if (!bucketKey) continue;
    const k = `${b.entity_id}|${b.account_id}`;
    if (!groups.has(k)) {
      groups.set(k, { entityId: b.entity_id, accountId: b.account_id, perBucket: {} });
    }
    const g = groups.get(k)!;
    if (!g.perBucket[bucketKey]) {
      g.perBucket[bucketKey] = { ending: 0, netChange: 0, lastMonth: 0, lastYear: 0 };
    }
    const slot = g.perBucket[bucketKey];
    slot.netChange += b.net_change;
    // "Last month wins" for ending_balance per bucket
    const monthRank = b.period_year * 12 + (b.period_month - 1);
    const slotRank = slot.lastYear * 12 + (slot.lastMonth - 1);
    if (slot.lastYear === 0 || monthRank >= slotRank) {
      slot.ending = b.ending_balance;
      slot.lastMonth = b.period_month;
      slot.lastYear = b.period_year;
    }
  }

  const rows: BridgeTier3Row[] = [];
  for (const [, g] of groups) {
    const acc = accountInfo.get(g.accountId);
    const ent = entityInfo.get(g.entityId);
    const amounts: Record<string, number> = {};
    for (const k of Object.keys(g.perBucket)) {
      const slot = g.perBucket[k];
      const v = body.statement === "BS" ? slot.ending : slot.netChange;
      amounts[k] = sign * v;
    }
    rows.push({
      id: `${g.entityId}_${g.accountId}`,
      glAccountId: g.accountId,
      entityId: g.entityId,
      entityCode: ent?.code ?? "",
      entityName: ent?.name ?? "",
      accountName: acc?.name ?? "(unknown)",
      accountNumber: acc?.account_number ?? null,
      amounts,
    });
  }

  // Sort by entity code then account number
  rows.sort((a, b) => {
    if (a.entityCode !== b.entityCode) return a.entityCode.localeCompare(b.entityCode);
    return (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "");
  });

  return NextResponse.json({ rows });
}

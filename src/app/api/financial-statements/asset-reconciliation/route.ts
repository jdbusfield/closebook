// ---------------------------------------------------------------------------
// GET /api/financial-statements/asset-reconciliation
//
// Per-entity, per-period reconciliation of the general-ledger fixed-asset
// carrying-value change against what the model can explain (depreciation +
// subledger acquisitions/disposals + the hand-entered Fixed-Asset Activity
// schedule).  The leftover is the "unexplained residual" — the same figure that
// lands in the Investing "Other property & equipment activity, net" line.  The
// schedule tab uses this to flag which entities/periods still need entries.
//
// Mirrors the engine's Investing math (route.ts): carryingChange = −ΔNBV of
// "Fixed Asset" accounts; depreciation = monthly standalone D&A expense (YTD
// ending-balance differences with a fiscal-year reset).
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPeriodsInRange } from "@/lib/utils/dates";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { fetchAssetCashFlows } from "@/lib/utils/asset-cash-flows";
import { fetchScheduleCashFlows } from "@/lib/utils/fixed-asset-schedule";
import type { Granularity } from "@/components/financial-statements/types";

interface BucketRecon {
  carryingChange: number;
  depreciation: number;
  subledgerNet: number; // cash-basis: +additions line removal etc. (display only)
  scheduleNet: number;
  residual: number;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationIdParam = searchParams.get("organizationId");
  const entityIdParam = searchParams.get("entityId");
  const startYear = parseInt(searchParams.get("startYear") ?? "2025");
  const startMonth = parseInt(searchParams.get("startMonth") ?? "1");
  const endYear = parseInt(searchParams.get("endYear") ?? "2025");
  const endMonth = parseInt(searchParams.get("endMonth") ?? "12");
  const granularity = (searchParams.get("granularity") ?? "monthly") as Granularity;

  const admin = createAdminClient();

  // Resolve organization + entity scope
  let organizationId = organizationIdParam;
  if (!organizationId && entityIdParam) {
    const { data: ent } = await admin
      .from("entities")
      .select("organization_id")
      .eq("id", entityIdParam)
      .single();
    organizationId = ent?.organization_id ?? null;
  }
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId or entityId required" }, { status: 400 });
  }

  const { data: entityRows } = await admin
    .from("entities")
    .select("id, name, code, fiscal_year_end_month, is_active")
    .eq("organization_id", organizationId);
  let entities = (entityRows ?? []).filter((e: { is_active: boolean }) => e.is_active);
  if (entityIdParam) entities = entities.filter((e: { id: string }) => e.id === entityIdParam);
  if (entities.length === 0) {
    return NextResponse.json({ periods: [], rows: [] });
  }

  const buckets = getPeriodsInRange(startYear, startMonth, endYear, endMonth, granularity);
  if (buckets.length === 0) return NextResponse.json({ periods: [], rows: [] });

  // Contiguous month span: the month BEFORE the first bucket's first month,
  // through the last bucket's end month (needed for −ΔNBV and YTD deltas).
  const firstMonth = buckets[0].months[0];
  const spanStart = firstMonth.month === 1
    ? { year: firstMonth.year - 1, month: 12 }
    : { year: firstMonth.year, month: firstMonth.month - 1 };
  const spanEnd = { year: endYear, month: endMonth };
  const spanMonths: Array<{ year: number; month: number }> = [];
  for (let y = spanStart.year, m = spanStart.month; y < spanEnd.year || (y === spanEnd.year && m <= spanEnd.month); ) {
    spanMonths.push({ year: y, month: m });
    if (m === 12) { y++; m = 1; } else { m++; }
  }
  const spanYears = [...new Set(spanMonths.map((x) => x.year))];
  const spanMonthNums = [...new Set(spanMonths.map((x) => x.month))];
  const inSpan = (y: number, m: number) => spanMonths.some((x) => x.year === y && x.month === m);
  const mk = (y: number, m: number) => `${y}-${m}`;

  const entityIds = entities.map((e: { id: string }) => e.id);

  // Fixed Asset + depreciation/amortization accounts for these entities
  const faAccts = await fetchAllPaginated<{ id: string; entity_id: string }>((offset, limit) =>
    admin
      .from("accounts")
      .select("id, entity_id, name, account_type, classification")
      .in("entity_id", entityIds)
      .eq("account_type", "Fixed Asset")
      .range(offset, offset + limit - 1)
  );
  const expAccts = await fetchAllPaginated<{ id: string; entity_id: string; name: string }>((offset, limit) =>
    admin
      .from("accounts")
      .select("id, entity_id, name, account_type, classification")
      .in("entity_id", entityIds)
      .eq("classification", "Expense")
      .range(offset, offset + limit - 1)
  );
  const faIdByEntity = new Map<string, Set<string>>();
  for (const a of faAccts) {
    if (!faIdByEntity.has(a.entity_id)) faIdByEntity.set(a.entity_id, new Set());
    faIdByEntity.get(a.entity_id)!.add(a.id);
  }
  const depIdByEntity = new Map<string, Set<string>>();
  for (const a of expAccts) {
    if (!/deprec|amort/i.test(a.name)) continue;
    if (!depIdByEntity.has(a.entity_id)) depIdByEntity.set(a.entity_id, new Set());
    depIdByEntity.get(a.entity_id)!.add(a.id);
  }

  const allAcctIds = [...faAccts.map((a) => a.id), ...expAccts.map((a) => a.id)];

  // GL endings across the span
  const gl = allAcctIds.length === 0
    ? []
    : await fetchAllPaginated<{
        account_id: string;
        entity_id: string;
        period_year: number;
        period_month: number;
        ending_balance: number | string;
      }>((offset, limit) =>
        admin
          .from("gl_balances")
          .select("account_id, entity_id, period_year, period_month, ending_balance")
          .in("account_id", allAcctIds)
          .in("period_year", spanYears)
          .in("period_month", spanMonthNums)
          .range(offset, offset + limit - 1)
      );

  // faEnd[entity][year-month] and depEnd[entity][year-month]
  const faEnd = new Map<string, Map<string, number>>();
  const depEnd = new Map<string, Map<string, number>>();
  for (const r of gl) {
    if (!inSpan(r.period_year, r.period_month)) continue;
    const key = mk(r.period_year, r.period_month);
    const faSet = faIdByEntity.get(r.entity_id);
    const depSet = depIdByEntity.get(r.entity_id);
    if (faSet?.has(r.account_id)) {
      if (!faEnd.has(r.entity_id)) faEnd.set(r.entity_id, new Map());
      const m = faEnd.get(r.entity_id)!;
      m.set(key, (m.get(key) ?? 0) + Number(r.ending_balance));
    } else if (depSet?.has(r.account_id)) {
      if (!depEnd.has(r.entity_id)) depEnd.set(r.entity_id, new Map());
      const m = depEnd.get(r.entity_id)!;
      m.set(key, (m.get(key) ?? 0) + Number(r.ending_balance));
    }
  }

  const rows = [];
  for (const e of entities) {
    const fyEnd = (e as { fiscal_year_end_month: number | null }).fiscal_year_end_month ?? 12;
    const fyStart = (fyEnd % 12) + 1;
    const fa = faEnd.get(e.id) ?? new Map<string, number>();
    const dep = depEnd.get(e.id) ?? new Map<string, number>();

    // Subledger + schedule per bucket (already bucketed, cash-basis where signed)
    const asset = await fetchAssetCashFlows(admin, [e.id], buckets);
    const sched = await fetchScheduleCashFlows(admin, [e.id], buckets);

    const byBucket: Record<string, BucketRecon> = {};
    const totals: BucketRecon = {
      carryingChange: 0,
      depreciation: 0,
      subledgerNet: 0,
      scheduleNet: 0,
      residual: 0,
    };

    for (const b of buckets) {
      // carrying change = −(FA ending at bucket end − FA ending at month before bucket start)
      const last = b.months[b.months.length - 1];
      const first = b.months[0];
      const beforeFirst = first.month === 1
        ? { year: first.year - 1, month: 12 }
        : { year: first.year, month: first.month - 1 };
      const endBal = fa.get(mk(last.year, last.month)) ?? 0;
      const begBal = fa.get(mk(beforeFirst.year, beforeFirst.month)) ?? 0;
      const carryingChange = -(endBal - begBal);

      // depreciation = Σ monthly standalone over bucket months (fiscal reset)
      let depreciation = 0;
      for (const m of b.months) {
        const cur = dep.get(mk(m.year, m.month)) ?? 0;
        if (m.month === fyStart) {
          depreciation += cur;
        } else {
          const pm = m.month === 1 ? 12 : m.month - 1;
          const py = m.month === 1 ? m.year - 1 : m.year;
          depreciation += cur - (dep.get(mk(py, pm)) ?? 0);
        }
      }

      const additions = asset.additionsByBucket[b.key] ?? 0;
      const disposals = asset.disposalProceedsByBucket[b.key] ?? 0;
      const purchaseLine = -additions;
      const proceedsLine = disposals;
      const schedCash = sched.cashPurchasesByBucket[b.key] ?? 0;
      const schedProceeds = sched.disposalProceedsByBucket[b.key] ?? 0;
      const schedNonCash = (sched.writeoffByBucket[b.key] ?? 0) + (sched.reclassByBucket[b.key] ?? 0);

      const subledgerNet = purchaseLine + proceedsLine;
      const scheduleNet = schedCash + schedProceeds + schedNonCash;
      const investingTotal = carryingChange - depreciation;
      const residual = investingTotal - purchaseLine - proceedsLine - schedCash - schedProceeds - schedNonCash;

      byBucket[b.key] = {
        carryingChange,
        depreciation,
        subledgerNet,
        scheduleNet,
        residual,
      };
      totals.carryingChange += carryingChange;
      totals.depreciation += depreciation;
      totals.subledgerNet += subledgerNet;
      totals.scheduleNet += scheduleNet;
      totals.residual += residual;
    }

    rows.push({
      entityId: e.id,
      entityCode: e.code,
      entityName: e.name,
      byBucket,
      totals,
    });
  }

  return NextResponse.json({
    periods: buckets.map((b) => ({ key: b.key, label: b.label })),
    rows,
  });
}

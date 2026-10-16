import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Qbo, accessToken, type Connection } from "@/lib/revenue-accrual/qbo";
import {
  AD_EXPENSE_TAGS,
  AD_TXN_TYPES,
  adAccountIds,
  adLinesFromTxn,
  type AdExpenseTag,
  type AdExpenseTagRow,
  type QboAdExpenseLine,
} from "@/lib/ads/qbo-ad-expenses";

export const runtime = "nodejs";
export const maxDuration = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Restroom ad ROI on the Ads tab. GET pulls every advertising line from each
// QuickBooks company the user can see, joins the restroom tags, and adds the
// monthly ad-platform spend and the restroom revenue (QBO "Bathroom" classes)
// for the ROI table. Session only: the embed never shows this section.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId")?.trim();
  const from = url.searchParams.get("from") ?? `${new Date().getFullYear()}-01-01`;
  const to = url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  if (!entityId) return NextResponse.json({ error: "entityId required" }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
  }

  // RLS on entities decides which companies this user may see.
  const { data: visible } = await supabase.from("entities").select("id, name");
  const entities = (visible ?? []) as { id: string; name: string }[];
  if (!entities.some((e) => e.id === entityId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const nameOf = new Map(entities.map((e) => [e.id, e.name]));

  const admin = createAdminClient();
  const { data: conns } = await admin
    .from("qbo_connections")
    .select("id, entity_id, realm_id, access_token, refresh_token, access_token_expires_at")
    .in("entity_id", entities.map((e) => e.id));

  const where = `TxnDate >= '${from}' AND TxnDate <= '${to}'`;
  const scanned: { entityId: string; name: string; ok: boolean; error?: string; lines: number }[] = [];
  const lines: QboAdExpenseLine[] = [];
  await Promise.all(
    ((conns ?? []) as (Connection & { entity_id: string })[]).map(async (c) => {
      const entity = { id: c.entity_id, name: nameOf.get(c.entity_id) ?? "" };
      try {
        const qbo = new Qbo(c.realm_id, await accessToken(admin, c));
        const accounts = adAccountIds(await qbo.queryAll("Account", "Active IN (true, false)"));
        let n = 0;
        if (accounts.size > 0) {
          for (const type of AD_TXN_TYPES) {
            for (const txn of await qbo.queryAll(type, where)) {
              const found = adLinesFromTxn(type, txn, accounts, entity);
              n += found.length;
              lines.push(...found);
            }
          }
        }
        scanned.push({ entityId: entity.id, name: entity.name, ok: true, lines: n });
      } catch (e) {
        scanned.push({ entityId: entity.id, name: entity.name, ok: false, lines: 0, error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );
  lines.sort((a, b) => b.date.localeCompare(a.date) || a.entityName.localeCompare(b.entityName));
  scanned.sort((a, b) => a.name.localeCompare(b.name));

  // Tags. A missing table means the migration hasn't been applied yet.
  let tags: AdExpenseTagRow[] = [];
  let tagsReady = true;
  {
    const { data, error } = await admin
      .from("qbo_ad_expense_tags")
      .select("entity_id, txn_type, txn_id, line_id, tag, restroom_share, note")
      .in("entity_id", entities.map((e) => e.id));
    if (error) tagsReady = false;
    else tags = (data ?? []) as AdExpenseTagRow[];
  }

  // Ad-platform spend for the page's brand, by month and platform.
  const platformSpend: Record<string, Record<string, number>> = {};
  for (let start = 0; ; start += 1000) {
    const { data } = await admin
      .from("ad_platform_daily")
      .select("platform, date, spend")
      .eq("entity_id", entityId)
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .range(start, start + 999);
    for (const r of data ?? []) {
      const m = String(r.date).slice(0, 7);
      platformSpend[m] ??= {};
      platformSpend[m][r.platform] = (platformSpend[m][r.platform] ?? 0) + Number(r.spend ?? 0);
    }
    if (!data || data.length < 1000) break;
  }
  const { data: manual } = await admin
    .from("rental_inquiry_ad_spend")
    .select("month, amount")
    .eq("entity_id", entityId);
  const manualSpend: Record<string, number> = {};
  for (const r of manual ?? []) {
    const m = String(r.month).slice(0, 7);
    if (m >= from.slice(0, 7) && m <= to.slice(0, 7)) manualSpend[m] = Number(r.amount ?? 0);
  }

  // Restroom revenue: income posted to any QBO class named like "Bathroom".
  const restroomRevenue: Record<string, number> = {};
  const fy = Number(from.slice(0, 4));
  const ty = Number(to.slice(0, 4));
  for (let start = 0; ; start += 1000) {
    const { data } = await admin
      .from("gl_class_balances")
      .select("period_year, period_month, net_change, qbo_classes!inner(name), accounts!inner(account_type)")
      .in("entity_id", entities.map((e) => e.id))
      .gte("period_year", fy)
      .lte("period_year", ty)
      .ilike("qbo_classes.name", "%bathroom%")
      .in("accounts.account_type", ["Income", "Other Income"])
      .order("id")
      .range(start, start + 999);
    for (const r of (data ?? []) as any[]) {
      const m = `${r.period_year}-${String(r.period_month).padStart(2, "0")}`;
      if (m < from.slice(0, 7) || m > to.slice(0, 7)) continue;
      restroomRevenue[m] = (restroomRevenue[m] ?? 0) - Number(r.net_change ?? 0);
    }
    if (!data || data.length < 1000) break;
  }

  return NextResponse.json({ from, to, lines, scanned, tags, tagsReady, platformSpend, manualSpend, restroomRevenue });
}

// Save tags for one or more lines. Body: { tags: [{ entityId, txnType, txnId,
// lineId, tag | null, restroomShare?, note? }] }; tag null clears the line.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { tags?: any[] };
  const items = Array.isArray(body.tags) ? body.tags : [];
  if (items.length === 0 || items.length > 500) {
    return NextResponse.json({ error: "tags must hold 1 to 500 lines" }, { status: 400 });
  }

  const { data: visible } = await supabase.from("entities").select("id");
  const allowed = new Set((visible ?? []).map((e: { id: string }) => e.id));

  const upserts: any[] = [];
  const clears: any[] = [];
  for (const t of items) {
    const entityId = String(t.entityId ?? "");
    const txnType = String(t.txnType ?? "");
    const txnId = String(t.txnId ?? "");
    const lineId = String(t.lineId ?? "");
    if (!allowed.has(entityId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!(AD_TXN_TYPES as readonly string[]).includes(txnType) || !txnId) {
      return NextResponse.json({ error: "Bad transaction reference" }, { status: 400 });
    }
    if (t.tag === null) {
      clears.push({ entityId, txnType, txnId, lineId });
      continue;
    }
    if (!AD_EXPENSE_TAGS.includes(t.tag as AdExpenseTag)) {
      return NextResponse.json({ error: "Unknown tag" }, { status: 400 });
    }
    const share = t.restroomShare === undefined ? 1 : Number(t.restroomShare);
    if (!Number.isFinite(share) || share < 0 || share > 1) {
      return NextResponse.json({ error: "Restroom share must be between 0 and 100%" }, { status: 400 });
    }
    upserts.push({
      entity_id: entityId,
      txn_type: txnType,
      txn_id: txnId,
      line_id: lineId,
      tag: t.tag,
      restroom_share: t.tag === "restroom_ads" ? share : 0,
      note: typeof t.note === "string" ? t.note.slice(0, 500) : null,
      tagged_by: user.id,
      updated_at: new Date().toISOString(),
    });
  }

  if (upserts.length) {
    const { error } = await supabase
      .from("qbo_ad_expense_tags")
      .upsert(upserts, { onConflict: "entity_id,txn_type,txn_id,line_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  for (const c of clears) {
    const { error } = await supabase
      .from("qbo_ad_expense_tags")
      .delete()
      .eq("entity_id", c.entityId)
      .eq("txn_type", c.txnType)
      .eq("txn_id", c.txnId)
      .eq("line_id", c.lineId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: upserts.length, cleared: clears.length });
}

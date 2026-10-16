/**
 * Versatile Rewards nightly run: cached RentalWorks invoices in, ledger and
 * member summaries out. Server-only (service-role client).
 *
 * 1. Load the program settings and tiers (created from defaults on first use).
 * 2. Load counted invoices + line items from rw_invoices_cache / rw_invoice_items.
 * 3. Auto-enroll RW customers that aren't linked to a member yet (shadow).
 * 4. Per member, compute earn rows (engine.ts) and upsert them by source_key;
 *    delete earn rows whose invoice dropped out of scope (e.g. voided).
 * 5. Recompute every member's balance and tier; log live tier changes for the
 *    rental team.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  computeBalance,
  computeMemberEarnings,
  earliestCountedDate,
  sortTiers,
  tierForSpend,
  tierStatus,
  type CachedInvoice,
  type CachedItem,
  type EarnRow,
  type RewardsSettings,
  type TierDef,
} from "./engine";
import { DEFAULT_CATALOG, DEFAULT_PERKS, DEFAULT_TIERS } from "./defaults";
import { getEntityFeatures } from "@/components/layout/nav-config";

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1000;

/** Today in Los Angeles, YYYY-MM-DD. */
export function todayLA(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** Page through a query builder factory until a short page comes back. */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Program setup ─────────────────────────────────────────────────────────

/**
 * Whether an entity runs the rewards program (the same "rewards" feature that
 * shows the sidebar item). The invoice cache has no entity_id, so a program on
 * any other entity would post Versatile invoices to it.
 */
export async function isRewardsEntity(admin: Admin, entityId: string): Promise<boolean> {
  const { data } = await admin.from("entities").select("name").eq("id", entityId).maybeSingle();
  return getEntityFeatures(data?.name ?? undefined).has("rewards");
}

/** Create the program, tiers, perks and catalog from defaults if missing. */
export async function ensureProgram(admin: Admin, entityId: string): Promise<void> {
  const { data: existing } = await admin.from("rewards_programs").select("entity_id").eq("entity_id", entityId).maybeSingle();
  if (existing) return;

  const { error: progErr } = await admin.from("rewards_programs").insert({ entity_id: entityId });
  if (progErr && !/duplicate/i.test(progErr.message)) throw new Error(progErr.message);

  const { data: tierRows, error: tierErr } = await admin
    .from("rewards_tiers")
    .upsert(DEFAULT_TIERS.map((t) => ({ ...t, entity_id: entityId })), { onConflict: "entity_id,key", ignoreDuplicates: true })
    .select("id, key");
  if (tierErr) throw new Error(tierErr.message);

  const { data: perkRows, error: perkErr } = await admin
    .from("rewards_perks")
    .upsert(
      DEFAULT_PERKS.map((p, i) => ({
        entity_id: entityId,
        key: p.key,
        name: p.name,
        category: p.category,
        value_kind: p.value_kind,
        description: p.description ?? null,
        sort_order: i + 1,
      })),
      { onConflict: "entity_id,key", ignoreDuplicates: true },
    )
    .select("id, key");
  if (perkErr) throw new Error(perkErr.message);

  const tierPerks = [];
  for (const perk of perkRows ?? []) {
    const def = DEFAULT_PERKS.find((p) => p.key === perk.key);
    for (const tier of tierRows ?? []) {
      const proposed = def?.proposed[tier.key as keyof typeof def.proposed] ?? null;
      tierPerks.push({ tier_id: tier.id, perk_id: perk.id, enabled: false, proposed_value: proposed });
    }
  }
  if (tierPerks.length > 0) {
    const { error } = await admin.from("rewards_tier_perks").upsert(tierPerks, { onConflict: "tier_id,perk_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  const { count } = await admin.from("rewards_catalog_items").select("id", { count: "exact", head: true }).eq("entity_id", entityId);
  if (!count) {
    const { error } = await admin
      .from("rewards_catalog_items")
      .insert(DEFAULT_CATALOG.map((c, i) => ({ ...c, entity_id: entityId, sort_order: i + 1 })));
    if (error) throw new Error(error.message);
  }
}

export interface LoadedProgram {
  settings: RewardsSettings;
  tiers: TierDef[];
  tierIds: Map<string, string>;
}

export async function loadProgram(admin: Admin, entityId: string): Promise<LoadedProgram> {
  await ensureProgram(admin, entityId);
  const [{ data: prog, error: progErr }, { data: tierRows, error: tierErr }] = await Promise.all([
    admin.from("rewards_programs").select("*").eq("entity_id", entityId).single(),
    admin.from("rewards_tiers").select("*").eq("entity_id", entityId),
  ]);
  if (progErr || !prog) throw new Error(progErr?.message ?? "Rewards program missing");
  if (tierErr) throw new Error(tierErr.message);
  if (!tierRows || tierRows.length === 0) throw new Error("Rewards program has no tiers");

  let excluded = [...(prog.excluded_icodes ?? [])];
  if (prog.use_rebate_exclusions) {
    const { data } = await admin
      .from("rebate_excluded_icodes")
      .select("i_code")
      .eq("entity_id", entityId)
      .is("rebate_customer_id", null);
    excluded = excluded.concat((data ?? []).map((r) => r.i_code));
  }

  const upper = (a: string[] | null) => (a ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
  return {
    settings: {
      programStartDate: prog.program_start_date,
      previewStartDate: prog.preview_start_date,
      invoicePrefixes: upper(prog.invoice_prefixes),
      countedStatuses: upper(prog.counted_statuses),
      paidStatuses: upper(prog.paid_statuses),
      eligibleRecTypes: upper(prog.eligible_rec_types),
      excludedICodes: upper(excluded),
      bathroomICodes: upper(prog.bathroom_icodes),
      weekendBonusEnabled: prog.weekend_bonus_enabled,
      pointsExpireMonths: prog.points_expire_months,
    },
    tiers: tierRows.map((t) => ({
      key: t.key,
      name: t.name,
      sortOrder: t.sort_order,
      minAnnualSpend: Number(t.min_annual_spend),
      pointsPerDollar: Number(t.points_per_dollar),
      weekendPointsPerDollar: t.weekend_points_per_dollar === null ? null : Number(t.weekend_points_per_dollar),
      bathroomBonusPoints: t.bathroom_bonus_points,
    })),
    tierIds: new Map(tierRows.map((t) => [t.key, t.id])),
  };
}

// ── Source data ─────────────────────────────────────────────────────────

async function loadInvoices(admin: Admin, settings: RewardsSettings) {
  const since = earliestCountedDate(settings);
  const prefixFilter = settings.invoicePrefixes.map((p) => `invoice_number.like.${p}%`).join(",");
  const invoices = await fetchAll((from, to) =>
    admin
      .from("rw_invoices_cache")
      .select("rw_invoice_id, invoice_number, invoice_date, billing_start_date, billing_end_date, status, customer_id, customer, sub_total")
      .gte("invoice_date", since)
      .in("status", settings.countedStatuses)
      .or(prefixFilter)
      .order("rw_invoice_id")
      .range(from, to),
  );
  const items = await fetchAll((from, to) =>
    admin
      .from("rw_invoice_items")
      .select("id, rw_invoice_id, i_code, rec_type, extended, quantity")
      .gte("invoice_date", since)
      .or(prefixFilter)
      .order("id")
      .range(from, to),
  );

  const itemsByInvoice = new Map<string, CachedItem[]>();
  for (const it of items) {
    const list = itemsByInvoice.get(it.rw_invoice_id) ?? [];
    list.push({ iCode: it.i_code, recType: it.rec_type, extended: Number(it.extended) || 0, quantity: Number(it.quantity) || 0 });
    itemsByInvoice.set(it.rw_invoice_id, list);
  }

  const cached: CachedInvoice[] = invoices
    .filter((r) => r.customer_id && r.invoice_date && r.invoice_number)
    .map((r) => ({
      rwInvoiceId: r.rw_invoice_id,
      invoiceNumber: r.invoice_number as string,
      invoiceDate: r.invoice_date as string,
      billingStartDate: r.billing_start_date,
      billingEndDate: r.billing_end_date,
      status: (r.status ?? "").toUpperCase(),
      customerId: r.customer_id as string,
      customerName: r.customer ?? "",
      subTotal: Number(r.sub_total) || 0,
    }));
  return { invoices: cached, itemsByInvoice };
}

// ── The run ───────────────────────────────────────────────────────────────

export interface RunSummary {
  invoices: number;
  members: number;
  newMembers: number;
  earnRowsWritten: number;
  earnRowsDeleted: number;
  tierChanges: number;
  asOf: string;
  durationMs: number;
}

export async function runRewards(admin: Admin, entityId: string, opts: { asOf?: string } = {}): Promise<RunSummary> {
  const started = Date.now();
  const asOf = opts.asOf ?? todayLA();
  const { settings, tiers } = await loadProgram(admin, entityId);
  const { data: prog } = await admin.from("rewards_programs").select("auto_enroll").eq("entity_id", entityId).single();
  const { invoices, itemsByInvoice } = await loadInvoices(admin, settings);

  // Members and their linked RW customers
  const links = await fetchAll((from, to) =>
    admin.from("rewards_member_customers").select("member_id, rw_customer_id").eq("entity_id", entityId).order("id").range(from, to),
  );
  const memberByCustomer = new Map(links.map((l) => [l.rw_customer_id, l.member_id]));

  // Auto-enroll customers with counted invoices and no member yet
  let newMembers = 0;
  if (prog?.auto_enroll !== false) {
    const latestName = new Map<string, { name: string; date: string }>();
    for (const inv of invoices) {
      if (memberByCustomer.has(inv.customerId)) continue;
      const cur = latestName.get(inv.customerId);
      if (!cur || inv.invoiceDate > cur.date) latestName.set(inv.customerId, { name: inv.customerName, date: inv.invoiceDate });
    }
    for (const batch of chunks([...latestName.entries()], 200)) {
      const { data: created, error } = await admin
        .from("rewards_members")
        .insert(batch.map(([, v]) => ({ entity_id: entityId, name: v.name || "Unnamed customer" })))
        .select("id");
      if (error) throw new Error(error.message);
      const linkRows = batch.map(([customerId, v], i) => ({
        entity_id: entityId,
        member_id: created![i].id,
        rw_customer_id: customerId,
        customer_name: v.name,
      }));
      const { error: linkErr } = await admin.from("rewards_member_customers").insert(linkRows);
      if (linkErr) throw new Error(linkErr.message);
      for (const l of linkRows) memberByCustomer.set(l.rw_customer_id, l.member_id);
      newMembers += batch.length;
    }
  }

  const members = await fetchAll((from, to) =>
    admin
      .from("rewards_members")
      .select("id, name, status, current_tier_key")
      .eq("entity_id", entityId)
      .order("id")
      .range(from, to),
  );
  const optedOut = new Set(members.filter((m) => m.status === "opted_out").map((m) => m.id));

  // Earn rows per member
  const invoicesByMember = new Map<string, CachedInvoice[]>();
  for (const inv of invoices) {
    const memberId = memberByCustomer.get(inv.customerId);
    if (!memberId || optedOut.has(memberId)) continue;
    const list = invoicesByMember.get(memberId) ?? [];
    list.push(inv);
    invoicesByMember.set(memberId, list);
  }

  const earnRows: (EarnRow & { memberId: string })[] = [];
  for (const [memberId, list] of invoicesByMember) {
    const { rows } = computeMemberEarnings(list, itemsByInvoice, tiers, settings);
    for (const r of rows) earnRows.push({ ...r, memberId });
  }

  const now = new Date().toISOString();
  for (const batch of chunks(earnRows, 500)) {
    const { error } = await admin.from("rewards_ledger").upsert(
      batch.map((r) => ({
        entity_id: entityId,
        member_id: r.memberId,
        rw_customer_id: r.rwCustomerId,
        entry_type: "earn",
        source_key: r.sourceKey,
        points: r.points,
        eligible_spend: r.eligibleSpend,
        rw_invoice_id: r.rwInvoiceId,
        invoice_number: r.invoiceNumber,
        invoice_date: r.invoiceDate,
        invoice_status: r.invoiceStatus,
        tier_key: r.tierKey,
        points_per_dollar: r.pointsPerDollar,
        weekend_applied: r.weekendApplied,
        bonus_points: r.bonusPoints,
        is_preview: r.isPreview,
        is_available: r.isAvailable,
        earned_on: r.earnedOn,
        expires_on: r.expiresOn,
        updated_at: now,
      })),
      { onConflict: "entity_id,source_key" },
    );
    if (error) throw new Error(error.message);
  }

  // Drop earn rows whose invoice no longer counts (voided, re-scoped). Opted-out
  // members keep what they had.
  const keep = new Set(earnRows.map((r) => r.sourceKey));
  const existingEarn = await fetchAll((from, to) =>
    admin
      .from("rewards_ledger")
      .select("id, source_key, member_id")
      .eq("entity_id", entityId)
      .eq("entry_type", "earn")
      .order("id")
      .range(from, to),
  );
  const stale = existingEarn.filter((r) => r.source_key && !keep.has(r.source_key) && !optedOut.has(r.member_id)).map((r) => r.id);
  for (const batch of chunks(stale, 200)) {
    const { error } = await admin.from("rewards_ledger").delete().in("id", batch);
    if (error) throw new Error(error.message);
  }

  const tierChanges = await refreshMemberSummaries(admin, entityId, settings, tiers, members, asOf);

  const summary: RunSummary = {
    invoices: invoices.length,
    members: members.length,
    newMembers,
    earnRowsWritten: earnRows.length,
    earnRowsDeleted: stale.length,
    tierChanges,
    asOf,
    durationMs: Date.now() - started,
  };
  await admin
    .from("rewards_programs")
    .update({ last_run_at: new Date().toISOString(), last_run_summary: { ...summary }, updated_at: now })
    .eq("entity_id", entityId);
  return summary;
}

/**
 * Recompute balance and tier for every member from the ledger. Returns how many
 * live tier changes were logged for the rental team.
 */
export async function refreshMemberSummaries(
  admin: Admin,
  entityId: string,
  settings: RewardsSettings,
  tiers: TierDef[],
  members: { id: string; name: string; status: string; current_tier_key: string | null }[],
  asOf: string,
): Promise<number> {
  const ledger = await fetchAll((from, to) =>
    admin
      .from("rewards_ledger")
      .select("member_id, entry_type, points, eligible_spend, invoice_date, earned_on, expires_on, is_available, is_preview")
      .eq("entity_id", entityId)
      .order("id")
      .range(from, to),
  );
  const byMember = new Map<string, typeof ledger>();
  for (const row of ledger) {
    const list = byMember.get(row.member_id) ?? [];
    list.push(row);
    byMember.set(row.member_id, list);
  }

  const sorted = sortTiers(tiers);
  const lowest = sorted[0];
  const live = asOf >= settings.programStartDate;
  const statusDate = live ? asOf : settings.programStartDate;
  const now = new Date().toISOString();
  const updates = [];
  const changes = [];

  for (const m of members) {
    const rows = byMember.get(m.id) ?? [];
    const liveSpend = new Map<number, number>();
    const previewSpend = new Map<number, number>();
    let previewPoints = 0;
    for (const r of rows) {
      if (r.entry_type !== "earn" || !r.invoice_date) continue;
      const y = Number(r.invoice_date.slice(0, 4));
      const target = r.is_preview ? previewSpend : liveSpend;
      target.set(y, (target.get(y) ?? 0) + Number(r.eligible_spend));
      if (r.is_preview) previewPoints += r.points;
    }
    const status = tierStatus(liveSpend, tiers, settings, statusDate);
    const balance = computeBalance(
      rows.map((r) => ({
        points: r.points,
        earnedOn: r.earned_on,
        expiresOn: r.expires_on,
        isAvailable: r.is_available,
        isPreview: r.is_preview,
      })),
      asOf,
    );
    const previewYear = previewSpend.size > 0 ? Math.max(...previewSpend.keys()) : null;
    const previewTotal = previewYear !== null ? previewSpend.get(previewYear) ?? 0 : 0;

    updates.push({
      id: m.id,
      entity_id: entityId,
      name: m.name,
      current_tier_key: status.tier.key,
      tier_effective_on: null as string | null,
      tier_expires_on: status.tier.key === lowest.key ? null : status.expiresOn,
      qualifying_year: status.qualifyingYear,
      qualifying_spend: status.qualifyingSpend,
      next_tier_key: status.next?.key ?? null,
      spend_to_next_tier: status.spendToNext,
      points_available: balance.available,
      points_pending: balance.pending,
      points_expiring_soon: balance.expiringSoon,
      points_lifetime: balance.lifetimeEarned,
      preview_spend: Math.round(previewTotal * 100) / 100,
      preview_points: previewPoints,
      preview_tier_key: previewYear !== null ? tierForSpend(sorted, previewTotal).key : null,
      summary_refreshed_at: now,
      updated_at: now,
    });

    if (live && m.status !== "opted_out" && m.current_tier_key && m.current_tier_key !== status.tier.key) {
      const up = sorted.findIndex((t) => t.key === status.tier.key) > sorted.findIndex((t) => t.key === m.current_tier_key);
      changes.push({
        entity_id: entityId,
        member_id: m.id,
        from_tier_key: m.current_tier_key,
        to_tier_key: status.tier.key,
        effective_on: asOf,
        reason: up
          ? `Reached ${status.tier.name} on ${status.qualifyingYear} spend`
          : `Tier from last year ended`,
      });
    }
  }

  // tier_effective_on: keep the stored date unless the tier changed today.
  const changedIds = new Set(changes.map((c) => c.member_id));
  const stored = await fetchAll((from, to) =>
    admin.from("rewards_members").select("id, tier_effective_on").eq("entity_id", entityId).order("id").range(from, to),
  );
  const storedEffective = new Map(stored.map((s) => [s.id, s.tier_effective_on]));
  for (const u of updates) {
    u.tier_effective_on = changedIds.has(u.id) ? asOf : storedEffective.get(u.id) ?? (live ? asOf : settings.programStartDate);
  }

  for (const batch of chunks(updates, 300)) {
    const { error } = await admin.from("rewards_members").upsert(batch, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  if (changes.length > 0) {
    const { error } = await admin.from("rewards_tier_changes").insert(changes);
    if (error) throw new Error(error.message);
  }
  return changes.length;
}

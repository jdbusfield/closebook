import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BudgetAccessError,
  assertOrgEditor,
  assertOrgMember,
  getBudgetActor,
  organizationForEntity,
} from "@/lib/budget/access";
import { fetchAll, isRewardsEntity, loadProgram, refreshMemberSummaries, runRewards, todayLA } from "@/lib/rewards/run";
import { addMonths, computeBalance } from "@/lib/rewards/engine";
import { allowanceState, redemptionRefund, type AllowancePeriod } from "@/lib/rewards/perks";

export const maxDuration = 300;

/**
 * Versatile Rewards staff API. One POST route with an action switch, like the
 * rebate and commission routes. Reads need org membership; writes need an
 * editor role (admin, controller, preparer). Writes go through the service
 * role, so every action resolves the entity's org and checks it first.
 */

type Admin = ReturnType<typeof createAdminClient>;

const PROGRAM_FIELDS = new Set([
  "name",
  "program_start_date",
  "preview_start_date",
  "invoice_prefixes",
  "counted_statuses",
  "paid_statuses",
  "eligible_rec_types",
  "excluded_icodes",
  "use_rebate_exclusions",
  "bathroom_icodes",
  "weekend_bonus_enabled",
  "points_expire_months",
  "auto_enroll",
]);
const TIER_FIELDS = new Set([
  "key",
  "name",
  "sort_order",
  "min_annual_spend",
  "points_per_dollar",
  "weekend_points_per_dollar",
  "bathroom_bonus_points",
  "rollover_cap",
  "notes",
]);
const PERK_FIELDS = new Set(["key", "name", "category", "value_kind", "description", "sort_order", "is_active"]);
const TIER_PERK_FIELDS = new Set(["enabled", "value_number", "value_text", "allowance", "allowance_period"]);
const CATALOG_FIELDS = new Set(["name", "points_cost", "kind", "cash_value", "cost_to_company", "is_active", "sort_order"]);

function pick(body: Record<string, unknown> | undefined, allowed: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body ?? {})) if (allowed.has(k)) out[k] = v === "" ? null : v;
  return out;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function memberEntity(admin: Admin, memberId: string): Promise<string | null> {
  const { data } = await admin.from("rewards_members").select("entity_id").eq("id", memberId).maybeSingle();
  return data?.entity_id ?? null;
}

async function memberLedger(admin: Admin, memberId: string) {
  // Paged: Supabase caps a request at 1,000 rows.
  return fetchAll((from, to) =>
    admin
      .from("rewards_ledger")
      .select("*")
      .eq("member_id", memberId)
      .order("earned_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
}

/** Live spendable balance for one member, straight from the ledger. */
async function availablePoints(admin: Admin, memberId: string): Promise<number> {
  const rows = await memberLedger(admin, memberId);
  return computeBalance(
    rows.map((r) => ({ points: r.points, earnedOn: r.earned_on, expiresOn: r.expires_on, isAvailable: r.is_available, isPreview: r.is_preview })),
    todayLA(),
  ).available;
}

/** Refresh one member's stored summary after a hand entry. */
async function refreshOne(admin: Admin, entityId: string, memberId: string) {
  const { settings, tiers } = await loadProgram(admin, entityId);
  const { data: m } = await admin.from("rewards_members").select("id, name, status, current_tier_key").eq("id", memberId).single();
  if (m) await refreshMemberSummaries(admin, entityId, settings, tiers, [m], todayLA());
}

export async function POST(request: Request) {
  const admin = createAdminClient();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }
  const action = String(body.action ?? "");

  try {
    const actor = await getBudgetActor();

    // Resolve the entity for this call and check access.
    // A member's own entity wins over any entityId in the body.
    let entityId = typeof body.entityId === "string" ? body.entityId : null;
    if (typeof body.memberId === "string" && body.memberId) {
      entityId = await memberEntity(admin, body.memberId);
      if (!entityId) return bad("Member not found", 404);
    }
    if (!entityId) return bad("entityId is required");
    const orgId = await organizationForEntity(admin, entityId);
    const READ_ACTIONS = new Set(["get_overview", "get_member", "search_customers", "preview_report"]);
    if (READ_ACTIONS.has(action)) assertOrgMember(actor, orgId);
    else assertOrgEditor(actor, orgId);
    if (!(await isRewardsEntity(admin, entityId))) return bad("Rewards is not set up for this entity", 404);

    switch (action) {
      // ── Overview ──────────────────────────────────────────────────────
      case "get_overview": {
        await loadProgram(admin, entityId); // creates defaults on first open
        const [program, tiers, perks, catalog, tierChanges, redemptions] = await Promise.all([
          admin.from("rewards_programs").select("*").eq("entity_id", entityId).single(),
          admin.from("rewards_tiers").select("*").eq("entity_id", entityId).order("min_annual_spend"),
          admin.from("rewards_perks").select("*").eq("entity_id", entityId).order("sort_order"),
          admin.from("rewards_catalog_items").select("*").eq("entity_id", entityId).order("points_cost").order("sort_order"),
          admin
            .from("rewards_tier_changes")
            .select("*, rewards_members(name)")
            .eq("entity_id", entityId)
            .order("created_at", { ascending: false })
            .limit(200),
          admin
            .from("rewards_redemptions")
            .select("*, rewards_members(name)")
            .eq("entity_id", entityId)
            .order("requested_at", { ascending: false })
            .limit(200),
        ]);
        const tierIds = (tiers.data ?? []).map((t) => t.id);
        const { data: tierPerks } = tierIds.length
          ? await admin.from("rewards_tier_perks").select("*").in("tier_id", tierIds)
          : { data: [] };

        const members = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await admin
            .from("rewards_members")
            .select("*, rewards_member_customers(rw_customer_id, customer_name, customer_number)")
            .eq("entity_id", entityId)
            .order("id")
            .range(from, from + 999);
          if (error) throw new Error(error.message);
          members.push(...(data ?? []));
          if (!data || data.length < 1000) break;
        }

        return NextResponse.json({
          program: program.data,
          tiers: tiers.data ?? [],
          perks: perks.data ?? [],
          tierPerks: tierPerks ?? [],
          catalog: catalog.data ?? [],
          tierChanges: tierChanges.data ?? [],
          redemptions: redemptions.data ?? [],
          members,
          today: todayLA(),
        });
      }

      case "recalculate": {
        const summary = await runRewards(admin, entityId);
        return NextResponse.json({ summary });
      }

      // ── Program, tiers, perks ─────────────────────────────────────────
      case "update_program": {
        const fields = pick(body.fields as Record<string, unknown>, PROGRAM_FIELDS);
        if (fields.points_expire_months !== undefined && !(Number(fields.points_expire_months) > 0)) {
          return bad("Points must expire after at least 1 month");
        }
        const { error } = await admin
          .from("rewards_programs")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("entity_id", entityId);
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
      }

      case "upsert_tier": {
        const fields = pick(body.fields as Record<string, unknown>, TIER_FIELDS);
        for (const k of ["min_annual_spend", "points_per_dollar", "weekend_points_per_dollar", "bathroom_bonus_points"]) {
          if (fields[k] !== undefined && fields[k] !== null && !(Number(fields[k]) >= 0)) return bad(`${k} must be zero or more`);
        }
        const tierId = typeof body.tierId === "string" ? body.tierId : null;
        if (tierId) {
          const { error } = await admin
            .from("rewards_tiers")
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq("id", tierId)
            .eq("entity_id", entityId);
          if (error) return bad(error.message, 500);
          return NextResponse.json({ ok: true });
        }
        if (!fields.key || !fields.name) return bad("A new tier needs a key and a name");
        const { data: tier, error } = await admin
          .from("rewards_tiers")
          .insert({ ...(fields as { key: string; name: string }), entity_id: entityId })
          .select("id")
          .single();
        if (error) return bad(error.message, 500);
        // Give the new tier a (switched-off) row for every perk.
        const { data: perks } = await admin.from("rewards_perks").select("id").eq("entity_id", entityId);
        if (perks?.length) {
          await admin.from("rewards_tier_perks").insert(perks.map((p) => ({ tier_id: tier.id, perk_id: p.id })));
        }
        return NextResponse.json({ ok: true, id: tier.id });
      }

      case "delete_tier": {
        const { count } = await admin.from("rewards_tiers").select("id", { count: "exact", head: true }).eq("entity_id", entityId);
        if ((count ?? 0) <= 1) return bad("The program needs at least one tier");
        const { error } = await admin.from("rewards_tiers").delete().eq("id", String(body.tierId)).eq("entity_id", entityId);
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
      }

      case "upsert_perk": {
        const fields = pick(body.fields as Record<string, unknown>, PERK_FIELDS);
        const perkId = typeof body.perkId === "string" ? body.perkId : null;
        if (perkId) {
          const { error } = await admin.from("rewards_perks").update(fields).eq("id", perkId).eq("entity_id", entityId);
          if (error) return bad(error.message, 500);
          return NextResponse.json({ ok: true });
        }
        if (!fields.name) return bad("A perk needs a name");
        const key =
          (fields.key as string) ||
          String(fields.name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "");
        const { data: perk, error } = await admin
          .from("rewards_perks")
          .insert({ ...(fields as { name: string }), key, entity_id: entityId })
          .select("id")
          .single();
        if (error) return bad(error.message, 500);
        const { data: tiers } = await admin.from("rewards_tiers").select("id").eq("entity_id", entityId);
        if (tiers?.length) {
          await admin.from("rewards_tier_perks").insert(tiers.map((t) => ({ tier_id: t.id, perk_id: perk.id })));
        }
        return NextResponse.json({ ok: true, id: perk.id });
      }

      case "set_tier_perk": {
        const tierId = String(body.tierId ?? "");
        const perkId = String(body.perkId ?? "");
        const { data: tier } = await admin.from("rewards_tiers").select("id").eq("id", tierId).eq("entity_id", entityId).maybeSingle();
        if (!tier) return bad("Tier not found", 404);
        const fields = pick(body.fields as Record<string, unknown>, TIER_PERK_FIELDS);
        const { error } = await admin
          .from("rewards_tier_perks")
          .upsert({ tier_id: tierId, perk_id: perkId, ...fields, updated_at: new Date().toISOString() }, { onConflict: "tier_id,perk_id" });
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
      }

      case "upsert_catalog_item": {
        const fields = pick(body.fields as Record<string, unknown>, CATALOG_FIELDS);
        const itemId = typeof body.itemId === "string" ? body.itemId : null;
        if (fields.points_cost !== undefined && !(Number(fields.points_cost) > 0)) return bad("Points cost must be more than zero");
        if (itemId) {
          const { error } = await admin.from("rewards_catalog_items").update(fields).eq("id", itemId).eq("entity_id", entityId);
          if (error) return bad(error.message, 500);
          return NextResponse.json({ ok: true });
        }
        if (!fields.name || !fields.points_cost) return bad("A catalog item needs a name and a points cost");
        const { error } = await admin
          .from("rewards_catalog_items")
          .insert({ ...(fields as { name: string; points_cost: number }), entity_id: entityId });
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
      }

      // ── Members ───────────────────────────────────────────────────────
      case "get_member": {
        const memberId = String(body.memberId ?? "");
        const [{ data: member }, { data: customers }, { data: contacts }, ledger, { data: uses }, { data: redemptions }, { data: changes }] =
          await Promise.all([
            admin.from("rewards_members").select("*").eq("id", memberId).eq("entity_id", entityId).single(),
            admin.from("rewards_member_customers").select("*").eq("member_id", memberId).order("customer_name"),
            admin.from("rewards_contacts").select("*").eq("member_id", memberId).order("created_at"),
            memberLedger(admin, memberId),
            admin.from("rewards_perk_uses").select("*").eq("member_id", memberId).order("used_on", { ascending: false }).limit(500),
            admin.from("rewards_redemptions").select("*").eq("member_id", memberId).order("requested_at", { ascending: false }),
            admin.from("rewards_tier_changes").select("*").eq("member_id", memberId).order("created_at", { ascending: false }),
          ]);
        if (!member) return bad("Member not found", 404);

        // Perks the member's tier has switched on, with allowance left this period.
        const today = todayLA();
        const { data: tier } = await admin
          .from("rewards_tiers")
          .select("id")
          .eq("entity_id", entityId)
          .eq("key", member.current_tier_key ?? "")
          .maybeSingle();
        const { data: tierPerks } = tier
          ? await admin.from("rewards_tier_perks").select("*, rewards_perks(*)").eq("tier_id", tier.id).eq("enabled", true)
          : { data: [] };
        const perks = (tierPerks ?? []).map((tp) => ({
          ...tp,
          state: allowanceState(
            tp.allowance,
            tp.allowance_period as AllowancePeriod | null,
            (uses ?? []).filter((u) => u.perk_id === tp.perk_id).map((u) => ({ usedOn: u.used_on, quantity: u.quantity })),
            today,
          ),
        }));

        const [{ data: tiers }, { data: catalog }] = await Promise.all([
          admin.from("rewards_tiers").select("key, name, min_annual_spend").eq("entity_id", entityId).order("min_annual_spend"),
          admin.from("rewards_catalog_items").select("*").eq("entity_id", entityId).eq("is_active", true).order("points_cost"),
        ]);

        return NextResponse.json({
          member,
          tiers: tiers ?? [],
          catalog: catalog ?? [],
          customers: customers ?? [],
          contacts: contacts ?? [],
          ledger,
          perkUses: uses ?? [],
          redemptions: redemptions ?? [],
          tierChanges: changes ?? [],
          perks,
          today,
        });
      }

      case "update_member": {
        const memberId = String(body.memberId ?? "");
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
        if (typeof body.notes === "string") update.notes = body.notes;
        if (body.status !== undefined) {
          const status = String(body.status);
          if (!["shadow", "active", "opted_out"].includes(status)) return bad("Unknown status");
          if (status === "active") {
            const { count } = await admin.from("rewards_contacts").select("id", { count: "exact", head: true }).eq("member_id", memberId);
            if (!count) return bad("Add a contact email before activating a member");
            update.activated_at = new Date().toISOString();
          }
          if (status === "opted_out") update.opted_out_at = new Date().toISOString();
          update.status = status;
        }
        const { error } = await admin.from("rewards_members").update(update).eq("id", memberId).eq("entity_id", entityId);
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
      }

      case "create_member": {
        const name = String(body.name ?? "").trim();
        if (!name) return bad("A member needs a name");
        const { data, error } = await admin.from("rewards_members").insert({ entity_id: entityId, name }).select("id").single();
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true, id: data.id });
      }

      case "search_customers": {
        // Versatile customers from the invoice cache, with spend since the
        // earliest counted date, so the right RW account can be picked.
        const q = String(body.query ?? "").trim();
        if (q.length < 2) return NextResponse.json({ customers: [] });
        const { settings } = await loadProgram(admin, entityId);
        const prefixFilter = settings.invoicePrefixes.map((p) => `invoice_number.like.${p}%`).join(",");
        const { data, error } = await admin
          .from("rw_invoices_cache")
          .select("customer_id, customer, sub_total, invoice_date, status")
          .ilike("customer", `%${q}%`)
          .or(prefixFilter)
          .neq("status", "VOID")
          .limit(2000);
        if (error) return bad(error.message, 500);
        const byId = new Map<string, { rwCustomerId: string; customerName: string; revenue: number; invoices: number; lastInvoice: string | null }>();
        for (const r of data ?? []) {
          if (!r.customer_id) continue;
          const cur = byId.get(r.customer_id) ?? { rwCustomerId: r.customer_id, customerName: r.customer ?? "", revenue: 0, invoices: 0, lastInvoice: null };
          cur.revenue += Number(r.sub_total) || 0;
          cur.invoices += 1;
          if (r.invoice_date && (!cur.lastInvoice || r.invoice_date > cur.lastInvoice)) cur.lastInvoice = r.invoice_date;
          byId.set(r.customer_id, cur);
        }
        const ids = [...byId.keys()];
        const { data: linked } = ids.length
          ? await admin.from("rewards_member_customers").select("rw_customer_id, member_id, rewards_members(name)").eq("entity_id", entityId).in("rw_customer_id", ids)
          : { data: [] };
        const linkMap = new Map((linked ?? []).map((l) => [l.rw_customer_id, l]));
        const customers = [...byId.values()]
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 25)
          .map((c) => {
            const l = linkMap.get(c.rwCustomerId);
            const name = (l?.rewards_members as { name?: string } | null)?.name ?? null;
            return { ...c, revenue: Math.round(c.revenue * 100) / 100, memberId: l?.member_id ?? null, memberName: name };
          });
        return NextResponse.json({ customers });
      }

      case "link_customer": {
        // Moves an RW customer (and every point it earned) onto this member.
        const memberId = String(body.memberId ?? "");
        const rwCustomerId = String(body.rwCustomerId ?? "");
        if (!rwCustomerId) return bad("rwCustomerId is required");
        const { data: prior } = await admin
          .from("rewards_member_customers")
          .select("member_id")
          .eq("entity_id", entityId)
          .eq("rw_customer_id", rwCustomerId)
          .maybeSingle();
        const { error } = await admin.from("rewards_member_customers").upsert(
          {
            entity_id: entityId,
            member_id: memberId,
            rw_customer_id: rwCustomerId,
            customer_name: (body.customerName as string) ?? null,
            customer_number: (body.customerNumber as string) ?? null,
          },
          { onConflict: "entity_id,rw_customer_id" },
        );
        if (error) return bad(error.message, 500);
        await admin.from("rewards_ledger").update({ member_id: memberId }).eq("entity_id", entityId).eq("rw_customer_id", rwCustomerId);

        // A member left with no customers and no hand entries is an empty
        // auto-enrolled shell: remove it.
        if (prior && prior.member_id !== memberId) {
          const [{ count: links }, { count: entries }] = await Promise.all([
            admin.from("rewards_member_customers").select("id", { count: "exact", head: true }).eq("member_id", prior.member_id),
            admin.from("rewards_ledger").select("id", { count: "exact", head: true }).eq("member_id", prior.member_id),
          ]);
          if (!links && !entries) await admin.from("rewards_members").delete().eq("id", prior.member_id);
        }
        const summary = await runRewards(admin, entityId);
        return NextResponse.json({ ok: true, summary });
      }

      case "unlink_customer": {
        // The customer becomes its own shadow member on the recalculation.
        const rwCustomerId = String(body.rwCustomerId ?? "");
        const memberId = String(body.memberId ?? "");
        const { error } = await admin
          .from("rewards_member_customers")
          .delete()
          .eq("entity_id", entityId)
          .eq("member_id", memberId)
          .eq("rw_customer_id", rwCustomerId);
        if (error) return bad(error.message, 500);
        await admin.from("rewards_ledger").delete().eq("entity_id", entityId).eq("member_id", memberId).eq("rw_customer_id", rwCustomerId).eq("entry_type", "earn");
        const summary = await runRewards(admin, entityId);
        return NextResponse.json({ ok: true, summary });
      }

      case "add_contact": {
        const memberId = String(body.memberId ?? "");
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("Enter a valid email");
        const { error } = await admin.from("rewards_contacts").insert({
          member_id: memberId,
          email,
          name: (body.name as string) || null,
          title: (body.title as string) || null,
        });
        if (error) return bad(/duplicate/i.test(error.message) ? "That email is already a contact" : error.message, 400);
        return NextResponse.json({ ok: true });
      }

      case "delete_contact": {
        const { error } = await admin.from("rewards_contacts").delete().eq("id", String(body.contactId)).eq("member_id", String(body.memberId));
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
      }

      // ── Hand entries ──────────────────────────────────────────────────
      case "add_adjustment": {
        const memberId = String(body.memberId ?? "");
        const points = Math.trunc(Number(body.points));
        const reason = String(body.reason ?? "").trim();
        if (!points) return bad("Points must be a whole number other than zero");
        if (!reason) return bad("Give a reason for the adjustment");
        const today = todayLA();
        const { settings } = await loadProgram(admin, entityId);
        const { error } = await admin.from("rewards_ledger").insert({
          entity_id: entityId,
          member_id: memberId,
          entry_type: "adjustment",
          points,
          earned_on: today,
          // Added points expire like earned points; deductions don't expire.
          expires_on: points > 0 ? addMonths(today, settings.pointsExpireMonths) : null,
          is_available: true,
          reason,
          created_by: actor.userId,
        });
        if (error) return bad(error.message, 500);
        await refreshOne(admin, entityId, memberId);
        return NextResponse.json({ ok: true });
      }

      case "log_perk_use": {
        const memberId = String(body.memberId ?? "");
        const perkId = String(body.perkId ?? "");
        const quantity = Math.max(1, Math.trunc(Number(body.quantity ?? 1)));
        const { data: perk } = await admin.from("rewards_perks").select("id").eq("id", perkId).eq("entity_id", entityId).maybeSingle();
        if (!perk) return bad("Perk not found", 404);
        const { error } = await admin.from("rewards_perk_uses").insert({
          entity_id: entityId,
          member_id: memberId,
          perk_id: perkId,
          quantity,
          used_on: (body.usedOn as string) || todayLA(),
          order_number: (body.orderNumber as string) || null,
          note: (body.note as string) || null,
          logged_by: actor.userId,
        });
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
      }

      case "delete_perk_use": {
        const { error } = await admin.from("rewards_perk_uses").delete().eq("id", String(body.useId)).eq("entity_id", entityId);
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
      }

      // ── Redemptions ───────────────────────────────────────────────────
      case "request_redemption": {
        const memberId = String(body.memberId ?? "");
        const { data: member } = await admin
          .from("rewards_members")
          .select("status, current_tier_key")
          .eq("id", memberId)
          .eq("entity_id", entityId)
          .single();
        if (!member) return bad("Member not found", 404);
        if (member.status !== "active") return bad("Only active members can redeem. Activate the member first.");

        let description = String(body.description ?? "").trim();
        let points = Math.trunc(Number(body.points));
        let costToCompany: number | null = null;
        const itemId = typeof body.catalogItemId === "string" ? body.catalogItemId : null;
        if (itemId) {
          const { data: item } = await admin.from("rewards_catalog_items").select("*").eq("id", itemId).eq("entity_id", entityId).single();
          if (!item) return bad("Catalog item not found", 404);
          description = item.name;
          points = item.points_cost;
          costToCompany = item.cost_to_company;
        }
        if (!description || !(points > 0)) return bad("Pick a catalog item, or give a description and points");

        const available = await availablePoints(admin, memberId);
        if (points > available) return bad(`Not enough points: ${available.toLocaleString()} available`);

        const today = todayLA();
        const { data: red, error } = await admin
          .from("rewards_redemptions")
          .insert({
            entity_id: entityId,
            member_id: memberId,
            catalog_item_id: itemId,
            description,
            points,
            cost_to_company: costToCompany,
            note: (body.note as string) || null,
            created_by: actor.userId,
          })
          .select("id")
          .single();
        if (error) return bad(error.message, 500);
        const { error: ledgerErr } = await admin.from("rewards_ledger").insert({
          entity_id: entityId,
          member_id: memberId,
          entry_type: "redeem",
          points: -points,
          earned_on: today,
          is_available: true,
          redemption_id: red.id,
          reason: description,
          created_by: actor.userId,
        });
        if (ledgerErr) {
          await admin.from("rewards_redemptions").delete().eq("id", red.id);
          return bad(ledgerErr.message, 500);
        }

        // Tier perk: a share of the points back, when switched on.
        const refundPct = await tierPerkNumber(admin, entityId, member.current_tier_key, "redemption_refund");
        const refund = redemptionRefund(points, refundPct);
        if (refund > 0) {
          const { settings } = await loadProgram(admin, entityId);
          await admin.from("rewards_ledger").insert({
            entity_id: entityId,
            member_id: memberId,
            entry_type: "redeem_refund",
            points: refund,
            earned_on: today,
            expires_on: addMonths(today, settings.pointsExpireMonths),
            is_available: true,
            redemption_id: red.id,
            reason: `${refundPct}% back on ${description}`,
            created_by: actor.userId,
          });
        }
        await refreshOne(admin, entityId, memberId);
        return NextResponse.json({ ok: true, id: red.id, refund });
      }

      case "update_redemption": {
        const redemptionId = String(body.redemptionId ?? "");
        const status = String(body.status ?? "");
        if (!["approved", "fulfilled", "cancelled"].includes(status)) return bad("Unknown status");
        const { data: red } = await admin.from("rewards_redemptions").select("*").eq("id", redemptionId).eq("entity_id", entityId).single();
        if (!red) return bad("Redemption not found", 404);
        if (red.status === "cancelled") return bad("This redemption was cancelled");
        const now = new Date().toISOString();
        const stamp: Record<string, unknown> = { status };
        if (status === "approved") stamp.approved_at = now;
        if (status === "fulfilled") stamp.fulfilled_at = now;
        if (status === "cancelled") stamp.cancelled_at = now;
        if (body.costToCompany !== undefined) stamp.cost_to_company = body.costToCompany === "" ? null : Number(body.costToCompany);
        const { error } = await admin.from("rewards_redemptions").update(stamp).eq("id", redemptionId);
        if (error) return bad(error.message, 500);

        if (status === "cancelled") {
          // Give the points back and take back any refund.
          const today = todayLA();
          const { settings } = await loadProgram(admin, entityId);
          const { data: refunds } = await admin
            .from("rewards_ledger")
            .select("points")
            .eq("redemption_id", redemptionId)
            .eq("entry_type", "redeem_refund");
          const refunded = (refunds ?? []).reduce((s, r) => s + r.points, 0);
          await admin.from("rewards_ledger").insert({
            entity_id: entityId,
            member_id: red.member_id,
            entry_type: "redeem_reversal",
            points: red.points - refunded,
            earned_on: today,
            // Returned points expire like newly earned ones.
            expires_on: addMonths(today, settings.pointsExpireMonths),
            is_available: true,
            redemption_id: redemptionId,
            reason: `Cancelled: ${red.description}`,
            created_by: actor.userId,
          });
          await refreshOne(admin, entityId, red.member_id);
        }
        return NextResponse.json({ ok: true });
      }

      case "complete_tier_change": {
        const { error } = await admin
          .from("rewards_tier_changes")
          .update({ done_at: body.undo ? null : new Date().toISOString(), done_by: body.undo ? null : actor.userId })
          .eq("id", String(body.changeId))
          .eq("entity_id", entityId);
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
      }

      // ── Internal 2026 preview ─────────────────────────────────────────
      case "preview_report": {
        const rows = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await admin
            .from("rewards_ledger")
            .select("member_id, points, eligible_spend, invoice_date, rewards_members(name)")
            .eq("entity_id", entityId)
            .eq("entry_type", "earn")
            .eq("is_preview", true)
            .order("id")
            .range(from, from + 999);
          if (error) throw new Error(error.message);
          rows.push(...(data ?? []));
          if (!data || data.length < 1000) break;
        }
        const byMonth = new Map<string, { spend: number; points: number }>();
        for (const r of rows) {
          const key = (r.invoice_date ?? "").slice(0, 7);
          const cur = byMonth.get(key) ?? { spend: 0, points: 0 };
          cur.spend += Number(r.eligible_spend);
          cur.points += r.points;
          byMonth.set(key, cur);
        }
        return NextResponse.json({
          months: [...byMonth.entries()].sort().map(([month, v]) => ({ month, spend: Math.round(v.spend * 100) / 100, points: v.points })),
        });
      }

      default:
        return bad(`Unknown action: ${action}`);
    }
  } catch (err) {
    if (err instanceof BudgetAccessError) return bad(err.message, err.status);
    return bad(err instanceof Error ? err.message : "Unknown error", 500);
  }
}

async function tierPerkNumber(admin: Admin, entityId: string, tierKey: string | null, perkKey: string): Promise<number | null> {
  if (!tierKey) return null;
  const [{ data: tier }, { data: perk }] = await Promise.all([
    admin.from("rewards_tiers").select("id").eq("entity_id", entityId).eq("key", tierKey).maybeSingle(),
    admin.from("rewards_perks").select("id").eq("entity_id", entityId).eq("key", perkKey).eq("is_active", true).maybeSingle(),
  ]);
  if (!tier || !perk) return null;
  const { data: tp } = await admin.from("rewards_tier_perks").select("enabled, value_number").eq("tier_id", tier.id).eq("perk_id", perk.id).maybeSingle();
  return tp?.enabled && tp.value_number !== null ? Number(tp.value_number) : null;
}


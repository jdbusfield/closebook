/**
 * Redemptions, shared by the staff API (/api/rewards) and the member portal.
 * Server-only (service-role client). Every function scopes by entity and
 * member so a caller can't touch another company's points.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { addMonths, computeBalance } from "./engine";
import { redemptionRefund } from "./perks";
import { fetchAll, loadProgram, refreshMemberSummaries, todayLA } from "./run";

type Admin = ReturnType<typeof createAdminClient>;

export type RedemptionResult =
  | { ok: true; id: string; refund: number }
  | { ok: false; error: string; status: number };

export type MoveResult = { ok: true } | { ok: false; error: string; status: number };

export async function memberLedgerRows(admin: Admin, memberId: string) {
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
export async function availablePoints(admin: Admin, memberId: string): Promise<number> {
  const rows = await memberLedgerRows(admin, memberId);
  return computeBalance(
    rows.map((r) => ({ points: r.points, earnedOn: r.earned_on, expiresOn: r.expires_on, isAvailable: r.is_available, isPreview: r.is_preview })),
    todayLA(),
  ).available;
}

/** Refresh one member's stored summary after a hand entry. */
export async function refreshOneMember(admin: Admin, entityId: string, memberId: string) {
  const { settings, tiers } = await loadProgram(admin, entityId);
  const { data: m } = await admin.from("rewards_members").select("id, name, status, current_tier_key").eq("id", memberId).single();
  if (m) await refreshMemberSummaries(admin, entityId, settings, tiers, [m], todayLA());
}

/** A tier perk's number (e.g. 25 for 25%) when the perk is switched on for that tier. */
export async function tierPerkNumber(admin: Admin, entityId: string, tierKey: string | null, perkKey: string): Promise<number | null> {
  if (!tierKey) return null;
  const [{ data: tier }, { data: perk }] = await Promise.all([
    admin.from("rewards_tiers").select("id").eq("entity_id", entityId).eq("key", tierKey).maybeSingle(),
    admin.from("rewards_perks").select("id").eq("entity_id", entityId).eq("key", perkKey).eq("is_active", true).maybeSingle(),
  ]);
  if (!tier || !perk) return null;
  const { data: tp } = await admin.from("rewards_tier_perks").select("enabled, value_number").eq("tier_id", tier.id).eq("perk_id", perk.id).maybeSingle();
  return tp?.enabled && tp.value_number !== null ? Number(tp.value_number) : null;
}

export async function requestRedemption(
  admin: Admin,
  input: {
    entityId: string;
    memberId: string;
    catalogItemId?: string | null;
    description?: string;
    points?: number;
    note?: string | null;
    /** Staff user, or null when a customer redeems from the portal. */
    createdBy?: string | null;
    contactId?: string | null;
  },
): Promise<RedemptionResult> {
  const { entityId, memberId } = input;
  const { data: member } = await admin
    .from("rewards_members")
    .select("status, current_tier_key")
    .eq("id", memberId)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (!member) return { ok: false, error: "Member not found", status: 404 };
  if (member.status !== "active") return { ok: false, error: "Only active members can redeem. Activate the member first.", status: 400 };

  let description = String(input.description ?? "").trim();
  let points = Math.trunc(Number(input.points));
  let costToCompany: number | null = null;
  const itemId = input.catalogItemId || null;
  if (itemId) {
    const { data: item } = await admin
      .from("rewards_catalog_items")
      .select("*")
      .eq("id", itemId)
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .maybeSingle();
    if (!item) return { ok: false, error: "Reward not found", status: 404 };
    description = item.name;
    points = item.points_cost;
    costToCompany = item.cost_to_company;
  }
  if (!description || !(points > 0)) return { ok: false, error: "Pick a catalog item, or give a description and points", status: 400 };

  const available = await availablePoints(admin, memberId);
  if (points > available) return { ok: false, error: `Not enough points: ${available.toLocaleString()} available`, status: 400 };

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
      note: input.note || null,
      created_by: input.createdBy ?? null,
      requested_by_contact_id: input.contactId ?? null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message, status: 500 };
  const { error: ledgerErr } = await admin.from("rewards_ledger").insert({
    entity_id: entityId,
    member_id: memberId,
    entry_type: "redeem",
    points: -points,
    earned_on: today,
    is_available: true,
    redemption_id: red.id,
    reason: description,
    created_by: input.createdBy ?? null,
  });
  if (ledgerErr) {
    await admin.from("rewards_redemptions").delete().eq("id", red.id);
    return { ok: false, error: ledgerErr.message, status: 500 };
  }
  // Two requests at once can both pass the check above. Recheck after
  // writing and back this one out if the balance went negative.
  if ((await availablePoints(admin, memberId)) < 0) {
    await admin.from("rewards_ledger").delete().eq("redemption_id", red.id);
    await admin.from("rewards_redemptions").delete().eq("id", red.id);
    return { ok: false, error: "Not enough points: another redemption just used them. Reload and try again.", status: 409 };
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
      created_by: input.createdBy ?? null,
    });
  }
  await refreshOneMember(admin, entityId, memberId);
  return { ok: true, id: red.id, refund };
}

const ALLOWED_FROM: Record<string, string[]> = {
  approved: ["requested"],
  fulfilled: ["requested", "approved"],
  cancelled: ["requested", "approved"],
};

/**
 * Move a redemption along. Allowed: requested -> approved; requested or
 * approved -> fulfilled or cancelled. A fulfilled reward has been handed over,
 * so it can't be cancelled. `onlyFrom` narrows the allowed starting statuses
 * (the portal lets a customer cancel only while a request is still requested).
 */
export async function moveRedemption(
  admin: Admin,
  input: {
    entityId: string;
    redemptionId: string;
    status: "approved" | "fulfilled" | "cancelled";
    actorId?: string | null;
    memberId?: string;
    onlyFrom?: string[];
    costToCompany?: number | null;
  },
): Promise<MoveResult> {
  const { entityId, redemptionId, status } = input;
  if (!ALLOWED_FROM[status]) return { ok: false, error: "Unknown status", status: 400 };
  let query = admin.from("rewards_redemptions").select("*").eq("id", redemptionId).eq("entity_id", entityId);
  if (input.memberId) query = query.eq("member_id", input.memberId);
  const { data: red } = await query.maybeSingle();
  if (!red) return { ok: false, error: "Redemption not found", status: 404 };
  const from = input.onlyFrom ? ALLOWED_FROM[status].filter((s) => input.onlyFrom!.includes(s)) : ALLOWED_FROM[status];
  if (!from.includes(red.status)) return { ok: false, error: `A ${red.status} redemption can't be marked ${status}`, status: 400 };

  const now = new Date().toISOString();
  const stamp: Record<string, unknown> = { status };
  if (status === "approved") stamp.approved_at = now;
  if (status === "fulfilled") stamp.fulfilled_at = now;
  if (status === "cancelled") stamp.cancelled_at = now;
  if (input.costToCompany !== undefined) stamp.cost_to_company = input.costToCompany;
  // Conditional on the status we checked, so two clicks can't both win.
  const { data: moved, error } = await admin
    .from("rewards_redemptions")
    .update(stamp)
    .eq("id", redemptionId)
    .in("status", from)
    .select("id");
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!moved || moved.length === 0) return { ok: false, error: "This redemption changed in the meantime. Reload and try again.", status: 409 };

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
      created_by: input.actorId ?? null,
    });
    await refreshOneMember(admin, entityId, red.member_id);
  }
  return { ok: true };
}

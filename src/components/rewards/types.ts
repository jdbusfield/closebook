// Shapes returned by /api/rewards (rows of the rewards_* tables).

export interface RewardsProgram {
  entity_id: string;
  name: string;
  program_start_date: string;
  preview_start_date: string | null;
  invoice_prefixes: string[];
  counted_statuses: string[];
  paid_statuses: string[];
  eligible_rec_types: string[];
  excluded_icodes: string[];
  use_rebate_exclusions: boolean;
  bathroom_icodes: string[];
  weekend_bonus_enabled: boolean;
  points_expire_months: number;
  auto_enroll: boolean;
  last_run_at: string | null;
  last_run_summary: Record<string, unknown> | null;
}

export interface RewardsTier {
  id: string;
  key: string;
  name: string;
  sort_order: number;
  min_annual_spend: number;
  points_per_dollar: number;
  weekend_points_per_dollar: number | null;
  bathroom_bonus_points: number | null;
  rollover_cap: number | null;
  notes: string | null;
}

export type PerkCategory = "rental" | "other" | "partner" | "pa";
export type PerkValueKind = "included" | "percent" | "allowance" | "text";

export interface RewardsPerk {
  id: string;
  key: string;
  name: string;
  category: PerkCategory;
  value_kind: PerkValueKind;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface RewardsTierPerk {
  id: string;
  tier_id: string;
  perk_id: string;
  enabled: boolean;
  value_number: number | null;
  value_text: string | null;
  allowance: number | null;
  allowance_period: string | null;
  proposed_value: string | null;
}

export interface CatalogItem {
  id: string;
  name: string;
  points_cost: number;
  kind: "swag" | "gift_card" | "order_credit" | "other";
  cash_value: number | null;
  cost_to_company: number | null;
  is_active: boolean;
  sort_order: number;
}

export type MemberStatus = "shadow" | "active" | "opted_out";

export interface RewardsMember {
  id: string;
  name: string;
  status: MemberStatus;
  activated_at: string | null;
  opted_out_at: string | null;
  notes: string | null;
  current_tier_key: string | null;
  tier_effective_on: string | null;
  tier_expires_on: string | null;
  qualifying_year: number | null;
  qualifying_spend: number;
  next_tier_key: string | null;
  spend_to_next_tier: number | null;
  points_available: number;
  points_pending: number;
  points_expiring_soon: number;
  points_lifetime: number;
  preview_spend: number;
  preview_points: number;
  preview_tier_key: string | null;
  summary_refreshed_at: string | null;
  rewards_member_customers?: { rw_customer_id: string; customer_name: string | null; customer_number: string | null }[];
}

export interface TierChange {
  id: string;
  member_id: string;
  from_tier_key: string | null;
  to_tier_key: string | null;
  effective_on: string;
  reason: string | null;
  done_at: string | null;
  created_at: string;
  rewards_members?: { name: string } | null;
}

export interface Redemption {
  id: string;
  member_id: string;
  catalog_item_id: string | null;
  description: string;
  points: number;
  status: "requested" | "approved" | "fulfilled" | "cancelled";
  cost_to_company: number | null;
  note: string | null;
  requested_at: string;
  approved_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  rewards_members?: { name: string } | null;
}

export interface LedgerRow {
  id: string;
  rw_customer_id: string | null;
  entry_type: "earn" | "adjustment" | "redeem" | "redeem_reversal" | "redeem_refund";
  points: number;
  eligible_spend: number;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_status: string | null;
  tier_key: string | null;
  points_per_dollar: number | null;
  weekend_applied: boolean;
  bonus_points: number;
  is_preview: boolean;
  is_available: boolean;
  earned_on: string;
  expires_on: string | null;
  reason: string | null;
}

export interface RewardsOverview {
  program: RewardsProgram;
  tiers: RewardsTier[];
  perks: RewardsPerk[];
  tierPerks: RewardsTierPerk[];
  catalog: CatalogItem[];
  tierChanges: TierChange[];
  redemptions: Redemption[];
  members: RewardsMember[];
  today: string;
}

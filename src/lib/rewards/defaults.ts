/**
 * Starting setup for a new rewards program, from Mike's workbook
 * (Versatile_Studios_Rewards_Program.xlsm, Oct 2026). Created once, the first
 * time the Rewards page opens for an entity; everything is editable after.
 *
 * Perks are created switched off: which tier gets what is decided later.
 * The workbook's idea for each tier is kept as proposed_value.
 */

export interface DefaultTier {
  key: string;
  name: string;
  sort_order: number;
  min_annual_spend: number;
  points_per_dollar: number;
  weekend_points_per_dollar: number | null;
  rollover_cap: number | null;
}

export const DEFAULT_TIERS: DefaultTier[] = [
  { key: "insider", name: "Insider", sort_order: 1, min_annual_spend: 0, points_per_dollar: 1, weekend_points_per_dollar: null, rollover_cap: null },
  { key: "preferred", name: "Preferred", sort_order: 2, min_annual_spend: 25000, points_per_dollar: 1.25, weekend_points_per_dollar: null, rollover_cap: null },
  { key: "premier", name: "Premier", sort_order: 3, min_annual_spend: 100000, points_per_dollar: 1.5, weekend_points_per_dollar: 2, rollover_cap: 25000 },
  { key: "v_list", name: "V-List", sort_order: 4, min_annual_spend: 300000, points_per_dollar: 2, weekend_points_per_dollar: 3, rollover_cap: 100000 },
];

type TierKey = "insider" | "preferred" | "premier" | "v_list";

export interface DefaultPerk {
  key: string;
  name: string;
  category: "rental" | "other" | "partner" | "pa";
  value_kind: "included" | "percent" | "allowance" | "text";
  description?: string;
  /** The workbook's value per tier; tiers left out had none. */
  proposed: Partial<Record<TierKey, string>>;
}

const ALL = (v: string): Record<TierKey, string> => ({ insider: v, preferred: v, premier: v, v_list: v });

export const DEFAULT_PERKS: DefaultPerk[] = [
  { key: "free_ice", name: "Free ice", category: "rental", value_kind: "included", proposed: ALL("Yes") },
  { key: "parking_discount", name: "Parking discount", category: "rental", value_kind: "percent", proposed: { insider: "10%", preferred: "25%", premier: "50%", v_list: "50%, overnight crew vehicles free" } },
  { key: "order_discount", name: "Automatic order discount", category: "rental", value_kind: "percent", description: "Exclusions apply. Does not stack with a negotiated discount.", proposed: { preferred: "5%", premier: "10%", v_list: "15%" } },
  { key: "quarterly_rebate", name: "Quarterly rebate", category: "rental", value_kind: "percent", description: "% back on spend each quarter. Existing rebate contracts stay as they are.", proposed: { premier: "5%", v_list: "10%" } },
  { key: "early_late", name: "Free early pickup and late return", category: "rental", value_kind: "text", description: "Before 7am and after 7pm.", proposed: { preferred: "Mon-Fri", premier: "Every day", v_list: "Every day" } },
  { key: "complimentary_delivery", name: "Complimentary delivery", category: "rental", value_kind: "allowance", description: "Within the LA production zone; equipment, trucks, trailers and bathrooms.", proposed: { preferred: "1 a month", premier: "1 a week", v_list: "Free on orders over $500" } },
  { key: "expendable_credit", name: "Expendable return credit", category: "rental", value_kind: "percent", description: "Hangers, Ram Board and other reusable expendables.", proposed: { insider: "50%", preferred: "75%", premier: "90%", v_list: "100%" } },
  { key: "priority_holds", name: "Priority vehicle holds", category: "rental", value_kind: "included", proposed: { premier: "TBD", v_list: "TBD" } },
  { key: "concierge", name: "Dedicated support concierge", category: "rental", value_kind: "included", proposed: { v_list: "TBD" } },
  { key: "wheel_spin", name: "Warehouse wheel spin", category: "other", value_kind: "allowance", proposed: ALL("1 per order") },
  { key: "free_pa_day", name: "Free PA for a day (Manifest)", category: "other", value_kind: "allowance", proposed: { premier: "Yes", v_list: "Yes" } },
  { key: "vip_group", name: "V-IP group and offers", category: "other", value_kind: "included", proposed: { v_list: "Yes" } },
  { key: "redemption_refund", name: "Points back after a redemption", category: "other", value_kind: "percent", description: "When on, this % of a redemption's points is credited back automatically.", proposed: { v_list: "25%" } },
  { key: "partner_wrapbook", name: "Wrapbook", category: "partner", value_kind: "text", proposed: ALL("TBD") },
  { key: "partner_roll_credits", name: "Roll Credits", category: "partner", value_kind: "text", proposed: ALL("TBD") },
  { key: "partner_hotel_guy", name: "The Hotel Guy travel benefits", category: "partner", value_kind: "text", proposed: ALL("TBD") },
  { key: "partner_catering", name: "Catering partner", category: "partner", value_kind: "text", proposed: ALL("TBD") },
  { key: "partner_coffee", name: "Coffee partner", category: "partner", value_kind: "text", proposed: ALL("TBD") },
  { key: "pa_wheel", name: "PA wheel spin on a clean return", category: "pa", value_kind: "allowance", proposed: ALL("Yes") },
];

export interface DefaultCatalogItem {
  name: string;
  points_cost: number;
  kind: "swag" | "gift_card" | "order_credit" | "other";
  cash_value: number | null;
}

export const DEFAULT_CATALOG: DefaultCatalogItem[] = [
  { name: "VS T-shirt", points_cost: 1000, kind: "swag", cash_value: null },
  { name: "VS hat", points_cost: 5000, kind: "swag", cash_value: null },
  { name: "VS signature tote", points_cost: 5000, kind: "swag", cash_value: null },
  { name: "VS water bottle", points_cost: 10000, kind: "swag", cash_value: null },
  { name: "$5 Starbucks gift card", points_cost: 10000, kind: "gift_card", cash_value: 5 },
  { name: "VS premium swag (Yeti, Owala)", points_cost: 30000, kind: "swag", cash_value: null },
  { name: "$100 AMEX gift card", points_cost: 30000, kind: "gift_card", cash_value: 100 },
  { name: "$200 AMEX gift card", points_cost: 50000, kind: "gift_card", cash_value: 200 },
  { name: "$500 off your next order", points_cost: 50000, kind: "order_credit", cash_value: 500 },
  { name: "$500 AMEX gift card", points_cost: 100000, kind: "gift_card", cash_value: 500 },
  { name: "$1,200 off your next order", points_cost: 100000, kind: "order_credit", cash_value: 1200 },
  { name: "$1,500 AMEX gift card", points_cost: 250000, kind: "gift_card", cash_value: 1500 },
  { name: "$3,500 off your next order", points_cost: 250000, kind: "order_credit", cash_value: 3500 },
];

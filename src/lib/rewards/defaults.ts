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
  { key: "free_ice", name: "Free Ice", category: "rental", value_kind: "included", proposed: ALL("Yes") },
  { key: "parking_discount", name: "Parking Discount", category: "rental", value_kind: "percent", proposed: { insider: "10%", preferred: "25%", premier: "50%", v_list: "50%, overnight crew vehicles free" } },
  { key: "order_discount", name: "Automatic Order Discount", category: "rental", value_kind: "percent", description: "Exclusions Apply · Doesn't Stack With a Negotiated Discount", proposed: { preferred: "5%", premier: "10%", v_list: "15%" } },
  { key: "quarterly_rebate", name: "Quarterly Rebate", category: "rental", value_kind: "percent", description: "Paid Each Quarter on Eligible Spend", proposed: { premier: "5%", v_list: "10%" } },
  { key: "early_late", name: "Free Early Pickup and Late Return", category: "rental", value_kind: "text", description: "Before 7am and After 7pm", proposed: { preferred: "Mon-Fri", premier: "Every day", v_list: "Every day" } },
  { key: "complimentary_delivery", name: "Complimentary Delivery", category: "rental", value_kind: "allowance", description: "LA Production Zone · Equipment, Trucks, Trailers and Bathrooms", proposed: { preferred: "1 a month", premier: "1 a week", v_list: "Free on orders over $500" } },
  { key: "expendable_credit", name: "Expendable Return Credit", category: "rental", value_kind: "percent", description: "Hangers, Ram Board and Other Reusable Expendables", proposed: { insider: "50%", preferred: "75%", premier: "90%", v_list: "100%" } },
  { key: "priority_holds", name: "Priority Vehicle Holds", category: "rental", value_kind: "included", proposed: { premier: "TBD", v_list: "TBD" } },
  { key: "concierge", name: "Dedicated Support Concierge", category: "rental", value_kind: "included", proposed: { v_list: "TBD" } },
  { key: "wheel_spin", name: "Warehouse Wheel Spin", category: "other", value_kind: "allowance", proposed: ALL("1 per order") },
  { key: "free_pa_day", name: "Free PA for a Day (Manifest)", category: "other", value_kind: "allowance", proposed: { premier: "Yes", v_list: "Yes" } },
  { key: "vip_group", name: "V-IP Group and Offers", category: "other", value_kind: "included", proposed: { v_list: "Yes" } },
  { key: "redemption_refund", name: "Points Back After a Redemption", category: "other", value_kind: "percent", description: "When on, this % of a redemption's points is credited back automatically.", proposed: { v_list: "25%" } },
  { key: "partner_wrapbook", name: "Wrapbook", category: "partner", value_kind: "text", proposed: ALL("TBD") },
  { key: "partner_roll_credits", name: "Roll Credits", category: "partner", value_kind: "text", proposed: ALL("TBD") },
  { key: "partner_hotel_guy", name: "The Hotel Guy Travel Benefits", category: "partner", value_kind: "text", proposed: ALL("TBD") },
  { key: "partner_catering", name: "Catering Partner", category: "partner", value_kind: "text", proposed: ALL("TBD") },
  { key: "partner_coffee", name: "Coffee Partner", category: "partner", value_kind: "text", proposed: ALL("TBD") },
  { key: "pa_wheel", name: "PA Wheel Spin on a Clean Return", category: "pa", value_kind: "allowance", proposed: ALL("Yes") },
];

export interface DefaultCatalogItem {
  name: string;
  points_cost: number;
  kind: "swag" | "gift_card" | "order_credit" | "other";
  cash_value: number | null;
}

export const DEFAULT_CATALOG: DefaultCatalogItem[] = [
  { name: "VS T-Shirt", points_cost: 1000, kind: "swag", cash_value: null },
  { name: "VS Hat", points_cost: 5000, kind: "swag", cash_value: null },
  { name: "VS Signature Tote", points_cost: 5000, kind: "swag", cash_value: null },
  { name: "VS Water Bottle", points_cost: 10000, kind: "swag", cash_value: null },
  { name: "$5 Starbucks Gift Card", points_cost: 10000, kind: "gift_card", cash_value: 5 },
  { name: "VS Premium Swag (Yeti, Owala)", points_cost: 30000, kind: "swag", cash_value: null },
  { name: "$100 AMEX Gift Card", points_cost: 30000, kind: "gift_card", cash_value: 100 },
  { name: "$200 AMEX Gift Card", points_cost: 50000, kind: "gift_card", cash_value: 200 },
  { name: "$500 Off Your Next Order", points_cost: 50000, kind: "order_credit", cash_value: 500 },
  { name: "$500 AMEX Gift Card", points_cost: 100000, kind: "gift_card", cash_value: 500 },
  { name: "$1,200 Off Your Next Order", points_cost: 100000, kind: "order_credit", cash_value: 1200 },
  { name: "$1,500 AMEX Gift Card", points_cost: 250000, kind: "gift_card", cash_value: 1500 },
  { name: "$3,500 Off Your Next Order", points_cost: 250000, kind: "order_credit", cash_value: 3500 },
];

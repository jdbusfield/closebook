import type { EquipmentType } from "@/lib/types/database";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RebateTier {
  id: string;
  label: string;
  threshold_min: number;
  threshold_max: number | null;
  sort_order: number;
  rate_pro_supplies: number;
  rate_vehicle: number;
  rate_grip_lighting: number;
  rate_studio: number;
  max_disc_pro_supplies: number;
  max_disc_vehicle: number;
  max_disc_grip_lighting: number;
  max_disc_studio: number;
}

export interface RebateCustomerConfig {
  id: string;
  customer_name: string;
  rw_customer_id: string | null;
  agreement_type: "commercial" | "freelancer";
  tax_rate: number;
  max_discount_percent: number | null;
  tiers: RebateTier[];
}

export interface CachedInvoice {
  id: string;
  rw_invoice_id: string;
  invoice_number: string;
  invoice_date: string | null;
  billing_start_date: string | null;
  billing_end_date: string | null;
  status: string | null;
  customer_name: string | null;
  deal: string | null;
  order_number: string | null;
  order_description: string | null;
  purchase_order_number: string | null;
  list_total: number;
  gross_total: number;
  sub_total: number;
  tax_amount: number;
  discount_amount: number;
  equipment_type: string;
  is_manually_excluded: boolean;
  manual_exclusion_reason: string | null;
}

export interface CachedInvoiceItem {
  id: string;
  rebate_invoice_id: string;
  i_code: string | null;
  description: string | null;
  extended: number | null;
  discount_amount: number | null;
  record_type: string | null;
}

export interface ExcludedItemDetail {
  iCode: string;
  description: string | null;
  amount: number;
  reason: "icode" | "loss_damage";
}

export interface RebateCalculationResult {
  invoice_id: string;
  rw_invoice_id: string;
  invoice_number: string;
  invoice_date: string | null;
  billing_end_date: string | null;
  quarter: string;
  deal: string | null;
  order_number: string | null;
  order_description: string | null;
  purchase_order_number: string | null;
  equipment_type: EquipmentType;
  list_total: number;
  gross_total: number;
  sub_total: number;
  tax_amount: number;
  discount_amount: number;
  discount_eligible_amount: number;
  taxable_sales: number;
  before_discount: number;
  discount_percent: number;
  excluded_total: number;
  excluded_items: ExcludedItemDetail[];
  final_amount: number;
  tier_label: string;
  rebate_rate: number;
  remaining_rebate_pct: number;
  gross_rebate: number;
  net_rebate: number;
  cumulative_revenue: number;
  cumulative_rebate: number;
  is_manually_excluded: boolean;
  manual_exclusion_reason: string | null;
}

// ─── Equipment Classification ────────────────────────────────────────────────

export function classifyEquipmentType(orderDesc: string): EquipmentType {
  if (!orderDesc) return "pro_supplies";
  const d = orderDesc.toUpperCase();
  // All "CUBE" variants are cube trucks — classified as vehicle.
  if (
    d.includes("VEHICLE") ||
    d.includes("CARGO VAN") ||
    d.includes("PROMASTER") ||
    d.includes("3 TON") ||
    d.includes("3-TON") ||
    d.includes("LOADED CUBE") ||
    d.includes("PROD CUBE") ||
    d.includes("CAMERA CUBE") ||
    d.includes("WARDROBE CUBE")
  )
    return "vehicle";
  if (
    d.includes("GRIP") ||
    d.includes("G&L") ||
    d.includes("G & L") ||
    d.includes("G+L")
  )
    return "grip_lighting";
  if (d.includes("STUDIO")) return "studio";
  return "pro_supplies";
}

export function getEquipmentLabel(type: EquipmentType): string {
  const labels: Record<EquipmentType, string> = {
    pro_supplies: "Pro Supplies",
    vehicle: "Vehicle",
    grip_lighting: "G&L",
    studio: "Studio",
  };
  return labels[type] || type;
}

// ─── Quarter Helpers ─────────────────────────────────────────────────────────

export function getQuarter(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "Unknown";
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `${d.getFullYear()} Q${q}`;
}

export function getCurrentQuarter(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()} Q${q}`;
}

export function parseQuarter(quarter: string): { year: number; quarterNum: number } | null {
  const match = quarter.match(/^(\d{4})\s*Q(\d)$/);
  if (!match) return null;
  return { year: parseInt(match[1]), quarterNum: parseInt(match[2]) };
}

// ─── Tier Lookup ─────────────────────────────────────────────────────────────

export function getTierForRevenue(tiers: RebateTier[], revenue: number): RebateTier {
  const sorted = [...tiers].sort((a, b) => a.sort_order - b.sort_order);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (revenue >= sorted[i].threshold_min) return sorted[i];
  }
  return sorted[0];
}

function getTierRate(tier: RebateTier, equipType: EquipmentType): number {
  const key = `rate_${equipType}` as keyof RebateTier;
  return (tier[key] as number) || 0;
}

function getTierMaxDisc(tier: RebateTier, equipType: EquipmentType): number {
  const key = `max_disc_${equipType}` as keyof RebateTier;
  return (tier[key] as number) || 0;
}

// ─── Commercial Formula ──────────────────────────────────────────────────────
// From rebates.html lines 709-734

export function calculateCommercialInvoice(params: {
  grossTotal: number;
  taxAmount: number;
  discountAmount: number;
  excludedTotal: number;
  taxRate: number;
  rebateRate: number;
  maxDiscRate: number;
}): {
  taxableSales: number;
  beforeDiscount: number;
  discountPercent: number;
  remainingRebatePct: number;
  grossRebate: number;
  netRebate: number;
  finalAmount: number;
} {
  const { grossTotal, taxAmount, discountAmount, excludedTotal, taxRate, rebateRate, maxDiscRate } =
    params;

  // Back-calculate taxable sales from tax amount
  const taxableSales = taxRate > 0 ? taxAmount / (taxRate / 100) : 0;

  // Base = gross (contains every line item) minus exclusions, taxable sales portion, and tax.
  // Using gross_total avoids the asymmetry where excluded labor/misc items would be subtracted
  // from a list_total base that never contained them.
  const beforeDiscount = Math.max(0, grossTotal - excludedTotal - taxableSales - taxAmount);

  // Discount as percentage of before-discount base
  const discountPercent = beforeDiscount > 0 ? (discountAmount / beforeDiscount) * 100 : 0;

  // Remaining rebate = combined allowed rate minus discount already given, capped at rebate rate
  const remainingRebatePct = Math.min(rebateRate, Math.max(0, rebateRate + maxDiscRate - discountPercent));

  // Net rebate on the before-discount base
  const netRebate = Math.max(0, beforeDiscount * (remainingRebatePct / 100));

  // Revenue tracking: before-discount base minus the discount amount
  const finalAmount = Math.max(0, beforeDiscount - discountAmount);

  return {
    taxableSales,
    beforeDiscount,
    discountPercent,
    remainingRebatePct,
    grossRebate: netRebate, // For commercial, gross = net
    netRebate,
    finalAmount,
  };
}

// ─── Freelancer Formula ──────────────────────────────────────────────────────
// From rebates.html lines 736-756

export function calculateFreelancerInvoice(params: {
  grossTotal: number;
  subTotal: number;
  discountAmount: number;
  excludedTotal: number;
  rebateRate: number;
  maxDiscountPercent: number | null;
}): {
  beforeDiscount: number;
  discountPercent: number;
  remainingRebatePct: number;
  grossRebate: number;
  netRebate: number;
  finalAmount: number;
} {
  const { grossTotal, subTotal, discountAmount, excludedTotal, rebateRate, maxDiscountPercent } =
    params;

  const finalAmount = Math.max(0, subTotal - excludedTotal);
  const grossRebate = finalAmount * (rebateRate / 100);
  let netRebate = grossRebate;

  const discountPercent = grossTotal > 0 ? (discountAmount / grossTotal) * 100 : 0;
  const beforeDiscount = grossTotal - excludedTotal;

  if (maxDiscountPercent != null && maxDiscountPercent > 0) {
    const combinedPct = discountPercent + rebateRate;
    if (combinedPct > maxDiscountPercent) {
      const overshoot = combinedPct - maxDiscountPercent;
      const overshootDeduction = finalAmount * (overshoot / 100);
      netRebate = Math.max(0, grossRebate - overshootDeduction);
    }
  }

  const remainingRebatePct = finalAmount > 0 ? (netRebate / finalAmount) * 100 : 0;

  return {
    beforeDiscount,
    discountPercent,
    remainingRebatePct,
    grossRebate,
    netRebate,
    finalAmount,
  };
}

// ─── Full Calculation Pipeline ───────────────────────────────────────────────
// From rebates.html lines 609-666

export function calculateCustomerRebates(
  customer: RebateCustomerConfig,
  invoices: CachedInvoice[],
  invoiceItemsMap: Map<string, CachedInvoiceItem[]>,
  excludedICodes: Set<string>,
): RebateCalculationResult[] {
  // Sort by BillingEndDate asc, then InvoiceDate asc
  const sorted = [...invoices].sort((a, b) => {
    const da = a.billing_end_date || a.invoice_date || "";
    const db = b.billing_end_date || b.invoice_date || "";
    return da.localeCompare(db);
  });

  // Filter to rebatable invoices (CLOSED, PROCESSED, or APPROVED status)
  const filtered = sorted.filter((inv) => {
    const status = (inv.status || "").toUpperCase();
    return status === "CLOSED" || status === "PROCESSED" || status === "APPROVED";
  });

  let cumulativeRevenue = 0;
  let cumulativeRebate = 0;
  const results: RebateCalculationResult[] = [];

  for (const inv of filtered) {
    // Calculate excluded amount from cached line items.
    // Also sum discount applied to those excluded lines so we can subtract it
    // from the invoice-level discount — a discount on an L&D walkie shouldn't
    // pull rebate-eligible revenue down.
    let excludedTotal = 0;
    let excludedDiscount = 0;
    const excludedItems: ExcludedItemDetail[] = [];
    const items = invoiceItemsMap.get(inv.id) || [];
    for (const item of items) {
      const amt = Number(item.extended) || 0;
      const disc = Number(item.discount_amount) || 0;

      // Exclude loss & damage items (record_type "F" = forfeited/L&D, or "L" legacy)
      if (item.record_type === "F" || item.record_type === "L") {
        excludedTotal += amt;
        excludedDiscount += disc;
        excludedItems.push({
          iCode: item.i_code || "L&D",
          description: item.description,
          amount: amt,
          reason: "loss_damage",
        });
      } else if (item.i_code && excludedICodes.has(item.i_code.trim())) {
        // Exclude by I-Code
        excludedTotal += amt;
        excludedDiscount += disc;
        excludedItems.push({
          iCode: item.i_code,
          description: item.description,
          amount: amt,
          reason: "icode",
        });
      }
    }

    // Effective discount = invoice-level discount minus the portion that
    // landed on excluded items. This is what the rebate formula should see.
    const effectiveDiscount = Math.max(0, (inv.discount_amount || 0) - excludedDiscount);

    // Equipment type
    const equipType = inv.equipment_type as EquipmentType;

    // Tier lookup based on cumulative revenue BEFORE this invoice
    const tier = getTierForRevenue(customer.tiers, cumulativeRevenue);
    const rebateRate = getTierRate(tier, equipType);

    // Quarter
    const quarter = getQuarter(inv.billing_end_date || inv.invoice_date);

    let result: RebateCalculationResult;

    if (customer.agreement_type === "commercial") {
      const maxDiscRate = getTierMaxDisc(tier, equipType);
      const calc = calculateCommercialInvoice({
        grossTotal: inv.gross_total,
        taxAmount: inv.tax_amount,
        discountAmount: effectiveDiscount,
        excludedTotal,
        taxRate: customer.tax_rate,
        rebateRate,
        maxDiscRate,
      });

      result = {
        invoice_id: inv.id,
        rw_invoice_id: inv.rw_invoice_id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        billing_end_date: inv.billing_end_date,
        quarter,
        deal: inv.deal,
        order_number: inv.order_number,
        order_description: inv.order_description,
        purchase_order_number: inv.purchase_order_number,
        equipment_type: equipType,
        list_total: inv.list_total,
        gross_total: inv.gross_total,
        sub_total: inv.sub_total,
        tax_amount: inv.tax_amount,
        discount_amount: inv.discount_amount,
        discount_eligible_amount: effectiveDiscount,
        taxable_sales: calc.taxableSales,
        before_discount: calc.beforeDiscount,
        discount_percent: calc.discountPercent,
        excluded_total: excludedTotal,
        excluded_items: excludedItems,
        final_amount: calc.finalAmount,
        tier_label: tier.label,
        rebate_rate: rebateRate,
        remaining_rebate_pct: calc.remainingRebatePct,
        gross_rebate: calc.grossRebate,
        net_rebate: calc.netRebate,
        cumulative_revenue: 0, // set below
        cumulative_rebate: 0,
        is_manually_excluded: inv.is_manually_excluded,
        manual_exclusion_reason: inv.manual_exclusion_reason,
      };
    } else {
      // Freelancer — use same commercial formula
      const maxDiscRate = getTierMaxDisc(tier, equipType);
      const calc = calculateCommercialInvoice({
        grossTotal: inv.gross_total,
        taxAmount: inv.tax_amount,
        discountAmount: effectiveDiscount,
        excludedTotal,
        taxRate: customer.tax_rate,
        rebateRate,
        maxDiscRate,
      });

      result = {
        invoice_id: inv.id,
        rw_invoice_id: inv.rw_invoice_id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        billing_end_date: inv.billing_end_date,
        quarter,
        deal: inv.deal,
        order_number: inv.order_number,
        order_description: inv.order_description,
        purchase_order_number: inv.purchase_order_number,
        equipment_type: equipType,
        list_total: inv.list_total,
        gross_total: inv.gross_total,
        sub_total: inv.sub_total,
        tax_amount: inv.tax_amount,
        discount_amount: inv.discount_amount,
        discount_eligible_amount: effectiveDiscount,
        taxable_sales: calc.taxableSales,
        before_discount: calc.beforeDiscount,
        discount_percent: calc.discountPercent,
        excluded_total: excludedTotal,
        excluded_items: excludedItems,
        final_amount: calc.finalAmount,
        tier_label: tier.label,
        rebate_rate: rebateRate,
        remaining_rebate_pct: calc.remainingRebatePct,
        gross_rebate: calc.grossRebate,
        net_rebate: calc.netRebate,
        cumulative_revenue: 0,
        cumulative_rebate: 0,
        is_manually_excluded: inv.is_manually_excluded,
        manual_exclusion_reason: inv.manual_exclusion_reason,
      };
    }

    // Handle manual exclusion
    if (result.is_manually_excluded) {
      result.net_rebate = 0;
      result.gross_rebate = 0;
      result.remaining_rebate_pct = 0;
      result.final_amount = 0;
    }

    // Update cumulative totals
    cumulativeRevenue += result.final_amount;
    cumulativeRebate += result.net_rebate;
    result.cumulative_revenue = cumulativeRevenue;
    result.cumulative_rebate = cumulativeRebate;

    results.push(result);
  }

  return results;
}

// ─── Quarterly Aggregation ───────────────────────────────────────────────────

export interface QuarterlySummary {
  quarter: string;
  year: number;
  quarter_num: number;
  total_revenue: number;       // rebate-applicable: sum(final_amount) after exclusions, tax, discount
  total_list_revenue: number;  // all revenue: sum(gross_total), includes excluded invoices/items
                               // (column kept named *_list_revenue for legacy reasons; values are
                               // gross_total since that's now the rebate base)
  total_rebate: number;
  invoice_count: number;
  tier_label: string;
}

export function aggregateByQuarter(results: RebateCalculationResult[]): QuarterlySummary[] {
  const map = new Map<string, QuarterlySummary>();

  for (const r of results) {
    const q = r.quarter;
    if (!map.has(q)) {
      const parsed = parseQuarter(q);
      map.set(q, {
        quarter: q,
        year: parsed?.year ?? 0,
        quarter_num: parsed?.quarterNum ?? 0,
        total_revenue: 0,
        total_list_revenue: 0,
        total_rebate: 0,
        invoice_count: 0,
        tier_label: r.tier_label,
      });
    }
    const summary = map.get(q)!;
    summary.total_revenue += r.final_amount;
    summary.total_list_revenue += r.gross_total;
    summary.total_rebate += r.net_rebate;
    summary.invoice_count += 1;
    summary.tier_label = r.tier_label; // last invoice's tier
  }

  return Array.from(map.values()).sort(
    (a, b) => a.year - b.year || a.quarter_num - b.quarter_num,
  );
}

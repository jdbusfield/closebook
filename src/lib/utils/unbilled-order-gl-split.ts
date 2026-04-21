/**
 * Per-order GL split for unbilled-earned revenue.
 *
 * Given a set of active orders whose rental period overlaps the target month
 * but haven't been invoiced yet, and a set of closed invoices we already have
 * GL distributions for, this module picks the best "template" for each order
 * and splits that order's unbilled amount across GL accounts using the
 * template's mix.
 *
 * Templates are tried in order of specificity (highest confidence first):
 *
 *   1. same-order    — the order itself has prior closed invoices (partial
 *                      billings, sister invoices). Their actual GL split is
 *                      the ground truth for whatever this order will be
 *                      coded to when the remainder bills.
 *   2. same-customer — other invoices against the same customer in this
 *                      period. Reasonable proxy when a customer's orders
 *                      tend to use a consistent set of revenue categories.
 *   3. same-type     — invoices whose order description classifies to the
 *                      same equipment type (vehicle / grip_lighting /
 *                      studio / pro_supplies). A pure vehicle order like
 *                      AC10005 lands on the vehicle mix even if neither
 *                      the order nor its customer has prior invoices.
 *   4. global        — fall back to the period-wide mix (prior behavior).
 *                      Only used when none of the above produce a mix.
 *
 * The rental-accruals-v2 route calls this per-order; the aggregate JE is the
 * sum of per-order splits, so the $180 on a pure vehicle order now lands
 * almost entirely on the vehicle revenue account rather than being sprinkled
 * across every GL the period's invoice mix happens to touch.
 */

import type { EquipmentType } from "@/lib/types/database";

export interface OrderGLTemplateSource {
  /** Closed invoice keyed data used to build a template mix. */
  invoiceNumber: string;
  orderNumber: string | null;
  customerName: string;
  equipmentType: EquipmentType;
  /** Revenue credits only, net of debits — already filtered to 4xxxx. */
  glLines: Array<{
    glAccountNo: string;
    glAccountDescription: string;
    glAccountId: string;
    revenueAmount: number; // positive for credits
  }>;
}

export interface UnbilledOrderForSplit {
  orderNumber: string | null;
  customerName: string;
  equipmentType: EquipmentType;
  /** Amount of this order's unbilled remainder that falls inside the target month. */
  grossInMonth: number;
}

export interface PerOrderSplit {
  orderNumber: string | null;
  customerName: string;
  equipmentType: EquipmentType;
  grossInMonth: number;
  templateSource: "same-order" | "same-customer" | "same-type" | "global" | "unclassified";
  templateDetail: string;
  lines: Array<{
    glAccountNo: string;
    glAccountDescription: string;
    glAccountId: string;
    grossAmount: number;
    share: number;
  }>;
}

interface Weighted {
  glAccountNo: string;
  glAccountDescription: string;
  glAccountId: string;
  total: number;
}

/**
 * Roll up a list of template sources into a per-account weight map.
 * Returns `null` if the sources have zero revenue (nothing to template from).
 */
function weightFromSources(sources: OrderGLTemplateSource[]): Weighted[] | null {
  const map = new Map<string, Weighted>();
  for (const s of sources) {
    for (const l of s.glLines) {
      if (l.revenueAmount <= 0) continue;
      const existing = map.get(l.glAccountNo);
      if (existing) {
        existing.total += l.revenueAmount;
      } else {
        map.set(l.glAccountNo, {
          glAccountNo: l.glAccountNo,
          glAccountDescription: l.glAccountDescription,
          glAccountId: l.glAccountId,
          total: l.revenueAmount,
        });
      }
    }
  }
  if (map.size === 0) return null;
  return [...map.values()];
}

function allocate(
  weighted: Weighted[],
  gross: number,
): Array<{
  glAccountNo: string;
  glAccountDescription: string;
  glAccountId: string;
  grossAmount: number;
  share: number;
}> {
  const totalWeight = weighted.reduce((s, w) => s + w.total, 0);
  if (totalWeight <= 0) return [];

  const sorted = [...weighted].sort((a, b) => b.total - a.total);
  let allocated = 0;
  const lines = sorted.map((w, idx) => {
    const share = w.total / totalWeight;
    const isLast = idx === sorted.length - 1;
    const grossAmount = isLast
      ? round2(gross - allocated)
      : round2(gross * share);
    allocated += grossAmount;
    return {
      glAccountNo: w.glAccountNo,
      glAccountDescription: w.glAccountDescription,
      glAccountId: w.glAccountId,
      grossAmount,
      share,
    };
  });
  return lines;
}

export interface SplitUnbilledInput {
  orders: UnbilledOrderForSplit[];
  templates: OrderGLTemplateSource[];
}

export interface SplitUnbilledResult {
  perOrder: PerOrderSplit[];
  /** Aggregated across all orders — what the caller will feed into the JE. */
  byAccount: Array<{
    glAccountNo: string;
    glAccountDescription: string;
    glAccountId: string;
    grossAmount: number;
    /** 0-1 share of total unbilled gross. */
    share: number;
    unclassified: boolean;
  }>;
  /** Count of orders that fell through to each template tier. */
  templateCounts: Record<PerOrderSplit["templateSource"], number>;
}

/**
 * Split each order's unbilled gross across its best-available GL template,
 * then roll the per-order lines up into a global `byAccount` view.
 */
export function splitUnbilledByOrder(
  input: SplitUnbilledInput,
): SplitUnbilledResult {
  const { orders, templates } = input;

  // Index templates for fast lookup.
  const byOrder = new Map<string, OrderGLTemplateSource[]>();
  const byCustomer = new Map<string, OrderGLTemplateSource[]>();
  const byType = new Map<EquipmentType, OrderGLTemplateSource[]>();
  for (const t of templates) {
    if (t.orderNumber) {
      if (!byOrder.has(t.orderNumber)) byOrder.set(t.orderNumber, []);
      byOrder.get(t.orderNumber)!.push(t);
    }
    if (t.customerName) {
      if (!byCustomer.has(t.customerName)) byCustomer.set(t.customerName, []);
      byCustomer.get(t.customerName)!.push(t);
    }
    if (!byType.has(t.equipmentType)) byType.set(t.equipmentType, []);
    byType.get(t.equipmentType)!.push(t);
  }
  const globalWeighted = weightFromSources(templates);

  const perOrder: PerOrderSplit[] = [];
  const templateCounts: Record<PerOrderSplit["templateSource"], number> = {
    "same-order": 0,
    "same-customer": 0,
    "same-type": 0,
    "global": 0,
    "unclassified": 0,
  };

  for (const ord of orders) {
    if (ord.grossInMonth <= 0) continue;

    let templateSource: PerOrderSplit["templateSource"] = "unclassified";
    let templateDetail = "No template available";
    let weighted: Weighted[] | null = null;

    // 1. Same-order prior invoices.
    if (ord.orderNumber) {
      const srcs = byOrder.get(ord.orderNumber);
      if (srcs && srcs.length > 0) {
        const w = weightFromSources(srcs);
        if (w) {
          weighted = w;
          templateSource = "same-order";
          templateDetail = `${srcs.length} prior invoice${srcs.length === 1 ? "" : "s"} on this order`;
        }
      }
    }

    // 2. Same-customer invoices in-period.
    if (!weighted && ord.customerName) {
      const srcs = byCustomer.get(ord.customerName);
      if (srcs && srcs.length > 0) {
        const w = weightFromSources(srcs);
        if (w) {
          weighted = w;
          templateSource = "same-customer";
          templateDetail = `${srcs.length} invoice${srcs.length === 1 ? "" : "s"} for ${ord.customerName} in this period`;
        }
      }
    }

    // 3. Same equipment type.
    if (!weighted) {
      const srcs = byType.get(ord.equipmentType);
      if (srcs && srcs.length > 0) {
        const w = weightFromSources(srcs);
        if (w) {
          weighted = w;
          templateSource = "same-type";
          templateDetail = `${srcs.length} invoice${srcs.length === 1 ? "" : "s"} classified as ${ord.equipmentType} in this period`;
        }
      }
    }

    // 4. Global fallback.
    if (!weighted && globalWeighted) {
      weighted = globalWeighted;
      templateSource = "global";
      templateDetail = `Fell through to period-wide GL mix (${templates.length} invoices)`;
    }

    if (!weighted) {
      perOrder.push({
        orderNumber: ord.orderNumber,
        customerName: ord.customerName,
        equipmentType: ord.equipmentType,
        grossInMonth: round2(ord.grossInMonth),
        templateSource: "unclassified",
        templateDetail,
        lines: [],
      });
      templateCounts.unclassified += 1;
      continue;
    }

    const lines = allocate(weighted, ord.grossInMonth);
    perOrder.push({
      orderNumber: ord.orderNumber,
      customerName: ord.customerName,
      equipmentType: ord.equipmentType,
      grossInMonth: round2(ord.grossInMonth),
      templateSource,
      templateDetail,
      lines,
    });
    templateCounts[templateSource] += 1;
  }

  // Roll up per-order lines into byAccount.
  const rollup = new Map<
    string,
    {
      glAccountNo: string;
      glAccountDescription: string;
      glAccountId: string;
      grossAmount: number;
    }
  >();
  let unclassifiedGross = 0;
  let totalGross = 0;

  for (const p of perOrder) {
    totalGross += p.grossInMonth;
    if (p.templateSource === "unclassified" || p.lines.length === 0) {
      unclassifiedGross += p.grossInMonth;
      continue;
    }
    for (const ln of p.lines) {
      const existing = rollup.get(ln.glAccountNo);
      if (existing) {
        existing.grossAmount = round2(existing.grossAmount + ln.grossAmount);
      } else {
        rollup.set(ln.glAccountNo, {
          glAccountNo: ln.glAccountNo,
          glAccountDescription: ln.glAccountDescription,
          glAccountId: ln.glAccountId,
          grossAmount: round2(ln.grossAmount),
        });
      }
    }
  }

  const byAccount: SplitUnbilledResult["byAccount"] = [];
  for (const v of rollup.values()) {
    byAccount.push({
      glAccountNo: v.glAccountNo,
      glAccountDescription: v.glAccountDescription,
      glAccountId: v.glAccountId,
      grossAmount: v.grossAmount,
      share: totalGross > 0 ? v.grossAmount / totalGross : 0,
      unclassified: false,
    });
  }
  if (unclassifiedGross > 0) {
    byAccount.push({
      glAccountNo: "",
      glAccountDescription: "Unclassified Revenue (no historical mapping)",
      glAccountId: "",
      grossAmount: round2(unclassifiedGross),
      share: totalGross > 0 ? unclassifiedGross / totalGross : 0,
      unclassified: true,
    });
  }
  byAccount.sort((a, b) => b.grossAmount - a.grossAmount);

  return { perOrder, byAccount, templateCounts };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Capex and disposal plan engine. Pure.
 *
 * A capex item is N identical units placed in service in one month. It
 * produces cash out (in-service month), straight-line book depreciation
 * from the in-service month, a debt draw when funded by debt, and a fleet
 * count increase. A disposal item removes units in a month: proceeds in,
 * gain or loss against net book value, depreciation stops the month of
 * disposal (house policy: no depreciation in the disposal month).
 */

export interface CapexItemInput {
  id: string;
  description: string;
  assetGroup: string | null;
  quantity: number;
  unitCost: number;
  inServiceYear: number;
  inServiceMonth: number;
  usefulLifeMonths: number | null;
  salvagePct: number | null;
  funding: "cash" | "debt" | "lease";
  debtRate: number | null;
  debtTermMonths: number | null;
  debtPct: number | null;
  status: string;
}

export interface DisposalItemInput {
  id: string;
  description: string | null;
  assetGroup: string | null;
  quantity: number;
  disposalYear: number;
  disposalMonth: number;
  expectedProceeds: number;
  nbvAtDisposal: number | null;
  monthlyDepreciation: number | null;
  status: string;
}

export interface GroupDefaults {
  usefulLifeMonths: number;
  salvagePct: number;
}

export interface CapexMonthly {
  /** Cash out for purchases (positive) */
  capexCash: number[];
  /** Book depreciation added by capex placeholders */
  depreciation: number[];
  /** New debt drawn in the month */
  debtDraw: number[];
  /** Interest on capex debt (simple amortizing estimate) */
  debtInterest: number[];
  /** Principal repaid on capex debt */
  debtPrincipal: number[];
  /** Proceeds from disposals (positive) */
  disposalProceeds: number[];
  /** Gain (positive) or loss (negative) on disposals */
  disposalGainLoss: number[];
  /** Depreciation removed by disposals (positive number = expense avoided) */
  depreciationAvoided: number[];
  /** Fleet count delta by asset group by month (cumulative, end of month) */
  fleetDelta: Record<string, number[]>;
}

const ACTIVE = new Set(["planned", "approved", "ordered", "received", "listed", "sold"]);

function zeros(): number[] {
  return new Array(12).fill(0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Monthly straight-line depreciation for one unit. */
export function unitMonthlyDepreciation(unitCost: number, usefulLifeMonths: number, salvagePct: number): number {
  if (!usefulLifeMonths || usefulLifeMonths <= 0) return 0;
  const salvage = unitCost * (Math.max(0, Math.min(100, salvagePct)) / 100);
  return (unitCost - salvage) / usefulLifeMonths;
}

/** Level payment for an amortizing loan. */
export function levelPayment(principal: number, annualRate: number, termMonths: number): number {
  if (termMonths <= 0) return principal;
  const r = annualRate / 12;
  if (r === 0) return principal / termMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -termMonths));
}

export function computeCapexMonthly(
  year: number,
  items: CapexItemInput[],
  disposals: DisposalItemInput[],
  defaultsFor: (assetGroup: string | null) => GroupDefaults,
  disposalProceedsPctOfNbv = 100,
): CapexMonthly {
  const out: CapexMonthly = {
    capexCash: zeros(),
    depreciation: zeros(),
    debtDraw: zeros(),
    debtInterest: zeros(),
    debtPrincipal: zeros(),
    disposalProceeds: zeros(),
    disposalGainLoss: zeros(),
    depreciationAvoided: zeros(),
    fleetDelta: {},
  };
  const groupKey = (g: string | null) => g ?? "Unassigned";

  for (const it of items) {
    if (!ACTIVE.has(it.status)) continue;
    const total = it.quantity * it.unitCost;
    const d = defaultsFor(it.assetGroup);
    const life = it.usefulLifeMonths ?? d.usefulLifeMonths;
    const salvagePct = it.salvagePct ?? d.salvagePct;
    const perUnit = unitMonthlyDepreciation(it.unitCost, life, salvagePct);
    const key = groupKey(it.assetGroup);
    out.fleetDelta[key] ??= zeros();

    // Items placed in service before the budget year still depreciate this year
    const startIndex = (it.inServiceYear - year) * 12 + (it.inServiceMonth - 1); // may be negative
    const endIndex = startIndex + life - 1;
    for (let i = 0; i < 12; i++) {
      if (i >= startIndex && i <= endIndex) out.depreciation[i] += perUnit * it.quantity;
      if (i >= startIndex) out.fleetDelta[key][i] += it.quantity;
    }
    if (startIndex >= 0 && startIndex < 12) {
      out.capexCash[startIndex] += total;
      if (it.funding === "debt") {
        const pct = (it.debtPct ?? 100) / 100;
        const principal = total * pct;
        const rate = it.debtRate ?? 0;
        const term = it.debtTermMonths ?? 60;
        out.debtDraw[startIndex] += principal;
        // First payment the month after the draw
        const pmt = levelPayment(principal, rate, term);
        let balance = principal;
        for (let i = startIndex + 1; i < 12 && balance > 0.005; i++) {
          const interest = balance * (rate / 12);
          const princ = Math.min(balance, pmt - interest);
          out.debtInterest[i] += interest;
          out.debtPrincipal[i] += princ;
          balance -= princ;
        }
      }
    } else if (startIndex < 0 && it.funding === "debt") {
      // Debt drawn in a prior year: continue the amortization into this year
      const pct = (it.debtPct ?? 100) / 100;
      const principal = total * pct;
      const rate = it.debtRate ?? 0;
      const term = it.debtTermMonths ?? 60;
      const pmt = levelPayment(principal, rate, term);
      let balance = principal;
      for (let i = startIndex + 1; i < 12 && balance > 0.005; i++) {
        const interest = balance * (rate / 12);
        const princ = Math.min(balance, pmt - interest);
        if (i >= 0) {
          out.debtInterest[i] += interest;
          out.debtPrincipal[i] += princ;
        }
        balance -= princ;
      }
    }
  }

  for (const dsp of disposals) {
    if (!ACTIVE.has(dsp.status) || dsp.disposalYear !== year) continue;
    const idx = dsp.disposalMonth - 1;
    const key = groupKey(dsp.assetGroup);
    out.fleetDelta[key] ??= zeros();
    for (let i = idx; i < 12; i++) out.fleetDelta[key][i] -= dsp.quantity;

    const nbv = dsp.nbvAtDisposal ?? 0;
    const proceeds = dsp.expectedProceeds > 0 ? dsp.expectedProceeds : nbv * (disposalProceedsPctOfNbv / 100);
    out.disposalProceeds[idx] += proceeds;
    out.disposalGainLoss[idx] += proceeds - nbv;
    if (dsp.monthlyDepreciation) {
      for (let i = idx; i < 12; i++) out.depreciationAvoided[i] += dsp.monthlyDepreciation;
    }
  }

  for (const k of Object.keys(out) as Array<keyof CapexMonthly>) {
    if (k === "fleetDelta") {
      for (const g of Object.keys(out.fleetDelta)) out.fleetDelta[g] = out.fleetDelta[g].map(round2);
    } else {
      out[k] = (out[k] as number[]).map(round2);
    }
  }
  return out;
}

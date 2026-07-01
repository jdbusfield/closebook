"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, AlertCircle, Calendar, Clock, Banknote } from "lucide-react";

// --- Types ---

interface DetailTarget {
  employeeId: string;
  companyId: string;
  year: number;
  month: number;
  name: string;
}

interface AllocatedAmounts {
  grossPay: number;
  hours?: number;
  regularHours: number;
  regularDollars: number;
  overtimeHours: number;
  overtimeDollars: number;
  doubletimeHours: number;
  doubletimeDollars: number;
  mealDollars: number;
  otherEarningsDollars: number;
  erTaxes: number;
  erBenefits: number;
  erBenefitDetail?: Record<string, number>;
}

interface PaycheckEntry {
  checkDate: string;
  beginDate: string;
  endDate: string;
  payPeriodDays: number;
  daysInMonth: number;
  proRataFraction: number;
  full: AllocatedAmounts;
  allocated: AllocatedAmounts;
}

interface AccrualInfo {
  daysUncovered: number;
  daysInMonth: number;
  dailyRate: number;
  estimatedGross: number;
  estimatedErTaxes: number;
  estimatedErBenefits: number;
}

interface DetailResponse {
  employeeName: string;
  payType: string;
  annualComp: number;
  year: number;
  month: number;
  daysInMonth: number;
  paychecks: PaycheckEntry[];
  accrual: AccrualInfo | null;
  totalAllocated: AllocatedAmounts;
}

const MONTH_LABELS = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BENEFIT_LABELS: Record<string, string> = {
  ERMED: "Medical/Dental/Vision",
  "401ER": "401(k) Match",
};

// --- Helpers ---

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function fmtHrs(n: number): string {
  return n > 0 ? `${n.toFixed(1)}h` : "";
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDate(d: string): string {
  const [, m, day] = d.split("-");
  return `${m}/${day}`;
}

function fmtDateFull(d: string): string {
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

/** Line item row for consistent formatting */
function LineItem({
  label,
  hours,
  full,
  allocated,
  indent,
  muted,
  bold,
}: {
  label: string;
  hours?: string;
  full?: number;
  allocated: number;
  indent?: boolean;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div className={`grid grid-cols-[1fr_60px_90px_90px] gap-1 items-center py-1 ${indent ? "pl-4" : ""}`}>
      <span className={`text-sm ${muted ? "text-muted-foreground" : ""} ${bold ? "font-semibold" : ""}`}>
        {label}
      </span>
      <span className="text-right font-mono text-xs text-muted-foreground">
        {hours ?? ""}
      </span>
      <span className={`text-right font-mono text-sm ${muted ? "text-muted-foreground" : ""}`}>
        {full !== undefined ? fmt(full) : ""}
      </span>
      <span className={`text-right font-mono text-sm ${bold ? "font-semibold" : "font-medium"}`}>
        {fmt(allocated)}
      </span>
    </div>
  );
}

// --- Reusable body: fetches + renders the per-paycheck breakdown for one
//     employee/month. Used by the entity drill-down sheet and the org-level
//     Monthly Payroll Estimate employee drawer. ---

export function PaycheckDetailBody({
  employeeId,
  companyId,
  year,
  month,
  onLoaded,
  hideAccrual,
}: {
  employeeId: string;
  companyId: string;
  year: number;
  month: number;
  /** Notified when data loads (e.g. so a parent header can show payType/annual). */
  onLoaded?: (info: { payType: string; annualComp: number } | null) => void;
  /** Suppress the endpoint's own accrual section (the estimate view renders its
   *  own bridge-consistent month-end accrual instead). */
  hideAccrual?: boolean;
}) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    onLoaded?.(null);

    fetch(
      `/api/paylocity/monthly-costs/detail?employeeId=${employeeId}&companyId=${companyId}&year=${year}&month=${month}`
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((d: DetailResponse) => {
        setData(d);
        onLoaded?.({ payType: d.payType, annualComp: d.annualComp });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // onLoaded intentionally omitted from deps (parent callback identity)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, companyId, year, month]);

  const totalCost = data
    ? data.totalAllocated.grossPay + data.totalAllocated.erTaxes + data.totalAllocated.erBenefits
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-destructive text-sm pt-4">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Month Summary Card */}
      <div className="rounded-lg bg-muted/40 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Month Summary (allocated to {MONTH_LABELS[data.month]})
          </h3>
          <span className="text-lg font-bold font-mono">{fmt(totalCost)}</span>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span>Regular Time</span>
            <span className="font-mono">{fmt(data.totalAllocated.regularDollars)}</span>
          </div>
          {data.totalAllocated.overtimeDollars > 0 && (
            <div className="flex justify-between text-sm">
              <span>Overtime (1.5x)</span>
              <span className="font-mono">{fmt(data.totalAllocated.overtimeDollars)}</span>
            </div>
          )}
          {data.totalAllocated.doubletimeDollars > 0 && (
            <div className="flex justify-between text-sm">
              <span>Double Time (2x)</span>
              <span className="font-mono">{fmt(data.totalAllocated.doubletimeDollars)}</span>
            </div>
          )}
          {data.totalAllocated.mealDollars > 0 && (
            <div className="flex justify-between text-sm">
              <span>Meal Premiums</span>
              <span className="font-mono">{fmt(data.totalAllocated.mealDollars)}</span>
            </div>
          )}
          {data.totalAllocated.otherEarningsDollars > 0 && (
            <div className="flex justify-between text-sm">
              <span>Other Earnings</span>
              <span className="font-mono">{fmt(data.totalAllocated.otherEarningsDollars)}</span>
            </div>
          )}

          <Separator className="my-1.5" />

          <div className="flex justify-between text-sm font-medium">
            <span>Gross Pay</span>
            <span className="font-mono">{fmt(data.totalAllocated.grossPay)}</span>
          </div>

          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Employer Taxes</span>
            <span className="font-mono">{fmt(data.totalAllocated.erTaxes)}</span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Employer Benefits</span>
            <span className="font-mono">{fmt(data.totalAllocated.erBenefits)}</span>
          </div>

          <Separator className="my-1.5" />

          <div className="flex justify-between text-sm font-bold">
            <span>Total Employer Cost</span>
            <span className="font-mono">{fmt(totalCost)}</span>
          </div>
        </div>
      </div>

      {/* Paychecks */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Banknote className="h-3.5 w-3.5" />
          Paychecks ({data.paychecks.length})
        </h3>

        {data.paychecks.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No paychecks overlap this month.
          </p>
        )}

        <div className="space-y-3">
          {data.paychecks.map((pc, idx) => (
            <div key={idx} className="rounded-lg border overflow-hidden">
              {/* Header */}
              <div className="px-4 py-2.5 bg-muted/50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{fmtDateFull(pc.checkDate)}</span>
                  </div>
                  <span className="text-muted-foreground">
                    {fmtDate(pc.beginDate)} &ndash; {fmtDate(pc.endDate)}
                  </span>
                </div>
                <Badge variant="secondary" className="text-xs shrink-0">
                  {pc.daysInMonth}/{pc.payPeriodDays}d &middot; {fmtPct(pc.proRataFraction)}
                </Badge>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-[1fr_60px_90px_90px] gap-1 px-4 py-1.5 border-b bg-muted/20 text-xs text-muted-foreground font-medium">
                <span>Category</span>
                <span className="text-right">Hours</span>
                <span className="text-right">Full</span>
                <span className="text-right">Allocated</span>
              </div>

              {/* Rows */}
              <div className="px-4 divide-y divide-border/50">
                <LineItem
                  label="Regular Time"
                  hours={fmtHrs(pc.full.regularHours)}
                  full={pc.full.regularDollars}
                  allocated={pc.allocated.regularDollars}
                />
                {(pc.full.overtimeHours > 0 || pc.full.overtimeDollars > 0) && (
                  <LineItem
                    label="Overtime (1.5x)"
                    hours={fmtHrs(pc.full.overtimeHours)}
                    full={pc.full.overtimeDollars}
                    allocated={pc.allocated.overtimeDollars}
                  />
                )}
                {(pc.full.doubletimeHours > 0 || pc.full.doubletimeDollars > 0) && (
                  <LineItem
                    label="Double Time (2x)"
                    hours={fmtHrs(pc.full.doubletimeHours)}
                    full={pc.full.doubletimeDollars}
                    allocated={pc.allocated.doubletimeDollars}
                  />
                )}
                {pc.full.mealDollars > 0 && (
                  <LineItem
                    label="Meal Premiums"
                    full={pc.full.mealDollars}
                    allocated={pc.allocated.mealDollars}
                  />
                )}
                {pc.full.otherEarningsDollars > 0 && (
                  <LineItem
                    label="Other Earnings"
                    full={pc.full.otherEarningsDollars}
                    allocated={pc.allocated.otherEarningsDollars}
                  />
                )}

                {/* Gross subtotal */}
                <LineItem
                  label="Gross Pay"
                  hours={fmtHrs(pc.full.hours ?? 0)}
                  full={pc.full.grossPay}
                  allocated={pc.allocated.grossPay}
                  bold
                />

                {/* ER costs */}
                <LineItem
                  label="Employer Taxes"
                  full={pc.full.erTaxes}
                  allocated={pc.allocated.erTaxes}
                  muted
                />
                <LineItem
                  label="Employer Benefits"
                  full={pc.full.erBenefits}
                  allocated={pc.allocated.erBenefits}
                  muted
                />
                {Object.entries(pc.allocated.erBenefitDetail ?? {}).map(([code, amount]) => (
                  <LineItem
                    key={code}
                    label={BENEFIT_LABELS[code] ?? code}
                    allocated={amount}
                    indent
                    muted
                  />
                ))}
              </div>

              {/* Paycheck total */}
              <div className="px-4 py-2 bg-muted/30 border-t flex justify-between text-sm font-semibold">
                <span>Paycheck Total (Allocated)</span>
                <span className="font-mono">
                  {fmt(pc.allocated.grossPay + pc.allocated.erTaxes + pc.allocated.erBenefits)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Accrual section */}
      {!hideAccrual && data.accrual && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            Accrual Estimate
          </h3>

          <div className="rounded-lg border border-dashed p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {data.accrual.daysUncovered} of {data.accrual.daysInMonth} days uncovered
              </Badge>
              <span className="text-xs text-muted-foreground">
                @ {fmt(data.accrual.dailyRate)}/day
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-muted/40 p-2.5 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">Gross</p>
                <p className="font-mono font-semibold text-sm">{fmt(data.accrual.estimatedGross)}</p>
              </div>
              <div className="rounded-md bg-muted/40 p-2.5 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">ER Taxes</p>
                <p className="font-mono font-semibold text-sm">{fmt(data.accrual.estimatedErTaxes)}</p>
              </div>
              <div className="rounded-md bg-muted/40 p-2.5 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">ER Benefits</p>
                <p className="font-mono font-semibold text-sm">{fmt(data.accrual.estimatedErBenefits)}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Entity drill-down sheet (unchanged external API) ---

export function PaycheckDetailSheet({
  target,
  onClose,
}: {
  target: DetailTarget | null;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<{ payType: string; annualComp: number } | null>(null);

  return (
    <Sheet open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="sm:max-w-[600px] overflow-y-auto p-0">
        {/* Fixed header */}
        <div className="sticky top-0 z-10 bg-background border-b px-6 pt-6 pb-4">
          <SheetHeader>
            <SheetTitle className="text-lg">
              {target?.name}
            </SheetTitle>
            <SheetDescription className="flex items-center gap-3 text-sm">
              <span>{MONTH_LABELS[target?.month ?? 0]} {target?.year}</span>
              {meta && (
                <>
                  <Separator orientation="vertical" className="h-4" />
                  <span>{meta.payType}</span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>Annual: {fmt(meta.annualComp ?? 0)}</span>
                </>
              )}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="px-6 pb-6 pt-4">
          {target && (
            <PaycheckDetailBody
              employeeId={target.employeeId}
              companyId={target.companyId}
              year={target.year}
              month={target.month}
              onLoaded={setMeta}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

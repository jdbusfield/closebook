"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PaycheckDetailBody } from "@/app/(app)/[entityId]/employees/monthly/paycheck-detail-sheet";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Clock,
} from "lucide-react";

// ── Types (mirror /api/paylocity/monthly-estimate) ──

interface AmountTriple {
  wages: number;
  erTaxes: number;
  erBenefits: number;
}

interface EmployeeBridge {
  employeeId: string;
  companyId: string;
  employeeName: string;
  effectiveEntityCode: string;
  department: string;
  costCenterCode: string;
  usedCostCenterFallback: boolean;
  allocationChangedInMonth: boolean;
  cash: AmountTriple;
  beginningAccrued: AmountTriple;
  endingAccrued: AmountTriple;
  estimatedTail: AmountTriple;
  earnedInMonth: AmountTriple;
  overtimeHours: number;
  doubletimeHours: number;
  mealPremiums: number;
  premiumPayCost: number;
  uncoveredTailDays: number;
  tailStartDate: string | null;
  tailEndDate: string | null;
  tailSuppressed: boolean;
  tailBasis: string;
  checkCount: number;
}

interface EntityBridge {
  entityId: string;
  entityCode: string;
  entityName: string;
  headcount: number;
  cash: AmountTriple;
  beginningAccrued: AmountTriple;
  endingAccrued: AmountTriple;
  estimatedTail: AmountTriple;
  earnedInMonth: AmountTriple;
  overtimeHours: number;
  doubletimeHours: number;
  mealPremiums: number;
  premiumPayCost: number;
  employees: EmployeeBridge[];
}

interface Exception {
  kind: string;
  employeeName: string;
  entityCode: string;
  detail: string;
}

interface OrgEstimate {
  year: number;
  month: number;
  isClosedMonth: boolean;
  org: {
    cash: AmountTriple;
    beginningAccrued: AmountTriple;
    endingAccrued: AmountTriple;
    estimatedTail: AmountTriple;
    earnedInMonth: AmountTriple;
    overtimeHours: number;
    doubletimeHours: number;
    mealPremiums: number;
    premiumPayCost: number;
    headcount: number;
  };
  entities: EntityBridge[];
  payingEntities: EntityBridge[];
  exceptions: Exception[];
  reconciliation: {
    orgEqualsEntities: boolean;
    entitiesEqualEmployees: boolean;
    bridgeBalances: boolean;
    maxResidual: number;
  };
  meta: { lastSynced: string | null; monthEndCovered: boolean; checksLoaded: number };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const EXCEPTION_LABELS: Record<string, string> = {
  unmapped_cost_center: "Unmapped cost center",
  estimated_tail: "Estimated month-end tail",
  long_uncovered_gap: "Long gap — not accrued",
  zero_checks: "No checks in month",
  allocation_changed_mid_month: "Allocation changed mid-month",
};

// ── Helpers ──

function total(t: AmountTriple): number {
  return t.wages + t.erTaxes + t.erBenefits;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

function fmtCents(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function fmtMD(iso: string | null): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function fmtNum(n: number, dp = 1): string {
  return n ? n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp }) : "—";
}

// ── Bridge table (reused for org, entity, employee) ──

function BridgeTable({
  cash,
  beginningAccrued,
  endingAccrued,
  estimatedTail,
  earnedInMonth,
  dense,
}: {
  cash: AmountTriple;
  beginningAccrued: AmountTriple;
  endingAccrued: AmountTriple;
  estimatedTail: AmountTriple;
  earnedInMonth: AmountTriple;
  dense?: boolean;
}) {
  const money = dense ? fmtCents : fmt;
  const cols: { key: keyof AmountTriple; label: string }[] = [
    { key: "wages", label: "Wages" },
    { key: "erTaxes", label: "ER Taxes" },
    { key: "erBenefits", label: "ER Benefits" },
  ];
  const rows = [
    { label: "Cash paid in month", value: cash, op: "" },
    { label: "Less: Beginning accrued", value: beginningAccrued, op: "-" },
    { label: "Plus: Ending accrued", value: endingAccrued, op: "+" },
  ];
  const tailTotal = total(estimatedTail);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px]">Bridge</TableHead>
            {cols.map((c) => (
              <TableHead key={c.key} className="text-right">{c.label}</TableHead>
            ))}
            <TableHead className="text-right font-semibold">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const sign = r.op === "-" ? -1 : 1;
            return (
              <TableRow key={r.label}>
                <TableCell className="text-sm text-muted-foreground">{r.label}</TableCell>
                {cols.map((c) => (
                  <TableCell key={c.key} className="text-right font-mono text-sm">
                    {money(sign * r.value[c.key])}
                  </TableCell>
                ))}
                <TableCell className="text-right font-mono text-sm">
                  {money(sign * total(r.value))}
                </TableCell>
              </TableRow>
            );
          })}
          {tailTotal !== 0 && (
            <TableRow>
              <TableCell className="text-xs italic text-muted-foreground pl-6">
                (of which estimated month-end tail)
              </TableCell>
              {cols.map((c) => (
                <TableCell key={c.key} className="text-right font-mono text-xs italic text-muted-foreground">
                  {money(estimatedTail[c.key])}
                </TableCell>
              ))}
              <TableCell className="text-right font-mono text-xs italic text-muted-foreground">
                {money(tailTotal)}
              </TableCell>
            </TableRow>
          )}
          <TableRow className="border-t-2 bg-muted/50 font-semibold">
            <TableCell>= Accrual-basis expense</TableCell>
            {cols.map((c) => (
              <TableCell key={c.key} className="text-right font-mono">
                {money(earnedInMonth[c.key])}
              </TableCell>
            ))}
            <TableCell className="text-right font-mono font-bold">
              {money(total(earnedInMonth))}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function ReconChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${ok ? "border-green-600/30 text-green-700 dark:text-green-400" : "border-destructive/40 text-destructive"}`}>
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {label}
    </div>
  );
}

// ── Page ──

export default function OrgMonthlyEstimatePage() {
  const now = new Date();
  // Default to the previous (most recently closed) month.
  const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [data, setData] = useState<OrgEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeBridge | null>(null);
  const [groupMode, setGroupMode] = useState<"allocated" | "paying">("allocated");

  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - 2 + i);

  const fetchData = useCallback(async (y: number, m: number) => {
    const res = await fetch(`/api/paylocity/monthly-estimate?year=${y}&month=${m}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Failed: ${res.status}`);
    }
    return (await res.json()) as OrgEstimate;
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchData(year, month)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, month, fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/paylocity/monthly-costs?year=${year}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sync failed: ${res.status}`);
      }
      setData(await fetchData(year, month));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const headline = data ? total(data.org.earnedInMonth) : 0;
  const groups = data ? (groupMode === "paying" ? data.payingEntities : data.entities) : [];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/payroll">
            <Button variant="ghost" size="sm" className="gap-1 -ml-2 mb-1">
              <ArrowLeft className="h-4 w-4" />
              Payroll Overview
            </Button>
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Monthly Payroll Estimate</h1>
          <p className="text-muted-foreground">
            Accrual-basis payroll expense for one month, org-wide, with a cash → accrual bridge.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {syncing ? "Syncing..." : "Sync"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4"><p className="text-sm text-destructive">{error}</p></CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {data && !loading && (
        <>
          {/* Headline */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-end justify-between flex-wrap gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {MONTHS[month - 1]} {year} — accrual-basis payroll expense
                  </p>
                  <p className="text-4xl font-bold font-mono mt-1">{fmt(headline)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {data.org.headcount} employees · wages {fmt(total(data.org.earnedInMonth) - data.org.earnedInMonth.erTaxes - data.org.earnedInMonth.erBenefits)} + ER taxes {fmt(data.org.earnedInMonth.erTaxes)} + ER benefits {fmt(data.org.earnedInMonth.erBenefits)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Premium pay: OT {fmtNum(data.org.overtimeHours)} hrs · DT {fmtNum(data.org.doubletimeHours)} hrs · {fmtNum(data.org.mealPremiums)} meal premiums · OT+DT+meal cost {fmt(data.org.premiumPayCost)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {data.isClosedMonth ? (
                    <Badge variant="secondary" className="gap-1"><Lock className="h-3 w-3" /> Closed month</Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> In progress — actuals to date</Badge>
                  )}
                  {data.meta.lastSynced && (
                    <span className="text-xs text-muted-foreground">
                      Synced {new Date(data.meta.lastSynced).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Reconciliation + coverage */}
          <div className="flex items-center gap-2 flex-wrap">
            <ReconChip ok={data.reconciliation.orgEqualsEntities} label="Org = Σ entities" />
            <ReconChip ok={data.reconciliation.entitiesEqualEmployees} label="Σ entities = Σ employees" />
            <ReconChip ok={data.reconciliation.bridgeBalances} label={`Bridge balances (max residual ${fmtCents(data.reconciliation.maxResidual)})`} />
            {data.isClosedMonth && (
              <ReconChip ok={data.meta.monthEndCovered} label={data.meta.monthEndCovered ? "Month-end paychecks synced" : "Month-end tail not yet paid (estimated)"} />
            )}
          </div>

          {/* Bridge */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cash → Accrual Bridge</CardTitle>
              <CardDescription>
                How cash paid this month reconciles to accrual-basis expense.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BridgeTable {...data.org} />
            </CardContent>
          </Card>

          {/* Per-entity */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="text-base">
                    {groupMode === "paying" ? "By Paying Entity (payroll company)" : "By Reporting Entity (allocation)"}
                  </CardTitle>
                  <CardDescription>
                    {groupMode === "paying"
                      ? "Grouped by the entity whose payroll company actually paid each employee — how it comes out of the payroll system. Same total, for reconciliation."
                      : "Grouped by how each employee's cost is allocated. Click a row's employees to see detail."}
                  </CardDescription>
                </div>
                <Select value={groupMode} onValueChange={(v) => setGroupMode(v as "allocated" | "paying")}>
                  <SelectTrigger className="w-[230px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allocated">Group by allocation</SelectItem>
                    <SelectItem value="paying">Group by paying entity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entity</TableHead>
                      <TableHead className="text-right">HC</TableHead>
                      <TableHead className="text-right">Cash paid</TableHead>
                      <TableHead className="text-right">− Begin accr.</TableHead>
                      <TableHead className="text-right">+ End accr.</TableHead>
                      <TableHead className="text-right font-semibold">Accrual expense</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((e) => (
                      <TableRow
                        key={e.entityId}
                        className="cursor-pointer hover:bg-muted/40"
                      >
                        <TableCell className="font-medium">
                          {e.entityName}
                          <span className="text-xs text-muted-foreground ml-2">{e.entityCode}</span>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{e.headcount}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(total(e.cash))}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(-total(e.beginningAccrued))}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(total(e.endingAccrued))}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{fmt(total(e.earnedInMonth))}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 bg-muted/50 font-semibold">
                      <TableCell>Total ({groups.length} entities)</TableCell>
                      <TableCell className="text-right">{data.org.headcount}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(total(data.org.cash))}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(-total(data.org.beginningAccrued))}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(total(data.org.endingAccrued))}</TableCell>
                      <TableCell className="text-right font-mono font-bold">{fmt(headline)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {/* By-employee breakdown: OT / DT hours, meal premiums, premium cost */}
              <div className="mt-6 space-y-6">
                {groups.map((e) => (
                  <div key={e.entityId}>
                    <h4 className="text-sm font-semibold mb-2">{e.entityName} <span className="text-muted-foreground font-normal">· {e.headcount} employees</span></h4>
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="min-w-[180px]">Employee</TableHead>
                            <TableHead className="text-right">OT hrs</TableHead>
                            <TableHead className="text-right">DT hrs</TableHead>
                            <TableHead className="text-right">Meal prem.</TableHead>
                            <TableHead className="text-right">OT+DT+Meal cost</TableHead>
                            <TableHead className="text-right font-semibold">Accrual expense</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {e.employees.map((emp) => (
                            <TableRow
                              key={`${emp.employeeId}:${emp.companyId}`}
                              onClick={() => setSelectedEmp(emp)}
                              className="cursor-pointer hover:bg-muted/40"
                            >
                              <TableCell>
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-sm truncate">{emp.employeeName}</span>
                                  <span className="text-xs text-muted-foreground truncate hidden sm:inline">{emp.department}</span>
                                  {emp.usedCostCenterFallback && (
                                    <Badge variant="outline" className="text-[10px]">unmapped CC</Badge>
                                  )}
                                  {emp.tailSuppressed && (
                                    <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600">
                                      {emp.uncoveredTailDays}d gap
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">{fmtNum(emp.overtimeHours)}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{fmtNum(emp.doubletimeHours)}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{fmtNum(emp.mealPremiums)}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{emp.premiumPayCost ? fmt(emp.premiumPayCost) : "—"}</TableCell>
                              <TableCell className="text-right font-mono font-medium">{fmt(total(emp.earnedInMonth))}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2 bg-muted/40 font-semibold">
                            <TableCell>{e.entityCode} subtotal</TableCell>
                            <TableCell className="text-right font-mono">{fmtNum(e.overtimeHours)}</TableCell>
                            <TableCell className="text-right font-mono">{fmtNum(e.doubletimeHours)}</TableCell>
                            <TableCell className="text-right font-mono">{fmtNum(e.mealPremiums)}</TableCell>
                            <TableCell className="text-right font-mono">{e.premiumPayCost ? fmt(e.premiumPayCost) : "—"}</TableCell>
                            <TableCell className="text-right font-mono">{fmt(total(e.earnedInMonth))}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Exceptions */}
          {data.exceptions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Exceptions & Data Quality ({data.exceptions.length})
                </CardTitle>
                <CardDescription>Review these before trusting the estimate.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border divide-y">
                  {data.exceptions.map((ex, i) => (
                    <div key={i} className="flex items-start gap-3 px-3 py-2 text-sm">
                      <Badge variant="secondary" className="shrink-0 text-[10px] mt-0.5">
                        {EXCEPTION_LABELS[ex.kind] ?? ex.kind}
                      </Badge>
                      <div className="min-w-0">
                        <span className="font-medium">{ex.employeeName}</span>
                        <span className="text-muted-foreground ml-1">({ex.entityCode})</span>
                        <span className="text-muted-foreground"> — {ex.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Employee bridge drawer */}
      <Sheet open={!!selectedEmp} onOpenChange={(o) => { if (!o) setSelectedEmp(null); }}>
        <SheetContent className="sm:max-w-[640px] overflow-y-auto">
          {selectedEmp && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedEmp.employeeName}</SheetTitle>
                <SheetDescription className="flex items-center gap-2">
                  <span>{selectedEmp.effectiveEntityCode} · {selectedEmp.department}</span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>{MONTHS[month - 1]} {year}</span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>{selectedEmp.checkCount} check(s)</span>
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Cash → Accrual Bridge
                  </h3>
                  <BridgeTable {...selectedEmp} dense />
                </div>

                {/* Premium pay incurred (OT / DT / meal premiums) */}
                <div className="grid grid-cols-4 gap-2 rounded-lg border p-3">
                  <div className="text-center">
                    <p className="text-[11px] text-muted-foreground">OT hrs</p>
                    <p className="font-mono text-sm font-semibold">{fmtNum(selectedEmp.overtimeHours)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] text-muted-foreground">DT hrs</p>
                    <p className="font-mono text-sm font-semibold">{fmtNum(selectedEmp.doubletimeHours)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] text-muted-foreground">Meal prem.</p>
                    <p className="font-mono text-sm font-semibold">{fmtNum(selectedEmp.mealPremiums)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] text-muted-foreground">OT+DT+Meal $</p>
                    <p className="font-mono text-sm font-semibold">{selectedEmp.premiumPayCost ? fmtCents(selectedEmp.premiumPayCost) : "—"}</p>
                  </div>
                </div>
                {/* Month-end accrual (uncovered days after the last paycheck's period) */}
                {selectedEmp.uncoveredTailDays > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Accrued Payroll — month end
                    </h3>
                    <div className={`rounded-lg border border-dashed p-4 space-y-3 ${selectedEmp.tailSuppressed ? "border-amber-500/50" : ""}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {fmtMD(selectedEmp.tailStartDate)}–{fmtMD(selectedEmp.tailEndDate)} · {selectedEmp.uncoveredTailDays} day(s)
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          not covered by any paycheck period
                        </span>
                      </div>
                      {selectedEmp.tailSuppressed ? (
                        <p className="text-xs text-amber-600">
                          Exceeds one pay cycle — <strong>not accrued</strong>. Verify termination
                          or re-sync Paylocity.
                        </p>
                      ) : (
                        <div className="grid grid-cols-3 gap-3">
                          <div className="rounded-md bg-muted/40 p-2.5 text-center">
                            <p className="text-xs text-muted-foreground mb-0.5">Gross</p>
                            <p className="font-mono font-semibold text-sm">{fmtCents(selectedEmp.estimatedTail.wages)}</p>
                          </div>
                          <div className="rounded-md bg-muted/40 p-2.5 text-center">
                            <p className="text-xs text-muted-foreground mb-0.5">ER Taxes</p>
                            <p className="font-mono font-semibold text-sm">{fmtCents(selectedEmp.estimatedTail.erTaxes)}</p>
                          </div>
                          <div className="rounded-md bg-muted/40 p-2.5 text-center">
                            <p className="text-xs text-muted-foreground mb-0.5">ER Benefits</p>
                            <p className="font-mono font-semibold text-sm">{fmtCents(selectedEmp.estimatedTail.erBenefits)}</p>
                          </div>
                        </div>
                      )}
                      {!selectedEmp.tailSuppressed && (
                        <p className="text-[11px] text-muted-foreground">
                          {selectedEmp.tailBasis === "trailing" ? "Rate from this month's earned pay" : "Rate from annual comp ÷ 365"}. Included in Ending accrued above.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  Cost center {selectedEmp.costCenterCode}
                  {selectedEmp.usedCostCenterFallback && " (unmapped — entity assigned by fallback)"}
                  {selectedEmp.allocationChangedInMonth && " · allocation changed mid-month"}
                </div>

                <Separator />

                {/* Per-paycheck breakdown (same view as the entity-level drill-down) */}
                <PaycheckDetailBody
                  employeeId={selectedEmp.employeeId}
                  companyId={selectedEmp.companyId}
                  year={year}
                  month={month}
                  hideAccrual
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

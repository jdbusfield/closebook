"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Plus, Download, RefreshCw, Trash2 } from "lucide-react";
import { useBudgetVersion } from "../version-shell";
import { fmtUsd, fmtPct, MONTH_ABBRS } from "@/lib/budget/format";
import { COMPONENT_LABELS, COST_COMPONENTS, type CostComponent, type PricedPosition } from "@/lib/budget/personnel-engine";

interface HeadcountRow {
  id: string;
  employee_id: string | null;
  paylocity_company_id: string | null;
  name: string;
  title: string | null;
  department: string | null;
  is_requisition: boolean;
  status: string;
  pay_type: string;
  base_rate: number | null;
  annual_salary: number | null;
  std_hours_week: number;
  fte_pct: number;
  start_month: number;
  end_month: number | null;
  merit_pct: number;
  merit_month: number | null;
  bonus_target: number;
  commission_annual: number;
  ot_pct: number;
  dt_pct: number;
  meal_pct: number;
  other_earnings_monthly: number;
  benefits_monthly: number;
  match_pct: number;
  life_disability_monthly: number;
  wc_class_code: string | null;
  pto_hours_per_period: number;
  other_costs_monthly: number;
  entity_allocations: Array<{ entity_id: string; pct: number }>;
  class_allocations: Array<{ class: string; pct: number }>;
  seeded_from: { runRate?: { gross: number; monthsCovered: number; erHealth: number }; warnings?: string[] } | null;
  notes: string | null;
}

function seedSkipReasons(skipped: Array<{ reason: string }>): string {
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts.entries()].map(([reason, n]) => `${n} ${reason}`).join(", ");
}

interface SeedPreviewRow {
  employeeId: string;
  paylocityCompanyId: string;
  name: string;
  title: string | null;
  department: string | null;
  payType: string;
  baseRate: number | null;
  annualSalary: number | null;
  otPct: number;
  benefitsMonthly: number;
  matchPct: number;
  reShare: number;
  warnings: string[];
}

const NUMERIC_FIELDS: Array<{ key: keyof HeadcountRow; label: string; step?: string; width?: string }> = [
  { key: "base_rate", label: "Rate / h", step: "0.01" },
  { key: "annual_salary", label: "Salary", step: "1" },
  { key: "std_hours_week", label: "Hrs / wk", step: "0.5" },
  { key: "fte_pct", label: "FTE %", step: "1" },
  { key: "start_month", label: "Start", step: "1" },
  { key: "end_month", label: "End", step: "1" },
  { key: "merit_pct", label: "Merit %", step: "0.1" },
  { key: "merit_month", label: "Merit mo", step: "1" },
  { key: "bonus_target", label: "Bonus", step: "1" },
  { key: "commission_annual", label: "Commission", step: "1" },
  { key: "ot_pct", label: "OT %", step: "0.1" },
  { key: "dt_pct", label: "DT %", step: "0.1" },
  { key: "meal_pct", label: "Meal %", step: "0.1" },
  { key: "benefits_monthly", label: "Benefits / mo", step: "1" },
  { key: "match_pct", label: "Match %", step: "0.1" },
  { key: "life_disability_monthly", label: "Life+dis / mo", step: "1" },
  { key: "pto_hours_per_period", label: "PTO h / per", step: "0.01" },
  { key: "other_costs_monthly", label: "Other / mo", step: "1" },
];

function num(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}

export default function BudgetHeadcountPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const { info, reload: reloadVersion, readOnly } = useBudgetVersion();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<HeadcountRow[]>([]);
  const [priced, setPriced] = useState<PricedPosition[]>([]);
  const [totals, setTotals] = useState<{ components: Record<CostComponent, number[]>; totalByMonth: number[]; total: number } | null>(null);
  const [memberEntityIds, setMemberEntityIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [seedOpen, setSeedOpen] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedRows, setSeedRows] = useState<SeedPreviewRow[] | null>(null);
  const [seedSkipped, setSeedSkipped] = useState<Array<{ name: string; reason: string }>>([]);
  const [seedOverwrite, setSeedOverwrite] = useState(false);

  const [reqOpen, setReqOpen] = useState(false);
  const [reqSaving, setReqSaving] = useState(false);
  const [req, setReq] = useState({ name: "", title: "", department: "", pay_type: "Hourly", base_rate: "", annual_salary: "", start_month: "1", benefits_monthly: "", wc_class_code: "" });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/budget/headcount?versionId=${versionId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.rows ?? []);
      setPriced(data.priced ?? []);
      setTotals(data.totals ?? null);
      setMemberEntityIds(data.memberEntityIds ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load headcount");
    } finally {
      setLoading(false);
    }
  }, [versionId]);

  useEffect(() => {
    load();
  }, [load]);

  const pricedById = useMemo(() => new Map(priced.map((p) => [p.rowId, p])), [priced]);

  const patch = async (id: string, fields: Partial<HeadcountRow>) => {
    setSavingId(id);
    try {
      const res = await fetch("/api/budget/headcount", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (row: HeadcountRow) => {
    if (!window.confirm(`Remove ${row.name} from this version?`)) return;
    const res = await fetch(`/api/budget/headcount?id=${row.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Delete failed");
      return;
    }
    setSelected(null);
    await load();
    reloadVersion();
  };

  const seedPreview = async () => {
    setSeedLoading(true);
    setSeedRows(null);
    try {
      const res = await fetch("/api/budget/headcount/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, mode: "preview" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setSeedRows(data.rows ?? []);
      setSeedSkipped(data.skipped ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setSeedLoading(false);
    }
  };

  const seedCommit = async () => {
    setSeedLoading(true);
    try {
      const res = await fetch("/api/budget/headcount/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, mode: "commit", overwrite: seedOverwrite }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Seed failed");
      toast.success(`Seeded ${data.inserted} new rows${data.updated ? `, refreshed ${data.updated}` : ""}${data.unchanged ? `, kept ${data.unchanged}` : ""}`);
      setSeedOpen(false);
      setSeedRows(null);
      await load();
      reloadVersion();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setSeedLoading(false);
    }
  };

  const createRequisition = async () => {
    if (!req.name.trim()) {
      toast.error("Give the position a name.");
      return;
    }
    setReqSaving(true);
    try {
      const res = await fetch("/api/budget/headcount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId,
          name: req.name.trim(),
          title: req.title || null,
          department: req.department || null,
          is_requisition: true,
          status: "planned",
          pay_type: req.pay_type,
          base_rate: req.base_rate ? Number(req.base_rate) : null,
          annual_salary: req.annual_salary ? Number(req.annual_salary) : null,
          start_month: Number(req.start_month || 1),
          benefits_monthly: req.benefits_monthly ? Number(req.benefits_monthly) : 0,
          wc_class_code: req.wc_class_code || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      toast.success("Position added");
      setReqOpen(false);
      setReq({ name: "", title: "", department: "", pay_type: "Hourly", base_rate: "", annual_salary: "", start_month: "1", benefits_monthly: "", wc_class_code: "" });
      await load();
      reloadVersion();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setReqSaving(false);
    }
  };

  // Bridge: trailing run rate -> budget
  const bridge = useMemo(() => {
    let runRateGross = 0;
    let runRateBenefits = 0;
    let budgetGross = 0;
    let budgetBenefits = 0;
    let merit = 0;
    let newPositions = 0;
    let terminations = 0;
    let taxes = 0;
    let softOther = 0;
    for (const r of rows) {
      const p = pricedById.get(r.id);
      if (!p) continue;
      const gross = ["wages", "overtime", "doubletime", "meal", "bonus", "commission", "other_earnings"].reduce(
        (t, c) => t + (p.componentTotals[c as CostComponent] ?? 0),
        0,
      );
      const benefits = (p.componentTotals.benefits ?? 0) + (p.componentTotals.match ?? 0) + (p.componentTotals.life_disability ?? 0);
      taxes += ["fica_ss", "medicare", "futa", "sui", "ett"].reduce((t, c) => t + (p.componentTotals[c as CostComponent] ?? 0), 0);
      softOther += (p.componentTotals.workers_comp ?? 0) + (p.componentTotals.pto ?? 0) + (p.componentTotals.payroll_fees ?? 0) + (p.componentTotals.recruiting ?? 0) + (p.componentTotals.other_costs ?? 0);
      budgetGross += gross;
      budgetBenefits += benefits;
      if (r.is_requisition) {
        newPositions += gross;
        continue;
      }
      const rr = r.seeded_from?.runRate;
      if (rr && rr.monthsCovered > 0) {
        runRateGross += (rr.gross / rr.monthsCovered) * 12 * p.reShare;
        runRateBenefits += (rr.erHealth / rr.monthsCovered) * 12 * p.reShare;
      }
      if (r.merit_pct && r.merit_month) {
        for (let m = r.merit_month; m <= 12; m++) {
          const w = p.components.wages[m - 1] ?? 0;
          merit += w - w / (1 + r.merit_pct / 100);
        }
      }
      if (r.end_month && r.end_month < 12 && rr && rr.monthsCovered > 0) {
        terminations -= (rr.gross / rr.monthsCovered) * (12 - r.end_month) * p.reShare;
      }
    }
    const other = budgetGross - runRateGross - merit - newPositions - terminations;
    return { runRateGross, merit, newPositions, terminations, other, budgetGross, runRateBenefits, budgetBenefits, taxes, softOther };
  }, [rows, pricedById]);

  const selectedRow = selected ? rows.find((r) => r.id === selected) ?? null : null;
  const selectedPriced = selected ? pricedById.get(selected) ?? null : null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading headcount
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          One row per position. Seeding pulls the live Paylocity roster and twelve months of paychecks; every field can be edited afterwards. Click a name for the monthly breakdown.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setSeedOpen(true); seedPreview(); }} disabled={readOnly}>
            <Download className="mr-2 h-4 w-4" />
            Seed from Paylocity
          </Button>
          <Button onClick={() => setReqOpen(true)} disabled={readOnly}>
            <Plus className="mr-2 h-4 w-4" />
            Add position
          </Button>
        </div>
      </div>

      {totals && rows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Positions</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{rows.filter((r) => r.status !== "excluded").length}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {rows.filter((r) => r.is_requisition).length} planned, {rows.filter((r) => r.status === "excluded").length} excluded
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Personnel cost, full year</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{fmtUsd(totals.total)}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Wages and premiums {fmtUsd(bridge.budgetGross)} · taxes {fmtUsd(bridge.taxes)} · benefits {fmtUsd(bridge.budgetBenefits)} · other {fmtUsd(bridge.softOther)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Bridge from trailing run rate</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{fmtUsd(bridge.budgetGross - bridge.runRateGross)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5 text-sm text-muted-foreground">
              <div className="flex justify-between"><span>Trailing twelve months, gross</span><span className="tabular-nums">{fmtUsd(bridge.runRateGross)}</span></div>
              <div className="flex justify-between"><span>Merit increases</span><span className="tabular-nums">{fmtUsd(bridge.merit)}</span></div>
              <div className="flex justify-between"><span>New positions</span><span className="tabular-nums">{fmtUsd(bridge.newPositions)}</span></div>
              <div className="flex justify-between"><span>Terminations</span><span className="tabular-nums">{fmtUsd(bridge.terminations)}</span></div>
              <div className="flex justify-between"><span>Rate, hours and mix</span><span className="tabular-nums">{fmtUsd(bridge.other)}</span></div>
              <div className="flex justify-between font-medium text-foreground"><span>Budget gross</span><span className="tabular-nums">{fmtUsd(bridge.budgetGross)}</span></div>
              <div className="flex justify-between pt-1"><span>Benefits: trailing {fmtUsd(bridge.runRateBenefits)} to budget</span><span className="tabular-nums">{fmtUsd(bridge.budgetBenefits)}</span></div>
            </CardContent>
          </Card>
        </div>
      )}

      {totals && rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>By month</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  {MONTH_ABBRS.map((m) => <TableHead key={m} className="text-right">{m}</TableHead>)}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {COST_COMPONENTS.filter((c) => totals.components[c].some((v) => v !== 0)).map((c) => (
                  <TableRow key={c}>
                    <TableCell className="whitespace-nowrap">{COMPONENT_LABELS[c]}</TableCell>
                    {totals.components[c].map((v, i) => <TableCell key={i} className="text-right tabular-nums">{fmtUsd(v)}</TableCell>)}
                    <TableCell className="text-right font-medium tabular-nums">{fmtUsd(totals.components[c].reduce((t, v) => t + v, 0))}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell>Total</TableCell>
                  {totals.totalByMonth.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{fmtUsd(v)}</TableCell>)}
                  <TableCell className="text-right tabular-nums">{fmtUsd(totals.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Positions</CardTitle>
          <CardDescription>Edits save when you leave a cell. Share shows the part of the person allocated to this reporting group.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No positions yet. Seed from Paylocity or add a position.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Dept</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pay</TableHead>
                  {NUMERIC_FIELDS.map((f) => <TableHead key={f.key} className="whitespace-nowrap text-right">{f.label}</TableHead>)}
                  <TableHead className="text-right">Share</TableHead>
                  <TableHead className="text-right">Year total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const p = pricedById.get(r.id);
                  return (
                    <TableRow key={r.id} className={r.status === "excluded" ? "opacity-50" : undefined}>
                      <TableCell className="whitespace-nowrap">
                        <button type="button" className="text-left font-medium hover:underline" onClick={() => setSelected(r.id)}>
                          {r.name}
                        </button>
                        <div className="text-xs text-muted-foreground">{r.title ?? (r.is_requisition ? "Planned position" : "")}</div>
                        {r.seeded_from?.warnings?.length ? (
                          <div className="text-xs text-amber-600">{r.seeded_from.warnings[0]}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{r.department ?? ""}</TableCell>
                      <TableCell>
                        <Select value={r.status} onValueChange={(v) => patch(r.id, { status: v })} disabled={readOnly}>
                          <SelectTrigger className="h-8 w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="planned">Planned</SelectItem>
                            <SelectItem value="terminated">Terminated</SelectItem>
                            <SelectItem value="excluded">Excluded</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={r.pay_type} onValueChange={(v) => patch(r.id, { pay_type: v })} disabled={readOnly}>
                          <SelectTrigger className="h-8 w-[100px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Hourly">Hourly</SelectItem>
                            <SelectItem value="Salary">Salary</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      {NUMERIC_FIELDS.map((f) => (
                        <TableCell key={f.key} className="p-1">
                          <NumberCell
                            id={`hc-${r.id}-${f.key}`}
                            value={r[f.key] as number | null}
                            step={f.step}
                            disabled={readOnly || savingId === r.id}
                            onCommit={(v) => patch(r.id, { [f.key]: v } as Partial<HeadcountRow>)}
                          />
                        </TableCell>
                      ))}
                      <TableCell className="text-right tabular-nums">{p ? fmtPct(p.reShare * 100, 0) : ""}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{p ? fmtUsd(p.total) : ""}</TableCell>
                      <TableCell>
                        {!readOnly && (
                          <Button variant="ghost" size="icon-xs" onClick={() => remove(r)} aria-label={`Remove ${r.name}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Side sheet: monthly components for one position */}
      <Sheet open={!!selectedRow} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="overflow-y-auto sm:max-w-[760px]">
          {selectedRow && selectedPriced && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedRow.name}</SheetTitle>
                <SheetDescription>
                  {selectedRow.title ?? ""} {selectedRow.department ? `· ${selectedRow.department}` : ""} · {selectedRow.pay_type}
                  {selectedRow.pay_type === "Hourly" && selectedRow.base_rate ? ` ${fmtUsd(selectedRow.base_rate, 2)}/h` : ""}
                  {selectedRow.pay_type === "Salary" && selectedRow.annual_salary ? ` ${fmtUsd(selectedRow.annual_salary)}/yr` : ""}
                  {" · "}share {fmtPct(selectedPriced.reShare * 100, 0)}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4 px-1">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Year total (this group)</div>
                    <div className="text-lg font-semibold tabular-nums">{fmtUsd(selectedPriced.total)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Allocation</div>
                    <div className="text-sm">
                      {selectedRow.entity_allocations.length === 0
                        ? "100% this group"
                        : selectedRow.entity_allocations.map((a) => `${a.pct}% ${memberEntityIds.includes(a.entity_id) ? "in group" : "other group"}`).join(", ")}
                      {selectedRow.class_allocations.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Classes: {selectedRow.class_allocations.map((c) => `${c.class} ${c.pct}%`).join(", ")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Component</TableHead>
                        {MONTH_ABBRS.map((m) => <TableHead key={m} className="text-right">{m}</TableHead>)}
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {COST_COMPONENTS.filter((c) => selectedPriced.components[c].some((v) => v !== 0)).map((c) => (
                        <TableRow key={c}>
                          <TableCell className="whitespace-nowrap text-xs">{COMPONENT_LABELS[c]}</TableCell>
                          {selectedPriced.components[c].map((v, i) => <TableCell key={i} className="text-right text-xs tabular-nums">{fmtUsd(v)}</TableCell>)}
                          <TableCell className="text-right text-xs font-medium tabular-nums">{fmtUsd(selectedPriced.componentTotals[c])}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-medium">
                        <TableCell className="text-xs">Total</TableCell>
                        {selectedPriced.totalByMonth.map((v, i) => <TableCell key={i} className="text-right text-xs tabular-nums">{fmtUsd(v)}</TableCell>)}
                        <TableCell className="text-right text-xs tabular-nums">{fmtUsd(selectedPriced.total)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="hc-notes">Notes</Label>
                  <Input
                    id="hc-notes"
                    defaultValue={selectedRow.notes ?? ""}
                    disabled={readOnly}
                    onBlur={(e) => { if (e.target.value !== (selectedRow.notes ?? "")) patch(selectedRow.id, { notes: e.target.value }); }}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="hc-wc">Workers comp class code</Label>
                  <Input
                    id="hc-wc"
                    defaultValue={selectedRow.wc_class_code ?? ""}
                    disabled={readOnly}
                    onBlur={(e) => { if (e.target.value !== (selectedRow.wc_class_code ?? "")) patch(selectedRow.id, { wc_class_code: e.target.value || null }); }}
                  />
                </div>
                {selectedRow.seeded_from?.runRate && (
                  <div className="rounded-md border p-3 text-xs text-muted-foreground">
                    Seeded from {selectedRow.seeded_from.runRate.monthsCovered} months of paychecks: gross {fmtUsd(selectedRow.seeded_from.runRate.gross)}, employer health {fmtUsd(selectedRow.seeded_from.runRate.erHealth)}.
                    {selectedRow.seeded_from.warnings?.length ? ` ${selectedRow.seeded_from.warnings.join(". ")}.` : ""}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Seed dialog */}
      <Dialog open={seedOpen} onOpenChange={(o) => { setSeedOpen(o); if (!o) setSeedRows(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Seed headcount from Paylocity</DialogTitle>
            <DialogDescription>
              Active employees allocated to {info?.owner.ownerName ?? "this group"}, priced from their current pay rate and the trailing twelve months of paychecks.
            </DialogDescription>
          </DialogHeader>
          {seedLoading && !seedRows ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Pulling the roster and paychecks
            </div>
          ) : seedRows ? (
            <div className="min-w-0 space-y-3">
              <div className="max-h-[50vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Dept</TableHead>
                      <TableHead>Pay</TableHead>
                      <TableHead className="text-right">OT %</TableHead>
                      <TableHead className="text-right">Benefits / mo</TableHead>
                      <TableHead className="text-right">Match %</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {seedRows.map((r) => (
                      <TableRow key={`${r.paylocityCompanyId}:${r.employeeId}`}>
                        <TableCell className="whitespace-nowrap">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">{r.title ?? ""}</div>
                        </TableCell>
                        <TableCell className="text-sm">{r.department ?? ""}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {r.payType === "Salary" ? fmtUsd(r.annualSalary ?? 0) + "/yr" : fmtUsd(r.baseRate ?? 0, 2) + "/h"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(r.otPct)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtUsd(r.benefitsMonthly)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(r.matchPct)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(r.reShare * 100, 0)}</TableCell>
                        <TableCell className="max-w-[320px] whitespace-normal text-xs text-amber-600">{r.warnings.join("; ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>
                  {seedRows.length} active employees to seed · {seedSkipped.length} skipped{seedSkipped.length ? ` (${seedSkipReasons(seedSkipped)})` : ""}
                </span>
                <label className="flex items-center gap-2">
                  <Checkbox id="seed-overwrite" checked={seedOverwrite} onCheckedChange={(v) => setSeedOverwrite(v === true)} />
                  <span>Refresh rows that already exist (discards edits)</span>
                </label>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeedOpen(false)}>
              Cancel
            </Button>
            <Button onClick={seedCommit} disabled={seedLoading || !seedRows || seedRows.length === 0}>
              {seedLoading && seedRows ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Seed {seedRows?.length ?? 0} rows
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Requisition dialog */}
      <Dialog open={reqOpen} onOpenChange={setReqOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a position</DialogTitle>
            <DialogDescription>A planned hire. Benefits start after the waiting period in Assumptions; recruiting cost lands in the start month.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="req-name">Name or role</Label>
              <Input id="req-name" value={req.name} onChange={(e) => setReq((r) => ({ ...r, name: e.target.value }))} placeholder="Rental agent, Burbank" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="req-title">Title</Label>
                <Input id="req-title" value={req.title} onChange={(e) => setReq((r) => ({ ...r, title: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="req-dept">Department</Label>
                <Input id="req-dept" value={req.department} onChange={(e) => setReq((r) => ({ ...r, department: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="req-paytype">Pay type</Label>
                <Select value={req.pay_type} onValueChange={(v) => setReq((r) => ({ ...r, pay_type: v }))}>
                  <SelectTrigger id="req-paytype">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Hourly">Hourly</SelectItem>
                    <SelectItem value="Salary">Salary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {req.pay_type === "Hourly" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="req-rate">Rate per hour</Label>
                  <Input id="req-rate" type="number" step="0.01" value={req.base_rate} onChange={(e) => setReq((r) => ({ ...r, base_rate: e.target.value }))} />
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="req-salary">Annual salary</Label>
                  <Input id="req-salary" type="number" step="1" value={req.annual_salary} onChange={(e) => setReq((r) => ({ ...r, annual_salary: e.target.value }))} />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="req-start">Start month</Label>
                <Input id="req-start" type="number" min={1} max={12} value={req.start_month} onChange={(e) => setReq((r) => ({ ...r, start_month: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="req-benefits">Benefits per month (blank = default)</Label>
                <Input id="req-benefits" type="number" step="1" value={req.benefits_monthly} onChange={(e) => setReq((r) => ({ ...r, benefits_monthly: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="req-wc">Workers comp class</Label>
                <Input id="req-wc" value={req.wc_class_code} onChange={(e) => setReq((r) => ({ ...r, wc_class_code: e.target.value }))} placeholder="8810" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReqOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createRequisition} disabled={reqSaving}>
              {reqSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add position
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NumberCell({
  id,
  value,
  step,
  disabled,
  onCommit,
}: {
  id: string;
  value: number | null;
  step?: string;
  disabled?: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = useState(num(value));
  useEffect(() => {
    setText(num(value));
  }, [value]);
  return (
    <Input
      id={id}
      type="number"
      step={step ?? "any"}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = text.trim() === "" ? null : Number(text);
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(num(value));
      }}
      className="h-7 w-[92px] px-1.5 text-right text-xs tabular-nums"
    />
  );
}

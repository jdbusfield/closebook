"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Plus, Download, RefreshCw, Search, Trash2, X } from "lucide-react";
import { fmtUsd, fmtPct, MONTH_ABBRS } from "@/lib/budget/format";
import { COMPONENT_LABELS, COST_COMPONENTS, pricePosition, type CostComponent, type HeadcountRowInput, type PricedPosition } from "@/lib/budget/personnel-engine";
import { AssumptionSet, type AssumptionRow } from "@/lib/budget/assumption-keys";
import { readBaselineFields } from "@/lib/budget/baseline";
import { PlanHistory } from "./plan-history";
import { CLASSES, FUNCTIONS, GEOGRAPHY_BY_LOCATION, LOCATIONS, SPLIT_OPTIONS, primaryKey, readSplits, splitLabel, type TagSplit } from "@/lib/budget/tagging";
import { effectiveAllocations, readEntityAllocations, type EntityAllocation } from "@/lib/budget/allocation";

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
  comp_adj_kind: "percent" | "amount" | "rate" | null;
  comp_adj_value: number | null;
  comp_adj_month: number | null;
  comp_adj_reason: string | null;
  amount_monthly: number | null;
  amount_is_loaded: boolean;
  open_role: boolean;
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
  location_allocations: unknown;
  function_allocations: unknown;
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

/** How a cell reads when it is not being edited. */
type CellFormat = "usd" | "usd2" | "pct" | "count" | "hours";

const NUMERIC_FIELDS: Array<{ key: keyof HeadcountRow; label: string; step?: string; format: CellFormat }> = [
  { key: "base_rate", label: "Rate / h", step: "0.01", format: "usd2" },
  { key: "annual_salary", label: "Salary", step: "1", format: "usd" },
  { key: "amount_monthly", label: "Amount / mo", step: "1", format: "usd" },
  { key: "std_hours_week", label: "Hrs / wk", step: "0.5", format: "hours" },
  { key: "fte_pct", label: "FTE %", step: "1", format: "pct" },
  { key: "start_month", label: "Start", step: "1", format: "count" },
  { key: "end_month", label: "End", step: "1", format: "count" },
  { key: "bonus_target", label: "Bonus", step: "1", format: "usd" },
  { key: "commission_annual", label: "Commission", step: "1", format: "usd" },
  { key: "ot_pct", label: "OT %", step: "0.1", format: "pct" },
  { key: "dt_pct", label: "DT %", step: "0.1", format: "pct" },
  { key: "meal_pct", label: "Meal %", step: "0.1", format: "pct" },
  { key: "benefits_monthly", label: "Benefits / mo", step: "1", format: "usd" },
  { key: "match_pct", label: "Match %", step: "0.1", format: "pct" },
  { key: "life_disability_monthly", label: "Life+dis / mo", step: "1", format: "usd" },
  { key: "pto_hours_per_period", label: "PTO h / per", step: "0.01", format: "hours" },
  { key: "other_costs_monthly", label: "Other / mo", step: "1", format: "usd" },
];

/** Dollars with commas, percentages to a tenth, hours to two places. */
function formatCell(v: number | null | undefined, format: CellFormat): string {
  if (v == null || Number.isNaN(Number(v))) return "";
  const n = Number(v);
  switch (format) {
    case "usd": return fmtUsd(n);
    case "usd2": return fmtUsd(n, 2);
    case "pct": return fmtPct(n, 1);
    case "hours": return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
    default: return String(n);
  }
}

function num(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}

/** Signed dollars: +$1,234 or -$1,234. */
function fmtChange(v: number, digits = 0): string {
  const abs = fmtUsd(Math.abs(v), digits);
  return v < 0 ? `-${abs}` : `+${abs}`;
}

type ViewMode = "name" | "salary" | "company" | "department" | "geography" | "location" | "function" | "class";
const VIEW_MODES: Array<{ key: ViewMode; label: string }> = [
  { key: "name", label: "Name" },
  { key: "salary", label: "Salary" },
  { key: "company", label: "Company" },
  { key: "department", label: "Department" },
  { key: "geography", label: "Geography" },
  { key: "location", label: "Location" },
  { key: "function", label: "Function" },
  { key: "class", label: "Class" },
];

const rowLocation = (r: HeadcountRow) => readSplits(r.location_allocations);
const rowClass = (r: HeadcountRow) => readSplits(r.class_allocations, "class");
const rowFunction = (r: HeadcountRow) => readSplits(r.function_allocations);

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Current pay in the row's unit, and how to print it. */
function payUnit(row: Pick<HeadcountRow, "pay_type" | "base_rate" | "annual_salary">): { current: number; hourly: boolean; print: (v: number) => string } {
  const hourly = row.pay_type === "Hourly" || (row.pay_type === "Salary" && !(row.annual_salary && row.annual_salary > 0));
  return {
    current: hourly ? row.base_rate ?? 0 : row.annual_salary ?? 0,
    hourly,
    print: (v) => (hourly ? `${fmtUsd(v, 2)}/h` : `${fmtUsd(v)}/yr`),
  };
}

/** New pay after an adjustment, in the row's unit. */
function adjustedPay(row: Pick<HeadcountRow, "pay_type" | "base_rate" | "annual_salary">, kind: string, value: number): number {
  const { current } = payUnit(row);
  if (kind === "percent") return current * (1 + value / 100);
  if (kind === "amount") return current + value;
  return value;
}

/** One-line label for a saved adjustment, e.g. "+4.0% from Apr" or "$75,000/yr from Jan". */
function adjLabel(row: HeadcountRow): string | null {
  if (!row.comp_adj_kind || row.comp_adj_value == null || row.comp_adj_value === 0) return null;
  const { print } = payUnit(row);
  const v = row.comp_adj_value;
  const month = MONTH_ABBRS[Math.min(12, Math.max(1, row.comp_adj_month ?? 1)) - 1];
  let head: string;
  if (row.comp_adj_kind === "percent") head = `${v > 0 ? "+" : ""}${fmtPct(v)}`;
  else if (row.comp_adj_kind === "amount") head = `${v > 0 ? "+" : "-"}${print(Math.abs(v))}`;
  else head = print(v);
  return `${head} from ${month}`;
}

export type HeadcountScope =
  | { kind: "plan"; planId: string; fiscalYear: number }
  | { kind: "version"; versionId: string; fiscalYear: number };

export interface PlanEntity {
  id: string;
  name: string;
  code: string;
  reportingEntityId: string | null;
  reportingEntityName: string | null;
}

/**
 * The shared payroll plan (every person once, allocated to entities) or a
 * version's read-only view of its share of that plan.
 */
export function HeadcountWorkspace({
  scope,
  readOnly,
  ownerName,
  onChanged,
}: {
  scope: HeadcountScope;
  readOnly: boolean;
  ownerName: string;
  onChanged?: () => void;
}) {
  const isPlan = scope.kind === "plan";
  const reloadVersion = () => onChanged?.();
  const fetchUrl = isPlan ? `/api/budget/headcount?planId=${scope.planId}` : `/api/budget/headcount?versionId=${scope.versionId}`;
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<HeadcountRow[]>([]);
  const [priced, setPriced] = useState<PricedPosition[]>([]);
  const [totals, setTotals] = useState<{ components: Record<CostComponent, number[]>; totalByMonth: number[]; total: number } | null>(null);
  const [memberEntityIds, setMemberEntityIds] = useState<string[]>([]);
  const [baselines, setBaselines] = useState<Record<string, { total: number; gross: number }>>({});
  const [meritDefault, setMeritDefault] = useState<{ pct: number; month: number }>({ pct: 0, month: 1 });
  const [showAdjustedOnly, setShowAdjustedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("name");
  const [entities, setEntities] = useState<PlanEntity[]>([]);
  const [reportingEntities, setReportingEntities] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [groupTotals, setGroupTotals] = useState<Record<string, number>>({});
  const [groupByMonth, setGroupByMonth] = useState<Record<string, number[]>>({});
  const [unallocatedByMonth, setUnallocatedByMonth] = useState<number[]>([]);
  const [unallocatedTotal, setUnallocatedTotal] = useState(0);
  const [revenueShares, setRevenueShares] = useState<EntityAllocation[]>([]);
  const [revenueSharesAsOf, setRevenueSharesAsOf] = useState<string | null>(null);
  const [sharesRefreshing, setSharesRefreshing] = useState(false);
  const [actuals, setActuals] = useState<{ year: number; byMonth: number[]; total: number; monthsWithData: number; hasData: boolean[] } | null>(null);
  const [assumptionRows, setAssumptionRows] = useState<AssumptionRow[]>([]);
  const [adjustRowId, setAdjustRowId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [seedOpen, setSeedOpen] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedRows, setSeedRows] = useState<SeedPreviewRow[] | null>(null);
  const [seedSkipped, setSeedSkipped] = useState<Array<{ name: string; reason: string }>>([]);
  const [seedOverwrite, setSeedOverwrite] = useState(false);

  const [reqOpen, setReqOpen] = useState(false);
  const [reqSaving, setReqSaving] = useState(false);
  const emptyReq = {
    mode: "open" as "named" | "open",
    name: "",
    title: "",
    department: "",
    count: "1",
    pay_type: "Hourly" as "Hourly" | "Salary" | "Amount",
    base_rate: "",
    annual_salary: "",
    amount_monthly: "",
    amount_is_loaded: true,
    start_month: "1",
    end_month: "",
    benefits_monthly: "",
    wc_class_code: "",
  };
  const [req, setReq] = useState(emptyReq);

  const load = useCallback(async () => {
    try {
      const res = await fetch(fetchUrl);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.rows ?? []);
      setPriced(data.priced ?? []);
      setTotals(data.totals ?? null);
      setMemberEntityIds(data.memberEntityIds ?? []);
      setBaselines(data.baselines ?? {});
      setMeritDefault(data.meritDefault ?? { pct: 0, month: 1 });
      setEntities(data.entities ?? []);
      setReportingEntities(data.reportingEntities ?? []);
      setGroupTotals(data.groupTotals ?? {});
      setGroupByMonth(data.groupByMonth ?? {});
      setUnallocatedByMonth(data.unallocatedByMonth ?? []);
      setUnallocatedTotal(data.unallocatedTotal ?? 0);
      setRevenueShares(data.plan?.revenueShares ?? []);
      setRevenueSharesAsOf(data.plan?.revenueSharesAsOf ?? null);
      setActuals(data.actuals ?? null);
      setAssumptionRows(data.assumptionRows ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load headcount");
    } finally {
      setLoading(false);
    }
  }, [fetchUrl]);

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
        body: JSON.stringify({ planId: isPlan ? scope.planId : undefined, mode: "preview" }),
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
        body: JSON.stringify({ planId: isPlan ? scope.planId : undefined, mode: "commit", overwrite: seedOverwrite }),
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

  // What the new position(s) cost this year, before the server prices them
  const reqPreview = useMemo(() => {
    const count = Math.min(50, Math.max(1, Math.floor(Number(req.count) || 1)));
    const start = Math.min(12, Math.max(1, Number(req.start_month) || 1));
    const end = req.end_month ? Math.min(12, Math.max(start, Number(req.end_month) || 12)) : 12;
    const months = end - start + 1;
    let perMonth = 0;
    if (req.pay_type === "Amount") perMonth = Number(req.amount_monthly) || 0;
    else if (req.pay_type === "Salary") perMonth = (Number(req.annual_salary) || 0) / 12;
    else perMonth = ((Number(req.base_rate) || 0) * 40 * 52) / 12;
    const loaded = req.pay_type === "Amount" && req.amount_is_loaded;
    return { count, start, end, months, total: perMonth * months * count, loaded };
  }, [req]);

  const createRequisition = async () => {
    const open = req.mode === "open";
    if (open && !req.title.trim()) {
      toast.error("Give the open role a title.");
      return;
    }
    if (!open && !req.name.trim()) {
      toast.error("Give the position a name.");
      return;
    }
    setReqSaving(true);
    try {
      const res = await fetch("/api/budget/headcount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: isPlan ? scope.planId : undefined,
          open_role: open,
          count: open ? reqPreview.count : 1,
          name: open ? undefined : req.name.trim(),
          title: req.title.trim() || null,
          department: req.department || null,
          is_requisition: true,
          status: "planned",
          pay_type: req.pay_type,
          base_rate: req.pay_type === "Hourly" && req.base_rate ? Number(req.base_rate) : null,
          annual_salary: req.pay_type === "Salary" && req.annual_salary ? Number(req.annual_salary) : null,
          amount_monthly: req.pay_type === "Amount" && req.amount_monthly ? Number(req.amount_monthly) : null,
          amount_is_loaded: req.pay_type === "Amount" ? req.amount_is_loaded : true,
          start_month: reqPreview.start,
          end_month: req.end_month ? reqPreview.end : null,
          benefits_monthly: req.benefits_monthly ? Number(req.benefits_monthly) : 0,
          wc_class_code: req.wc_class_code || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      toast.success(data.inserted > 1 ? `${data.inserted} positions added` : "Position added");
      setReqOpen(false);
      setReq(emptyReq);
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
    let adjRaises = 0;
    let adjCuts = 0;
    let newPositions = 0;
    let terminations = 0;
    let taxes = 0;
    let softOther = 0;
    for (const r of rows) {
      const p = pricedById.get(r.id);
      if (!p) continue;
      const baseline = baselines[r.id];
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
      if (baseline) {
        // The row's own adjustment, on gross
        const delta = gross - baseline.gross;
        if (delta >= 0) adjRaises += delta;
        else adjCuts += delta;
      } else if (meritDefault.pct && r.pay_type !== "Amount") {
        // Default merit from Assumptions on rows with no adjustment of their own
        for (let m = Math.max(1, meritDefault.month); m <= 12; m++) {
          const w = p.components.wages[m - 1] ?? 0;
          merit += w - w / (1 + meritDefault.pct / 100);
        }
      }
      if (r.end_month && r.end_month < 12 && rr && rr.monthsCovered > 0) {
        terminations -= (rr.gross / rr.monthsCovered) * (12 - r.end_month) * p.reShare;
      }
    }
    const other = budgetGross - runRateGross - merit - adjRaises - adjCuts - newPositions - terminations;
    return { runRateGross, merit, adjRaises, adjCuts, newPositions, terminations, other, budgetGross, runRateBenefits, budgetBenefits, taxes, softOther };
  }, [rows, pricedById, baselines, meritDefault]);

  // Comp adjustment summary on loaded cost (what the Change column adds up to)
  const adjSummary = useMemo(() => {
    let count = 0;
    let raises = 0;
    let cuts = 0;
    for (const r of rows) {
      const b = baselines[r.id];
      const p = pricedById.get(r.id);
      if (!b || !p) continue;
      count++;
      const delta = p.total - b.total;
      if (delta >= 0) raises += delta;
      else cuts += delta;
    }
    return { count, raises, cuts, net: raises + cuts, netGross: bridge.adjRaises + bridge.adjCuts };
  }, [rows, baselines, pricedById, bridge]);

  // Search matches name, title, department and employee id; every word typed must match
  const visibleRows = useMemo(() => {
    const base = showAdjustedOnly ? rows.filter((r) => !!baselines[r.id]) : rows;
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return base;
    return base.filter((r) => {
      const hay = `${r.name} ${r.title ?? ""} ${r.department ?? ""} ${r.employee_id ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [rows, baselines, showAdjustedOnly, search]);

  // Class names already on rows that are not on the cheat sheet stay selectable
  const classOptions = useMemo(() => {
    const extra = new Set<string>();
    for (const r of rows) for (const s of rowClass(r)) if (!CLASSES.includes(s.key)) extra.add(s.key);
    return [...CLASSES, ...extra];
  }, [rows]);

  const untagged = useMemo(
    () => rows.filter((r) => r.status !== "excluded" && (rowLocation(r).length === 0 || rowClass(r).length === 0 || rowFunction(r).length === 0)).length,
    [rows],
  );

  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const entityCodes = useMemo(() => new Map(entities.map((e) => [e.id, e.code])), [entities]);

  /** "AVON" or "AVON 75 / HDR 25"; by group: "Avon" or "Avon 75 / HDR 25". Revenue rows resolve to the shares. */
  const companyLabel = useCallback(
    (r: HeadcountRow, byGroupArg = false): string => {
      const allocs = effectiveAllocations(r, revenueShares);
      if (allocs.length === 0) return "";
      // Revenue shares are between reporting groups, so always read as groups
      const byGroup = byGroupArg || (r as unknown as { allocation_mode?: string }).allocation_mode === "revenue";
      const parts = new Map<string, number>();
      for (const a of allocs) {
        const e = entityById.get(a.entity_id);
        const key = byGroup ? (e?.reportingEntityName ?? e?.name ?? "Other") : (e?.code ?? e?.name ?? "?");
        parts.set(key, (parts.get(key) ?? 0) + a.pct);
      }
      const total = [...parts.values()].reduce((t, v) => t + v, 0) || 100;
      const list = [...parts.entries()].sort((a, b) => b[1] - a[1]);
      if (list.length === 1) return list[0][0];
      return list.map(([k, v]) => `${k} ${Math.round((v / total) * 100)}`).join(" / ");
    },
    [revenueShares, entityById],
  );

  const unallocated = useMemo(() => rows.filter((r) => r.status !== "excluded" && effectiveAllocations(r, revenueShares).length === 0).length, [rows, revenueShares]);

  const refreshShares = async () => {
    if (!isPlan) return;
    setSharesRefreshing(true);
    try {
      const res = await fetch("/api/budget/payroll-plan/revenue-shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: scope.planId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Refresh failed");
      toast.success("Revenue shares refreshed");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setSharesRefreshing(false);
    }
  };

  // The view: a flat list by name or salary, or groups with a subtotal
  const groups = useMemo(() => {
    const total = (r: HeadcountRow) => pricedById.get(r.id)?.total ?? 0;
    const sum = (rs: HeadcountRow[]) => rs.reduce((t, r) => t + total(r), 0);
    if (viewMode === "name") return [{ key: "all", label: null as string | null, rows: visibleRows, total: sum(visibleRows) }];
    if (viewMode === "salary") {
      const sorted = [...visibleRows].sort((a, b) => total(b) - total(a));
      return [{ key: "all", label: null as string | null, rows: sorted, total: sum(sorted) }];
    }
    const keyOf = (r: HeadcountRow): string => {
      if (viewMode === "company") return companyLabel(r, true) || "Not allocated";
      if (viewMode === "department") return r.department?.trim() || "No department";
      if (viewMode === "location") return primaryKey(rowLocation(r)) || "Not set";
      if (viewMode === "geography") {
        const l = primaryKey(rowLocation(r));
        return l ? GEOGRAPHY_BY_LOCATION[l] ?? l : "Not set";
      }
      if (viewMode === "function") return primaryKey(rowFunction(r)) || "Not set";
      return primaryKey(rowClass(r)) || "Not set";
    };
    const map = new Map<string, HeadcountRow[]>();
    for (const r of visibleRows) {
      const k = keyOf(r);
      const list = map.get(k) ?? [];
      list.push(r);
      map.set(k, list);
    }
    return [...map.entries()]
      .map(([k, rs]) => ({ key: k, label: k as string | null, rows: [...rs].sort((a, b) => total(b) - total(a)), total: sum(rs) }))
      .sort((a, b) => (a.key === "Not set" || a.key === "Not allocated" ? 1 : b.key === "Not set" || b.key === "Not allocated" ? -1 : b.total - a.total));
  }, [visibleRows, viewMode, pricedById, companyLabel]);

  const saveTags = (id: string, field: "location_allocations" | "function_allocations" | "class_allocations", splits: TagSplit[]) => {
    const stored = field === "class_allocations" ? splits.map((s) => ({ class: s.key, pct: s.pct })) : splits;
    return patch(id, { [field]: stored } as unknown as Partial<HeadcountRow>);
  };

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
      {isPlan ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={refreshShares} disabled={readOnly || sharesRefreshing} title={revenueSharesAsOf ?? "Not computed yet"}>
              {sharesRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {revenueShares.length ? "Refresh revenue shares" : "Compute revenue shares"}
            </Button>
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
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-4 py-3 text-sm">
          <span>
            Personnel comes from the shared payroll plan for {scope.fiscalYear}. This is {ownerName}&apos;s share of it, priced with this version&apos;s assumptions.
            {rows.length === 0 && " Nothing is allocated to this group yet."}
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href={`/budget/payroll/${scope.fiscalYear}`}>Open the payroll plan</Link>
          </Button>
        </div>
      )}

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
              <div className="flex justify-between"><span>Comp adjustments, raises</span><span className="tabular-nums text-emerald-700">{fmtChange(bridge.adjRaises)}</span></div>
              <div className="flex justify-between"><span>Comp adjustments, reductions</span><span className="tabular-nums text-red-700">{fmtChange(bridge.adjCuts)}</span></div>
              <div className="flex justify-between"><span>Default merit ({fmtPct(meritDefault.pct)})</span><span className="tabular-nums">{fmtUsd(bridge.merit)}</span></div>
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
                {actuals && actuals.monthsWithData > 0 && (() => {
                  // Compare like for like: the projection over the months the ledger has booked
                  const booked = actuals.hasData;
                  const lastBooked = booked.lastIndexOf(true);
                  const actualToDate = actuals.byMonth.reduce((t, v, i) => (booked[i] ? t + v : t), 0);
                  const projectedSameMonths = totals.totalByMonth.reduce((t, v, i) => (booked[i] ? t + v : t), 0);
                  const totalPct = actualToDate ? ((projectedSameMonths - actualToDate) / Math.abs(actualToDate)) * 100 : 0;
                  const partial = actuals.monthsWithData < 12;
                  return (
                    <>
                      <TableRow className="border-t-2">
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {actuals.year} actual, booked{partial && lastBooked >= 0 ? ` through ${MONTH_ABBRS[lastBooked]}` : ""}
                        </TableCell>
                        {actuals.byMonth.map((v, i) => (
                          <TableCell key={i} className="text-right tabular-nums text-muted-foreground">{booked[i] ? fmtUsd(v) : ""}</TableCell>
                        ))}
                        <TableCell className="text-right font-medium tabular-nums text-muted-foreground">{fmtUsd(actualToDate)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="whitespace-nowrap">Change vs {actuals.year}{partial ? ", same months" : ""}</TableCell>
                        {totals.totalByMonth.map((v, i) => {
                          if (!booked[i]) return <TableCell key={i} className="text-right text-muted-foreground"></TableCell>;
                          const base = actuals.byMonth[i];
                          if (!base) return <TableCell key={i} className="text-right text-muted-foreground">{v ? "new" : ""}</TableCell>;
                          const pct = ((v - base) / Math.abs(base)) * 100;
                          return (
                            <TableCell key={i} className={`text-right tabular-nums ${pct > 0 ? "text-red-700" : pct < 0 ? "text-emerald-700" : ""}`}>
                              {pct > 0 ? "+" : ""}{fmtPct(pct)}
                            </TableCell>
                          );
                        })}
                        <TableCell className={`text-right font-medium tabular-nums ${totalPct > 0 ? "text-red-700" : totalPct < 0 ? "text-emerald-700" : ""}`}>
                          {actualToDate ? `${totalPct > 0 ? "+" : ""}${fmtPct(totalPct)}` : ""}
                        </TableCell>
                      </TableRow>
                    </>
                  );
                })()}
              </TableBody>
            </Table>
            {actuals && actuals.monthsWithData > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {actuals.year} actual is every Personnel Costs account in the general ledger for {isPlan ? "all entities" : ownerName}, by month booked. Change compares this projection to it, month for month and for the months booked so far; red is higher cost, green is lower.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {isPlan && totals && rows.length > 0 && reportingEntities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>By company</CardTitle>
            <CardDescription>Each reporting group&apos;s share of the personnel cost by month, from the Company column: manual splits and By revenue rows alike.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  {MONTH_ABBRS.map((m) => <TableHead key={m} className="text-right">{m}</TableHead>)}
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...reportingEntities]
                  .map((g) => ({ ...g, series: groupByMonth[g.id] ?? new Array(12).fill(0), total: groupTotals[g.id] ?? 0 }))
                  .sort((a, b) => b.total - a.total)
                  .map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="whitespace-nowrap font-medium">{g.name}</TableCell>
                      {g.series.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{fmtUsd(v)}</TableCell>)}
                      <TableCell className="text-right font-medium tabular-nums">{fmtUsd(g.total)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{totals.total > 0 ? fmtPct((g.total / totals.total) * 100) : ""}</TableCell>
                    </TableRow>
                  ))}
                {unallocatedTotal > 0 && (
                  <TableRow>
                    <TableCell className="whitespace-nowrap text-amber-600">Unallocated</TableCell>
                    {(unallocatedByMonth.length === 12 ? unallocatedByMonth : new Array(12).fill(0)).map((v, i) => (
                      <TableCell key={i} className="text-right tabular-nums text-amber-600">{fmtUsd(v)}</TableCell>
                    ))}
                    <TableCell className="text-right font-medium tabular-nums text-amber-600">{fmtUsd(unallocatedTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{totals.total > 0 ? fmtPct((unallocatedTotal / totals.total) * 100) : ""}</TableCell>
                  </TableRow>
                )}
                <TableRow className="font-medium">
                  <TableCell>Total</TableCell>
                  {totals.totalByMonth.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{fmtUsd(v)}</TableCell>)}
                  <TableCell className="text-right tabular-nums">{fmtUsd(totals.total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">100.0%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle>Positions</CardTitle>
              <CardDescription>
                Location, Class and Function are the three tags from the cheat sheet, set once per person; a split is 75/25 or 50/50. Edits save when you leave a cell. Adjustment is one pay change for the year. Change is what that adjustment does to the full-year cost for this group. Share shows the part of the person allocated to this group.
              </CardDescription>
            </div>
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">View by</span>
                <div className="flex overflow-hidden rounded-md border">
                  {VIEW_MODES.map((m, i) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setViewMode(m.key)}
                      aria-pressed={viewMode === m.key}
                      className={`px-2.5 py-1.5 text-xs ${i > 0 ? "border-l" : ""} ${viewMode === m.key ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted/40"}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="relative ml-2">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") setSearch(""); }}
                    placeholder="Find a person"
                    aria-label="Find a person by name, title or department"
                    className="h-8 w-[200px] pl-7 pr-7 text-sm"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      aria-label="Clear search"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <span className="ml-2 text-muted-foreground">Show</span>
                <Select value={showAdjustedOnly ? "adjusted" : "all"} onValueChange={(v) => setShowAdjustedOnly(v === "adjusted")}>
                  <SelectTrigger className="h-8 w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All positions</SelectItem>
                    <SelectItem value="adjusted">Adjusted only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          {rows.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {isPlan &&
                reportingEntities.map((g) => (
                  <span key={g.id}>
                    <span className="text-muted-foreground">{g.name}</span> <span className="ml-1 font-medium tabular-nums">{fmtUsd(groupTotals[g.id] ?? 0)}</span>
                  </span>
                ))}
              {isPlan && unallocatedTotal > 0 && (
                <span>
                  <span className="text-muted-foreground">Unallocated</span> <span className="ml-1 font-medium tabular-nums text-amber-600">{fmtUsd(unallocatedTotal)}</span>
                  <span className="text-muted-foreground"> ({unallocated} {unallocated === 1 ? "person" : "people"})</span>
                </span>
              )}
              {untagged > 0 && (
                <span>
                  <span className="text-muted-foreground">Missing a tag</span> <span className="ml-1 font-medium tabular-nums text-amber-600">{untagged}</span>
                </span>
              )}
              <span>
                <span className="text-muted-foreground">Adjustments</span> <span className="ml-1 font-medium tabular-nums">{adjSummary.count}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Raises</span> <span className="ml-1 font-medium tabular-nums text-emerald-700">{fmtChange(adjSummary.raises)}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Reductions</span> <span className="ml-1 font-medium tabular-nums text-red-700">{fmtChange(adjSummary.cuts)}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Net change, loaded</span> <span className="ml-1 font-medium tabular-nums">{fmtChange(adjSummary.net)}</span>
                {bridge.runRateGross > 0 && adjSummary.count > 0 && (
                  <span className="text-muted-foreground"> ({fmtChange(adjSummary.netGross)} on gross, {fmtPct((adjSummary.netGross / bridge.runRateGross) * 100)} of trailing)</span>
                )}
              </span>
            </div>
          )}
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No positions yet. Seed from Paylocity or add a position.</p>
          ) : visibleRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search.trim() ? `Nobody matches "${search.trim()}".` : "No adjustments yet. Click a value in the Adjustment column to add one."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Adjust</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Function</TableHead>
                  <TableHead>Company</TableHead>
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
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    {g.label !== null && (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={13 + NUMERIC_FIELDS.length} className="py-1.5 text-xs">
                          <span className="font-medium">{g.label}</span>
                          <span className="ml-2 text-muted-foreground">{g.rows.length} {g.rows.length === 1 ? "position" : "positions"}</span>
                          <span className="ml-2 font-medium tabular-nums">{fmtUsd(g.total)}</span>
                          {totals && totals.total > 0 && <span className="ml-1 text-muted-foreground">({fmtPct((g.total / totals.total) * 100)})</span>}
                        </TableCell>
                      </TableRow>
                    )}
                {g.rows.map((r) => {
                  const p = pricedById.get(r.id);
                  const baseline = baselines[r.id];
                  const delta = p ? p.total - (baseline?.total ?? 0) : 0;
                  const changeLabel = adjLabel(r);
                  const tagsDisabled = readOnly || savingId === r.id;
                  return (
                    <TableRow key={r.id} className={r.status === "excluded" ? "opacity-50" : undefined}>
                      <TableCell className="whitespace-nowrap">
                        <button type="button" className="text-left font-medium hover:underline" onClick={() => setSelected(r.id)}>
                          {r.name}
                        </button>
                        <div className="text-xs text-muted-foreground">
                          {r.open_role ? "Planned, no name yet" : r.title ?? (r.is_requisition ? "Planned position" : "")}
                        </div>
                        {changeLabel && <div className="text-xs text-muted-foreground">{changeLabel}</div>}
                        {r.seeded_from?.warnings?.length ? (
                          <div className="text-xs text-amber-600">{r.seeded_from.warnings[0]}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="p-1">
                        <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" disabled={savingId === r.id} onClick={() => setAdjustRowId(r.id)}>
                          {readOnly ? "View" : "Adjust"}
                        </Button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        <span className={delta > 0 ? "text-red-700" : delta < 0 ? "text-emerald-700" : "text-muted-foreground"}>
                          {delta === 0 ? "$0" : fmtChange(delta)}
                          {baseline && baseline.total > 0 && delta !== 0 && (
                            <span className="text-muted-foreground"> ({delta < 0 ? "-" : "+"}{fmtPct((Math.abs(delta) / baseline.total) * 100)})</span>
                          )}
                          {(!baseline || baseline.total === 0) && delta > 0 && <span className="text-muted-foreground"> new</span>}
                        </span>
                      </TableCell>
                      <TableCell className="p-1">
                        <TagCell label="Location" value={rowLocation(r)} options={[...LOCATIONS]} disabled={tagsDisabled} onSave={(s) => saveTags(r.id, "location_allocations", s)} />
                      </TableCell>
                      <TableCell className="p-1">
                        <TagCell label="Class" value={rowClass(r)} options={classOptions} disabled={tagsDisabled} onSave={(s) => saveTags(r.id, "class_allocations", s)} />
                      </TableCell>
                      <TableCell className="p-1">
                        <TagCell label="Function" value={rowFunction(r)} options={[...FUNCTIONS]} disabled={tagsDisabled} onSave={(s) => saveTags(r.id, "function_allocations", s)} />
                      </TableCell>
                      <TableCell className="p-1">
                        {isPlan ? (
                          <CompanyCell
                            row={r}
                            entities={entities}
                            revenueShares={revenueShares}
                            label={companyLabel(r)}
                            disabled={tagsDisabled}
                            onSave={(fields) => patch(r.id, fields)}
                          />
                        ) : (
                          <span className="px-1.5 text-xs">{companyLabel(r) || <span className="text-amber-600">Not allocated</span>}</span>
                        )}
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
                          <SelectTrigger className="h-8 w-[104px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Hourly">Hourly</SelectItem>
                            <SelectItem value="Salary">Salary</SelectItem>
                            <SelectItem value="Amount">Amount</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      {NUMERIC_FIELDS.map((f) => (
                        <TableCell key={f.key} className="p-1">
                          <NumberCell
                            id={`hc-${r.id}-${f.key}`}
                            value={r[f.key] as number | null}
                            step={f.step}
                            format={f.format}
                            disabled={readOnly || savingId === r.id}
                            onCommit={(v) => patch(r.id, { [f.key]: v } as Partial<HeadcountRow>)}
                          />
                        </TableCell>
                      ))}
                      <TableCell className="text-right tabular-nums">{p && !isPlan ? fmtPct(p.reShare * 100, 0) : ""}</TableCell>
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
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isPlan && <PlanHistory planId={scope.planId} entityNames={entityCodes} />}

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
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="hc-name">Name</Label>
                    <Input
                      id="hc-name"
                      defaultValue={selectedRow.name}
                      disabled={readOnly}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (!v || v === selectedRow.name) return;
                        // Filling in a person closes the open role
                        patch(selectedRow.id, { name: v, ...(selectedRow.open_role && !/^open role/i.test(v) ? { open_role: false } : {}) });
                      }}
                    />
                    {selectedRow.open_role && <span className="text-xs text-muted-foreground">Open role. Type the person&apos;s name here once you have one.</span>}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="hc-title">Title</Label>
                    <Input
                      id="hc-title"
                      defaultValue={selectedRow.title ?? ""}
                      disabled={readOnly}
                      onBlur={(e) => { if (e.target.value !== (selectedRow.title ?? "")) patch(selectedRow.id, { title: e.target.value || null }); }}
                    />
                  </div>
                </div>
                {adjLabel(selectedRow) && (
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">Comp adjustment</div>
                    <div>
                      {adjLabel(selectedRow)}: {payUnit(selectedRow).print(payUnit(selectedRow).current)} to {payUnit(selectedRow).print(adjustedPay(selectedRow, selectedRow.comp_adj_kind!, selectedRow.comp_adj_value!))}
                      {baselines[selectedRow.id] && (
                        <span className={(selectedPriced.total - baselines[selectedRow.id].total) < 0 ? "ml-2 text-red-700" : "ml-2 text-emerald-700"}>
                          {fmtChange(selectedPriced.total - baselines[selectedRow.id].total)} this year, loaded
                        </span>
                      )}
                    </div>
                    {selectedRow.comp_adj_reason && <div className="text-xs text-muted-foreground">{selectedRow.comp_adj_reason}</div>}
                  </div>
                )}
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
                {isPlan && (
                  <div className="rounded-md border p-3">
                    <div className="mb-1 text-xs text-muted-foreground">Changes to this person</div>
                    <PlanHistory planId={scope.planId} rowId={selectedRow.id} entityNames={entityCodes} compact />
                  </div>
                )}
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
              Active employees allocated to {ownerName}, priced from their current pay rate and the trailing twelve months of paychecks.
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

      {adjustRowId && rows.find((r) => r.id === adjustRowId) && (
        <AdjustDialog
          key={adjustRowId}
          row={rows.find((r) => r.id === adjustRowId)!}
          reShare={pricedById.get(adjustRowId)?.reShare ?? 1}
          assumptionRows={assumptionRows}
          fiscalYear={scope.fiscalYear}
          ownerName={isPlan ? "the organization" : ownerName}
          readOnly={readOnly}
          onClose={() => setAdjustRowId(null)}
          onSubmit={(fields) => patch(adjustRowId, fields)}
        />
      )}

      {/* Add position dialog: a named hire, or an open role with money set aside */}
      <Dialog open={reqOpen} onOpenChange={setReqOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add a position</DialogTitle>
            <DialogDescription>A planned hire. Benefits start after the waiting period in Assumptions; recruiting cost lands in the start month.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { mode: "named", label: "Named hire", help: "You know who it is, or the exact role and rate." },
                  { mode: "open", label: "Open role", help: "No name yet. Set aside the money and fill in the person later." },
                ] as const
              ).map((o) => (
                <button
                  key={o.mode}
                  type="button"
                  onClick={() => setReq((r) => ({ ...r, mode: o.mode }))}
                  className={`flex items-start gap-2.5 rounded-md border p-3 text-left ${req.mode === o.mode ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/40"}`}
                  aria-pressed={req.mode === o.mode}
                >
                  <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border ${req.mode === o.mode ? "border-[5px] border-foreground" : "border-muted-foreground"}`} />
                  <span>
                    <span className="block text-sm font-medium">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.help}</span>
                  </span>
                </button>
              ))}
            </div>

            {req.mode === "named" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="req-name">Name</Label>
                  <Input id="req-name" value={req.name} onChange={(e) => setReq((r) => ({ ...r, name: e.target.value }))} placeholder="Jane Doe" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="req-title">Title</Label>
                  <Input id="req-title" value={req.title} onChange={(e) => setReq((r) => ({ ...r, title: e.target.value }))} placeholder="Rental agent" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-[2fr_1fr] gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="req-role">Role</Label>
                  <Input id="req-role" value={req.title} onChange={(e) => setReq((r) => ({ ...r, title: e.target.value }))} placeholder="Rental agent" />
                  <span className="text-xs text-muted-foreground">Shows as Open role: {req.title.trim() || "Rental agent"} until you add a name.</span>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="req-count">How many</Label>
                  <Input id="req-count" type="number" min={1} max={50} step="1" value={req.count} onChange={(e) => setReq((r) => ({ ...r, count: e.target.value }))} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="req-dept">Department</Label>
                <Input id="req-dept" value={req.department} onChange={(e) => setReq((r) => ({ ...r, department: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="req-wc">Workers comp class</Label>
                <Input id="req-wc" value={req.wc_class_code} onChange={(e) => setReq((r) => ({ ...r, wc_class_code: e.target.value }))} placeholder="8810" />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>How to budget it</Label>
              <div className="flex w-fit overflow-hidden rounded-md border">
                {(
                  [
                    { v: "Hourly", label: "Hourly rate" },
                    { v: "Salary", label: "Salary" },
                    { v: "Amount", label: "Amount per month" },
                  ] as const
                ).map((o, i) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setReq((r) => ({ ...r, pay_type: o.v }))}
                    aria-pressed={req.pay_type === o.v}
                    className={`px-3 py-1.5 text-sm ${i > 0 ? "border-l" : ""} ${req.pay_type === o.v ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted/40"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {req.pay_type === "Amount" && (
                <span className="text-xs text-muted-foreground">For money you want to hold without a rate in mind. The amount can be the whole cost, or wages with taxes and benefits added on top.</span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {req.pay_type === "Hourly" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="req-rate">Rate per hour</Label>
                  <Input id="req-rate" type="number" step="0.01" value={req.base_rate} onChange={(e) => setReq((r) => ({ ...r, base_rate: e.target.value }))} />
                </div>
              )}
              {req.pay_type === "Salary" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="req-salary">Annual salary</Label>
                  <Input id="req-salary" type="number" step="1" value={req.annual_salary} onChange={(e) => setReq((r) => ({ ...r, annual_salary: e.target.value }))} />
                </div>
              )}
              {req.pay_type === "Amount" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="req-amount">Amount per month</Label>
                  <Input id="req-amount" type="number" step="1" value={req.amount_monthly} onChange={(e) => setReq((r) => ({ ...r, amount_monthly: e.target.value }))} />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="req-start">Start month</Label>
                <Select value={req.start_month} onValueChange={(v) => setReq((r) => ({ ...r, start_month: v }))}>
                  <SelectTrigger id="req-start">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="req-end">End month</Label>
                <Select value={req.end_month || "none"} onValueChange={(v) => setReq((r) => ({ ...r, end_month: v === "none" ? "" : v }))}>
                  <SelectTrigger id="req-end">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Through December</SelectItem>
                    {MONTH_NAMES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {req.pay_type === "Amount" ? (
              <div className="grid gap-2">
                {(
                  [
                    { v: true, label: "Amount is the whole cost", help: "Taxes, benefits and workers comp are inside the amount. Lands on wages as one line." },
                    { v: false, label: "Amount is wages only", help: "Taxes, benefits and workers comp are added on top from Assumptions." },
                  ] as const
                ).map((o) => (
                  <button
                    key={String(o.v)}
                    type="button"
                    onClick={() => setReq((r) => ({ ...r, amount_is_loaded: o.v }))}
                    aria-pressed={req.amount_is_loaded === o.v}
                    className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-left ${req.amount_is_loaded === o.v ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/40"}`}
                  >
                    <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border ${req.amount_is_loaded === o.v ? "border-[5px] border-foreground" : "border-muted-foreground"}`} />
                    <span>
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="block text-xs text-muted-foreground">{o.help}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="req-benefits">Benefits per month (blank = default)</Label>
                <Input id="req-benefits" type="number" step="1" value={req.benefits_monthly} onChange={(e) => setReq((r) => ({ ...r, benefits_monthly: e.target.value }))} />
              </div>
            )}

            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span>
                {req.mode === "open" ? `${reqPreview.count} open role${reqPreview.count > 1 ? "s" : ""}` : "1 position"}, {MONTH_ABBRS[reqPreview.start - 1]} through {MONTH_ABBRS[reqPreview.end - 1]}
              </span>
              <span className="font-medium tabular-nums">
                {fmtUsd(reqPreview.total)} {reqPreview.loaded ? "this year" : "wages this year"}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReqOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createRequisition} disabled={reqSaving}>
              {reqSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {req.mode === "open" && reqPreview.count > 1 ? `Add ${reqPreview.count} positions` : "Add position"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * A number cell that reads as dollars or a percent at rest and becomes a
 * plain number while it has focus. Typed "$", "," and "%" are ignored.
 */
function NumberCell({
  id,
  value,
  step,
  format,
  disabled,
  onCommit,
}: {
  id: string;
  value: number | null;
  step?: string;
  format: CellFormat;
  disabled?: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(num(value));
  // At rest the cell shows the formatted stored value; the draft only matters while editing
  const shown = editing ? text : formatCell(value, format);
  return (
    <Input
      id={id}
      type={editing ? "number" : "text"}
      step={editing ? step ?? "any" : undefined}
      inputMode="decimal"
      value={shown}
      disabled={disabled}
      onFocus={() => { setText(num(value)); setEditing(true); }}
      onChange={(e) => setText(e.target.value.replace(/[$,%s]/g, ""))}
      onBlur={() => {
        setEditing(false);
        const cleaned = text.trim();
        const next = cleaned === "" ? null : Number(cleaned);
        if (next !== null && Number.isNaN(next)) return;
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setText(num(value)); (e.target as HTMLInputElement).blur(); }
      }}
      className={`h-7 px-1.5 text-right text-xs tabular-nums ${format === "usd" || format === "usd2" ? "w-[104px]" : "w-[84px]"}`}
    />
  );
}



/** Engine input from a table row, for pricing in the browser. */
function rowToEngineInput(r: HeadcountRow): HeadcountRowInput {
  return {
    id: r.id,
    name: r.name,
    employeeId: r.employee_id,
    paylocityCompanyId: r.paylocity_company_id,
    reportingEntityId: null,
    isRequisition: !!r.is_requisition,
    status: (r.status as HeadcountRowInput["status"]) ?? "active",
    payType: r.pay_type === "Salary" ? "Salary" : r.pay_type === "Amount" ? "Amount" : "Hourly",
    baseRate: r.base_rate == null ? null : Number(r.base_rate),
    annualSalary: r.annual_salary == null ? null : Number(r.annual_salary),
    amountMonthly: r.amount_monthly == null ? null : Number(r.amount_monthly),
    amountIsLoaded: r.amount_is_loaded !== false,
    compAdj:
      r.comp_adj_kind && r.comp_adj_value != null && Number(r.comp_adj_value) !== 0
        ? { kind: r.comp_adj_kind, value: Number(r.comp_adj_value), month: Number(r.comp_adj_month ?? 1), reason: r.comp_adj_reason ?? null }
        : null,
    stdHoursWeek: Number(r.std_hours_week ?? 40),
    ftePct: Number(r.fte_pct ?? 100),
    startMonth: Number(r.start_month ?? 1),
    endMonth: r.end_month == null ? null : Number(r.end_month),
    meritPct: Number(r.merit_pct ?? 0),
    meritMonth: r.merit_month == null ? null : Number(r.merit_month),
    bonusTarget: Number(r.bonus_target ?? 0),
    commissionAnnual: Number(r.commission_annual ?? 0),
    otPct: Number(r.ot_pct ?? 0),
    dtPct: Number(r.dt_pct ?? 0),
    mealPct: Number(r.meal_pct ?? 0),
    otherEarningsMonthly: Number(r.other_earnings_monthly ?? 0),
    benefitsMonthly: Number(r.benefits_monthly ?? 0),
    matchPct: Number(r.match_pct ?? 0),
    lifeDisabilityMonthly: Number(r.life_disability_monthly ?? 0),
    wcClassCode: r.wc_class_code,
    ptoHoursPerPeriod: Number(r.pto_hours_per_period ?? 0),
    otherCostsMonthly: Number(r.other_costs_monthly ?? 0),
    entityAllocations: r.entity_allocations ?? [],
    classAllocations: r.class_allocations ?? [],
  };
}

/** The row as seeded (its baseline) with no comp adjustment; null for hand-added rows. */
function baselineOf(r: HeadcountRow): HeadcountRow | null {
  const fields = readBaselineFields(r.seeded_from);
  const cleared = { comp_adj_kind: null, comp_adj_value: null, comp_adj_month: null, comp_adj_reason: null, merit_pct: 0, merit_month: null };
  if (!fields) return r.is_requisition || !r.employee_id ? null : { ...r, ...cleared };
  return { ...r, ...(fields as Partial<HeadcountRow>), ...cleared };
}

type AdjustField = {
  key: keyof HeadcountRow;
  label: string;
  format: CellFormat;
  step?: string;
  /** Only shown for these pay types */
  payTypes?: string[];
};

const ADJUST_FIELDS: AdjustField[] = [
  { key: "base_rate", label: "Rate per hour", format: "usd2", step: "0.01", payTypes: ["Hourly"] },
  { key: "annual_salary", label: "Annual salary", format: "usd", step: "1", payTypes: ["Salary"] },
  { key: "amount_monthly", label: "Amount per month", format: "usd", step: "1", payTypes: ["Amount"] },
  { key: "std_hours_week", label: "Hours per week", format: "hours", step: "0.5" },
  { key: "fte_pct", label: "FTE", format: "pct", step: "1" },
  { key: "start_month", label: "Start month", format: "count", step: "1" },
  { key: "end_month", label: "End month", format: "count", step: "1" },
  { key: "bonus_target", label: "Bonus target", format: "usd", step: "1" },
  { key: "commission_annual", label: "Commission, annual", format: "usd", step: "1" },
  { key: "ot_pct", label: "Overtime", format: "pct", step: "0.1" },
  { key: "dt_pct", label: "Doubletime", format: "pct", step: "0.1" },
  { key: "meal_pct", label: "Meal premiums", format: "pct", step: "0.1" },
  { key: "benefits_monthly", label: "Benefits per month", format: "usd", step: "1" },
  { key: "match_pct", label: "401(k) match", format: "pct", step: "0.1" },
  { key: "life_disability_monthly", label: "Life and disability per month", format: "usd", step: "1" },
  { key: "pto_hours_per_period", label: "PTO hours per period", format: "hours", step: "0.01" },
  { key: "other_costs_monthly", label: "Other per month", format: "usd", step: "1" },
];

const PAY_KEYS = new Set<keyof HeadcountRow>(["base_rate", "annual_salary"]);

/**
 * Adjust: every number that drives a person's cost, side by side. Current is
 * the seeded baseline, Adjusted is what the budget uses, and the result is
 * the full-year loaded comp for both with the net change. Submit writes the
 * adjusted values; a rate or salary change is stored as the row's comp
 * adjustment from its effective month, so the baseline stays intact.
 */
function AdjustDialog({
  row,
  reShare,
  assumptionRows,
  fiscalYear,
  ownerName,
  readOnly,
  onClose,
  onSubmit,
}: {
  row: HeadcountRow;
  reShare: number;
  assumptionRows: AssumptionRow[];
  fiscalYear: number;
  ownerName: string;
  readOnly: boolean;
  onClose: () => void;
  onSubmit: (fields: Partial<HeadcountRow>) => Promise<void>;
}) {
  const baseline = useMemo(() => baselineOf(row), [row]);
  // Adjusted starts from what the budget uses today: the row with its comp adjustment applied to pay
  const initial = useMemo(() => {
    const d: Record<string, string> = {};
    for (const f of ADJUST_FIELDS) d[f.key] = num(row[f.key] as number | null);
    d.pay_type = row.pay_type;
    if (row.comp_adj_kind && row.comp_adj_value != null) {
      const next = adjustedPay(row, row.comp_adj_kind, row.comp_adj_value);
      if (payUnit(row).hourly) d.base_rate = String(Math.round(next * 100) / 100);
      else d.annual_salary = String(Math.round(next));
    }
    return d;
  }, [row]);
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [bump, setBump] = useState<Record<string, string>>({});
  const [month, setMonth] = useState(String(row.comp_adj_month ?? 1));
  const [reason, setReason] = useState(row.comp_adj_reason ?? "");
  const [saving, setSaving] = useState(false);

  const assumptions = useMemo(() => new AssumptionSet(assumptionRows), [assumptionRows]);
  const ctx = useMemo(() => ({ year: fiscalYear, assumptions, reShare }), [fiscalYear, assumptions, reShare]);

  const currentValue = (key: keyof HeadcountRow): number | string | null => (baseline ? (baseline[key] as number | string | null) : null);
  const draftNumber = (key: string): number | null => {
    const v = (draft[key] ?? "").trim();
    return v === "" ? null : Number(v);
  };
  /** Percent the adjusted value sits above or below the current one, as typed or as implied. */
  const bumpShown = (f: AdjustField): string => {
    if (bump[f.key] !== undefined) return bump[f.key];
    const cur = Number(currentValue(f.key) ?? 0);
    const adj = draftNumber(f.key);
    if (!cur || adj == null) return "";
    const pct = ((adj - cur) / Math.abs(cur)) * 100;
    return Math.abs(pct) < 0.005 ? "" : String(Math.round(pct * 10) / 10);
  };
  /** Typing a percent sets the adjusted value from the current one. */
  const applyBump = (f: AdjustField, text: string) => {
    setBump((b) => ({ ...b, [f.key]: text }));
    const pct = Number(text.replace(/[%\s]/g, ""));
    const cur = Number(currentValue(f.key) ?? 0);
    if (text.trim() === "" || Number.isNaN(pct)) return;
    const raw = cur * (1 + pct / 100);
    const next = f.format === "usd2" || f.format === "hours" || f.format === "pct" ? Math.round(raw * 100) / 100 : Math.round(raw);
    setDraft((d) => ({ ...d, [f.key]: String(next) }));
  };

  // The row the budget would use if Submit were pressed now
  const adjustedRow = useMemo((): HeadcountRow => {
    const next: HeadcountRow = { ...row, pay_type: draft.pay_type };
    for (const f of ADJUST_FIELDS) (next as unknown as Record<string, unknown>)[f.key] = draftNumber(f.key);
    // A pay change keeps the baseline pay on the row and rides as a comp adjustment from its month
    const unit = payUnit(next);
    const basePay = baseline ? payUnit({ ...baseline, pay_type: draft.pay_type }).current : unit.current;
    const nextPay = unit.hourly ? draftNumber("base_rate") ?? 0 : draftNumber("annual_salary") ?? 0;
    if (baseline && draft.pay_type === baseline.pay_type && draft.pay_type !== "Amount" && Math.abs(nextPay - basePay) > 0.004) {
      if (unit.hourly) next.base_rate = baseline.base_rate;
      else next.annual_salary = baseline.annual_salary;
      next.comp_adj_kind = "rate";
      next.comp_adj_value = nextPay;
      next.comp_adj_month = Number(month) || 1;
      next.comp_adj_reason = reason.trim() || null;
    } else {
      next.comp_adj_kind = null;
      next.comp_adj_value = null;
      next.comp_adj_month = null;
      next.comp_adj_reason = null;
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, baseline, draft, month, reason]);

  const currentPriced = useMemo(() => (baseline ? pricePosition(rowToEngineInput(baseline), ctx) : null), [baseline, ctx]);
  const adjustedPriced = useMemo(() => pricePosition(rowToEngineInput(adjustedRow), ctx), [adjustedRow, ctx]);
  const currentTotal = currentPriced?.total ?? 0;
  const delta = adjustedPriced.total - currentTotal;
  const payChanged = !!adjustedRow.comp_adj_kind;

  const submit = async () => {
    setSaving(true);
    try {
      const fields: Partial<HeadcountRow> = { pay_type: adjustedRow.pay_type };
      for (const f of ADJUST_FIELDS) (fields as Record<string, unknown>)[f.key] = adjustedRow[f.key];
      fields.comp_adj_kind = adjustedRow.comp_adj_kind;
      fields.comp_adj_value = adjustedRow.comp_adj_value;
      fields.comp_adj_month = adjustedRow.comp_adj_month;
      fields.comp_adj_reason = adjustedRow.comp_adj_reason;
      await onSubmit(fields);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const visibleFields = ADJUST_FIELDS.filter((f) => !f.payTypes || f.payTypes.includes(draft.pay_type));
  const changedKeys = new Set(
    visibleFields.filter((f) => baseline && Number(draftNumber(f.key) ?? 0) !== Number((baseline[f.key] as number | null) ?? 0)).map((f) => f.key),
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Adjust {row.name}</DialogTitle>
          <DialogDescription>
            Current is what the person was seeded with. Type a percent in Change to move a value up or down from current, or type the adjusted value directly. The result is the full-year loaded comp for {ownerName}, and Submit pulls the adjusted column into the projection.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead className="w-[150px] text-right">Current</TableHead>
                <TableHead className="w-[150px] text-right">Change %</TableHead>
                <TableHead className="w-[150px] text-right">Adjusted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Pay type</TableCell>
                <TableCell className="text-right text-muted-foreground">{baseline?.pay_type ?? ""}</TableCell>
                <TableCell />
                <TableCell className="text-right">
                  <Select value={draft.pay_type} onValueChange={(v) => setDraft((d) => ({ ...d, pay_type: v }))} disabled={readOnly}>
                    <SelectTrigger className="h-8 w-full text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Hourly">Hourly</SelectItem>
                      <SelectItem value="Salary">Salary</SelectItem>
                      <SelectItem value="Amount">Amount</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
              {visibleFields.map((f) => (
                <Fragment key={f.key}>
                  <TableRow>
                    <TableCell>{f.label}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCell(currentValue(f.key) as number | null, f.format)}</TableCell>
                    <TableCell className="text-right">
                      <div className="relative w-full">
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={bumpShown(f)}
                          disabled={readOnly || !Number(currentValue(f.key) ?? 0)}
                          placeholder={Number(currentValue(f.key) ?? 0) ? "+0.0" : ""}
                          onChange={(e) => applyBump(f, e.target.value)}
                          className={`h-8 pr-6 text-right text-sm tabular-nums ${Number(bumpShown(f)) > 0 ? "text-red-700" : Number(bumpShown(f)) < 0 ? "text-emerald-700" : ""}`}
                          aria-label={`Change ${f.label} by percent`}
                          title="Type a percent to move the adjusted value up or down from the current one"
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="relative w-full">
                        {changedKeys.has(f.key) && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wide text-amber-600">changed</span>}
                        <Input
                          type="number"
                          step={f.step ?? "any"}
                          inputMode="decimal"
                          value={draft[f.key] ?? ""}
                          disabled={readOnly}
                          onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, [f.key]: v })); setBump((b) => { const n = { ...b }; delete n[f.key]; return n; }); }}
                          className={`h-8 w-full text-right text-sm tabular-nums ${changedKeys.has(f.key) ? "border-amber-400" : ""}`}
                          aria-label={`Adjusted ${f.label}`}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                  {PAY_KEYS.has(f.key) && (
                    <TableRow>
                      <TableCell className="pl-6 text-muted-foreground">Pay change effective</TableCell>
                      <TableCell className="text-right text-muted-foreground">{row.comp_adj_kind ? MONTH_NAMES[(row.comp_adj_month ?? 1) - 1] : ""}</TableCell>
                      <TableCell />
                      <TableCell className="text-right">
                        <Select value={month} onValueChange={setMonth} disabled={readOnly || !payChanged}>
                          <SelectTrigger className="h-8 w-full text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MONTH_NAMES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              <TableRow>
                <TableCell>Reason (optional)</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.comp_adj_reason ?? ""}</TableCell>
                <TableCell />
                <TableCell className="text-right">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={readOnly} placeholder="Market adjustment, new duties" className="h-8 w-full text-sm" aria-label="Reason" />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <div className="rounded-md border bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">Result, full year loaded for {ownerName}{reShare < 1 ? ` (${fmtPct(reShare * 100, 0)} share)` : ""}</div>
            <div className="mt-1 grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Current annual comp</div>
                <div className="text-lg font-semibold tabular-nums">{baseline ? fmtUsd(currentTotal) : <span className="text-muted-foreground">None, new position</span>}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Adjusted annual comp</div>
                <div className="text-lg font-semibold tabular-nums">{fmtUsd(adjustedPriced.total)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Net change</div>
                <div className={`text-lg font-semibold tabular-nums ${delta > 0 ? "text-red-700" : delta < 0 ? "text-emerald-700" : ""}`}>
                  {fmtChange(delta)}
                  {currentTotal > 0 && <span className="ml-1 text-sm font-normal text-muted-foreground">({delta < 0 ? "-" : "+"}{fmtPct((Math.abs(delta) / currentTotal) * 100)})</span>}
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={readOnly || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One of the three tags: a primary pick with an optional 75/25 or 50/50 split. */
function TagCell({
  label,
  value,
  options,
  disabled,
  onSave,
}: {
  label: string;
  value: TagSplit[];
  options: string[];
  disabled?: boolean;
  onSave: (splits: TagSplit[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const sorted = [...value].sort((a, b) => b.pct - a.pct);
  const [primary, setPrimary] = useState(sorted[0]?.key ?? "");
  const [second, setSecond] = useState(sorted[1]?.key ?? "");
  const [primaryPct, setPrimaryPct] = useState<number>(sorted[1] ? Math.round(sorted[0].pct) : 100);

  const onOpenChange = (next: boolean) => {
    if (next) {
      const s = [...value].sort((a, b) => b.pct - a.pct);
      setPrimary(s[0]?.key ?? "");
      setSecond(s[1]?.key ?? "");
      setPrimaryPct(s[1] ? Math.round(s[0].pct) : 100);
    }
    setOpen(next);
  };

  const text = splitLabel(value);
  const apply = () => {
    if (!primary) {
      onSave([]);
    } else if (second && second !== primary && primaryPct < 100) {
      onSave([{ key: primary, pct: primaryPct }, { key: second, pct: 100 - primaryPct }]);
    } else {
      onSave([{ key: primary, pct: 100 }]);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={`h-7 min-w-[110px] max-w-[190px] justify-start truncate px-2 text-xs font-normal ${text ? "" : "text-amber-600"}`}
          title={text || `${label} not set`}
        >
          {text || "Set"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] space-y-3">
        <div className="text-sm font-medium">{label}</div>
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Pick one</Label>
          <Select value={primary || "none"} onValueChange={(v) => setPrimary(v === "none" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not set</SelectItem>
              {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Split with (only if it is at least a quarter of their week)</Label>
          <Select value={second || "none"} onValueChange={(v) => { setSecond(v === "none" ? "" : v); if (v !== "none" && primaryPct === 100) setPrimaryPct(75); }} disabled={!primary}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="No split" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No split</SelectItem>
              {options.filter((o) => o !== primary).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {second && second !== primary && (
          <div className="flex overflow-hidden rounded-md border">
            {SPLIT_OPTIONS.map((o, i) => (
              <button
                key={o.pct}
                type="button"
                onClick={() => setPrimaryPct(o.pct)}
                aria-pressed={primaryPct === o.pct}
                className={`flex-1 py-1.5 text-xs ${i > 0 ? "border-l" : ""} ${primaryPct === o.pct ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted/40"}`}
              >
                {primary} {o.pct} / {second} {100 - o.pct}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => { onSave([]); setOpen(false); }}>
            Clear
          </button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={apply}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Who pays for the person: a manual entity split (75/25 or 50/50) or the plan's revenue shares. */
function CompanyCell({
  row,
  entities,
  revenueShares,
  label,
  disabled,
  onSave,
}: {
  row: HeadcountRow;
  entities: PlanEntity[];
  revenueShares: EntityAllocation[];
  label: string;
  disabled?: boolean;
  onSave: (fields: Partial<HeadcountRow> & { allocation_mode?: string; entity_allocations?: EntityAllocation[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"manual" | "revenue">((row as unknown as { allocation_mode?: string }).allocation_mode === "revenue" ? "revenue" : "manual");
  const [primary, setPrimary] = useState("");
  const [second, setSecond] = useState("");
  const [primaryPct, setPrimaryPct] = useState(100);

  const onOpenChange = (next: boolean) => {
    if (next) {
      const current = readEntityAllocations(row.entity_allocations).sort((a, b) => b.pct - a.pct);
      setMode((row as unknown as { allocation_mode?: string }).allocation_mode === "revenue" ? "revenue" : "manual");
      setPrimary(current[0]?.entity_id ?? "");
      setSecond(current[1]?.entity_id ?? "");
      setPrimaryPct(current[1] ? Math.round(current[0].pct) : 100);
    }
    setOpen(next);
  };

  const byGroup = new Map<string, PlanEntity[]>();
  for (const e of entities) {
    const k = e.reportingEntityName ?? "Other";
    const list = byGroup.get(k) ?? [];
    list.push(e);
    byGroup.set(k, list);
  }
  const nameOf = (id: string) => entities.find((e) => e.id === id)?.code ?? "";

  const apply = () => {
    if (mode === "revenue") {
      onSave({ allocation_mode: "revenue" });
    } else if (!primary) {
      onSave({ allocation_mode: "manual", entity_allocations: [] });
    } else if (second && second !== primary && primaryPct < 100) {
      onSave({ allocation_mode: "manual", entity_allocations: [{ entity_id: primary, pct: primaryPct }, { entity_id: second, pct: 100 - primaryPct }] });
    } else {
      onSave({ allocation_mode: "manual", entity_allocations: [{ entity_id: primary, pct: 100 }] });
    }
    setOpen(false);
  };

  const isRevenue = (row as unknown as { allocation_mode?: string }).allocation_mode === "revenue";
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={`h-7 min-w-[120px] max-w-[220px] justify-start truncate px-2 text-xs font-normal ${label ? "" : "text-amber-600"}`}
          title={label ? `${isRevenue ? "By revenue: " : ""}${label}` : "Not allocated"}
        >
          {label ? (isRevenue ? `By revenue: ${label}` : label) : "Allocate"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] space-y-3">
        <div className="text-sm font-medium">Who pays for {row.name}</div>
        <div className="flex overflow-hidden rounded-md border">
          {(
            [
              { k: "manual", label: "Pick the company" },
              { k: "revenue", label: "By revenue" },
            ] as const
          ).map((o, i) => (
            <button
              key={o.k}
              type="button"
              onClick={() => setMode(o.k)}
              aria-pressed={mode === o.k}
              className={`flex-1 py-1.5 text-xs ${i > 0 ? "border-l" : ""} ${mode === o.k ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted/40"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {mode === "revenue" ? (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            {revenueShares.length === 0 ? (
              <span className="text-muted-foreground">No revenue shares yet. Use Compute revenue shares above first.</span>
            ) : (
              <>
                <div>Follows each company&apos;s share of trailing revenue:</div>
                <div className="text-xs text-muted-foreground">{revenueShares.map((s) => `${entities.find((e) => e.id === s.entity_id)?.reportingEntityName ?? nameOf(s.entity_id) ?? "?"} ${fmtPct(s.pct)}`).join(", ")}</div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Company</Label>
              <Select value={primary || "none"} onValueChange={(v) => setPrimary(v === "none" ? "" : v)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Not allocated" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not allocated</SelectItem>
                  {[...byGroup.entries()].map(([g, list]) => (
                    <Fragment key={g}>
                      <div className="px-2 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g}</div>
                      {list.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} ({e.code})</SelectItem>)}
                    </Fragment>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Split with (only if it is at least a quarter of their week)</Label>
              <Select value={second || "none"} onValueChange={(v) => { setSecond(v === "none" ? "" : v); if (v !== "none" && primaryPct === 100) setPrimaryPct(75); }} disabled={!primary}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="No split" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No split</SelectItem>
                  {entities.filter((e) => e.id !== primary).map((e) => <SelectItem key={e.id} value={e.id}>{e.name} ({e.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {second && second !== primary && (
              <div className="flex overflow-hidden rounded-md border">
                {SPLIT_OPTIONS.map((o, i) => (
                  <button
                    key={o.pct}
                    type="button"
                    onClick={() => setPrimaryPct(o.pct)}
                    aria-pressed={primaryPct === o.pct}
                    className={`flex-1 py-1.5 text-xs ${i > 0 ? "border-l" : ""} ${primaryPct === o.pct ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted/40"}`}
                  >
                    {nameOf(primary)} {o.pct} / {nameOf(second)} {100 - o.pct}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={apply} disabled={mode === "revenue" && revenueShares.length === 0}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

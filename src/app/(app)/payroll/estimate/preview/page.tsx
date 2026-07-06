"use client";

import { Suspense, useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Printer, Pencil, Save } from "lucide-react";

// ── Types (mirror /api/paylocity/monthly-estimate) ──

interface AmountTriple {
  wages: number;
  erTaxes: number;
  erBenefits: number;
}

interface ClassSplit {
  className: string;
  pct: number;
}

interface EmployeeSlice {
  entityId: string;
  entityCode: string;
  entityName: string;
  department: string;
  weight: number;
  classSplits: ClassSplit[];
  earnedInMonth: AmountTriple;
  overtimeHours: number;
  mealPremiums: number;
}

interface EmployeeRow {
  employeeId: string;
  companyId: string;
  employeeName: string;
  department: string;
  earnedInMonth: AmountTriple;
  overtimeHours: number;
  mealPremiums: number;
  /** Present on entity-grouped slice rows */
  classSplits?: ClassSplit[];
  slices?: EmployeeSlice[];
}

interface EntityGroup {
  entityId: string;
  entityCode: string;
  entityName: string;
  headcount: number;
  earnedInMonth: AmountTriple;
  overtimeHours: number;
  mealPremiums: number;
  employees: EmployeeRow[];
}

interface OrgEstimate {
  year: number;
  month: number;
  isClosedMonth: boolean;
  org: {
    headcount: number;
    earnedInMonth: AmountTriple;
    overtimeHours: number;
    mealPremiums: number;
  };
  entities: EntityGroup[];
  payingEntities: EntityGroup[];
}

interface PreviewInput {
  revenueEstimate: string;
  revenueBudget: string;
  revenueDeduction: string;
  payrollBudget: string;
}

// ── Constants ──

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Display name + header color per entity code, in report order. */
const REPORT_ENTITIES: Record<string, { label: string; color: string; order: number }> = {
  AVON: { label: "Avon", color: "#E00000", order: 0 },
  HDR: { label: "HDR", color: "#0000E0", order: 1 },
  VS: { label: "Versatile", color: "#000000", order: 2 },
  ARH: { label: "ARH", color: "#555555", order: 3 },
  HSS: { label: "HSS", color: "#555555", order: 4 },
};

const TOTAL_COLOR = "#4E7A27";

const PAYLOCITY_LABEL: Record<string, string> = {
  AVON: "Avon",
  HDR: "HDR",
};

const entityLabel = (code: string, name?: string) =>
  REPORT_ENTITIES[code]?.label ?? name ?? code;

// ── Formatting ──

const tTotal = (t: AmountTriple) => t.wages + t.erTaxes + t.erBenefits;

function usd0(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n < 0 ? `($${abs})` : `$${abs}`;
}

function num1(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return n < 0 ? `(${abs})` : abs;
}

function pct1(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "";
  return `${(n * 100).toFixed(1)}%`;
}

const parseNum = (s: string): number => {
  const n = Number(String(s).replace(/[$,()]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ── Page 1 entity block ──

function EntityBlock({
  label,
  color,
  estimateLabel,
  revenueEstimate,
  revenueBudget,
  revenueDeduction,
  showDeductionLine,
  payrollEstimate,
  payrollBudget,
  otHours,
  mealPremiums,
}: {
  label: string;
  color: string;
  estimateLabel?: string;
  revenueEstimate: number;
  revenueBudget: number;
  revenueDeduction: number;
  showDeductionLine: boolean;
  payrollEstimate: number;
  payrollBudget: number;
  otHours: number;
  mealPremiums: number;
}) {
  const netRevenue = revenueEstimate - revenueDeduction;
  const revVar = netRevenue - revenueBudget;
  const revPct = revenueBudget !== 0 ? revVar / revenueBudget : null;
  const payVar = payrollBudget - payrollEstimate;
  const payPct = payrollBudget !== 0 ? payVar / payrollBudget : null;

  const cell = "py-[3px] px-2 text-right font-mono text-[13px] whitespace-nowrap";
  const labelCell = "py-[3px] px-2 text-[13px]";

  return (
    <div className="mb-5">
      <div
        className="text-white text-[13px] font-bold px-3 py-1"
        style={{ backgroundColor: color, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
      >
        {label}
      </div>
      <table className="w-full mt-1.5">
        <thead>
          <tr className="font-bold">
            <td className={labelCell} style={{ width: "28%" }} />
            <td className={`${cell} font-sans font-bold`}>{estimateLabel ?? "Estimate"}</td>
            <td className={`${cell} font-sans font-bold`}>Budget</td>
            <td className={`${cell} font-sans font-bold`}>Variance</td>
            <td className={`${cell} font-sans font-bold`}>% Variance</td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={`${labelCell} font-bold`}>Total Revenue</td>
            <td className={cell}>{usd0(revenueEstimate)}</td>
            <td className={cell}>{usd0(revenueBudget)}</td>
            {showDeductionLine ? (
              <>
                <td className={cell} />
                <td className={cell} />
              </>
            ) : (
              <>
                <td className={cell}>{usd0(revVar)}</td>
                <td className={cell}>{pct1(revPct)}</td>
              </>
            )}
          </tr>
          {showDeductionLine && (
            <>
              <tr>
                <td className={`${labelCell} pl-6`}>Less: Versa Group</td>
                <td className={cell}>{revenueDeduction !== 0 ? usd0(-revenueDeduction) : ""}</td>
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
              </tr>
              <tr>
                <td className={`${labelCell} font-bold`}>Net Revenue</td>
                <td className={cell}>{usd0(netRevenue)}</td>
                <td className={cell}>{usd0(revenueBudget)}</td>
                <td className={cell}>{usd0(revVar)}</td>
                <td className={cell}>{pct1(revPct)}</td>
              </tr>
            </>
          )}
          <tr>
            <td className={labelCell} style={{ paddingTop: 10 }}>Payroll Costs</td>
            <td className={cell} style={{ paddingTop: 10 }}>{usd0(payrollEstimate)}</td>
            <td className={cell} style={{ paddingTop: 10 }}>{payrollBudget !== 0 ? usd0(payrollBudget) : ""}</td>
            <td className={cell} style={{ paddingTop: 10 }}>{payrollBudget !== 0 ? usd0(payVar) : ""}</td>
            <td className={cell} style={{ paddingTop: 10 }}>{payrollBudget !== 0 ? pct1(payPct) : ""}</td>
          </tr>
          <tr>
            <td className={`${labelCell} pl-6`}>OT Hours</td>
            <td className={cell}>{num1(otHours)}</td>
            <td className={cell} colSpan={3} />
          </tr>
          <tr>
            <td className={`${labelCell} pl-6`}>Meal Premiums</td>
            <td className={cell}>{num1(mealPremiums)}</td>
            <td className={cell} colSpan={3} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──

function MonthPreviewContent() {
  const searchParams = useSearchParams();
  const now = new Date();
  const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const [year, setYear] = useState(Number(searchParams.get("year")) || defaultYear);
  const [month, setMonth] = useState(Number(searchParams.get("month")) || defaultMonth);
  const [data, setData] = useState<OrgEstimate | null>(null);
  const [inputs, setInputs] = useState<Record<string, PreviewInput>>({});
  const [revenueBudgets, setRevenueBudgets] = useState<Record<string, number>>({});
  const [inputsTableExists, setInputsTableExists] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - 2 + i);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/paylocity/monthly-estimate?year=${year}&month=${month}`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `Failed: ${r.status}`);
        return r.json() as Promise<OrgEstimate>;
      }),
      fetch(`/api/payroll/preview-inputs?year=${year}&month=${month}`).then((r) =>
        r.ok ? r.json() : { inputs: [], tableExists: false }
      ),
    ])
      .then(([est, inp]) => {
        if (cancelled) return;
        setData(est);
        setInputsTableExists(inp.tableExists !== false);
        setRevenueBudgets(inp.revenueBudgets ?? {});
        const map: Record<string, PreviewInput> = {};
        for (const row of inp.inputs ?? []) {
          map[row.entity_id] = {
            revenueEstimate: row.revenue_estimate != null ? String(row.revenue_estimate) : "",
            revenueBudget: row.revenue_budget != null ? String(row.revenue_budget) : "",
            revenueDeduction: row.revenue_deduction != null ? String(row.revenue_deduction) : "",
            payrollBudget: row.payroll_budget != null ? String(row.payroll_budget) : "",
          };
        }
        setInputs(map);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  // Entities shown on the report: any with cost, in report order
  const reportEntities = useMemo(() => {
    if (!data) return [];
    return [...data.entities]
      .filter((e) => Math.abs(tTotal(e.earnedInMonth)) > 0.005 || e.headcount > 0)
      .sort(
        (a, b) =>
          (REPORT_ENTITIES[a.entityCode]?.order ?? 99) -
          (REPORT_ENTITIES[b.entityCode]?.order ?? 99)
      );
  }, [data]);

  const getInput = useCallback(
    (entityId: string): PreviewInput =>
      inputs[entityId] ?? { revenueEstimate: "", revenueBudget: "", revenueDeduction: "", payrollBudget: "" },
    [inputs]
  );

  // Revenue budget: live from the budgeting module (active version, Revenue/
  // Income accounts); falls back to a manually-saved figure if no budget exists.
  const getRevenueBudget = useCallback(
    (entityId: string): number =>
      revenueBudgets[entityId] ?? parseNum(getInput(entityId).revenueBudget),
    [revenueBudgets, getInput]
  );

  const setInputField = (entityId: string, field: keyof PreviewInput, value: string) => {
    setInputs((prev) => ({ ...prev, [entityId]: { ...getInput(entityId), [field]: value } }));
  };

  const saveInputs = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payroll/preview-inputs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          inputs: reportEntities.map((e) => {
            const i = getInput(e.entityId);
            return {
              entityId: e.entityId,
              revenueEstimate: i.revenueEstimate || null,
              revenueBudget: i.revenueBudget || null,
              revenueDeduction: i.revenueDeduction || null,
              payrollBudget: i.payrollBudget || null,
            };
          }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      setEditOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ── Page 2: grouped by company allocation. A split employee appears in
  // EACH company's group carrying only that company's share of OT / meal /
  // cost (so subtotals equal the entity totals), flagged in the Split column
  // with their share %. Within each company: most OT hours first, tiebreaker
  // highest total cost.
  const otGroups = useMemo(() => {
    if (!data) return [];

    interface EntityAgg {
      code: string;
      entityName: string;
      weight: number;
      maxSliceWeight: number;
      department: string;
      classLabel: string;
      otHours: number;
      mealHours: number;
      totalCost: number;
    }

    const rows: OtRow[] = data.payingEntities.flatMap((pe) =>
      pe.employees.flatMap((emp) => {
        const slices = emp.slices ?? [];
        // Aggregate this employee's slices per allocated entity
        const byEntity = new Map<string, EntityAgg>();
        for (const s of slices) {
          let agg = byEntity.get(s.entityCode);
          if (!agg) {
            agg = {
              code: s.entityCode,
              entityName: s.entityName,
              weight: 0,
              maxSliceWeight: -1,
              department: s.department,
              classLabel: "",
              otHours: 0,
              mealHours: 0,
              totalCost: 0,
            };
            byEntity.set(s.entityCode, agg);
          }
          agg.weight += s.weight;
          agg.otHours += s.overtimeHours;
          agg.mealHours += s.mealPremiums;
          agg.totalCost += tTotal(s.earnedInMonth);
          // Department/class label from the entity's largest slice
          if (s.weight > agg.maxSliceWeight) {
            agg.maxSliceWeight = s.weight;
            agg.department = s.department;
            agg.classLabel =
              s.classSplits.length === 0
                ? ""
                : s.classSplits.length === 1
                  ? s.classSplits[0].className
                  : s.classSplits
                      .map((sp) => `${sp.className} ${Math.round(sp.pct)}%`)
                      .join(" / ");
          }
        }
        const aggs = [...byEntity.values()];
        const isSplit = aggs.length > 1;
        return aggs.map((agg) => ({
          key: `${emp.employeeId}:${emp.companyId}:${agg.code}`,
          split: isSplit ? `${Math.round(agg.weight * 100)}%` : "",
          name: emp.employeeName,
          id: emp.employeeId,
          paylocity: PAYLOCITY_LABEL[pe.entityCode] ?? pe.entityCode,
          allocCode: agg.code,
          coAllocation: entityLabel(agg.code, agg.entityName),
          className: agg.classLabel,
          department: agg.department,
          otHours: agg.otHours,
          mealHours: agg.mealHours,
          totalCost: agg.totalCost,
        }));
      })
    );

    const byCode = new Map<string, OtRow[]>();
    for (const r of rows) {
      const arr = byCode.get(r.allocCode);
      if (arr) arr.push(r);
      else byCode.set(r.allocCode, [r]);
    }
    return [...byCode.entries()]
      .sort(
        ([a], [b]) =>
          (REPORT_ENTITIES[a]?.order ?? 99) - (REPORT_ENTITIES[b]?.order ?? 99)
      )
      .map(([code, groupRows]) => {
        const sorted = groupRows.sort(
          (a, b) => b.otHours - a.otHours || b.totalCost - a.totalCost
        );
        return {
          code,
          label: entityLabel(code, sorted[0]?.coAllocation),
          rows: sorted,
          otHours: sorted.reduce((s, r) => s + r.otHours, 0),
          mealHours: sorted.reduce((s, r) => s + r.mealHours, 0),
          totalCost: sorted.reduce((s, r) => s + r.totalCost, 0),
        };
      });
  }, [data]);

  // ── Page 3 matrix: entity → department rows × class columns of OT hours ──
  const matrix = useMemo(() => {
    if (!data) return null;
    interface DeptRow {
      otByClass: Record<string, number>;
      totalOt: number;
      totalCost: number;
    }
    interface EntityRows {
      code: string;
      label: string;
      depts: Record<string, DeptRow>;
      otByClass: Record<string, number>;
      totalOt: number;
      totalCost: number;
    }
    const entities = new Map<string, EntityRows>();
    const classTotals: Record<string, number> = {};

    const ordered = [...data.entities].sort(
      (a, b) =>
        (REPORT_ENTITIES[a.entityCode]?.order ?? 99) -
        (REPORT_ENTITIES[b.entityCode]?.order ?? 99)
    );

    for (const e of ordered) {
      const ent: EntityRows = {
        code: e.entityCode,
        label: entityLabel(e.entityCode, e.entityName),
        depts: {},
        otByClass: {},
        totalOt: 0,
        totalCost: 0,
      };
      entities.set(e.entityId, ent);
      for (const row of e.employees) {
        const dept = row.department || "—";
        const d = (ent.depts[dept] ??= { otByClass: {}, totalOt: 0, totalCost: 0 });
        const splits =
          row.classSplits && row.classSplits.length > 0
            ? row.classSplits
            : [{ className: "Unassigned", pct: 100 }];
        for (const sp of splits) {
          const ot = row.overtimeHours * (sp.pct / 100);
          d.otByClass[sp.className] = (d.otByClass[sp.className] ?? 0) + ot;
          ent.otByClass[sp.className] = (ent.otByClass[sp.className] ?? 0) + ot;
          classTotals[sp.className] = (classTotals[sp.className] ?? 0) + ot;
        }
        d.totalOt += row.overtimeHours;
        d.totalCost += tTotal(row.earnedInMonth);
        ent.totalOt += row.overtimeHours;
        ent.totalCost += tTotal(row.earnedInMonth);
      }
    }

    // Class columns: any class with OT activity, biggest first, Unassigned last
    const classCols = Object.entries(classTotals)
      .filter(([, v]) => Math.abs(v) > 0.05)
      .sort((a, b) => {
        if (a[0] === "Unassigned") return 1;
        if (b[0] === "Unassigned") return -1;
        return b[1] - a[1];
      })
      .map(([k]) => k);

    return { entities: [...entities.values()], classCols, classTotals };
  }, [data]);

  const monthLabel = MONTHS[month - 1];

  const totals = useMemo(() => {
    const t = {
      revenueEstimate: 0,
      revenueBudget: 0,
      payrollEstimate: 0,
      payrollBudget: 0,
      otHours: 0,
      mealPremiums: 0,
    };
    for (const e of reportEntities) {
      const i = getInput(e.entityId);
      t.revenueEstimate += parseNum(i.revenueEstimate) - parseNum(i.revenueDeduction);
      t.revenueBudget += getRevenueBudget(e.entityId);
      t.payrollEstimate += tTotal(e.earnedInMonth);
      t.payrollBudget += parseNum(i.payrollBudget);
      t.otHours += e.overtimeHours;
      t.mealPremiums += e.mealPremiums;
    }
    return t;
  }, [reportEntities, getInput, getRevenueBudget]);

  return (
    <div className="max-w-[850px] mx-auto">
      {/* Toolbar (hidden on print) */}
      <div className="stmt-no-print space-y-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <Link href="/payroll/estimate">
              <Button variant="ghost" size="sm" className="gap-1 -ml-2 mb-1">
                <ArrowLeft className="h-4 w-4" />
                Monthly Estimate
              </Button>
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">Month Preview Report</h1>
            <p className="text-muted-foreground text-sm">
              Print-ready packet: summary vs budget, overtime breakdown, and OT hours by class.
              Use your browser&apos;s print dialog to save as PDF.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-[95px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setEditOpen((o) => !o)}>
              <Pencil className="mr-2 h-4 w-4" />
              Revenue & Budgets
            </Button>
            <Button size="sm" onClick={() => window.print()} disabled={loading || !data}>
              <Printer className="mr-2 h-4 w-4" />
              Print / PDF
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-destructive"><CardContent className="pt-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent></Card>
        )}

        {editOpen && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Revenue & budget figures — {monthLabel} {year}</CardTitle>
              <CardDescription>
                Payroll cost, OT, and meal figures come from the estimate. Revenue Budget pulls
                automatically from the Budgeting module (active budget version, Revenue accounts).
                {!inputsTableExists && (
                  <span className="block text-destructive mt-1">
                    Saving requires DB migration 20260706_payroll_preview_inputs.sql (Supabase Studio → SQL Editor).
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-[110px_repeat(4,1fr)] gap-2 items-center text-xs font-medium text-muted-foreground">
                <span />
                <span>Revenue Estimate</span>
                <span>Revenue Budget (auto)</span>
                <span>Less: Versa Group</span>
                <span>Payroll Budget</span>
              </div>
              {reportEntities.map((e) => {
                const i = getInput(e.entityId);
                const budgetFromModule = revenueBudgets[e.entityId];
                return (
                  <div key={e.entityId} className="grid grid-cols-[110px_repeat(4,1fr)] gap-2 items-center">
                    <span className="text-sm font-medium">{entityLabel(e.entityCode, e.entityName)}</span>
                    <Input className="h-8 text-sm text-right" inputMode="decimal" value={i.revenueEstimate}
                      onChange={(ev) => setInputField(e.entityId, "revenueEstimate", ev.target.value)} />
                    <span
                      className="h-8 flex items-center justify-end px-3 text-sm font-mono rounded-md border bg-muted/40 text-muted-foreground"
                      title={budgetFromModule != null ? "From Budgeting module" : "No active budget found for this month"}
                    >
                      {budgetFromModule != null ? usd0(budgetFromModule) : "—"}
                    </span>
                    <Input className="h-8 text-sm text-right" inputMode="decimal" value={i.revenueDeduction}
                      onChange={(ev) => setInputField(e.entityId, "revenueDeduction", ev.target.value)}
                      disabled={e.entityCode !== "VS"} placeholder={e.entityCode !== "VS" ? "—" : ""} />
                    <Input className="h-8 text-sm text-right" inputMode="decimal" value={i.payrollBudget}
                      onChange={(ev) => setInputField(e.entityId, "payrollBudget", ev.target.value)} />
                  </div>
                );
              })}
              <div className="flex justify-end">
                <Button size="sm" onClick={saveInputs} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {loading && (
        <div className="flex h-[50vh] items-center justify-center stmt-no-print">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {data && !loading && (
        <div className="bg-white text-black rounded-md border p-8 print:p-0 print:border-0 print:rounded-none">
          {/* ══ Page 1: Month Preview ══ */}
          <section className="break-after-page">
            <div
              className="bg-black text-white font-bold text-lg px-4 py-3"
              style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
            >
              Month Preview Report
            </div>
            <table className="w-full mt-1 mb-2">
              <tbody>
                <tr>
                  <td style={{ width: "28%" }} />
                  {[0, 1, 2, 3].map((i) => (
                    <td key={i} className="text-right px-2 text-[13px]">{monthLabel}</td>
                  ))}
                </tr>
              </tbody>
            </table>

            {reportEntities.map((e) => {
              const meta = REPORT_ENTITIES[e.entityCode];
              const i = getInput(e.entityId);
              return (
                <EntityBlock
                  key={e.entityId}
                  label={entityLabel(e.entityCode, e.entityName)}
                  color={meta?.color ?? "#555555"}
                  revenueEstimate={parseNum(i.revenueEstimate)}
                  revenueBudget={getRevenueBudget(e.entityId)}
                  revenueDeduction={parseNum(i.revenueDeduction)}
                  showDeductionLine={e.entityCode === "VS"}
                  payrollEstimate={tTotal(e.earnedInMonth)}
                  payrollBudget={parseNum(i.payrollBudget)}
                  otHours={e.overtimeHours}
                  mealPremiums={e.mealPremiums}
                />
              );
            })}

            <EntityBlock
              label="Total"
              color={TOTAL_COLOR}
              revenueEstimate={totals.revenueEstimate}
              revenueBudget={totals.revenueBudget}
              revenueDeduction={0}
              showDeductionLine={false}
              payrollEstimate={totals.payrollEstimate}
              payrollBudget={totals.payrollBudget}
              otHours={totals.otHours}
              mealPremiums={totals.mealPremiums}
            />
          </section>

          {/* ══ Page 2: Overtime Breakdown ══ */}
          <section className="break-after-page pt-6 print:pt-0">
            <h2 className="font-bold text-sm mb-2">Overtime Breakdown</h2>
            <table className="w-full text-[9.5px] leading-[1.35]">
              <thead>
                <tr className="font-bold text-left">
                  <th className="py-0.5 pr-1">Split</th>
                  <th className="py-0.5 pr-1">Name</th>
                  <th className="py-0.5 pr-1">ID</th>
                  <th className="py-0.5 pr-1">Paylocity</th>
                  <th className="py-0.5 pr-1">Co Allocation</th>
                  <th className="py-0.5 pr-1">Class</th>
                  <th className="py-0.5 pr-1">Department</th>
                  <th className="py-0.5 pl-1 text-right">OT Hours</th>
                  <th className="py-0.5 pl-1 text-right">Meal Hours</th>
                  <th className="py-0.5 pl-1 text-right">Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {otGroups.map((g) => (
                  <GroupRows key={g.code} group={g} />
                ))}
                <tr className="font-bold border-t-2 border-black">
                  <td className="py-1" colSpan={7}>Grand Total</td>
                  <td className="py-1 pl-1 text-right font-mono">{num1(data.org.overtimeHours)}</td>
                  <td className="py-1 pl-1 text-right font-mono">{num1(data.org.mealPremiums)}</td>
                  <td className="py-1 pl-1 text-right font-mono">{num1(tTotal(data.org.earnedInMonth))}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* ══ Page 3: OT Hours by Class (prints landscape) ══ */}
          {matrix && (
            <section className="pt-6 print:pt-0 ot-matrix-page">
              <style>{`
                @media print {
                  .ot-matrix-page { page: otmatrix; }
                }
                @page otmatrix {
                  size: letter landscape;
                  margin: 0.3in 0.4in;
                }
              `}</style>
              <h2 className="font-bold text-sm mb-2">
                Overtime Hours by Class — {monthLabel} {year}
              </h2>
              <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-[9.5px] leading-snug">
                <thead>
                  <tr className="font-bold border-b border-black text-left align-bottom">
                    <th className="py-1 pr-2 whitespace-nowrap">Row Labels</th>
                    {matrix.classCols.map((c) => (
                      <th key={c} className="py-1 px-1 text-right break-words max-w-[70px]">{c}</th>
                    ))}
                    <th className="py-1 px-1 text-right border-l whitespace-nowrap">Total OT</th>
                    <th className="py-1 px-1 text-right whitespace-nowrap">Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.entities.map((ent) => (
                    <EntityMatrixRows key={ent.code} ent={ent} classCols={matrix.classCols} />
                  ))}
                  <tr
                    className="font-bold border-t border-black"
                    style={{ backgroundColor: "#DEEBF7", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
                  >
                    <td className="py-1 pr-2">Grand Total</td>
                    {matrix.classCols.map((c) => (
                      <td key={c} className="py-1 px-1 text-right font-mono">
                        {num1(matrix.classTotals[c] ?? 0)}
                      </td>
                    ))}
                    <td className="py-1 px-1 text-right font-mono border-l">{num1(data.org.overtimeHours)}</td>
                    <td className="py-1 px-1 text-right font-mono">{num1(tTotal(data.org.earnedInMonth))}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

interface OtRow {
  key: string;
  /** Share % of this employee's month in this company (blank when not split) */
  split: string;
  name: string;
  id: string;
  paylocity: string;
  allocCode: string;
  coAllocation: string;
  className: string;
  department: string;
  otHours: number;
  mealHours: number;
  totalCost: number;
}

function GroupRows({
  group,
}: {
  group: {
    code: string;
    label: string;
    rows: OtRow[];
    otHours: number;
    mealHours: number;
    totalCost: number;
  };
}) {
  const headerColor = REPORT_ENTITIES[group.code]?.color ?? "#555555";
  return (
    <>
      <tr>
        <td colSpan={10} className="pt-2 pb-0.5">
          <span
            className="inline-block text-white font-bold px-2 py-[1px] text-[10px]"
            style={{ backgroundColor: headerColor, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
          >
            {group.label}
          </span>
        </td>
      </tr>
      {group.rows.map((r, idx) => (
        <tr
          key={r.key}
          style={
            idx % 2 === 0
              ? { backgroundColor: "#DEEBF7", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }
              : undefined
          }
        >
          <td className="py-[1px] pr-1 font-bold" style={{ color: "#1D4ED8" }}>
            {r.split}
          </td>
          <td className="py-[1px] pr-1 whitespace-nowrap">{r.name}</td>
          <td className="py-[1px] pr-1">{r.id}</td>
          <td className="py-[1px] pr-1">{r.paylocity}</td>
          <td className="py-[1px] pr-1">{r.coAllocation}</td>
          <td className="py-[1px] pr-1">{r.className}</td>
          <td className="py-[1px] pr-1">{r.department}</td>
          <td className="py-[1px] pl-1 text-right font-mono">{num1(r.otHours)}</td>
          <td className="py-[1px] pl-1 text-right font-mono">{num1(r.mealHours)}</td>
          <td className="py-[1px] pl-1 text-right font-mono">{num1(r.totalCost)}</td>
        </tr>
      ))}
      <tr className="font-bold border-t border-black">
        <td className="py-0.5" colSpan={7}>{group.label} Total ({group.rows.length} employees)</td>
        <td className="py-0.5 pl-1 text-right font-mono">{num1(group.otHours)}</td>
        <td className="py-0.5 pl-1 text-right font-mono">{num1(group.mealHours)}</td>
        <td className="py-0.5 pl-1 text-right font-mono">{num1(group.totalCost)}</td>
      </tr>
    </>
  );
}

function EntityMatrixRows({
  ent,
  classCols,
}: {
  ent: {
    label: string;
    depts: Record<string, { otByClass: Record<string, number>; totalOt: number; totalCost: number }>;
    otByClass: Record<string, number>;
    totalOt: number;
    totalCost: number;
  };
  classCols: string[];
}) {
  const deptNames = Object.keys(ent.depts).sort();
  return (
    <>
      <tr className="font-bold border-t">
        <td className="py-1 pr-2 whitespace-nowrap">{ent.label}</td>
        {classCols.map((c) => (
          <td key={c} className="py-1 px-1 text-right font-mono">{num1(ent.otByClass[c] ?? 0)}</td>
        ))}
        <td className="py-1 px-1 text-right font-mono border-l">{num1(ent.totalOt)}</td>
        <td className="py-1 px-1 text-right font-mono">{num1(ent.totalCost)}</td>
      </tr>
      {deptNames.map((d) => {
        const row = ent.depts[d];
        return (
          <tr key={d}>
            <td className="py-[2px] pr-2 pl-4 whitespace-nowrap">{d}</td>
            {classCols.map((c) => (
              <td key={c} className="py-[2px] px-1 text-right font-mono">
                {num1(row.otByClass[c] ?? 0)}
              </td>
            ))}
            <td className="py-[2px] px-1 text-right font-mono border-l">{num1(row.totalOt)}</td>
            <td className="py-[2px] px-1 text-right font-mono">{num1(row.totalCost)}</td>
          </tr>
        );
      })}
    </>
  );
}

export default function MonthPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <MonthPreviewContent />
    </Suspense>
  );
}

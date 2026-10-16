"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { combine, fmtMoney, pnl, type DashboardPayload, type Mode, type Units } from "@/lib/budget/dashboard";
import { Segmented, MONTHS } from "./_components/shared";
import { Overview } from "./_components/overview";
import { PnlView, type Drill } from "./_components/pnl-view";
import { FunctionsView } from "./_components/functions-view";
import { RentView } from "./_components/rent-view";

type Tab = "overview" | "pnl" | "functions" | "rent";

/**
 * Budget dashboard (docs/budget-dashboard-plan.md, step 4): every reporting group's live
 * budget as a P&L by function, with drill-down to the item. Read only; edits stay on each
 * budget's Model tab and show here on the next load.
 */
export default function BudgetDashboardPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = use(params);
  const fiscalYear = Number(year);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState("All");
  const [mode, setMode] = useState<Mode>("pace");
  const [units, setUnits] = useState<Units>("M");
  const [tab, setTab] = useState<Tab>("overview");
  const [drill, setDrill] = useState<Drill>({ fn: null, lineId: null, itemKey: null });
  const [fnSel, setFnSel] = useState("Fleet");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/budget/dashboard?fiscalYear=${fiscalYear}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load the budget");
    } finally {
      setLoading(false);
    }
  }, [fiscalYear]);
  useEffect(() => {
    load();
  }, [load]);

  const { lines, booked } = useMemo(() => (data ? combine(data, entity) : { lines: [], booked: 0 }), [data, entity]);
  const totals = useMemo(() => pnl(lines, mode, booked).totals, [lines, mode, booked]);
  const view = { mode, units, booked, fiscalYear };
  const goDrill = (d: Drill) => {
    setDrill(d);
    setTab("pnl");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const entityName = entity === "All" ? "All companies" : data?.groups.find((g) => g.code === entity)?.name ?? entity;
  const eb = totals.ebitda;
  const lastMonth = MONTHS[Math.max(0, booked - 1)];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="text-sm text-muted-foreground"><Link href="/budget" className="hover:underline">Budget</Link> / Dashboard</div>
          <h1 className="text-2xl font-semibold tracking-tight">FY {fiscalYear} budget{entity === "All" ? "" : ` · ${entityName}`}</h1>
          {data && eb && (
            <p className="max-w-3xl text-sm text-muted-foreground">
              {entityName} {mode === "pace" ? "plans" : "budgets"} {fmtMoney(totals.revenue.cur, units)} of revenue and {fmtMoney(eb.cur, units)} of operating profit
              {mode === "pace" ? ` in ${fiscalYear}` : ` for January to ${lastMonth}`}, {fmtMoney(Math.abs(eb.cur - eb.prior), units)} {eb.cur < eb.prior ? "less" : "more"} than {mode === "pace" ? `the ${fiscalYear - 1} pace` : `the same months of ${fiscalYear - 1}`}.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Segmented label="Company" value={entity} onChange={(v) => { setEntity(v); setDrill({ fn: null, lineId: null, itemKey: null }); }}
            options={[["All", "All companies"], ...(data?.groups ?? []).map((g) => [g.code, g.name] as [string, string])]} />
          <Segmented<Mode> label="Compare" value={mode} onChange={setMode} options={[["pace", `Full year vs ${fiscalYear - 1} pace`], ["ytd", `Jan–${lastMonth} vs Jan–${lastMonth} ${fiscalYear - 1}`]]} />
          <Segmented<Units> label="Show amounts in" value={units} onChange={setUnits} options={[["M", "$M"], ["K", "$K"], ["D", "$"]]} />
          <Button variant="outline" size="sm" className="h-9" onClick={load} disabled={loading} aria-label="Reload the budget">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pnl">Master P&amp;L</TabsTrigger>
          <TabsTrigger value="functions">Cost by function</TabsTrigger>
          <TabsTrigger value="rent">Rent</TabsTrigger>
        </TabsList>
      </Tabs>

      {!data ? (
        <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading every company&apos;s budget…</> : "The budget did not load. Try Reload."}
        </div>
      ) : (
        <>
          {tab === "overview" && <Overview {...view} payload={data} entity={entity} lines={lines} onEntity={setEntity} onOpenFunction={(f) => { setFnSel(f); setTab("functions"); }} onOpenLine={(id) => goDrill({ fn: null, lineId: id, itemKey: null })} />}
          {tab === "pnl" && <PnlView {...view} lines={lines} drill={drill} onDrill={setDrill} />}
          {tab === "functions" && <FunctionsView {...view} payload={data} entity={entity} lines={lines} fn={fnSel} onFn={setFnSel} onDrill={goDrill} />}
          {tab === "rent" && <RentView {...view} lines={lines} onDrill={goDrill} />}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Live from each company&apos;s FY {fiscalYear} budget ({data.groups.map((g) => `${g.name}: ${g.version.name}${g.version.isActive ? ", active" : ", draft"}`).join("; ")}).{" "}
            {fiscalYear - 1} is the Financial Model&apos;s actuals for January to {lastMonth}; the pace is those months × 12 ÷ {booked}. All companies leaves out intercompany lines; a single company keeps them.
            Edit the budget and its tags on each company&apos;s Model tab; Reload to see the change.
          </p>
        </>
      )}
    </div>
  );
}

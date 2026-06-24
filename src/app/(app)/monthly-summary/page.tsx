"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileText, Download, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { getCurrentPeriod } from "@/lib/utils/dates";
import type { StatementSection, LineItem } from "@/components/financial-statements/types";
import {
  exportMonthlySummaryPdf,
  type CellValues,
  type SummaryRow,
  type SummarySection,
} from "./monthly-summary-pdf";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

// ── KPI endpoint response shape ──
interface KpiTriple {
  month: number;
  ytd: number;
  pyMonth: number;
  pyYtd: number;
}
interface KpiSegment {
  util: KpiTriple;
  rate: KpiTriple;
  onRent: KpiTriple;
  fleet: { month: number; pyMonth: number };
}
interface KpiResponse {
  segments: { vehicle: KpiSegment; trailer: KpiSegment; total: KpiSegment };
}

export default function MonthlySummaryPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [checked, setChecked] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [includeService, setIncludeService] = useState(false);

  // Default to the most recently completed month.
  const [{ year, month }, setPeriod] = useState(() => {
    const now = getCurrentPeriod();
    const m = now.month - 1;
    return m < 1 ? { year: now.year - 1, month: 12 } : { year: now.year, month: m };
  });

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setChecked(true);
        return;
      }
      const { data: memberships } = await supabase
        .from("organization_members")
        .select("organization_id, organizations(name)")
        .eq("user_id", user.id)
        .limit(1);
      if (memberships && memberships[0]) {
        setOrganizationId(memberships[0].organization_id);
        const orgRel = (memberships[0] as { organizations?: { name?: string } | { name?: string }[] })
          .organizations;
        const name = Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name;
        setOrgName(name ?? "Organization");
      }
      setChecked(true);
    })();
  }, []);

  const yearOptions = useMemo(() => {
    const now = getCurrentPeriod();
    return [now.year, now.year - 1, now.year - 2];
  }, []);

  async function handleGenerate() {
    if (!organizationId) return;
    setGenerating(true);
    try {
      const mKey = monthKey(year, month);
      const ytdKey = month > 1 ? "TOTAL" : mKey;

      const finUrl =
        `/api/financial-statements?scope=organization&organizationId=${organizationId}` +
        `&startYear=${year}&startMonth=1&endYear=${year}&endMonth=${month}` +
        `&granularity=monthly&includeTotal=true&includeYoY=true&includeBudget=true` +
        `&includeProForma=true&includeAllocations=true`;
      const kpiUrl =
        `/api/rental-assets/monthly-summary?organization_id=${organizationId}` +
        `&year=${year}&month=${month}&include_service=${includeService}`;

      const [finRes, kpiRes] = await Promise.all([fetch(finUrl), fetch(kpiUrl)]);
      if (!finRes.ok) {
        throw new Error(`Financial statements failed: ${(await finRes.json()).error ?? finRes.status}`);
      }
      if (!kpiRes.ok) {
        throw new Error(`Fleet KPIs failed: ${(await kpiRes.json()).error ?? kpiRes.status}`);
      }
      const fin = await finRes.json();
      const kpi: KpiResponse = await kpiRes.json();

      // ── P&L extraction ──
      const sections = (fin.incomeStatement?.sections ?? []) as StatementSection[];
      const byId = new Map(sections.map((s) => [s.id, s]));
      const lineOf = (id: string): LineItem | undefined => byId.get(id)?.subtotalLine;

      // Pull a Month/YTD CellValues set off an income-statement subtotal line.
      // `pctRatio` converts margin ratios (0.823) into percent units (82.3).
      function moneyVals(id: string): { month: CellValues; ytd: CellValues } {
        const l = lineOf(id);
        const pick = (key: string): CellValues => ({
          actual: l?.amounts?.[key] ?? null,
          py: l?.priorYearAmounts?.[key] ?? null,
          budget: l?.budgetAmounts?.[key] ?? null,
        });
        return { month: pick(mKey), ytd: pick(ytdKey) };
      }
      function pctVals(id: string): { month: CellValues; ytd: CellValues } {
        const l = lineOf(id);
        const x100 = (n: number | null | undefined) =>
          n == null ? null : n * 100;
        const pick = (key: string): CellValues => ({
          actual: x100(l?.amounts?.[key]),
          py: x100(l?.priorYearAmounts?.[key]),
          budget: x100(l?.budgetAmounts?.[key]),
        });
        return { month: pick(mKey), ytd: pick(ytdKey) };
      }

      // Combine the two operating-cost sections (direct + fixed) into a single
      // "Total Operating Costs" line, cell by cell across actual/PY/budget.
      function combineVals(
        a: { month: CellValues; ytd: CellValues },
        b: { month: CellValues; ytd: CellValues }
      ): { month: CellValues; ytd: CellValues } {
        const add = (x: number | null, y: number | null) =>
          x == null && y == null ? null : (x ?? 0) + (y ?? 0);
        const cv = (p: CellValues, q: CellValues): CellValues => ({
          actual: add(p.actual, q.actual),
          py: add(p.py, q.py),
          budget: add(p.budget, q.budget),
        });
        return { month: cv(a.month, b.month), ytd: cv(a.ytd, b.ytd) };
      }
      const totalOperatingCosts = combineVals(
        moneyVals("direct_operating_costs"),
        moneyVals("other_operating_costs")
      );

      const mkRow = (
        label: string,
        kind: SummaryRow["kind"],
        vals: { month: CellValues; ytd: CellValues },
        opts: Partial<SummaryRow> = {}
      ): SummaryRow => ({ label, kind, ...vals, ...opts });

      const performance: SummarySection = {
        title: "Month Performance",
        showBudget: true,
        rows: [
          mkRow("Total Revenue", "money", moneyVals("revenue")),
          mkRow("Total Operating Costs", "money", totalOperatingCosts, { invert: true }),
          { label: "", kind: "money", spacer: true, month: emptyVals(), ytd: emptyVals() },
          mkRow("EBITDA", "money", moneyVals("operating_margin"), { bold: true }),
          mkRow("EBITDA %", "pct", pctVals("operating_margin_pct"), { sub: true }),
        ],
      };

      // ── KPI sections ──
      const seg = kpi.segments;
      const utilRow = (label: string, s: KpiSegment): SummaryRow =>
        mkRow(label, "pct", {
          month: { actual: s.util.month, py: s.util.pyMonth, budget: null },
          ytd: { actual: s.util.ytd, py: s.util.pyYtd, budget: null },
        });
      const rateRow = (label: string, s: KpiSegment): SummaryRow =>
        mkRow(label, "rate", {
          month: { actual: s.rate.month, py: s.rate.pyMonth, budget: null },
          ytd: { actual: s.rate.ytd, py: s.rate.pyYtd, budget: null },
        });
      const fleetRow = (label: string, s: KpiSegment): SummaryRow =>
        mkRow(label, "count", {
          month: { actual: s.fleet.month, py: s.fleet.pyMonth, budget: null },
          ytd: emptyVals(),
        });
      const onRentRow = (label: string, s: KpiSegment): SummaryRow =>
        mkRow(label, "avg", {
          month: { actual: s.onRent.month, py: s.onRent.pyMonth, budget: null },
          ytd: { actual: s.onRent.ytd, py: s.onRent.pyYtd, budget: null },
        });

      const utilization: SummarySection = {
        title: "Month Utilization",
        showBudget: false,
        rows: [
          utilRow("Total Vehicle", seg.vehicle),
          utilRow("Total Trailer", seg.trailer),
          fleetUtilTotal(seg.total),
        ],
      };
      const avgOnRent: SummarySection = {
        title: "Average Vehicles on Rent",
        showBudget: false,
        rows: [
          onRentRow("Total Vehicle", seg.vehicle),
          onRentRow("Total Trailer", seg.trailer),
          { ...onRentRow("Total", seg.total), bold: true },
        ],
      };
      const rates: SummarySection = {
        title: "Month Rates",
        showBudget: false,
        rows: [
          rateRow("Total Vehicle", seg.vehicle),
          rateRow("Total Trailer", seg.trailer),
          rateRow("Total", seg.total),
        ],
      };
      const fleet: SummarySection = {
        title: "End of Month Fleet Size",
        showBudget: false,
        rows: [
          fleetRow("Total Vehicle", seg.vehicle),
          fleetRow("Total Trailer", seg.trailer),
          fleetRow("Total", seg.total),
        ],
      };

      await exportMonthlySummaryPdf({
        organizationName: orgName,
        monthLabel: `${MONTH_NAMES[month]} ${year}`,
        monthShort: `${MONTH_SHORT[month]}-${String(year).slice(2)}`,
        pyShort: `${MONTH_SHORT[month]}-${String(year - 1).slice(2)}`,
        ytdShort: `YTD-${String(year).slice(2)}`,
        ytdPyShort: `YTD-${String(year - 1).slice(2)}`,
        generatedAtIso: new Date().toISOString(),
        scopeNote: "Consolidated",
        sections: [performance, utilization, avgOnRent, rates, fleet],
      });
      toast.success("Monthly summary PDF generated");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to generate summary");
    } finally {
      setGenerating(false);
    }
  }

  if (!checked) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!organizationId) {
    return (
      <div className="p-6 text-muted-foreground">
        No organization membership found.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monthly Summary</h1>
        <p className="text-sm text-muted-foreground">
          One-page performance summary (P&amp;L, utilization, rates, fleet) for the
          financial package.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Generate Summary PDF
          </CardTitle>
          <CardDescription>
            Consolidated across all entities. Month Performance includes vs-Budget
            and vs-Prior-Year; utilization, rates, and fleet show vs-Prior-Year.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>Month</Label>
              <Select
                value={String(month)}
                onValueChange={(v) => setPeriod((p) => ({ ...p, month: Number(v) }))}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {MONTH_NAMES[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Select
                value={String(year)}
                onValueChange={(v) => setPeriod((p) => ({ ...p, year: Number(v) }))}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch
                id="svc"
                checked={includeService}
                onCheckedChange={setIncludeService}
              />
              <Label htmlFor="svc" className="text-sm font-normal">
                Include service vehicles
              </Label>
            </div>
          </div>

          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" /> Generate PDF
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function emptyVals(): CellValues {
  return { actual: null, py: null, budget: null };
}

// The blended "Total Fleet Util %" row uses the total segment's utilization.
function fleetUtilTotal(s: KpiSegment): SummaryRow {
  return {
    label: "Total Fleet Util %",
    kind: "pct",
    bold: true,
    month: { actual: s.util.month, py: s.util.pyMonth, budget: null },
    ytd: { actual: s.util.ytd, py: s.util.pyYtd, budget: null },
  };
}

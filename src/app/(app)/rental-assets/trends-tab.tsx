"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Legend,
  Tooltip as RechartsTooltip,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, ChevronDown, AlertCircle, Download } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DrillDownSheet, type DrillParams } from "./drill-down-sheet";

// ──────────── types ────────────

interface PeriodPoint {
  period: string; // "YYYY-MM" | "YYYY-QN" | "YYYY"
  label: string; // pretty-printed bucket label
  total: {
    revenue: number;
    rentalDays: number;
    actualRentalDays: number;
    fleetDays: number;
    maintenance: number;
    acquisitionCost: number;
    utilizationPct: number;
    finUtilPct: number;
    avgDailyRate: number;
    vehicleCount: number;
  };
  byGroup: Record<
    string,
    {
      revenue: number;
      rentalDays: number;
      actualRentalDays: number;
      fleetDays: number;
      maintenance: number;
      acquisitionCost: number;
      utilizationPct: number;
      finUtilPct: number;
      avgDailyRate: number;
      vehicleCount: number;
    }
  >;
}

interface TrendsResponse {
  series: PeriodPoint[];
  groups: string[];
}

interface TrendsTabProps {
  organizationId: string;
  includeService: boolean;
  availablePeriods: { year: number; month: number }[];
  entityId?: string | null;
  entityName?: string | null;
}

// Distinct colors by group. Static so the same group keeps the same color
// across all charts on the page.
const GROUP_COLORS: Record<string, string> = {
  Car: "#3b82f6",
  "Cargo Van": "#10b981",
  "Passenger Van": "#f59e0b",
  "Box Truck": "#ef4444",
  "Studio Box Truck": "#8b5cf6",
  Stakebed: "#06b6d4",
  "Cast Trailer": "#ec4899",
  "Makeup Trailer": "#84cc16",
  Unclassified: "#94a3b8",
  // Master-type buckets
  Vehicle: "#2563eb",
  Trailer: "#ec4899",
  Other: "#94a3b8",
};
const FALLBACK_COLORS = [
  "#6366f1",
  "#14b8a6",
  "#f97316",
  "#a855f7",
  "#0ea5e9",
];
function colorFor(group: string, idx: number): string {
  return GROUP_COLORS[group] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

type Metric =
  | "utilizationPct"
  | "revenue"
  | "fleetDays"
  | "maintenance"
  | "finUtilPct"
  | "avgDailyRate"
  | "vehicleCount";
type ViewMode = "aggregate" | "by_group";
type ChartStyle = "line" | "area" | "bar";
type GroupBy = "reporting_group" | "master_type";
type Granularity = "monthly" | "quarterly" | "yearly";

// Annualization factor for period-rate metrics (Financial Utilization).
// A $ util of 2% in one month is 24% annualized; in one quarter, 8%; in
// one year, 2%.
function annualizationFactor(g: Granularity): number {
  return g === "monthly" ? 12 : g === "quarterly" ? 4 : 1;
}
// Metrics that represent a period-rate (expressed per bucket) — these get
// scaled up when presenting on an annualized basis.
const ANNUALIZABLE_METRICS: Metric[] = ["finUtilPct"];
// Metrics where summing across groups produces a meaningful total — these
// are the ones that can stack in bar/area charts. Rate metrics (util %,
// ADR) are excluded because stacking rates is nonsense.
const STACKABLE_METRICS: Metric[] = [
  "revenue",
  "fleetDays",
  "maintenance",
  "vehicleCount",
];

// Reporting-group → master-type mapping (mirrors VEHICLE_CLASSIFICATIONS)
const GROUP_TO_MASTER_TYPE: Record<string, "Vehicle" | "Trailer" | "Other"> = {
  Car: "Vehicle",
  "Cargo Van": "Vehicle",
  "Passenger Van": "Vehicle",
  "Box Truck": "Vehicle",
  "Studio Box Truck": "Vehicle",
  Stakebed: "Vehicle",
  "Cast Trailer": "Trailer",
  "Makeup Trailer": "Trailer",
};
function masterTypeFor(group: string): "Vehicle" | "Trailer" | "Other" {
  return GROUP_TO_MASTER_TYPE[group] ?? "Other";
}

const METRICS: {
  key: Metric;
  label: string;
  yFormat: (v: number) => string;
  defaultStyle: ChartStyle;
  description: string;
}[] = [
  {
    key: "utilizationPct",
    label: "DBR Utilization %",
    yFormat: (v) => `${v.toFixed(0)}%`,
    defaultStyle: "line",
    description: "Rental days ÷ fleet days, weighted across the scope.",
  },
  {
    key: "finUtilPct",
    label: "Financial Utilization %",
    yFormat: (v) => `${v.toFixed(1)}%`,
    defaultStyle: "line",
    description:
      "Total revenue ÷ fleet acquisition cost. Measures how much of the fleet's purchase investment was earned back during the period. Only matched assets count — orphans have no acquisition cost in closebook.",
  },
  {
    key: "revenue",
    label: "Total Revenue",
    yFormat: (v) => formatCompact(v),
    defaultStyle: "bar",
    description: "Monthly rental revenue.",
  },
  {
    key: "fleetDays",
    label: "Fleet Days",
    yFormat: (v) => v.toLocaleString(),
    defaultStyle: "area",
    description: "Total fleet-days in service during the period.",
  },
  {
    key: "maintenance",
    label: "Maintenance Spend",
    yFormat: (v) => formatCompact(v),
    defaultStyle: "bar",
    description: "Service entries + work orders completed in the month.",
  },
  {
    key: "avgDailyRate",
    label: "Average Daily Rate",
    yFormat: (v) => formatCurrencyPrecise(v),
    defaultStyle: "line",
    description:
      "Total revenue ÷ actual rental days (column K). The effective daily rate realized across rented days in the period.",
  },
  {
    key: "vehicleCount",
    label: "Vehicle Count",
    yFormat: (v) => Math.round(v).toLocaleString(),
    defaultStyle: "bar",
    description:
      "Distinct vehicles that appeared in the fleet (fleet_days > 0) during the period. Matched assets + orphans, de-duplicated across months when viewing quarterly/yearly.",
  },
];

function formatCompact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${Math.round(v)}`;
}

// Full precision for a daily rate — never "compact" since daily numbers
// like $127.50 are typically under $1k but meaningful to the cent.
function formatCurrencyPrecise(v: number): string {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ──────────── component ────────────

export function TrendsTab({
  organizationId,
  includeService,
  availablePeriods,
  entityId = null,
  entityName = null,
}: TrendsTabProps) {
  const [drillParams, setDrillParams] = useState<DrillParams | null>(null);

  function openDrill(period: string, label: string, group: string | null) {
    setDrillParams({
      organizationId,
      period,
      periodLabel: label,
      group,
      groupBy,
      includeService,
      entityId,
      entityName,
    });
  }
  // Date range — default to last 24 months (or full history if less).
  const [rangePreset, setRangePreset] = useState<
    "12m" | "24m" | "60m" | "ytd" | "all" | "custom"
  >("24m");
  const [customStart, setCustomStart] = useState<{
    year: number;
    month: number;
  } | null>(null);
  const [customEnd, setCustomEnd] = useState<{
    year: number;
    month: number;
  } | null>(null);

  const [metric, setMetric] = useState<Metric>("utilizationPct");
  const [secondaryMetric, setSecondaryMetric] = useState<Metric | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("by_group");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("line");
  const [secondaryStyle, setSecondaryStyle] = useState<ChartStyle>("line");
  const [secondaryStyleOverridden, setSecondaryStyleOverridden] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("reporting_group");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  // Whether to stack per-group bars/areas when stacking is meaningful.
  // Only applies to additive metrics (revenue, fleet days, maintenance,
  // vehicle count) — rate metrics never stack.
  const [stacked, setStacked] = useState(true);
  // Year-over-year comparison mode
  const [yoyMode, setYoyMode] = useState(false);
  const [yoySlotType, setYoySlotType] = useState<"month" | "quarter">(
    "quarter"
  );
  const [yoySlotValue, setYoySlotValue] = useState<number>(1); // 1..12 for month, 1..4 for quarter

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TrendsResponse | null>(null);

  // Resolve each metric's default chart style when it changes (unless the
  // user has explicitly overridden that style).
  const [styleOverridden, setStyleOverridden] = useState(false);
  useEffect(() => {
    if (!styleOverridden) {
      const m = METRICS.find((x) => x.key === metric);
      if (m) setChartStyle(m.defaultStyle);
    }
  }, [metric, styleOverridden]);
  useEffect(() => {
    if (secondaryMetric && !secondaryStyleOverridden) {
      const m = METRICS.find((x) => x.key === secondaryMetric);
      if (m) setSecondaryStyle(m.defaultStyle);
    }
  }, [secondaryMetric, secondaryStyleOverridden]);

  // In YoY mode we force the fetched granularity to match the slot type
  // (month → monthly, quarter → quarterly) and always pull the full history
  // so every year is represented.
  const effectiveGranularity: Granularity = yoyMode
    ? yoySlotType === "month"
      ? "monthly"
      : "quarterly"
    : granularity;

  // Resolve the date range to (start, end).
  const { startYear, startMonth, endYear, endMonth } = useMemo(() => {
    if (availablePeriods.length === 0) {
      return {
        startYear: undefined,
        startMonth: undefined,
        endYear: undefined,
        endMonth: undefined,
      };
    }
    const latest = availablePeriods[0];
    const earliest = availablePeriods[availablePeriods.length - 1];

    // YoY mode always pulls full history so every year shows on the x-axis.
    if (yoyMode) {
      return {
        startYear: earliest.year,
        startMonth: earliest.month,
        endYear: latest.year,
        endMonth: latest.month,
      };
    }

    if (rangePreset === "custom") {
      const s = customStart ?? earliest;
      const e = customEnd ?? latest;
      return {
        startYear: s.year,
        startMonth: s.month,
        endYear: e.year,
        endMonth: e.month,
      };
    }
    if (rangePreset === "all") {
      return {
        startYear: earliest.year,
        startMonth: earliest.month,
        endYear: latest.year,
        endMonth: latest.month,
      };
    }
    if (rangePreset === "ytd") {
      return {
        startYear: latest.year,
        startMonth: 1,
        endYear: latest.year,
        endMonth: latest.month,
      };
    }
    const months = rangePreset === "12m" ? 11 : rangePreset === "24m" ? 23 : 59;
    const d = new Date(Date.UTC(latest.year, latest.month - 1 - months, 1));
    const sy = Math.max(d.getUTCFullYear(), earliest.year);
    const sm =
      sy === earliest.year && d.getUTCMonth() + 1 < earliest.month
        ? earliest.month
        : d.getUTCMonth() + 1;
    return {
      startYear: sy,
      startMonth: sm,
      endYear: latest.year,
      endMonth: latest.month,
    };
  }, [rangePreset, customStart, customEnd, availablePeriods, yoyMode]);

  // Fetch trends
  useEffect(() => {
    if (!startYear) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      organization_id: organizationId,
      start_year: String(startYear),
      start_month: String(startMonth),
      end_year: String(endYear),
      end_month: String(endMonth),
      include_service: String(includeService),
      granularity: effectiveGranularity,
    });
    fetch(`/api/rental-assets/trends?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        const j = (await r.json()) as TrendsResponse;
        setData(j);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(String(e.message ?? e));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [
    organizationId,
    startYear,
    startMonth,
    endYear,
    endMonth,
    includeService,
    effectiveGranularity,
  ]);

  const rawSeries = useMemo(() => data?.series ?? [], [data]);
  const rawGroups = useMemo(() => data?.groups ?? [], [data]);

  // When groupBy = "master_type", collapse reporting groups into Vehicle /
  // Trailer / Other buckets. Weighted metrics (utilization, revUtil) use
  // fleetDays/standardRate as the weight so the rollup stays correct.
  const { series, allGroups } = useMemo(() => {
    if (groupBy === "reporting_group") {
      return { series: rawSeries, allGroups: rawGroups };
    }
    const collapsedGroups = new Set<string>();
    const collapsed: PeriodPoint[] = rawSeries.map((p) => {
      const byGroup: PeriodPoint["byGroup"] = {};
      const accum: Record<
        string,
        {
          revenue: number;
          rentalDays: number;
          actualRentalDays: number;
          fleetDays: number;
          maintenance: number;
          acquisitionCost: number;
          vehicleCount: number;
        }
      > = {};
      for (const [g, v] of Object.entries(p.byGroup)) {
        const m = masterTypeFor(g);
        collapsedGroups.add(m);
        if (!accum[m])
          accum[m] = {
            revenue: 0,
            rentalDays: 0,
            actualRentalDays: 0,
            fleetDays: 0,
            maintenance: 0,
            acquisitionCost: 0,
            vehicleCount: 0,
          };
        accum[m].revenue += v.revenue;
        accum[m].rentalDays += v.rentalDays;
        accum[m].actualRentalDays += v.actualRentalDays ?? 0;
        accum[m].fleetDays += v.fleetDays;
        accum[m].maintenance += v.maintenance;
        accum[m].acquisitionCost += v.acquisitionCost ?? 0;
        // Reporting groups are disjoint at the vehicle level — a vehicle
        // can only be in one reporting group at a time — so summing the
        // per-group vehicle counts gives the correct master-type count.
        accum[m].vehicleCount += v.vehicleCount ?? 0;
      }
      for (const [m, a] of Object.entries(accum)) {
        byGroup[m] = {
          revenue: a.revenue,
          rentalDays: a.rentalDays,
          actualRentalDays: a.actualRentalDays,
          fleetDays: a.fleetDays,
          maintenance: a.maintenance,
          acquisitionCost: a.acquisitionCost,
          utilizationPct:
            a.fleetDays > 0 ? (a.rentalDays / a.fleetDays) * 100 : 0,
          finUtilPct:
            a.acquisitionCost > 0
              ? (a.revenue / a.acquisitionCost) * 100
              : 0,
          avgDailyRate:
            a.actualRentalDays > 0 ? a.revenue / a.actualRentalDays : 0,
          vehicleCount: a.vehicleCount,
        };
      }
      return { ...p, byGroup };
    });
    // Preferred order: Vehicle, Trailer, Other
    const ordered = ["Vehicle", "Trailer", "Other"].filter((x) =>
      collapsedGroups.has(x)
    );
    return { series: collapsed, allGroups: ordered };
  }, [rawSeries, rawGroups, groupBy]);

  const currentMetricBase = METRICS.find((m) => m.key === metric)!;
  const secondaryMetricBase = secondaryMetric
    ? METRICS.find((m) => m.key === secondaryMetric) ?? null
    : null;

  // When showing a period-rate metric on monthly/quarterly bucket, label it
  // "(annualized)" so the number is unambiguous.
  const annualFactor = annualizationFactor(granularity);
  const isAnnualized = (m: Metric) =>
    annualFactor !== 1 && ANNUALIZABLE_METRICS.includes(m);
  const currentMetric = {
    ...currentMetricBase,
    label: isAnnualized(metric)
      ? `${currentMetricBase.label} (annualized)`
      : currentMetricBase.label,
    description: isAnnualized(metric)
      ? `${currentMetricBase.description} Shown as annualized rate — the ${granularity === "monthly" ? "monthly" : "quarterly"} value × ${annualFactor}.`
      : currentMetricBase.description,
  };
  const secondaryMetricDef =
    secondaryMetricBase && secondaryMetric
      ? {
          ...secondaryMetricBase,
          label: isAnnualized(secondaryMetric)
            ? `${secondaryMetricBase.label} (annualized)`
            : secondaryMetricBase.label,
        }
      : null;

  // Apply the annualization factor to any series value tied to a period-
  // rate metric. Works on the already-group-rolled `series` so every
  // downstream consumer (main chart, small multiples, tooltip, CSV) sees
  // consistent numbers.
  function scale(value: number, m: Metric) {
    return ANNUALIZABLE_METRICS.includes(m) ? value * annualFactor : value;
  }

  // Keep selectedGroups in sync with whichever groups are currently available.
  useEffect(() => {
    setSelectedGroups((prev) => {
      if (allGroups.length === 0) return new Set();
      // Keep any previously-selected groups that still exist; if nothing
      // overlaps (e.g. after switching groupBy), pre-select everything.
      const next = new Set<string>();
      for (const g of allGroups) if (prev.has(g)) next.add(g);
      if (next.size === 0) for (const g of allGroups) next.add(g);
      return next;
    });
  }, [allGroups]);

  // Flatten series → Recharts-friendly rows. Both primary and secondary
  // metric values are included under prefixed keys when secondary is active.
  const chartData = useMemo(() => {
    // In YoY mode: filter series to the selected slot (e.g. only "*-03" for
    // March, only "*-Q2" for Q2), and relabel the x-axis to the year alone.
    let visible = series;
    if (yoyMode) {
      visible = series.filter((p) => {
        if (yoySlotType === "month") {
          const m = /-(\d{2})$/.exec(p.period);
          return m && Number(m[1]) === yoySlotValue;
        }
        const q = /-Q([1-4])$/.exec(p.period);
        return q && Number(q[1]) === yoySlotValue;
      });
    }
    return visible.map((p) => {
      const yearLabel = yoyMode
        ? /^(\d{4})/.exec(p.period)?.[1] ?? p.label
        : p.label;
      const row: Record<string, string | number> = {
        period: p.period,
        label: yearLabel,
        total: scale(p.total[metric], metric),
      };
      for (const g of allGroups) {
        row[g] = scale(p.byGroup[g]?.[metric] ?? 0, metric);
      }
      if (secondaryMetric) {
        row.__secondary__ = scale(p.total[secondaryMetric], secondaryMetric);
      }
      return row;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    series,
    metric,
    secondaryMetric,
    allGroups,
    annualFactor,
    yoyMode,
    yoySlotType,
    yoySlotValue,
  ]);

  const activeGroups = allGroups.filter((g) => selectedGroups.has(g));

  function exportCsv() {
    const cols = ["period", "total", ...allGroups];
    const rows = [cols.join(",")].concat(
      series.map((p) =>
        [
          p.period,
          scale(p.total[metric], metric),
          ...allGroups.map((g) => scale(p.byGroup[g]?.[metric] ?? 0, metric)),
        ]
          .map((v) =>
            typeof v === "string" && /[",\n]/.test(v) ? `"${v}"` : String(v)
          )
          .join(",")
      )
    );
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rental-trends-${metric}-${startYear}-${String(startMonth).padStart(2, "0")}_to_${endYear}-${String(endMonth).padStart(2, "0")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* ───── Controls ───── */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-3">
            {/* Metric */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Metric
              </span>
              <Select
                value={metric}
                onValueChange={(v) => {
                  setMetric(v as Metric);
                  setStyleOverridden(false);
                }}
              >
                <SelectTrigger className="h-8 w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Compare with (secondary metric) */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Compare
              </span>
              <Select
                value={secondaryMetric ?? "none"}
                onValueChange={(v) => {
                  setSecondaryMetric(v === "none" ? null : (v as Metric));
                  setSecondaryStyleOverridden(false);
                }}
              >
                <SelectTrigger className="h-8 w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— none —</SelectItem>
                  {METRICS.filter((m) => m.key !== metric).map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {secondaryMetric && (
                <div className="flex items-center gap-1 rounded-md border p-0.5">
                  {(["line", "area", "bar"] as ChartStyle[]).map((s) => (
                    <Button
                      key={s}
                      variant={secondaryStyle === s ? "default" : "ghost"}
                      size="sm"
                      className="h-7 px-2 text-xs capitalize"
                      onClick={() => {
                        setSecondaryStyle(s);
                        setSecondaryStyleOverridden(true);
                      }}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {/* Group-by */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Group
              </span>
              <Select
                value={groupBy}
                onValueChange={(v) => setGroupBy(v as GroupBy)}
              >
                <SelectTrigger className="h-8 w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reporting_group">
                    Reporting Group
                  </SelectItem>
                  <SelectItem value="master_type">Vehicle / Trailer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Granularity — hidden in YoY mode since granularity is forced
                to match the slot type */}
            {!yoyMode && (
              <div className="flex items-center gap-1 rounded-md border p-0.5">
                {(
                  [
                    ["monthly", "Monthly"],
                    ["quarterly", "Quarterly"],
                    ["yearly", "Yearly"],
                  ] as const
                ).map(([k, label]) => (
                  <Button
                    key={k}
                    variant={granularity === k ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setGranularity(k)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            )}

            {/* YoY toggle + slot picker */}
            <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
              <Button
                variant={yoyMode ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setYoyMode((v) => !v)}
                title="Compare the same period across years"
              >
                YoY
              </Button>
              {yoyMode && (
                <>
                  <Select
                    value={yoySlotType}
                    onValueChange={(v) => {
                      setYoySlotType(v as "month" | "quarter");
                      setYoySlotValue(1);
                    }}
                  >
                    <SelectTrigger className="h-7 w-[96px] border-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quarter">Quarter</SelectItem>
                      <SelectItem value="month">Month</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(yoySlotValue)}
                    onValueChange={(v) => setYoySlotValue(Number(v))}
                  >
                    <SelectTrigger className="h-7 w-[108px] border-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {yoySlotType === "quarter"
                        ? [1, 2, 3, 4].map((q) => (
                            <SelectItem key={q} value={String(q)}>
                              Q{q}
                            </SelectItem>
                          ))
                        : Array.from({ length: 12 }, (_, i) => i + 1).map(
                            (m) => (
                              <SelectItem key={m} value={String(m)}>
                                {MONTH_NAMES[m]}
                              </SelectItem>
                            )
                          )}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>

            {/* Date range presets — hidden in YoY mode since the chart
                always spans full history with year on the x-axis */}
            {!yoyMode && (
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              {(
                [
                  ["12m", "12M"],
                  ["24m", "24M"],
                  ["60m", "5Y"],
                  ["ytd", "YTD"],
                  ["all", "All"],
                  ["custom", "Custom"],
                ] as const
              ).map(([k, label]) => (
                <Button
                  key={k}
                  variant={rangePreset === k ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setRangePreset(k);
                    if (k !== "custom") {
                      setCustomStart(null);
                      setCustomEnd(null);
                    } else if (availablePeriods.length > 0 && !customStart) {
                      // Seed custom range with the current preset's resolved
                      // bounds so user has a sensible starting point.
                      setCustomStart({
                        year: startYear ?? availablePeriods[availablePeriods.length - 1].year,
                        month:
                          startMonth ??
                          availablePeriods[availablePeriods.length - 1].month,
                      });
                      setCustomEnd({
                        year: endYear ?? availablePeriods[0].year,
                        month: endMonth ?? availablePeriods[0].month,
                      });
                    }
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            )}

            {/* Custom range pickers — only shown when "Custom" is active */}
            {!yoyMode && rangePreset === "custom" && availablePeriods.length > 0 && (
              <div className="flex items-center gap-1 rounded-md border bg-background px-1 py-0.5">
                <MonthPicker
                  value={
                    customStart ?? availablePeriods[availablePeriods.length - 1]
                  }
                  available={availablePeriods}
                  onChange={setCustomStart}
                  label="From"
                />
                <span className="text-xs text-muted-foreground">→</span>
                <MonthPicker
                  value={customEnd ?? availablePeriods[0]}
                  available={availablePeriods}
                  onChange={setCustomEnd}
                  label="To"
                />
              </div>
            )}

            {/* View mode */}
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              <Button
                variant={viewMode === "aggregate" ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setViewMode("aggregate")}
              >
                Aggregate
              </Button>
              <Button
                variant={viewMode === "by_group" ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setViewMode("by_group")}
              >
                By Group
              </Button>
            </div>

            {/* Chart style */}
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              {(["line", "area", "bar"] as ChartStyle[]).map((s) => (
                <Button
                  key={s}
                  variant={chartStyle === s ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-xs capitalize"
                  onClick={() => {
                    setChartStyle(s);
                    setStyleOverridden(true);
                  }}
                >
                  {s}
                </Button>
              ))}
            </div>

            {/* Stack toggle — only shown when stacking is meaningful:
                additive metric + by-group view + bar/area style + no
                secondary (dual axis + stacking gets visually tangled). */}
            {STACKABLE_METRICS.includes(metric) &&
              viewMode === "by_group" &&
              (chartStyle === "bar" || chartStyle === "area") &&
              !secondaryMetric && (
                <div className="flex items-center gap-1 rounded-md border p-0.5">
                  <Button
                    variant={stacked ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setStacked(true)}
                    title="Stack groups on top of each other so the total is visible"
                  >
                    Stacked
                  </Button>
                  <Button
                    variant={!stacked ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setStacked(false)}
                    title="Show each group side-by-side"
                  >
                    Grouped
                  </Button>
                </div>
              )}

            {/* Group multi-select */}
            {viewMode === "by_group" && allGroups.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">
                    Groups
                    <Badge variant="secondary" className="ml-1.5">
                      {selectedGroups.size}/{allGroups.length}
                    </Badge>
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] p-2" align="end">
                  <div className="mb-2 flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      onClick={() => setSelectedGroups(new Set(allGroups))}
                    >
                      All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      onClick={() => setSelectedGroups(new Set())}
                    >
                      None
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {allGroups.map((g, idx) => {
                      const active = selectedGroups.has(g);
                      return (
                        <button
                          key={g}
                          onClick={() => {
                            setSelectedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(g)) next.delete(g);
                              else next.add(g);
                              return next;
                            });
                          }}
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent"
                        >
                          <span
                            className="h-3 w-3 shrink-0 rounded-sm"
                            style={{
                              backgroundColor: colorFor(g, idx),
                              opacity: active ? 1 : 0.25,
                            }}
                          />
                          <span className="flex-1 text-left">{g}</span>
                          {active && <Check className="h-3 w-3" />}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            <div className="flex-1" />

            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={exportCsv}
              disabled={series.length === 0}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              CSV
            </Button>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            {currentMetric.description}
            {yoyMode ? (
              <>
                {" · "}
                Year-over-year comparison: showing{" "}
                <strong>
                  {yoySlotType === "quarter"
                    ? `Q${yoySlotValue}`
                    : MONTH_NAMES[yoySlotValue]}
                </strong>{" "}
                across every year in history
              </>
            ) : (
              <>
                {" · "}
                Showing{" "}
                {startYear
                  ? `${MONTH_NAMES[startMonth!]} ${startYear} → ${MONTH_NAMES[endMonth!]} ${endYear}`
                  : "—"}
                {" · "}
                {series.length}{" "}
                {granularity === "monthly"
                  ? "month"
                  : granularity === "quarterly"
                    ? "quarter"
                    : "year"}
                {series.length === 1 ? "" : "s"}
              </>
            )}
          </p>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* ───── Main chart ───── */}
      <Card className="relative overflow-hidden">
        {/* Indeterminate progress bar — pinned to the top edge of the card
            while a fetch is in flight. Lets the previous chart stay visible
            underneath so the tab doesn't blank out between loads. */}
        {loading && <IndeterminateBar />}
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{currentMetric.label}</CardTitle>
              <CardDescription>{currentMetric.description}</CardDescription>
            </div>
            {loading && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                Loading…
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div
            className={`relative h-[380px] transition-opacity ${
              loading && series.length > 0 ? "opacity-60" : "opacity-100"
            }`}
          >
            {series.length === 0 && !loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No data in the selected range.
              </div>
            ) : series.length === 0 && loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading trend data…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                {renderChart({
                  data: chartData,
                  style: chartStyle,
                  viewMode,
                  activeGroups,
                  metric,
                  yFormat: currentMetric.yFormat,
                  secondaryMetric,
                  secondaryStyle,
                  secondaryYFormat: secondaryMetricDef?.yFormat,
                  secondaryLabel: secondaryMetricDef?.label,
                  stacked,
                  onDrill: openDrill,
                })}
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Drill-down sheet — opened by chart clicks */}
      <DrillDownSheet params={drillParams} onClose={() => setDrillParams(null)} />

      {/* ───── Supporting small multiples ───── */}
      {series.length > 0 && viewMode === "by_group" && (
        <Card className="relative overflow-hidden">
          {loading && <IndeterminateBar />}
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Per-group small multiples
            </CardTitle>
            <CardDescription>
              Same metric ({currentMetric.label}) on its own scale per group —
              useful for comparing trend shape rather than magnitude.
            </CardDescription>
          </CardHeader>
          <CardContent
            className={`transition-opacity ${loading ? "opacity-60" : ""}`}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {activeGroups.map((g, idx) => {
                const color = colorFor(g, idx);
                const groupData = series.map((p) => ({
                  period: p.period,
                  label: p.label,
                  value: scale(p.byGroup[g]?.[metric] ?? 0, metric),
                }));
                return (
                  <div
                    key={g}
                    className="cursor-pointer rounded-md border p-3 transition-colors hover:bg-accent/40"
                    title={`Click a point to drill into ${g} for that period`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-xs font-medium">{g}</span>
                      </div>
                    </div>
                    <div className="h-[96px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={groupData}
                          margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
                          onClick={(e: unknown) => {
                            const state = e as {
                              activeTooltipIndex?: number;
                            };
                            const idx = state?.activeTooltipIndex;
                            if (idx == null) return;
                            const row = groupData[idx];
                            if (row)
                              openDrill(
                                String(row.period),
                                String(row.label),
                                g
                              );
                          }}
                        >
                          <YAxis hide domain={["auto", "auto"]} />
                          <XAxis hide dataKey="label" />
                          <RechartsTooltip
                            cursor={false}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.[0]) return null;
                              return (
                                <div className="rounded-md border bg-background px-2 py-1 text-xs shadow-sm">
                                  <div className="font-medium">{label}</div>
                                  <div className="tabular-nums">
                                    {currentMetric.yFormat(
                                      Number(payload[0].value)
                                    )}
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke={color}
                            strokeWidth={1.5}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ──────────── chart renderer ────────────

function renderChart({
  data,
  style,
  viewMode,
  activeGroups,
  metric,
  yFormat,
  secondaryMetric,
  secondaryStyle,
  secondaryYFormat,
  secondaryLabel,
  stacked,
  onDrill,
}: {
  data: Record<string, string | number>[];
  style: ChartStyle;
  viewMode: ViewMode;
  activeGroups: string[];
  metric: Metric;
  yFormat: (v: number) => string;
  secondaryMetric: Metric | null;
  secondaryStyle: ChartStyle;
  secondaryYFormat?: (v: number) => string;
  secondaryLabel?: string;
  stacked: boolean;
  onDrill?: (period: string, label: string, group: string | null) => void;
}) {
  const hasSecondary = secondaryMetric != null;

  // Chart-level click → drill into that period for all currently-shown groups.
  // Recharts emits this with `activeLabel` (x-axis label) and `activePayload`
  // (series values at that X). We resolve period via the underlying row.
  const chartOnClick = onDrill
    ? (e: unknown) => {
        const state = e as {
          activeTooltipIndex?: number;
          activeLabel?: string;
        };
        const idx = state?.activeTooltipIndex;
        if (idx == null) return;
        const row = data[idx];
        if (!row) return;
        onDrill(
          String(row.period),
          String(row.label),
          viewMode === "by_group" && activeGroups.length === 1
            ? activeGroups[0]
            : null
        );
      }
    : undefined;

  // Per-series Bar click → drill into that group specifically.
  const barOnClick = onDrill
    ? (data: { period: string; label: string }, group: string) =>
        onDrill(data.period, data.label, group)
    : undefined;

  const commonAxis = (
    <>
      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      <XAxis
        dataKey="label"
        tick={{ fontSize: 11 }}
        interval={
          data.length > 36 ? 5 : data.length > 18 ? 2 : data.length > 12 ? 1 : 0
        }
        className="text-muted-foreground"
      />
      <YAxis
        yAxisId="left"
        tickFormatter={yFormat}
        tick={{ fontSize: 11 }}
        className="text-muted-foreground"
        width={65}
      />
      {hasSecondary && (
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={secondaryYFormat}
          tick={{ fontSize: 11 }}
          className="text-muted-foreground"
          width={65}
        />
      )}
      <RechartsTooltip
        content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const visible = payload.filter((p) => (p.value as number) !== 0);
          return (
            <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
              <div className="mb-1 font-medium">{label}</div>
              {visible.map((p) => {
                const isSecondary = p.dataKey === "__secondary__";
                const fmt = isSecondary
                  ? secondaryYFormat ?? yFormat
                  : yFormat;
                const name = isSecondary
                  ? `${secondaryLabel} (2°)`
                  : (p.dataKey as string);
                return (
                  <div
                    key={p.dataKey as string}
                    className="flex items-center gap-2 tabular-nums"
                  >
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="flex-1">{name}</span>
                    <span className="font-medium">{fmt(Number(p.value))}</span>
                  </div>
                );
              })}
            </div>
          );
        }}
      />
      <Legend
        verticalAlign="bottom"
        height={28}
        iconSize={10}
        wrapperStyle={{ fontSize: 11 }}
      />
    </>
  );

  const seriesConfig =
    viewMode === "aggregate"
      ? [{ key: "total", color: "#6366f1", name: "Total" }]
      : activeGroups.map((g, idx) => ({
          key: g,
          color: colorFor(g, idx),
          name: g,
        }));

  // Stack when the user opted in, it's by-group, there's no secondary axis
  // competing for space, and the metric is additive.
  const isStacked =
    stacked &&
    !hasSecondary &&
    viewMode === "by_group" &&
    STACKABLE_METRICS.includes(metric);

  // Helper to render a single series in any chart style. Used for both the
  // primary (per-group / aggregate) and secondary (single aggregate) lines.
  function renderSeries(
    cfg: { key: string; color: string; name: string },
    seriesStyle: ChartStyle,
    axisId: "left" | "right",
    opts?: { dashed?: boolean; stackId?: string; drillable?: boolean }
  ) {
    const dashed = opts?.dashed ?? false;
    const drillHandler =
      opts?.drillable && barOnClick
        ? (d: unknown) => {
            const row = d as { payload?: { period: string; label: string } };
            if (row.payload) barOnClick(row.payload, cfg.name);
          }
        : undefined;
    if (seriesStyle === "line") {
      return (
        <Line
          yAxisId={axisId}
          key={cfg.key}
          type="monotone"
          dataKey={cfg.key}
          stroke={cfg.color}
          strokeWidth={axisId === "right" ? 2 : 2}
          strokeDasharray={dashed ? "4 4" : undefined}
          dot={false}
          name={cfg.name}
          activeDot={
            drillHandler ? { r: 5, onClick: drillHandler } : undefined
          }
        />
      );
    }
    if (seriesStyle === "area") {
      return (
        <Area
          yAxisId={axisId}
          key={cfg.key}
          type="monotone"
          dataKey={cfg.key}
          stroke={cfg.color}
          fill={cfg.color}
          fillOpacity={0.35}
          strokeWidth={1.5}
          stackId={opts?.stackId}
          name={cfg.name}
          activeDot={
            drillHandler ? { r: 5, onClick: drillHandler } : undefined
          }
        />
      );
    }
    return (
      <Bar
        yAxisId={axisId}
        key={cfg.key}
        dataKey={cfg.key}
        fill={cfg.color}
        stroke={cfg.color}
        name={cfg.name}
        stackId={opts?.stackId}
        radius={opts?.stackId ? [0, 0, 0, 0] : [2, 2, 0, 0]}
        onClick={drillHandler}
        cursor={drillHandler ? "pointer" : undefined}
      />
    );
  }

  const secondaryConfig = hasSecondary
    ? {
        key: "__secondary__",
        color: "#0f172a",
        name: secondaryLabel ?? "Secondary",
      }
    : null;

  // When a secondary metric is active, ComposedChart lets us mix Line + Bar
  // + Area freely on the same chart with two independent Y-axes.
  if (hasSecondary) {
    return (
      <ComposedChart
        data={data}
        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        onClick={chartOnClick}
      >
        {commonAxis}
        {seriesConfig.map((s) =>
          renderSeries(s, style, "left", {
            stackId: isStacked ? "stack" : undefined,
            drillable: true,
          })
        )}
        {secondaryConfig &&
          renderSeries(secondaryConfig, secondaryStyle, "right", {
            dashed: secondaryStyle === "line",
          })}
      </ComposedChart>
    );
  }

  if (style === "line") {
    return (
      <LineChart
        data={data}
        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        onClick={chartOnClick}
      >
        {commonAxis}
        {seriesConfig.map((s) =>
          renderSeries(s, "line", "left", { drillable: true })
        )}
      </LineChart>
    );
  }
  if (style === "area") {
    return (
      <AreaChart
        data={data}
        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        onClick={chartOnClick}
      >
        {commonAxis}
        {seriesConfig.map((s) =>
          renderSeries(s, "area", "left", {
            stackId: isStacked ? "stack" : undefined,
            drillable: true,
          })
        )}
      </AreaChart>
    );
  }
  return (
    <BarChart
      data={data}
      margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
      onClick={chartOnClick}
    >
      {commonAxis}
      {seriesConfig.map((s) =>
        renderSeries(s, "bar", "left", {
          stackId: isStacked ? "stack" : undefined,
          drillable: true,
        })
      )}
    </BarChart>
  );
}

// ──────────── indeterminate progress bar ────────────
// Thin animated bar pinned to the top edge of a relatively-positioned parent.
// Uses a CSS keyframe defined inline so no Tailwind config change is required.

function IndeterminateBar() {
  return (
    <>
      <style>{`
        @keyframes trends-loading-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] overflow-hidden bg-primary/10"
      >
        <div
          className="h-full w-1/4 rounded-full bg-primary"
          style={{
            animation: "trends-loading-slide 1.2s ease-in-out infinite",
          }}
        />
      </div>
    </>
  );
}

// ──────────── month picker ────────────

function MonthPicker({
  value,
  available,
  onChange,
  label,
}: {
  value: { year: number; month: number };
  available: { year: number; month: number }[];
  onChange: (v: { year: number; month: number }) => void;
  label: string;
}) {
  const byYear = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const p of available) {
      if (!m.has(p.year)) m.set(p.year, new Set());
      m.get(p.year)!.add(p.month);
    }
    return m;
  }, [available]);
  const years = useMemo(
    () => [...byYear.keys()].sort((a, b) => b - a),
    [byYear]
  );
  const monthsForYear = byYear.get(value.year) ?? new Set<number>();

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Select
        value={String(value.year)}
        onValueChange={(v) => {
          const y = Number(v);
          const monthsSet = byYear.get(y) ?? new Set<number>();
          const target = monthsSet.has(value.month)
            ? value.month
            : Math.max(...monthsSet);
          onChange({ year: y, month: target });
        }}
      >
        <SelectTrigger className="h-7 w-[78px] border-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(value.month)}
        onValueChange={(v) => onChange({ year: value.year, month: Number(v) })}
      >
        <SelectTrigger className="h-7 w-[88px] border-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const avail = monthsForYear.has(m);
            return (
              <SelectItem key={m} value={String(m)} disabled={!avail}>
                {MONTH_NAMES[m]}
                {!avail ? " —" : ""}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

const MONTH_NAMES = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];


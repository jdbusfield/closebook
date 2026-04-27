"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  Customized,
  usePlotArea,
  useXAxisDomain,
  useYAxisDomain,
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
import {
  Check,
  ChevronDown,
  AlertCircle,
  Download,
  X,
  ArrowRight,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DrillDownSheet, type DrillParams } from "./drill-down-sheet";
import { VEHICLE_CLASSIFICATIONS } from "@/lib/utils/vehicle-classification";

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
    revenuePerActiveAsset: number;
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
      revenuePerActiveAsset: number;
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
// Palette offered in the inline color picker. Twelve distinct hues picked
// to read well on both light and dark surfaces.
const COLOR_PALETTE = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#a855f7",
  "#14b8a6",
  "#64748b",
];
function colorFor(
  group: string,
  idx: number,
  overrides: Record<string, string> = {}
): string {
  return (
    overrides[group] ??
    GROUP_COLORS[group] ??
    FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
  );
}

type Metric =
  | "utilizationPct"
  | "revenue"
  | "fleetDays"
  | "maintenance"
  | "finUtilPct"
  | "avgDailyRate"
  | "vehicleCount"
  | "revenuePerActiveAsset";
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
    yFormat: (v) => `${v.toFixed(1)}%`,
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
  {
    key: "revenuePerActiveAsset",
    label: "Revenue per Active Asset",
    yFormat: (v) => formatCompact(v),
    defaultStyle: "bar",
    description:
      "Total revenue ÷ distinct active vehicles in the period. Measures average per-vehicle earning power across the bucket — rising means each active asset is pulling more weight.",
  },
];

function formatCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  // Keep full precision under $10k so a $7,562 value doesn't render as "$7k".
  if (abs < 10_000) {
    return v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return `$${(v / 1_000).toFixed(0)}k`;
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

  // ── Point-to-point compare mode ──
  // When on, chart clicks capture data points instead of opening the
  // drill-down sheet. Two captured points render a graphic showing the
  // absolute and relative change between them.
  type ComparePoint = {
    period: string;
    label: string;
    group: string | null;
  };
  const [compareMode, setCompareMode] = useState(false);
  const [comparePoints, setComparePoints] = useState<ComparePoint[]>([]);
  // Which series to compare. `null` = total across visible groups;
  // otherwise the name of a specific reporting group.
  const [compareSeries, setCompareSeries] = useState<string | null>(null);

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
      classes:
        selectedClasses && selectedClasses.size > 0
          ? [...selectedClasses]
          : null,
    });
  }

  // Recharts fires both Bar.onClick AND BarChart.onClick for the same
  // physical click, so our handler is invoked twice with the same period.
  // We dedupe by tracking the last (period, timestamp) pair — anything
  // within this burst window is treated as a single click.
  const lastClickRef = useRef<{ period: string; ts: number } | null>(null);
  const CLICK_BURST_MS = 350;

  // Click handler: in compare mode we capture the point; otherwise we
  // open the drill-down. Drops the oldest point when a third click lands.
  function handlePointClick(
    period: string,
    label: string,
    group: string | null
  ) {
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.period === period && now - last.ts < CLICK_BURST_MS) {
      // Same click, second fire — ignore.
      return;
    }
    lastClickRef.current = { period, ts: now };

    if (!compareMode) {
      openDrill(period, label, group);
      return;
    }
    setComparePoints((prev) => {
      // If the same period is clicked twice (with a real gap between
      // clicks), treat the second as a de-select so the user can correct
      // a misclick without hitting Clear.
      if (prev.some((p) => p.period === period)) {
        return prev.filter((p) => p.period !== period);
      }
      const next = [...prev, { period, label, group }];
      // Keep the two most recent clicks — order matters (first = "from",
      // second = "to") so the % change reads the way the user expects.
      return next.length > 2 ? next.slice(-2) : next;
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
  // Class-level filter. `null` = no filter (all classes allowed). A non-null
  // Set restricts the chart to only those vehicle classes.
  const [selectedClasses, setSelectedClasses] = useState<Set<string> | null>(
    null
  );
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

  // Per-group color overrides. Persists in localStorage so the operator's
  // customized palette sticks across sessions (fallback colors can be
  // indistinguishable when several random hues land close to each other).
  const COLOR_LS_KEY = "rental-assets-trends-color-overrides";
  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>(
    () => {
      if (typeof window === "undefined") return {};
      try {
        const raw = window.localStorage.getItem(COLOR_LS_KEY);
        return raw ? (JSON.parse(raw) as Record<string, string>) : {};
      } catch {
        return {};
      }
    }
  );
  useEffect(() => {
    try {
      window.localStorage.setItem(
        COLOR_LS_KEY,
        JSON.stringify(colorOverrides)
      );
    } catch {
      // Quota/privacy mode — the UI still works without persistence.
    }
  }, [colorOverrides]);

  // Chart shape changes (metric, grouping, YoY, granularity) invalidate the
  // captured compare points — drop them so the compare card doesn't reference
  // a period that no longer exists on the x-axis.
  useEffect(() => {
    setComparePoints([]);
  }, [metric, groupBy, yoyMode, yoySlotType, yoySlotValue, granularity]);

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
    if (selectedClasses && selectedClasses.size > 0) {
      params.set("classes", [...selectedClasses].join(","));
    }
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
    selectedClasses,
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
          revenuePerActiveAsset:
            a.vehicleCount > 0 ? a.revenue / a.vehicleCount : 0,
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

  // Which series the compare delta reads from. Preference:
  //   1. Explicit user pick (compareSeries), if still valid
  //   2. If both picked points share a group, use that group
  //   3. If viewing a single group, use it
  //   4. Fall back to "total"
  const effectiveCompareSeries = useMemo(() => {
    if (
      compareSeries &&
      (compareSeries === "total" || activeGroups.includes(compareSeries))
    ) {
      return compareSeries;
    }
    const gs = comparePoints.map((p) => p.group).filter(Boolean) as string[];
    if (gs.length >= 2 && gs[0] === gs[1]) return gs[0];
    if (viewMode === "by_group" && activeGroups.length === 1) {
      return activeGroups[0];
    }
    return "total";
  }, [compareSeries, activeGroups, viewMode, comparePoints]);

  // Resolve the two clicked periods to {label, value} pairs on the active
  // series so both the in-chart overlay and the top strip pull from one
  // source of truth. Points are sorted chronologically by `period` — the
  // earlier bucket is always `a` ("from") and the later one is `b` ("to"),
  // so the % change reads as "earlier → later" regardless of click order.
  const compareValues = useMemo(() => {
    if (!compareMode || comparePoints.length !== 2) return null;
    const key = effectiveCompareSeries;
    const [p0, p1] = [...comparePoints].sort((x, y) =>
      x.period.localeCompare(y.period)
    );
    const rowA = chartData.find((r) => r.period === p0.period);
    const rowB = chartData.find((r) => r.period === p1.period);
    if (!rowA || !rowB) return null;
    const vA = rowA[key];
    const vB = rowB[key];
    if (typeof vA !== "number" || typeof vB !== "number") return null;
    return {
      a: { label: p0.label, value: vA },
      b: { label: p1.label, value: vB },
    };
  }, [compareMode, comparePoints, effectiveCompareSeries, chartData]);

  // Classes eligible for the Classes selector. Always show every class in
  // the catalog regardless of which groups are active — operators compare
  // across groups (e.g. "2-room cast trailers vs class 24 trucks") and
  // hiding out-of-group classes blocks that workflow. Picking a class
  // whose reporting group isn't currently shown auto-enables that group
  // so the bars land on the chart. Excludes the "ADJ"
  // accounting-adjustment sentinel since it's not a real vehicle class.
  const availableClasses = useMemo(() => {
    return Object.values(VEHICLE_CLASSIFICATIONS)
      .filter((c) => c.class !== "ADJ")
      .sort((a, b) => {
        const ra = a.reportingGroup || "~";
        const rb = b.reportingGroup || "~";
        if (ra !== rb) return ra.localeCompare(rb);
        return a.class.localeCompare(b.class, undefined, { numeric: true });
      });
  }, []);

  // Index class → reportingGroup so the class picker can auto-add the
  // right group(s) to selectedGroups when a class is toggled on.
  const groupForClass = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of availableClasses) {
      if (c.reportingGroup) m.set(c.class, c.reportingGroup);
    }
    return m;
  }, [availableClasses]);

  // When the set of available classes changes (e.g. user narrowed the
  // groups filter), drop any previously-selected classes that are no
  // longer valid. If nothing remains selected, reset to "all" (null).
  useEffect(() => {
    if (!selectedClasses) return;
    const availableSet = new Set(availableClasses.map((c) => c.class));
    let changed = false;
    const next = new Set<string>();
    for (const c of selectedClasses) {
      if (availableSet.has(c)) next.add(c);
      else changed = true;
    }
    if (!changed) return;
    setSelectedClasses(next.size === 0 ? null : next);
  }, [availableClasses, selectedClasses]);

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
        <CardContent className="py-5 space-y-4">
          {/* ── Metric row — what is being measured ── */}
          <ControlRow label="Metric">
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

            <div className="flex items-center gap-1.5 pl-1 border-l ml-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
                <SegmentedGroup>
                  {(["line", "area", "bar"] as ChartStyle[]).map((s) => (
                    <SegmentedButton
                      key={s}
                      active={secondaryStyle === s}
                      onClick={() => {
                        setSecondaryStyle(s);
                        setSecondaryStyleOverridden(true);
                      }}
                    >
                      <span className="capitalize">{s}</span>
                    </SegmentedButton>
                  ))}
                </SegmentedGroup>
              )}
            </div>
          </ControlRow>

          {/* ── Time row — YoY + granularity + date range ── */}
          <ControlRow label="Time">
            <SegmentedGroup>
              <SegmentedButton
                active={yoyMode}
                onClick={() => setYoyMode((v) => !v)}
                title="Compare the same period across years"
              >
                YoY
              </SegmentedButton>
              {yoyMode && (
                <div className="flex items-center gap-1 pl-1 ml-1 border-l">
                  <Select
                    value={yoySlotType}
                    onValueChange={(v) => {
                      setYoySlotType(v as "month" | "quarter");
                      setYoySlotValue(1);
                    }}
                  >
                    <SelectTrigger className="h-7 w-[96px] border-0 text-xs shadow-none">
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
                    <SelectTrigger className="h-7 w-[108px] border-0 text-xs shadow-none">
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
                </div>
              )}
            </SegmentedGroup>

            {!yoyMode && (
              <>
                <SegmentedGroup>
                  {(
                    [
                      ["monthly", "Monthly"],
                      ["quarterly", "Quarterly"],
                      ["yearly", "Yearly"],
                    ] as const
                  ).map(([k, label]) => (
                    <SegmentedButton
                      key={k}
                      active={granularity === k}
                      onClick={() => setGranularity(k)}
                    >
                      {label}
                    </SegmentedButton>
                  ))}
                </SegmentedGroup>

                <SegmentedGroup>
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
                    <SegmentedButton
                      key={k}
                      active={rangePreset === k}
                      onClick={() => {
                        setRangePreset(k);
                        if (k !== "custom") {
                          setCustomStart(null);
                          setCustomEnd(null);
                        } else if (
                          availablePeriods.length > 0 &&
                          !customStart
                        ) {
                          setCustomStart({
                            year:
                              startYear ??
                              availablePeriods[availablePeriods.length - 1]
                                .year,
                            month:
                              startMonth ??
                              availablePeriods[availablePeriods.length - 1]
                                .month,
                          });
                          setCustomEnd({
                            year: endYear ?? availablePeriods[0].year,
                            month: endMonth ?? availablePeriods[0].month,
                          });
                        }
                      }}
                    >
                      {label}
                    </SegmentedButton>
                  ))}
                </SegmentedGroup>

                {rangePreset === "custom" && availablePeriods.length > 0 && (
                  <div className="flex items-center gap-1 rounded-md border bg-background px-1 py-0.5">
                    <MonthPicker
                      value={
                        customStart ??
                        availablePeriods[availablePeriods.length - 1]
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
              </>
            )}
          </ControlRow>

          {/* ── Display row — view + style + stacking + grouping + export ── */}
          <ControlRow label="Display">
            <SegmentedGroup>
              <SegmentedButton
                active={viewMode === "aggregate"}
                onClick={() => setViewMode("aggregate")}
              >
                Aggregate
              </SegmentedButton>
              <SegmentedButton
                active={viewMode === "by_group"}
                onClick={() => setViewMode("by_group")}
              >
                By Group
              </SegmentedButton>
            </SegmentedGroup>

            <SegmentedGroup>
              {(["line", "area", "bar"] as ChartStyle[]).map((s) => (
                <SegmentedButton
                  key={s}
                  active={chartStyle === s}
                  onClick={() => {
                    setChartStyle(s);
                    setStyleOverridden(true);
                  }}
                >
                  <span className="capitalize">{s}</span>
                </SegmentedButton>
              ))}
            </SegmentedGroup>

            {STACKABLE_METRICS.includes(metric) &&
              viewMode === "by_group" &&
              (chartStyle === "bar" || chartStyle === "area") &&
              !secondaryMetric && (
                <SegmentedGroup>
                  <SegmentedButton
                    active={stacked}
                    onClick={() => setStacked(true)}
                    title="Stack groups on top of each other so the total is visible"
                  >
                    Stacked
                  </SegmentedButton>
                  <SegmentedButton
                    active={!stacked}
                    onClick={() => setStacked(false)}
                    title="Show each group side-by-side"
                  >
                    Grouped
                  </SegmentedButton>
                </SegmentedGroup>
              )}

            {viewMode === "by_group" && (
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
            )}

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
                  {Object.keys(colorOverrides).length > 0 && (
                    <button
                      onClick={() => setColorOverrides({})}
                      className="mb-2 w-full rounded-sm px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
                    >
                      Reset all custom colors
                    </button>
                  )}
                  <div className="space-y-1">
                    {allGroups.map((g, idx) => {
                      const active = selectedGroups.has(g);
                      const color = colorFor(g, idx, colorOverrides);
                      return (
                        <div
                          key={g}
                          className="group flex w-full items-center gap-1 rounded-sm pr-1 text-xs hover:bg-accent"
                        >
                          <ColorSwatchPicker
                            group={g}
                            color={color}
                            active={active}
                            onChange={(c) =>
                              setColorOverrides((prev) => ({
                                ...prev,
                                [g]: c,
                              }))
                            }
                            onReset={() =>
                              setColorOverrides((prev) => {
                                if (!(g in prev)) return prev;
                                const next = { ...prev };
                                delete next[g];
                                return next;
                              })
                            }
                            hasOverride={g in colorOverrides}
                          />
                          <button
                            onClick={() => {
                              setSelectedGroups((prev) => {
                                const next = new Set(prev);
                                if (next.has(g)) next.delete(g);
                                else next.add(g);
                                return next;
                              });
                            }}
                            className="flex flex-1 items-center gap-2 py-1 pl-1 text-left"
                          >
                            <span className="flex-1">{g}</span>
                            {active && <Check className="h-3 w-3" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Classes multi-select — narrows the underlying data to specific
                vehicle classes. Scoped by the current Groups selection when
                grouping by reporting group. */}
            {availableClasses.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">
                    Classes
                    <Badge variant="secondary" className="ml-1.5">
                      {selectedClasses
                        ? `${selectedClasses.size}/${availableClasses.length}`
                        : `All · ${availableClasses.length}`}
                    </Badge>
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[280px] p-2"
                  align="end"
                >
                  <div className="mb-2 flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      onClick={() => setSelectedClasses(null)}
                    >
                      All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      onClick={() => setSelectedClasses(new Set())}
                    >
                      None
                    </Button>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto space-y-0.5">
                    {(() => {
                      // Render classes with a sticky-ish reporting-group
                      // header so the picker reads as a hierarchy.
                      const nodes: React.ReactNode[] = [];
                      let prevGroup: string | null = null;
                      for (const c of availableClasses) {
                        if (c.reportingGroup !== prevGroup) {
                          nodes.push(
                            <div
                              key={`hdr-${c.reportingGroup || "none"}`}
                              className="mt-1.5 px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0"
                            >
                              {c.reportingGroup || "Uncategorized"}
                            </div>
                          );
                          prevGroup = c.reportingGroup;
                        }
                        const active = selectedClasses
                          ? selectedClasses.has(c.class)
                          : true;
                        nodes.push(
                          <button
                            key={c.class}
                            onClick={() => {
                              // Determine whether this click is turning the
                              // class ON so we know whether to also auto-add
                              // its reporting group.
                              let wasToggledOn = false;
                              setSelectedClasses((prev) => {
                                // Starting from "all" (null) with a click
                                // means "only this class" is what the user
                                // likely wants — so seed from the full set
                                // and toggle off the clicked one? No:
                                // when prev is null, treat as "everything
                                // selected" and toggling flips to "all
                                // except this one." That's confusing.
                                // Simpler: when prev is null and the user
                                // clicks, treat it as "show only this one."
                                if (prev === null) {
                                  wasToggledOn = true;
                                  return new Set([c.class]);
                                }
                                const next = new Set(prev);
                                if (next.has(c.class)) {
                                  next.delete(c.class);
                                } else {
                                  next.add(c.class);
                                  wasToggledOn = true;
                                }
                                return next.size === 0 ? null : next;
                              });
                              // If the class turning on belongs to a
                              // reporting group that's currently hidden,
                              // auto-enable that group so its bars render.
                              // Only meaningful when grouping by reporting
                              // group (master-type buckets always hold the
                              // class regardless of which master is shown).
                              if (
                                wasToggledOn &&
                                groupBy === "reporting_group"
                              ) {
                                const g = groupForClass.get(c.class);
                                if (g && allGroups.includes(g)) {
                                  setSelectedGroups((prev) => {
                                    if (prev.has(g)) return prev;
                                    const next = new Set(prev);
                                    next.add(g);
                                    return next;
                                  });
                                }
                              }
                            }}
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent"
                          >
                            <span
                              className={
                                "h-3 w-3 shrink-0 rounded-sm border " +
                                (active
                                  ? "bg-primary border-primary"
                                  : "bg-background border-muted-foreground/40")
                              }
                            />
                            <span className="font-mono text-[11px] text-muted-foreground w-8 shrink-0">
                              {c.class}
                            </span>
                            <span className="flex-1 text-left truncate">
                              {c.className}
                            </span>
                            {active && selectedClasses && (
                              <Check className="h-3 w-3 shrink-0" />
                            )}
                          </button>
                        );
                      }
                      return nodes;
                    })()}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            <Button
              variant={compareMode ? "default" : "outline"}
              size="sm"
              className="h-8"
              onClick={() => {
                setCompareMode((v) => {
                  if (v) setComparePoints([]);
                  return !v;
                });
              }}
              title="Click two points on the chart to compare their values"
            >
              Compare
              {compareMode && comparePoints.length > 0 && (
                <Badge variant="secondary" className="ml-1.5">
                  {comparePoints.length}/2
                </Badge>
              )}
            </Button>

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
          </ControlRow>

          <p className="text-xs text-muted-foreground pt-1 border-t">
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
            {selectedClasses && selectedClasses.size > 0 && (
              <>
                {" · "}
                <span className="text-foreground">
                  Filtered to {selectedClasses.size} class
                  {selectedClasses.size === 1 ? "" : "es"}
                </span>
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
        {/* Compare strip — thin, in-card. Delta renders directly on the
            chart, so this bar only handles state + series picker + clear. */}
        {compareMode && (
          <CompareBar
            points={comparePoints}
            activeGroups={activeGroups}
            viewMode={viewMode}
            effectiveSeries={effectiveCompareSeries}
            setCompareSeries={setCompareSeries}
            onClear={() => setComparePoints([])}
          />
        )}
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
                  onDrill: handlePointClick,
                  compare: compareValues,
                  isPercentMetric:
                    metric === "utilizationPct" || metric === "finUtilPct",
                  colorOverrides,
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
                const color = colorFor(g, idx, colorOverrides);
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
                              handlePointClick(
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
  compare,
  isPercentMetric,
  colorOverrides,
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
  compare: {
    a: { label: string; value: number };
    b: { label: string; value: number };
  } | null;
  isPercentMetric: boolean;
  colorOverrides: Record<string, string>;
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
                  ? secondaryLabel ?? "Secondary"
                  : (p.name as string) ?? (p.dataKey as string);
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

  const aggregateColor = colorOverrides["Total"] ?? "#6366f1";
  const seriesConfig =
    viewMode === "aggregate"
      ? [{ key: "total", color: aggregateColor, name: "Total" }]
      : activeGroups.map((g, idx) => ({
          key: g,
          color: colorFor(g, idx, colorOverrides),
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

  // In-chart overlay that bridges the two compare points with a dotted line
  // and a floating % delta badge. Wrapped in Customized so Recharts mounts
  // it inside a <Layer class="recharts-customized-wrapper"> appended AFTER
  // the series layers — guarantees the dashed line and badge sit above any
  // bar or filled area beneath them.
  // When a bar series is present (BarChart, or ComposedChart where either
  // axis carries bars) Recharts uses a band scale on the X axis; line/area
  // charts use an even point scale.
  const hasBarSeries =
    style === "bar" || (hasSecondary && secondaryStyle === "bar");
  const compareScaleType: "band" | "point" = hasBarSeries ? "band" : "point";
  const compareOverlay =
    compare != null ? (
      <Customized
        component={() => (
          <CompareOverlay
            a={compare.a}
            b={compare.b}
            yFormat={yFormat}
            isPercent={isPercentMetric}
            scaleType={compareScaleType}
          />
        )}
      />
    ) : null;

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
        {compareOverlay}
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
        {compareOverlay}
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
        {compareOverlay}
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
      {compareOverlay}
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

// ──────────── compare bar ────────────
// Thin strip rendered inside the chart card above the canvas while compare
// mode is on. Conveys state, lets the user pick which series to compare,
// and clears the selection. The % change itself renders directly on the
// chart via CompareOverlay — so this bar stays minimal by design.

function CompareBar({
  points,
  activeGroups,
  viewMode,
  effectiveSeries,
  setCompareSeries,
  onClear,
}: {
  points: { period: string; label: string; group: string | null }[];
  activeGroups: string[];
  viewMode: "aggregate" | "by_group";
  effectiveSeries: string;
  setCompareSeries: (s: string | null) => void;
  onClear: () => void;
}) {
  // Sort chronologically so the bar reads "earlier → later" regardless of
  // the order the user clicked them in. Matches the overlay's orientation.
  const sortedPoints = [...points].sort((x, y) =>
    x.period.localeCompare(y.period)
  );
  const a = sortedPoints[0] ?? null;
  const b = sortedPoints[1] ?? null;

  const statusText =
    points.length === 0
      ? "Click any point on the chart to begin."
      : points.length === 1
        ? "One point picked — click another to compare."
        : null;

  return (
    <div className="flex flex-wrap items-center gap-3 border-y border-primary/15 bg-primary/[0.03] px-6 py-2">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
          Compare
        </span>
        <Badge variant="secondary" className="font-normal tabular-nums">
          {points.length}/2
        </Badge>
      </div>

      <div className="min-w-0 flex-1 text-xs text-muted-foreground tabular-nums">
        {statusText ? (
          statusText
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium text-foreground">{a?.label}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium text-foreground">{b?.label}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {viewMode === "by_group" && activeGroups.length > 0 && (
          <Select
            value={effectiveSeries}
            onValueChange={(v) => setCompareSeries(v)}
          >
            <SelectTrigger className="h-7 w-[168px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="total">Total (all groups)</SelectItem>
              {activeGroups.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onClear}
          disabled={points.length === 0}
        >
          <X className="mr-1 h-3 w-3" />
          Clear
        </Button>
      </div>
    </div>
  );
}

// ──────────── compare overlay ────────────
// SVG overlay rendered inside the chart. Draws a dashed line connecting the
// two picked data points and a pill at the midpoint showing the percent
// change. Direction is colored: green for up, rose for down, slate for flat.
//
// Positioning is computed from the plot area + axis domains rather than by
// grabbing the internal scale, since the public hooks API only exposes the
// domains. For categorical X we pick band-centering (for BarChart) or even
// point-spacing (for LineChart/AreaChart) based on `scaleType`.

function CompareOverlay({
  a,
  b,
  yFormat,
  isPercent,
  scaleType,
}: {
  a: { label: string; value: number };
  b: { label: string; value: number };
  yFormat: (v: number) => string;
  isPercent: boolean;
  scaleType: "band" | "point";
}) {
  const plot = usePlotArea();
  const xDomain = useXAxisDomain(0);
  const yDomain = useYAxisDomain("left");
  if (!plot || !xDomain || !yDomain) return null;

  // Categorical X-axis domain — array of label strings.
  const labels = xDomain as ReadonlyArray<string | number>;
  const idxA = labels.indexOf(a.label);
  const idxB = labels.indexOf(b.label);
  if (idxA < 0 || idxB < 0) return null;
  const n = labels.length;
  if (n === 0) return null;

  const plotW = plot.width;
  const plotH = plot.height;
  const plotLeft = plot.x;
  const plotTop = plot.y;

  // Band scales position points at band centers: (i + 0.5) * (W / n).
  // Point scales position them at even divisions: i * (W / (n - 1)).
  const xFor = (idx: number): number => {
    if (scaleType === "band") {
      return plotLeft + ((idx + 0.5) * plotW) / n;
    }
    if (n === 1) return plotLeft + plotW / 2;
    return plotLeft + (idx * plotW) / (n - 1);
  };

  // Y-axis domain is a numeric tuple [min, max] for linear scales.
  const [yMinRaw, yMaxRaw] = (yDomain as ReadonlyArray<number>) ?? [];
  const yMin = typeof yMinRaw === "number" ? yMinRaw : 0;
  const yMax = typeof yMaxRaw === "number" ? yMaxRaw : 1;
  const ySpan = yMax - yMin || 1;
  const yFor = (v: number): number =>
    plotTop + plotH * (1 - (v - yMin) / ySpan);

  const xA = xFor(idxA);
  const xB = xFor(idxB);
  const yA = yFor(a.value);
  const yB = yFor(b.value);

  const absDelta = b.value - a.value;
  const relDelta =
    a.value !== 0 ? (absDelta / Math.abs(a.value)) * 100 : null;
  const EPS = 1e-6;
  const dir =
    absDelta > EPS ? "up" : absDelta < -EPS ? "down" : "flat";

  const color =
    dir === "up" ? "#10b981" : dir === "down" ? "#f43f5e" : "#64748b";
  const tint =
    dir === "up"
      ? "rgba(16, 185, 129, 0.08)"
      : dir === "down"
        ? "rgba(244, 63, 94, 0.08)"
        : "rgba(100, 116, 139, 0.08)";

  const relText =
    relDelta == null
      ? "—"
      : `${relDelta > 0 ? "+" : ""}${relDelta.toFixed(1)}%`;

  const absText = isPercent
    ? `${absDelta > 0 ? "+" : absDelta < 0 ? "−" : ""}${Math.abs(
        absDelta
      ).toFixed(1)} pts`
    : `${absDelta > 0 ? "+" : absDelta < 0 ? "−" : ""}${yFormat(
        Math.abs(absDelta)
      )}`;

  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "—";

  // Midpoint for the badge. Nudge the pill slightly above the line so it
  // doesn't overlap the connection on shallow deltas.
  const midX = (xA + xB) / 2;
  const midY = (yA + yB) / 2;
  const badgeY = midY - 26;

  // Rough width estimation so the <foreignObject> hosts the pill nicely
  // centered. A few pixels of slack prevents text from clipping on edge cases.
  const badgeWidth = 160;
  const badgeHeight = 44;

  return (
    <g pointerEvents="none">
      {/* connecting dashed line */}
      <line
        x1={xA}
        y1={yA}
        x2={xB}
        y2={yB}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="4 5"
        opacity={0.9}
      />
      {/* endpoint ring + dot, A */}
      <circle cx={xA} cy={yA} r={7} fill={tint} />
      <circle
        cx={xA}
        cy={yA}
        r={5}
        fill="white"
        stroke={color}
        strokeWidth={2}
      />
      <circle cx={xA} cy={yA} r={2.25} fill={color} />
      {/* endpoint ring + dot, B */}
      <circle cx={xB} cy={yB} r={7} fill={tint} />
      <circle
        cx={xB}
        cy={yB}
        r={5}
        fill="white"
        stroke={color}
        strokeWidth={2}
      />
      <circle cx={xB} cy={yB} r={2.25} fill={color} />
      {/* center pill with % change */}
      <foreignObject
        x={midX - badgeWidth / 2}
        y={badgeY - badgeHeight / 2}
        width={badgeWidth}
        height={badgeHeight}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            width: "100%",
            height: "100%",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px 4px 8px",
              borderRadius: "9999px",
              background: "white",
              border: `1.5px solid ${color}`,
              boxShadow: "0 4px 10px rgba(15, 23, 42, 0.12)",
              fontFeatureSettings: '"tnum" 1',
              whiteSpace: "nowrap",
              lineHeight: 1,
            }}
          >
            <span
              style={{
                color,
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              {arrow}
            </span>
            <span
              style={{
                color,
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              {relText}
            </span>
            <span
              style={{
                color: "#64748b",
                fontSize: "10px",
                fontWeight: 500,
                marginLeft: "2px",
              }}
            >
              {absText}
            </span>
          </div>
        </div>
      </foreignObject>
    </g>
  );
}

// ──────────── color swatch picker ────────────
// Clickable swatch that opens an inline palette for the given group. Uses
// stopPropagation on its Popover so the surrounding group-toggle button
// doesn't also fire when the user interacts with the picker.

function ColorSwatchPicker({
  group,
  color,
  active,
  onChange,
  onReset,
  hasOverride,
}: {
  group: string;
  color: string;
  active: boolean;
  onChange: (hex: string) => void;
  onReset: () => void;
  hasOverride: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="relative h-4 w-4 shrink-0 rounded-sm ring-1 ring-border transition hover:ring-2 hover:ring-primary/60"
          style={{
            backgroundColor: color,
            opacity: active ? 1 : 0.35,
          }}
          aria-label={`Change color for ${group}`}
          title="Click to change color"
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-3"
        side="right"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {group}
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => onChange(c)}
              className="h-6 w-6 rounded-sm ring-1 ring-border transition hover:ring-2 hover:ring-primary"
              style={{ backgroundColor: c }}
              aria-label={c}
              title={c}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t pt-3">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Custom
            <input
              type="color"
              value={color}
              onChange={(e) => onChange(e.target.value)}
              className="h-6 w-8 cursor-pointer rounded border p-0"
            />
          </label>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-[11px]"
            onClick={onReset}
            disabled={!hasOverride}
          >
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ──────────── control layout primitives ────────────

function ControlRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground w-[64px] shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}

function SegmentedGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center rounded-md border bg-muted/40 p-0.5">
      {children}
    </div>
  );
}

function SegmentedButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={
        "px-2.5 py-1 text-xs font-medium rounded-[5px] transition-colors " +
        (active
          ? "bg-background shadow-sm text-foreground"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
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


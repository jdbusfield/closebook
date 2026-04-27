"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Loader2,
  X,
  Car,
  DollarSign,
  Wrench,
  TrendingUp,
  CalendarDays,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/utils/dates";

interface VehicleMatch {
  id: string;
  entity_id: string;
  entity_name: string | null;
  asset_tag: string | null;
  vin: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_class: string | null;
  rental_category: string;
  acquisition_cost: number;
  disposed_date: string | null;
}

interface VehicleDetail {
  vehicle: {
    id: string;
    entity_id: string;
    entity_name: string;
    asset_tag: string | null;
    vin: string | null;
    vehicle_year: number | null;
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_class: string | null;
    reporting_group: string | null;
    rental_category: string;
    acquisition_cost: number;
    in_service_date: string | null;
    disposed_date: string | null;
  };
  totals: {
    revenue: number;
    rentalDays: number;
    actualRentalDays: number;
    fleetDays: number;
    maintenance: number;
    avgUtilizationPct: number;
    avgDailyRate: number;
    acquisitionCost: number;
    financialUtilizationPct: number;
    netOfMaintenance: number;
    months: number;
  };
  series: Array<{
    period: string;
    year: number;
    month: number;
    revenue: number;
    rentalDays: number;
    actualRentalDays: number;
    fleetDays: number;
    utilizationPct: number;
    maintenance: number;
  }>;
}

const MONTH_SHORT = [
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

function formatTitle(v: {
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  asset_tag: string | null;
}): string {
  const head = [v.vehicle_year, v.vehicle_make, v.vehicle_model]
    .filter(Boolean)
    .join(" ");
  const tag = v.asset_tag ? `#${v.asset_tag}` : "";
  return [head, tag].filter(Boolean).join(" · ") || "Vehicle";
}

export function VehicleLookup({
  organizationId,
}: {
  organizationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<VehicleMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Debounced search. Short debounce — this is an operator workflow, they
  // want results to land fast.
  useEffect(() => {
    const term = query.trim();
    const controller = new AbortController();
    if (term.length < 1) {
      Promise.resolve().then(() => {
        if (!controller.signal.aborted) setMatches([]);
      });
      return () => controller.abort();
    }
    const id = setTimeout(() => {
      const params = new URLSearchParams({
        organization_id: organizationId,
        q: term,
      });
      fetch(`/api/rental-assets/vehicle-detail?${params}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((j: { matches?: VehicleMatch[]; error?: string }) => {
          if (j.error) {
            setMatches([]);
            return;
          }
          setMatches(j.matches ?? []);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setMatches([]);
        })
        .finally(() => setSearching(false));
    }, 180);
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) setSearching(true);
    });
    return () => {
      controller.abort();
      clearTimeout(id);
    };
  }, [query, organizationId]);

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) {
            setTimeout(() => inputRef.current?.focus(), 0);
          } else {
            setQuery("");
            setMatches([]);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-[260px] justify-start gap-2 text-muted-foreground"
          >
            <Search className="h-4 w-4" />
            <span className="text-sm">Search a vehicle…</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[420px] p-0" align="start">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Asset tag, VIN, year, make, or model"
              className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
            />
            {searching ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : query ? (
              <button
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {query.trim().length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                Type a few characters to search the fleet.
              </div>
            ) : matches.length === 0 && !searching ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                No vehicles match {`"${query}"`}.
              </div>
            ) : (
              <ul className="divide-y">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => {
                        setSelectedId(m.id);
                        setOpen(false);
                      }}
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/60"
                    >
                      <Car className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {formatTitle(m)}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          {m.vehicle_class && (
                            <Badge variant="secondary" className="font-normal">
                              {m.vehicle_class}
                            </Badge>
                          )}
                          {m.vin && (
                            <span className="truncate font-mono">
                              VIN {m.vin.slice(-8)}
                            </span>
                          )}
                          {m.disposed_date && (
                            <Badge variant="outline" className="font-normal">
                              Disposed
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <VehicleDetailSheet
        organizationId={organizationId}
        fixedAssetId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}

function VehicleDetailSheet({
  organizationId,
  fixedAssetId,
  onClose,
}: {
  organizationId: string;
  fixedAssetId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<VehicleDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<
    "monthly" | "quarterly" | "yearly"
  >("monthly");

  useEffect(() => {
    if (!fixedAssetId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      organization_id: organizationId,
      fixed_asset_id: fixedAssetId,
    });
    // Kick off the fetch first, then flip loading state in a microtask so
    // the `react-hooks/set-state-in-effect` lint stays happy (matches the
    // pattern used by drill-down-sheet.tsx).
    const pending = fetch(
      `/api/rental-assets/vehicle-detail?${params}`,
      { signal: controller.signal }
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as VehicleDetail;
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(String(e.message ?? e));
      })
      .finally(() => setLoading(false));
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setError(null);
      }
    });
    return () => {
      controller.abort();
      void pending;
    };
  }, [organizationId, fixedAssetId]);

  // Only surface data that matches the currently-open vehicle. Prevents the
  // previous vehicle's stats from flashing when a new one is picked.
  const matchedData = data?.vehicle.id === fixedAssetId ? data : null;

  // Aggregate the all-months series up to the user's chosen granularity.
  // Sums revenue/maintenance/days, then recomputes utilization so the
  // weighting stays correct (quarterly util ≠ mean of three monthly %s).
  // For quarterly/yearly we drop buckets that aren't fully populated (e.g.
  // a partial in-progress quarter or a year where the vehicle was only on
  // the fleet for part of it) so the bars compare like-for-like.
  const { chartData, droppedBuckets } = useMemo(() => {
    const series = matchedData?.series ?? [];
    if (granularity === "monthly") {
      return {
        chartData: series.map((s) => ({
          label: `${MONTH_SHORT[s.month]} ${String(s.year).slice(2)}`,
          revenue: Math.round(s.revenue),
          maintenance: Math.round(s.maintenance),
          utilization: Number(s.utilizationPct.toFixed(1)),
        })),
        droppedBuckets: 0,
      };
    }
    const buckets = new Map<
      string,
      {
        key: string;
        label: string;
        year: number;
        bucket: number; // 1-4 for quarters, unused for yearly
        months: Set<number>;
        revenue: number;
        maintenance: number;
        rentalDays: number;
        fleetDays: number;
      }
    >();
    for (const s of series) {
      let key: string;
      let label: string;
      let bucket = 0;
      if (granularity === "quarterly") {
        const q = Math.ceil(s.month / 3);
        key = `${s.year}-Q${q}`;
        label = `Q${q} '${String(s.year).slice(2)}`;
        bucket = q;
      } else {
        key = String(s.year);
        label = String(s.year);
      }
      let b = buckets.get(key);
      if (!b) {
        b = {
          key,
          label,
          year: s.year,
          bucket,
          months: new Set<number>(),
          revenue: 0,
          maintenance: 0,
          rentalDays: 0,
          fleetDays: 0,
        };
        buckets.set(key, b);
      }
      b.months.add(s.month);
      b.revenue += s.revenue;
      b.maintenance += s.maintenance;
      b.rentalDays += s.rentalDays;
      b.fleetDays += s.fleetDays;
    }
    const required = granularity === "quarterly" ? 3 : 12;
    const all = [...buckets.values()].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.bucket - b.bucket;
    });
    const kept = all.filter((b) => b.months.size >= required);
    return {
      chartData: kept.map((b) => ({
        label: b.label,
        revenue: Math.round(b.revenue),
        maintenance: Math.round(b.maintenance),
        utilization:
          b.fleetDays > 0
            ? Number(((b.rentalDays / b.fleetDays) * 100).toFixed(1))
            : 0,
      })),
      droppedBuckets: all.length - kept.length,
    };
  }, [matchedData, granularity]);

  const bucketNoun =
    granularity === "monthly"
      ? "month"
      : granularity === "quarterly"
        ? "quarter"
        : "year";

  const v = matchedData?.vehicle;
  const t = matchedData?.totals;

  return (
    <Sheet
      open={fixedAssetId != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full max-w-[720px] overflow-y-auto sm:max-w-[720px]">
        <SheetHeader className="space-y-1.5 border-b pb-4">
          <SheetTitle className="text-xl tracking-tight">
            {v ? formatTitle(v) : "Loading…"}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2 text-xs">
            {v?.vehicle_class && (
              <Badge variant="secondary" className="font-normal">
                {v.vehicle_class}
              </Badge>
            )}
            {v?.reporting_group && (
              <span className="text-muted-foreground">
                {v.reporting_group}
              </span>
            )}
            {v?.entity_name && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{v.entity_name}</span>
              </>
            )}
            {v?.disposed_date && (
              <Badge variant="outline" className="font-normal">
                Disposed
              </Badge>
            )}
          </SheetDescription>
        </SheetHeader>

        {loading && !matchedData && (
          <div className="flex items-center gap-2 px-6 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading vehicle history…
          </div>
        )}

        {error && (
          <div className="px-6 py-6 text-sm text-destructive">
            Couldn&apos;t load this vehicle: {error}
          </div>
        )}

        {v && t && (
          <div className="space-y-5 p-6 pt-5">
            {/* ─── KPI tiles ─── */}
            <div className="grid grid-cols-2 gap-3">
              <KpiTile
                icon={<DollarSign className="h-4 w-4" />}
                label="Total revenue"
                value={formatCurrency(t.revenue)}
                sub={`${t.months} active month${t.months === 1 ? "" : "s"}`}
              />
              <KpiTile
                icon={<Car className="h-4 w-4" />}
                label="Original cost"
                value={formatCurrency(t.acquisitionCost)}
                sub={
                  t.acquisitionCost > 0
                    ? `${t.financialUtilizationPct.toFixed(1)}% earned back`
                    : "No cost on file"
                }
                tone="muted"
              />
              <KpiTile
                icon={<Wrench className="h-4 w-4" />}
                label="Total maintenance"
                value={formatCurrency(t.maintenance)}
                sub={
                  t.revenue > 0
                    ? `${((t.maintenance / t.revenue) * 100).toFixed(1)}% of revenue`
                    : "—"
                }
                tone="muted"
              />
              <KpiTile
                icon={<TrendingUp className="h-4 w-4" />}
                label="Avg DBR utilization"
                value={`${t.avgUtilizationPct.toFixed(1)}%`}
                sub={`${t.rentalDays.toLocaleString()} / ${t.fleetDays.toLocaleString()} days`}
                tone="accent"
              />
            </div>

            {/* ─── Identity block ─── */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
              <IdRow label="Asset tag" value={v.asset_tag ?? "—"} />
              <IdRow
                label="VIN"
                value={v.vin ? <span className="font-mono">{v.vin}</span> : "—"}
              />
              <IdRow
                label="In service"
                value={
                  v.in_service_date
                    ? new Date(v.in_service_date).toLocaleDateString()
                    : "—"
                }
              />
              <IdRow
                label="Disposed"
                value={
                  v.disposed_date
                    ? new Date(v.disposed_date).toLocaleDateString()
                    : "—"
                }
              />
              <IdRow
                label="Avg daily rate"
                value={
                  t.actualRentalDays > 0
                    ? formatCurrency(t.avgDailyRate)
                    : "—"
                }
              />
              <IdRow
                label="Net of maintenance"
                value={formatCurrency(t.netOfMaintenance)}
              />
            </div>

            <Separator />

            {/* ─── History chart ─── */}
            <div>
              <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold capitalize">
                    {granularity} revenue &amp; utilization
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    All-time history · bars = revenue, dashed line =
                    utilization %
                  </p>
                  {granularity !== "monthly" && (
                    <p className="mt-1 text-[11px] italic text-muted-foreground">
                      Only full {bucketNoun}s are available for that view
                      {droppedBuckets > 0
                        ? ` · hiding ${droppedBuckets} partial ${
                            droppedBuckets === 1 ? bucketNoun : `${bucketNoun}s`
                          }`
                        : ""}
                      .
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center rounded-md border bg-muted/40 p-0.5">
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
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() => setGranularity(k)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />
                    {chartData.length} {bucketNoun}
                    {chartData.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="h-[260px] rounded-lg border bg-background p-3">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No history recorded for this vehicle.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={chartData}
                      margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-muted"
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                        interval={
                          granularity === "yearly"
                            ? 0
                            : granularity === "quarterly"
                              ? chartData.length > 16
                                ? 1
                                : 0
                              : chartData.length > 36
                                ? 5
                                : chartData.length > 18
                                  ? 2
                                  : chartData.length > 12
                                    ? 1
                                    : 0
                        }
                      />
                      <YAxis
                        yAxisId="left"
                        tickFormatter={(n: number) =>
                          n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`
                        }
                        tick={{ fontSize: 10 }}
                        width={52}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tickFormatter={(n: number) => `${n}%`}
                        tick={{ fontSize: 10 }}
                        width={40}
                      />
                      <RechartsTooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          return (
                            <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
                              <div className="mb-1 font-medium">{label}</div>
                              {payload.map((p) => {
                                const key = p.dataKey as string;
                                const val = Number(p.value);
                                const formatted =
                                  key === "utilization"
                                    ? `${val.toFixed(1)}%`
                                    : formatCurrency(val);
                                return (
                                  <div
                                    key={key}
                                    className="flex items-center gap-2 tabular-nums"
                                  >
                                    <span
                                      className="h-2 w-2 rounded-sm"
                                      style={{ backgroundColor: p.color }}
                                    />
                                    <span className="flex-1 capitalize">
                                      {key}
                                    </span>
                                    <span className="font-medium">
                                      {formatted}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={24}
                        iconSize={10}
                        wrapperStyle={{ fontSize: 11 }}
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="revenue"
                        fill="#6366f1"
                        radius={[2, 2, 0, 0]}
                        name="Revenue"
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="maintenance"
                        fill="#f59e0b"
                        radius={[2, 2, 0, 0]}
                        name="Maintenance"
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="utilization"
                        stroke="#0f172a"
                        strokeWidth={1.75}
                        strokeDasharray="4 4"
                        dot={false}
                        name="Utilization %"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function KpiTile({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "muted" | "accent";
}) {
  const accent =
    tone === "accent"
      ? "border-primary/40 bg-primary/[0.04]"
      : tone === "muted"
        ? "border-border bg-muted/40"
        : "border-border bg-background";
  return (
    <div className={`rounded-lg border p-3 ${accent}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight">
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
      )}
    </div>
  );
}

function IdRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium tabular-nums text-right">
        {value}
      </span>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPriorPeriod } from "@/lib/utils/dates";
import type { FinancialStatementsResponse } from "@/components/financial-statements/types";

interface RevenueByReportingEntityProps {
  organizationId: string;
  currentYear: number;
  currentMonth: number;
  includeProForma?: boolean;
}

interface ReportingEntity {
  id: string;
  name: string;
  code: string;
  excludeFromBreakdown?: boolean;
}

interface ReSeries {
  id: string;
  name: string;
  color: string;
  dataKey: string;
  monthly: Record<string, number>;
  total: number;
}

const RE_COLOR_RULES: Array<{ match: string; color: string }> = [
  { match: "avon", color: "#dc2626" },      // red-600
  { match: "hdr", color: "#2563eb" },       // blue-600
  { match: "versatile", color: "#111827" }, // near-black
];

function colorForReportingEntity(name: string): string {
  const lower = name.toLowerCase();
  for (const rule of RE_COLOR_RULES) {
    if (lower.includes(rule.match)) return rule.color;
  }
  return "#94a3b8"; // slate-400 fallback
}

function sanitizeDataKey(id: string): string {
  return `re_${id.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function getTwelveMonthRange(year: number, month: number) {
  const end = getPriorPeriod(year, month);
  let startYear = end.year;
  let startMonth = end.month - 11;
  while (startMonth <= 0) {
    startMonth += 12;
    startYear -= 1;
  }
  return {
    startYear,
    startMonth,
    endYear: end.year,
    endMonth: end.month,
  };
}

function formatUsdFull(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

export function RevenueByReportingEntity({
  organizationId,
  currentYear,
  currentMonth,
  includeProForma = true,
}: RevenueByReportingEntityProps) {
  const range = useMemo(
    () => getTwelveMonthRange(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reSeries, setReSeries] = useState<ReSeries[]>([]);
  const [periods, setPeriods] = useState<Array<{ key: string; label: string }>>(
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const reRes = await fetch(
          `/api/reporting-entities?organizationId=${organizationId}`
        );
        if (!reRes.ok) {
          throw new Error(`Failed to load reporting entities (${reRes.status})`);
        }
        const reJson = await reRes.json();
        const allReportingEntities: ReportingEntity[] =
          reJson.reportingEntities ?? [];
        // Hide reporting entities flagged as excluded from the breakdown —
        // they would otherwise overstate consolidated revenue against the
        // dashboard's headline KPIs, which already exclude them.
        const reportingEntities = allReportingEntities.filter(
          (re) => !re.excludeFromBreakdown,
        );

        if (reportingEntities.length === 0) {
          if (!cancelled) {
            setReSeries([]);
            setPeriods([]);
            setLoading(false);
          }
          return;
        }

        const commonParams = new URLSearchParams({
          scope: "reporting_entity",
          startYear: String(range.startYear),
          startMonth: String(range.startMonth),
          endYear: String(range.endYear),
          endMonth: String(range.endMonth),
          granularity: "monthly",
          includeBudget: "false",
          includeYoY: "false",
          includeProForma: String(includeProForma),
          includeAllocations: "false",
          includeTotal: "false",
        });

        const results = await Promise.all(
          reportingEntities.map(async (re) => {
            const params = new URLSearchParams(commonParams);
            params.set("reportingEntityId", re.id);
            const res = await fetch(
              `/api/financial-statements?${params.toString()}`
            );
            if (!res.ok) {
              throw new Error(
                `Failed to load revenue for ${re.name} (${res.status})`
              );
            }
            const json: FinancialStatementsResponse = await res.json();
            return { re, json };
          })
        );

        if (cancelled) return;

        let sharedPeriods: Array<{ key: string; label: string }> = [];
        const series: ReSeries[] = results.map(({ re, json }) => {
          const filtered = (json.periods ?? []).filter((p) => !p.isTotal);
          if (sharedPeriods.length === 0) {
            sharedPeriods = filtered.map((p) => ({
              key: p.key,
              label: p.label,
            }));
          }
          const revenueSection = json.incomeStatement?.sections.find(
            (s) => s.id === "revenue"
          );
          const amounts = revenueSection?.subtotalLine?.amounts ?? {};
          const monthly: Record<string, number> = {};
          let total = 0;
          for (const p of filtered) {
            const value = amounts[p.key] ?? 0;
            monthly[p.key] = value;
            total += value;
          }
          return {
            id: re.id,
            name: re.name,
            color: colorForReportingEntity(re.name),
            dataKey: sanitizeDataKey(re.id),
            monthly,
            total,
          };
        });

        // Sort so color priority entities (avon/hdr/versatile) sit in a
        // consistent order and the largest RE is on top of the stack.
        series.sort((a, b) => b.total - a.total);

        setReSeries(series);
        setPeriods(sharedPeriods);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load data");
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [organizationId, range, includeProForma]);

  const chartData = useMemo(() => {
    if (!periods.length || !reSeries.length) return [];
    return periods.map((p) => {
      const row: Record<string, number | string> = { label: p.label };
      for (const s of reSeries) {
        row[s.dataKey] = s.monthly[p.key] ?? 0;
      }
      return row;
    });
  }, [periods, reSeries]);

  const totals = useMemo(() => {
    const sum = reSeries.reduce((a, s) => a + s.total, 0);
    return { sum, series: reSeries };
  }, [reSeries]);

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="text-base font-semibold text-foreground">
            Revenue by Reporting Entity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Couldn&apos;t load: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="text-base font-semibold text-foreground">
            Revenue by Reporting Entity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (reSeries.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="text-base font-semibold text-foreground">
            Revenue by Reporting Entity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No reporting entities configured yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardDescription className="text-base font-semibold text-foreground">
          Revenue by Reporting Entity
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col space-y-3">
        <div className="flex-1 min-h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="var(--border, #e5e7eb)"
              />
              <XAxis
                dataKey="label"
                tick={{
                  fontSize: 11,
                  fill: "var(--muted-foreground, #6b7280)",
                }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{
                  fontSize: 11,
                  fill: "var(--muted-foreground, #6b7280)",
                }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(n: number) => formatCompact(n)}
                width={64}
              />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.1)" }}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid var(--border, #e5e7eb)",
                  fontSize: 12,
                }}
                formatter={(value, name) => {
                  const numeric = typeof value === "number" ? value : 0;
                  const s = reSeries.find((r) => r.dataKey === name);
                  return [formatUsdFull(numeric), s?.name ?? String(name)];
                }}
                labelStyle={{ fontWeight: 500 }}
              />
              {reSeries.map((s) => (
                <Bar
                  key={s.dataKey}
                  dataKey={s.dataKey}
                  stackId="revenue"
                  fill={s.color}
                  maxBarSize={32}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-4 pt-2 border-t">
          {totals.series.map((s) => {
            const pct =
              totals.sum === 0 ? 0 : (s.total / totals.sum) * 100;
            return (
              <div key={s.id} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">
                  {formatUsdFull(s.total)} · {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

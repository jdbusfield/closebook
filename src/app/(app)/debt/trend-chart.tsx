"use client";

/**
 * 24-month trend with two views:
 *   - Balances: stacked area of ending balance by debt type
 *   - Activity: grouped bars of monthly draws vs paydowns
 *
 * Controls are a small toggle strip in the card header so it stays compact
 * and fits next to the other panels in a Workday-style grid.
 */

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/dates";
import {
  DEBT_TYPE_LABELS,
  type MonthlyBalancePoint,
} from "@/lib/utils/debt-rollforward";

const TYPE_COLORS = [
  "#1F3A5F", "#10B981", "#F59E0B", "#6366F1", "#EF4444",
  "#0EA5E9", "#8B5CF6", "#14B8A6", "#78716C",
];

interface TrendChartProps {
  trend: MonthlyBalancePoint[];
}

export function TrendChart({ trend }: TrendChartProps) {
  const [mode, setMode] = useState<"balance" | "activity">("balance");

  const { rows, types, colorFor } = useMemo(() => {
    const typeSet = new Set<string>();
    for (const p of trend) {
      for (const t of Object.keys(p.byDebtType)) typeSet.add(t);
    }
    const types = Array.from(typeSet).sort();
    const colorFor: Record<string, string> = {};
    types.forEach((t, i) => {
      colorFor[t] = TYPE_COLORS[i % TYPE_COLORS.length];
    });
    const rows = trend.map((p) => {
      const base: Record<string, string | number> = {
        label: p.label,
        draws: p.draws,
        paydowns: p.paydowns,
      };
      for (const t of types) {
        base[t] = p.byDebtType[t] ?? 0;
      }
      return base;
    });
    return { rows, types, colorFor };
  }, [trend]);

  if (trend.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            No historical data to chart.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">
          {mode === "balance" ? "Outstanding by Month" : "Draws vs. Paydowns"}
        </CardTitle>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={mode === "balance" ? "default" : "outline"}
            onClick={() => setMode("balance")}
            className="h-7 px-2 text-xs"
          >
            Balance
          </Button>
          <Button
            size="sm"
            variant={mode === "activity" ? "default" : "outline"}
            onClick={() => setMode("activity")}
            className="h-7 px-2 text-xs"
          >
            Activity
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            {mode === "balance" ? (
              <AreaChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="label" fontSize={11} tick={{ fill: "currentColor" }} />
                <YAxis
                  fontSize={11}
                  tick={{ fill: "currentColor" }}
                  tickFormatter={compact}
                />
                <Tooltip
                  formatter={(v, n) => [
                    typeof v === "number" ? formatCurrency(v) : String(v ?? ""),
                    DEBT_TYPE_LABELS[n as string] ?? String(n ?? ""),
                  ]}
                  contentStyle={{ borderRadius: 6, fontSize: 12 }}
                />
                <Legend
                  formatter={(v) => DEBT_TYPE_LABELS[v as string] ?? v}
                  wrapperStyle={{ fontSize: 11 }}
                />
                {types.map((t) => (
                  <Area
                    key={t}
                    type="monotone"
                    dataKey={t}
                    stackId="1"
                    stroke={colorFor[t]}
                    fill={colorFor[t]}
                    fillOpacity={0.6}
                  />
                ))}
              </AreaChart>
            ) : (
              <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="label" fontSize={11} tick={{ fill: "currentColor" }} />
                <YAxis
                  fontSize={11}
                  tick={{ fill: "currentColor" }}
                  tickFormatter={compact}
                />
                <Tooltip
                  formatter={(v) =>
                    typeof v === "number" ? formatCurrency(v) : String(v ?? "")
                  }
                  contentStyle={{ borderRadius: 6, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="draws" name="Draws" fill="#EF4444" />
                <Bar dataKey="paydowns" name="Paydowns" fill="#10B981" />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

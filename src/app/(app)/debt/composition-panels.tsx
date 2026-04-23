"use client";

/**
 * Two panels side-by-side:
 *   Left  — Stacked horizontal bar per entity, segmented by debt type
 *   Right — Donut by debt type with an inline legend table
 *
 * Clicking a slice / bar segment filters the detail sections downstream.
 * The donut sits right of the entity bars so the eye moves "total → by
 * entity → by type" the same way an investor reads it.
 */

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/dates";
import {
  DEBT_TYPE_LABELS,
  type GroupedRollForward,
} from "@/lib/utils/debt-rollforward";

const TYPE_COLORS = [
  "#1F3A5F", "#10B981", "#F59E0B", "#6366F1", "#EF4444",
  "#0EA5E9", "#8B5CF6", "#14B8A6", "#78716C",
];

interface Props {
  rollForward: GroupedRollForward | null;
  onSelectType?: (debtType: string | null) => void;
  onSelectEntity?: (entityId: string | null) => void;
  selectedType?: string | null;
  selectedEntityId?: string | null;
}

export function CompositionPanels({
  rollForward,
  onSelectType,
  onSelectEntity,
  selectedType,
  selectedEntityId,
}: Props) {
  const typeData = useMemo(() => {
    if (!rollForward) return [];
    const totals: Record<string, number> = {};
    for (const eg of rollForward.entities) {
      for (const tg of eg.debtTypes) {
        totals[tg.debtType] =
          (totals[tg.debtType] ?? 0) + tg.totals.endingBalance;
      }
    }
    return Object.entries(totals)
      .filter(([, v]) => Math.abs(v) > 0.005)
      .map(([debtType, value]) => ({
        debtType,
        name: DEBT_TYPE_LABELS[debtType] ?? debtType,
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [rollForward]);

  const typeColor = useMemo(() => {
    const m: Record<string, string> = {};
    typeData.forEach((d, i) => {
      m[d.debtType] = TYPE_COLORS[i % TYPE_COLORS.length];
    });
    return m;
  }, [typeData]);

  const entityBars = useMemo(() => {
    if (!rollForward) return { rows: [], types: [] as string[] };
    const types = Array.from(new Set(typeData.map((d) => d.debtType)));
    const rows = rollForward.entities.map((eg) => {
      const row: Record<string, number | string> = {
        entityId: eg.entity.id,
        name: eg.entity.name,
        total: eg.totals.endingBalance,
      };
      for (const tg of eg.debtTypes) {
        row[tg.debtType] = tg.totals.endingBalance;
      }
      return row;
    });
    return { rows: rows.sort((a, b) => (b.total as number) - (a.total as number)), types };
  }, [rollForward, typeData]);

  const totalOutstanding = typeData.reduce((s, d) => s + d.value, 0);
  const hasAny = typeData.length > 0;

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span>By Entity</span>
            {hasAny && (
              <span className="text-xs font-normal text-muted-foreground">
                {entityBars.rows.length} {entityBars.rows.length === 1 ? "entity" : "entities"}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasAny ? (
            <EmptyMsg />
          ) : (
            <div style={{ height: Math.max(240, entityBars.rows.length * 44) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={entityBars.rows}
                  layout="vertical"
                  margin={{ left: 12, right: 24, top: 4, bottom: 4 }}
                >
                  <XAxis
                    type="number"
                    tickFormatter={compact}
                    fontSize={11}
                    tick={{ fill: "currentColor" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    fontSize={11}
                    tick={{ fill: "currentColor" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v, n) => [
                      typeof v === "number" ? formatCurrency(v) : String(v ?? ""),
                      DEBT_TYPE_LABELS[n as string] ?? String(n ?? ""),
                    ]}
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                    contentStyle={{ borderRadius: 6, fontSize: 12 }}
                  />
                  {entityBars.types.map((t) => (
                    <Bar
                      key={t}
                      dataKey={t}
                      stackId="a"
                      fill={typeColor[t]}
                      onClick={(data) => {
                        if (!onSelectEntity) return;
                        const payload = (data as { payload?: { entityId?: string } })
                          ?.payload;
                        const id = payload?.entityId ?? null;
                        onSelectEntity(selectedEntityId === id ? null : id);
                      }}
                      opacity={!selectedType || selectedType === t ? 1 : 0.25}
                      cursor={onSelectEntity ? "pointer" : "default"}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span>By Debt Type</span>
            {hasAny && (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {formatCurrency(totalOutstanding)}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasAny ? (
            <EmptyMsg />
          ) : (
            <div className="flex items-center gap-4">
              <div className="h-[180px] w-[180px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={typeData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={1}
                      onClick={(e) =>
                        onSelectType?.(
                          selectedType === e.debtType ? null : e.debtType
                        )
                      }
                      cursor={onSelectType ? "pointer" : "default"}
                    >
                      {typeData.map((d) => (
                        <Cell
                          key={d.debtType}
                          fill={typeColor[d.debtType]}
                          opacity={
                            !selectedType || selectedType === d.debtType
                              ? 1
                              : 0.25
                          }
                          stroke="hsl(var(--background))"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) =>
                        typeof v === "number" ? formatCurrency(v) : String(v ?? "")
                      }
                      contentStyle={{ borderRadius: 6, fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1 text-sm">
                {typeData.map((d) => {
                  const pct =
                    totalOutstanding > 0 ? (d.value / totalOutstanding) * 100 : 0;
                  const active = selectedType === d.debtType;
                  return (
                    <button
                      key={d.debtType}
                      type="button"
                      onClick={() =>
                        onSelectType?.(active ? null : d.debtType)
                      }
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-muted",
                        active && "bg-muted"
                      )}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ background: typeColor[d.debtType] }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {d.name}
                      </span>
                      <span className="text-right text-xs tabular-nums">
                        <span className="font-medium">
                          {formatCompact(d.value)}
                        </span>
                        <span className="ml-1.5 text-muted-foreground">
                          {pct.toFixed(0)}%
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyMsg() {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      No debt to display for the selected scope.
    </p>
  );
}

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  if (abs < 0.005) return "$0";
  return `$${n.toFixed(0)}`;
}

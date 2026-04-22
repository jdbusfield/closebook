"use client";

/**
 * Hero summary — the "at a glance" block.
 *
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │  OUTSTANDING DEBT                                   [sparkline]   │
 *   │  $5,218,456                                                       │
 *   │  ▼ 2.4% vs last month · ▼ $128k vs period start · 14 instruments  │
 *   └───────────────────────────────────────────────────────────────────┘
 *   ┌─────────┬─────────┬─────────┬─────────┐
 *   │ DRAWS   │ PRINC.  │ INT+FEE │ NET Δ   │     (supporting metrics)
 *   │ $128k   │ $(256k) │ $(42k)  │ $(128k) │
 *   └─────────┴─────────┴─────────┴─────────┘
 *
 * Replaces the 6-card KPI row — one hero metric instead of six equal-weight
 * cards, four supporting metrics below that keep the period-activity story
 * visible without crowding the top of the page.
 */

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/dates";
import type {
  GroupedRollForward,
  MonthlyBalancePoint,
} from "@/lib/utils/debt-rollforward";

interface Props {
  rollForward: GroupedRollForward | null;
  trend: MonthlyBalancePoint[];
}

export function HeroSummary({ rollForward, trend }: Props) {
  const t = rollForward?.totals;
  const netChange = t ? t.endingBalance - t.beginningBalance : 0;
  const hasData = !!t && t.instrumentCount > 0;

  const momPct =
    trend.length >= 2
      ? deltaPct(
          trend[trend.length - 1].endingBalance,
          trend[trend.length - 2].endingBalance
        )
      : 0;

  const sparklineData = trend.map((p) => ({ value: p.endingBalance }));
  const sparklineColor = netChange <= 0 ? "#10B981" : "#F43F5E";

  return (
    <div className="space-y-3">
      {/* Hero card */}
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                Outstanding Debt
              </div>
              <div className="text-4xl font-semibold tabular-nums tracking-tight md:text-5xl">
                {hasData ? formatCurrency(t.endingBalance) : "—"}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-sm">
                {hasData && (
                  <>
                    <DeltaChip
                      value={momPct}
                      label="vs last month"
                      type="pct"
                      invertColors
                    />
                    <Separator />
                    <DeltaChip
                      value={netChange}
                      label="vs period start"
                      type="currency"
                      invertColors
                    />
                    <Separator />
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground tabular-nums">
                        {t.instrumentCount}
                      </span>{" "}
                      {t.instrumentCount === 1 ? "instrument" : "instruments"}
                    </span>
                    <Separator />
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground tabular-nums">
                        {(t.weightedAvgRate * 100).toFixed(2)}%
                      </span>{" "}
                      weighted rate
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Sparkline — trailing 24 months of outstanding balance */}
            {sparklineData.length > 1 && (
              <div className="h-20 w-full lg:h-24 lg:w-64 xl:w-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sparklineData}>
                    <defs>
                      <linearGradient id="hero-spark" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={sparklineColor} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={sparklineColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={sparklineColor}
                      strokeWidth={2}
                      fill="url(#hero-spark)"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Supporting metrics row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile
          label="Draws"
          value={t?.draws ?? 0}
          tone="negative"
          sub={t ? `${formatCompact(t.draws)} into debt` : undefined}
        />
        <MetricTile
          label="Principal Paid"
          value={t?.netPrincipalPaid ?? 0}
          tone="positive"
          sub={
            t && t.vehiclePayoffs > 0
              ? `incl. ${formatCompact(t.vehiclePayoffs)} vehicle payoffs`
              : undefined
          }
        />
        <MetricTile
          label="Interest + Fees"
          value={(t?.interestPayments ?? 0) + (t?.fees ?? 0)}
          tone="amber"
          sub={
            t
              ? `Int ${formatCompact(t.interestPayments)} · Fees ${formatCompact(t.fees)}`
              : undefined
          }
        />
        <MetricTile
          label="Net Change"
          value={netChange}
          tone={netChange < 0 ? "positive" : netChange > 0 ? "negative" : "neutral"}
          sub={
            t
              ? `${formatCompact(t.beginningBalance)} → ${formatCompact(t.endingBalance)}`
              : undefined
          }
          showSign
        />
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

interface MetricTileProps {
  label: string;
  value: number;
  tone: "positive" | "negative" | "amber" | "neutral";
  sub?: string;
  showSign?: boolean;
}
function MetricTile({ label, value, tone, sub, showSign }: MetricTileProps) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
        ? "text-rose-600 dark:text-rose-400"
        : tone === "amber"
          ? "text-amber-600 dark:text-amber-400"
          : "text-foreground";
  const display = showSign && value !== 0
    ? (value < 0 ? "−" : "+") + formatCurrency(Math.abs(value))
    : formatCurrency(Math.abs(value));
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className={cn("text-xl font-semibold tabular-nums md:text-2xl", valueClass)}>
          {display}
        </div>
        {sub && (
          <div className="text-xs text-muted-foreground line-clamp-1" title={sub}>
            {sub}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Separator() {
  return <span className="text-muted-foreground/40">·</span>;
}

interface DeltaChipProps {
  value: number;
  label: string;
  type: "pct" | "currency";
  invertColors?: boolean;
}
function DeltaChip({ value, label, type, invertColors }: DeltaChipProps) {
  const neutral = value === 0 || !isFinite(value);
  const favorable = invertColors ? value < 0 : value > 0;
  const Icon = neutral ? Minus : favorable ? ArrowDownRight : ArrowUpRight;
  const toneClass = neutral
    ? "text-muted-foreground bg-muted"
    : favorable
      ? "text-emerald-700 bg-emerald-500/10 dark:text-emerald-400"
      : "text-rose-700 bg-rose-500/10 dark:text-rose-400";

  const formatted =
    type === "pct"
      ? `${Math.abs(value).toFixed(1)}%`
      : formatCurrency(Math.abs(value));

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        toneClass
      )}
    >
      <Icon className="size-3" />
      <span className="tabular-nums">{formatted}</span>
      <span className="font-normal opacity-70">{label}</span>
    </span>
  );
}

function deltaPct(current: number, prior: number): number {
  if (!isFinite(prior) || prior === 0) return 0;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  if (abs < 0.005) return "$0";
  return `$${n.toFixed(0)}`;
}

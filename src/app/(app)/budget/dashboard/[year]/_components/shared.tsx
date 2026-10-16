"use client";

import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtPctChange, fmtSigned, type Mode, type Units } from "@/lib/budget/dashboard";

/** Function colors: the validated categorical order (blue, orange, aqua, yellow); each always has a text label. */
export const FN_COLOR: Record<string, string> = {
  Revenue: "#64748b",
  Sales: "#2a78d6",
  Fleet: "#eb6834",
  Operations: "#1baf7a",
  Overhead: "#eda100",
  Unassigned: "#a8a29e",
};
export const PRIOR_COLOR = "#b4b9c1";
export const BUDGET_COLOR = "#1F3A5F";
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface ViewProps {
  mode: Mode;
  units: Units;
  booked: number;
  fiscalYear: number;
}

export const curLabel = (mode: Mode, fy: number, booked: number) => (mode === "pace" ? `FY ${fy} budget` : `Jan–${MONTHS[Math.max(0, booked - 1)]} ${fy} budget`);
export const priorLabel = (mode: Mode, fy: number, booked: number) => (mode === "pace" ? `${fy - 1} pace` : `Jan–${MONTHS[Math.max(0, booked - 1)]} ${fy - 1} actual`);

/** Good or bad in color and words, never color alone. */
export function changeClass(change: number, upIsGood: boolean) {
  if (Math.abs(change) < 0.5) return "text-muted-foreground";
  return change > 0 === upIsGood ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400";
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="inline-flex flex-wrap overflow-hidden rounded-md border" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}
            className={cn("min-h-9 border-r px-3 py-1.5 text-sm last:border-r-0", v === value ? "bg-muted font-medium text-foreground shadow-[inset_0_-2px_0_currentColor]" : "text-muted-foreground hover:text-foreground")}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Kpi({ label, value, change, base, upIsGood, priorText, plain, units }: { label: string; value: number; change: number; base: number; upIsGood: boolean; priorText: string; plain?: string; units: Units }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{fmtMoney(value, units)}</div>
      <div className={cn("text-xs font-medium tabular-nums", changeClass(change, upIsGood))}>
        {fmtSigned(change, units)}
        {fmtPctChange(change, base)} {Math.abs(change) >= 0.5 ? (change > 0 === upIsGood ? "better" : "worse") : ""}
      </div>
      <div className="text-xs tabular-nums text-muted-foreground">{priorText}: {fmtMoney(base, units)}</div>
      {plain && <div className="mt-1 border-t pt-2 text-xs leading-relaxed text-muted-foreground">{plain}</div>}
    </div>
  );
}

/** A thick bar for the budget over a thin one for last year, on one shared scale. */
export function BarPair({ value, prior, max, color }: { value: number; prior?: number; max: number; color: string }) {
  const w = (v: number) => `${max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0}%`;
  return (
    <div className="flex flex-col gap-0.5" aria-hidden>
      <div className="h-3 overflow-hidden rounded bg-muted"><div className="h-full rounded" style={{ width: w(value), background: color }} /></div>
      {prior != null && <div className="h-1 overflow-hidden rounded bg-muted/60"><div className="h-full rounded bg-muted-foreground/60" style={{ width: w(prior) }} /></div>}
    </div>
  );
}

/** Stacked share bar with labels beside it. */
export function ShareBar({ parts }: { parts: Array<{ key: string; value: number }> }) {
  const pos = parts.filter((p) => p.value > 0);
  return (
    <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
      {pos.map((p) => <div key={p.key} style={{ flex: `${p.value} 1 0`, background: FN_COLOR[p.key] ?? FN_COLOR.Unassigned }} />)}
    </div>
  );
}

export function Swatch({ fn }: { fn: string }) {
  return <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: FN_COLOR[fn] ?? FN_COLOR.Unassigned }} aria-hidden />;
}

const axisMoney = (u: Units) => (v: number) => {
  const div = u === "M" ? 1e6 : u === "K" ? 1e3 : 1;
  const x = v / div;
  return `${v < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: u === "M" ? 1 : 0 })}${u === "M" ? "M" : u === "K" ? "K" : ""}`;
};

/** Budget vs last year by month, bars from zero (negatives go below). */
export function MonthChart({ data, units, height = 240, priorName, budgetName }: { data: Array<{ label: string; budget: number; prior: number | null }>; units: Units; height?: number; priorName: string; budgetName: string }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="0" stroke="currentColor" strokeOpacity={0.08} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis tickFormatter={axisMoney(units)} tickLine={false} axisLine={false} fontSize={12} width={64} />
          <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.35} />
          <Tooltip
            cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
            formatter={(v, name) => [v == null ? "Not closed yet" : fmtMoney(Number(v), units), name]}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="prior" name={priorName} fill={PRIOR_COLOR} radius={[3, 3, 0, 0]} />
          <Bar dataKey="budget" name={budgetName} fill={BUDGET_COLOR} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

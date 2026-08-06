"use client";

// Marketing ROI section for the sales dashboard: revenue at each pipeline
// stage for the leads that came in during a chosen period, against the ad
// spend entered for that period. Spend is a manual monthly figure (there is
// no ads-platform integration) — one editable cell per month in the tracking
// table. Revenue is credited to the month the lead came in, so a month's ROI
// keeps improving as its leads convert.

import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { toast } from "sonner";
import {
  type Inquiry,
  STAGES,
  LOST_STAGE,
  COMPLETED_STAGE,
  isOpenStatus,
  isBookedStatus,
  fmtMoney,
} from "@/lib/inquiries/shared";
import type { AdSpendRow } from "@/lib/inquiries/use-ad-spend";

const ALL_STAGES = [...STAGES, COMPLETED_STAGE, LOST_STAGE];

// The tracking table never reaches back before this month (pre-dates the ad
// tracking effort; earlier months would just be noise).
const EARLIEST_MONTH = "2026-05-01";

const PRESETS = [
  { key: "this", label: "This month" },
  { key: "last", label: "Last month" },
  { key: "3mo", label: "3 months" },
  { key: "6mo", label: "6 months" },
  { key: "ytd", label: "Year to date" },
  { key: "all", label: "All time" },
] as const;
type PresetKey = (typeof PRESETS)[number]["key"];

function monthStart(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function shiftMonth(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  return monthStart(new Date(y, m - 1 + n, 1));
}

function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

// A won deal for ROI purposes: committed or fully closed out.
function isWon(i: Inquiry): boolean {
  return isBookedStatus(i.status) || i.status === "completed";
}

interface MonthRow {
  month: string;
  leads: number;
  adsLeads: number;
  wonRev: number;
  openRev: number;
  spend: number | null;
}

interface RoiModel {
  fromMonth: string | null; // inclusive, null = all time
  byStage: { key: string; label: string; color: string; count: number; value: number }[];
  leads: number;
  adsLeads: number;
  spend: number;
  spendMissing: boolean;
  wonRev: number;
  openRev: number;
  months: MonthRow[];
}

function buildRoi(
  inquiries: Inquiry[],
  spendRows: AdSpendRow[],
  preset: PresetKey
): RoiModel {
  const thisMonth = monthStart(new Date());
  const fromMonth =
    preset === "all"
      ? null
      : preset === "this"
        ? thisMonth
        : preset === "last"
          ? shiftMonth(thisMonth, -1)
          : preset === "3mo"
            ? shiftMonth(thisMonth, -2)
            : preset === "6mo"
              ? shiftMonth(thisMonth, -5)
              : `${thisMonth.slice(0, 4)}-01-01`; // ytd
  // "Last month" is the only window that doesn't run through today.
  const toMonth = preset === "last" ? shiftMonth(thisMonth, -1) : thisMonth;

  const inMonth = (created: string, m: string) => created.slice(0, 7) === m.slice(0, 7);
  const inWindow = (created: string) => {
    const m = created.slice(0, 7);
    if (fromMonth && m < fromMonth.slice(0, 7)) return false;
    return m <= toMonth.slice(0, 7);
  };

  const cohort = inquiries.filter((i) => inWindow(i.created_at));
  const byStage = ALL_STAGES.map((s) => {
    const rows = cohort.filter((i) => i.status === s.key);
    return {
      key: s.key,
      label: s.label,
      color: s.color,
      count: rows.length,
      value: rows.reduce((sum, i) => sum + (i.estimated_value || 0), 0),
    };
  });

  const spendInWindow = spendRows.filter((r) => {
    const m = r.month.slice(0, 7);
    if (fromMonth && m < fromMonth.slice(0, 7)) return false;
    return m <= toMonth.slice(0, 7);
  });

  // Every month from the current one back to May 2026 (when ad tracking
  // starts), newest first — the table grows a row each month.
  const months: MonthRow[] = [];
  for (let n = 0; ; n++) {
    const m = shiftMonth(thisMonth, -n);
    if (m < EARLIEST_MONTH && n > 0) break;
    const rows = inquiries.filter((i) => inMonth(i.created_at, m));
    const spendRow = spendRows.find((r) => r.month.slice(0, 7) === m.slice(0, 7));
    months.push({
      month: m,
      leads: rows.length,
      adsLeads: rows.filter((i) => !!i.gclid).length,
      wonRev: rows.filter(isWon).reduce((s, i) => s + (i.estimated_value || 0), 0),
      openRev: rows
        .filter((i) => isOpenStatus(i.status))
        .reduce((s, i) => s + (i.estimated_value || 0), 0),
      spend: spendRow ? spendRow.amount : null,
    });
  }

  return {
    fromMonth,
    byStage,
    leads: cohort.length,
    adsLeads: cohort.filter((i) => !!i.gclid).length,
    spend: spendInWindow.reduce((s, r) => s + (r.amount || 0), 0),
    spendMissing: spendInWindow.length === 0,
    wonRev: cohort.filter(isWon).reduce((s, i) => s + (i.estimated_value || 0), 0),
    openRev: cohort
      .filter((i) => isOpenStatus(i.status))
      .reduce((s, i) => s + (i.estimated_value || 0), 0),
    months,
  };
}

function roiLabel(won: number, spend: number): string {
  if (spend <= 0) return "—";
  return `${(won / spend).toFixed(1)}×`;
}

function Stat({
  label,
  value,
  foot,
}: {
  label: string;
  value: string;
  foot?: string;
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
      {foot && <div className="mt-0.5 text-[11px] text-muted-foreground">{foot}</div>}
    </div>
  );
}

// Editable monthly spend cell — commits on blur or Enter when the value
// actually changed.
function SpendInput({
  month,
  amount,
  onSave,
}: {
  month: string;
  amount: number | null;
  onSave: (month: string, amount: number) => Promise<void>;
}) {
  const [text, setText] = useState(amount == null ? "" : String(amount));
  const commit = async () => {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed === String(amount ?? "")) return;
    const parsed = Number(trimmed.replace(/[$,\s]/g, ""));
    if (!isFinite(parsed) || parsed < 0) {
      toast.error("Enter a dollar amount");
      setText(amount == null ? "" : String(amount));
      return;
    }
    await onSave(month, parsed);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground">$</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="0"
        inputMode="decimal"
        aria-label={`Ad spend for ${monthLabel(month)}`}
        className="w-20 rounded border bg-background px-1.5 py-0.5 text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </span>
  );
}

export function RoiSection({
  inquiries,
  spendRows,
  onSaveSpend,
}: {
  inquiries: Inquiry[];
  spendRows: AdSpendRow[];
  onSaveSpend: (month: string, amount: number) => Promise<void>;
}) {
  const [preset, setPreset] = useState<PresetKey>("all");
  const m = useMemo(
    () => buildRoi(inquiries, spendRows, preset),
    [inquiries, spendRows, preset]
  );

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <TrendingUp className="size-4 text-cyan-600" />
        <h3 className="text-sm font-semibold">Marketing ROI</h3>
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-muted p-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                preset === p.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Headline numbers for the selected period */}
      <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-5">
        <Stat
          label="Leads in"
          value={String(m.leads)}
          foot={`${m.adsLeads} from Google Ads`}
        />
        <Stat
          label="Ad spend"
          value={fmtMoney(m.spend)}
          foot={m.spendMissing ? "No spend entered yet" : undefined}
        />
        <Stat
          label="Cost per lead"
          value={m.leads > 0 && m.spend > 0 ? fmtMoney(m.spend / m.leads) : "—"}
        />
        <Stat label="Won revenue" value={fmtMoney(m.wonRev)} foot={`${fmtMoney(m.openRev)} still open`} />
        <Stat
          label="ROI"
          value={roiLabel(m.wonRev, m.spend)}
          foot="won revenue ÷ ad spend"
        />
      </div>

      {/* Where the period's leads sit right now */}
      <div className="border-b px-4 py-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Revenue by stage — leads from this period
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
          {m.byStage.map((s) => (
            <div
              key={s.key}
              className={`flex items-center gap-1.5 text-xs ${s.count === 0 ? "opacity-40" : ""}`}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="truncate text-muted-foreground">{s.label}</span>
              <span className="ml-auto whitespace-nowrap font-mono font-semibold">
                {s.count > 0 ? `${s.count} · ${fmtMoney(s.value)}` : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Month-by-month tracking */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-2 py-2 text-right font-medium">Leads</th>
              <th className="px-2 py-2 text-right font-medium">From ads</th>
              <th className="px-2 py-2 text-right font-medium">Won revenue</th>
              <th className="px-2 py-2 text-right font-medium">Still open</th>
              <th className="px-2 py-2 text-right font-medium">Ad spend</th>
              <th className="px-2 py-2 text-right font-medium">Cost / lead</th>
              <th className="px-4 py-2 text-right font-medium">ROI</th>
            </tr>
          </thead>
          <tbody>
            {m.months.map((row) => (
              <tr key={row.month} className="border-b last:border-b-0">
                <td className="px-4 py-2 font-medium">{monthLabel(row.month)}</td>
                <td className="px-2 py-2 text-right font-mono">{row.leads}</td>
                <td className="px-2 py-2 text-right font-mono">{row.adsLeads}</td>
                <td className="px-2 py-2 text-right font-mono">{fmtMoney(row.wonRev)}</td>
                <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                  {fmtMoney(row.openRev)}
                </td>
                <td className="px-2 py-2 text-right">
                  <SpendInput
                    key={`${row.month}:${row.spend ?? ""}`}
                    month={row.month}
                    amount={row.spend}
                    onSave={onSaveSpend}
                  />
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {row.leads > 0 && (row.spend ?? 0) > 0
                    ? fmtMoney((row.spend as number) / row.leads)
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono font-semibold">
                  {roiLabel(row.wonRev, row.spend ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2.5 text-[11px] text-muted-foreground">
        Revenue is credited to the month its lead first came in, so a month&apos;s ROI keeps
        improving as those leads book. Enter each month&apos;s ad spend to track the return;
        &quot;from ads&quot; counts leads that arrived through a Google Ads click.
      </p>
    </div>
  );
}

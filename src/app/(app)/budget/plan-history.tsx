"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { fmtPct, fmtUsd, MONTH_ABBRS } from "@/lib/budget/format";
import { readSplits, splitLabel } from "@/lib/budget/tagging";
import { readEntityAllocations } from "@/lib/budget/allocation";

interface Entry {
  id: string;
  at: string;
  user: string;
  action: string;
  resourceType: string;
  rowId: string | null;
  label: string;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
}

const FIELD_LABELS: Record<string, string> = {
  name: "Name", title: "Title", department: "Department", status: "Status", pay_type: "Pay type",
  base_rate: "Rate per hour", annual_salary: "Annual salary", amount_monthly: "Amount per month", amount_is_loaded: "Amount is whole cost",
  std_hours_week: "Hours per week", fte_pct: "FTE", start_month: "Start month", end_month: "End month",
  bonus_target: "Bonus target", commission_annual: "Commission", ot_pct: "Overtime", dt_pct: "Doubletime", meal_pct: "Meal premiums",
  other_earnings_monthly: "Other earnings per month", benefits_monthly: "Benefits per month", match_pct: "401(k) match",
  life_disability_monthly: "Life and disability", wc_class_code: "Workers comp class", pto_hours_per_period: "PTO hours per period",
  other_costs_monthly: "Other per month", merit_pct: "Merit", merit_month: "Merit month",
  comp_adj_kind: "Pay change kind", comp_adj_value: "Pay change", comp_adj_month: "Pay change effective", comp_adj_reason: "Reason",
  location_allocations: "Location", class_allocations: "Class", function_allocations: "Function",
  entity_allocations: "Company", allocation_mode: "Allocation", open_role: "Open role", is_requisition: "Planned hire", notes: "Notes",
  revenue_shares: "Revenue shares", revenue_shares_as_of: "Revenue shares as of", reporting_entity_id: "Reporting entity",
};

const USD = new Set(["annual_salary", "amount_monthly", "bonus_target", "commission_annual", "other_earnings_monthly", "benefits_monthly", "life_disability_monthly", "other_costs_monthly", "comp_adj_value"]);
const USD2 = new Set(["base_rate"]);
const PCT = new Set(["fte_pct", "ot_pct", "dt_pct", "meal_pct", "match_pct", "merit_pct"]);
const MONTH = new Set(["start_month", "end_month", "comp_adj_month", "merit_month"]);

function fmtValue(field: string, v: unknown, entityNames?: Map<string, string>): string {
  if (v == null || v === "") return "blank";
  if (field === "location_allocations" || field === "function_allocations") return splitLabel(readSplits(v)) || "blank";
  if (field === "class_allocations") return splitLabel(readSplits(v, "class")) || "blank";
  if (field === "entity_allocations" || field === "revenue_shares") {
    const a = readEntityAllocations(v);
    if (a.length === 0) return "none";
    return a.map((x) => `${entityNames?.get(x.entity_id) ?? "company"} ${Math.round(x.pct)}`).join(" / ");
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))) {
    const n = Number(v);
    if (USD.has(field)) return fmtUsd(n);
    if (USD2.has(field)) return fmtUsd(n, 2);
    if (PCT.has(field)) return fmtPct(n, 1);
    if (MONTH.has(field)) return MONTH_ABBRS[Math.min(12, Math.max(1, n)) - 1] ?? String(n);
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const ACTION_LABEL: Record<string, string> = { create: "Added", insert: "Added", update: "Edited", delete: "Removed" };

/**
 * Every audited change on the plan (or one person when rowId is set),
 * newest first, from the database audit log: who, when, and each field
 * from its old value to its new one.
 */
export function PlanHistory({ planId, rowId, entityNames, compact }: { planId: string; rowId?: string; entityNames?: Map<string, string>; compact?: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const pageSize = compact ? 20 : 50;

  const load = useCallback(async (offset: number, append: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ planId, limit: String(pageSize), offset: String(offset) });
      if (rowId) params.set("rowId", rowId);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/budget/payroll-plan/history?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load history");
      setEntries((prev) => (append ? [...prev, ...(data.entries ?? [])] : data.entries ?? []));
      setTotal(data.total ?? 0);
    } catch {
      if (!append) setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [planId, rowId, q, pageSize]);

  useEffect(() => {
    const t = setTimeout(() => load(0, false), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const list = (
    <div className="divide-y">
      {entries.map((e) => (
        <div key={e.id} className="py-2.5 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xs tabular-nums text-muted-foreground">{fmtWhen(e.at)}</span>
            <span className="font-medium">{e.user}</span>
            <span className="text-muted-foreground">{ACTION_LABEL[e.action] ?? e.action}</span>
            {!rowId && <span className="font-medium">{e.label}</span>}
          </div>
          {e.action !== "delete" && e.changes.length > 0 && (
            <ul className="mt-1 space-y-0.5 pl-3 text-xs">
              {e.changes.map((c) => (
                <li key={c.field} className="text-muted-foreground">
                  <span className="text-foreground">{FIELD_LABELS[c.field] ?? c.field}</span>
                  {e.action === "update" || e.action === "delete" ? (
                    <>
                      : <span className="line-through">{fmtValue(c.field, c.from, entityNames)}</span> to <span className="text-foreground">{fmtValue(c.field, c.to, entityNames)}</span>
                    </>
                  ) : (
                    <>: {fmtValue(c.field, c.to, entityNames)}</>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {!loading && entries.length === 0 && <p className="py-3 text-sm text-muted-foreground">{rowId ? "No changes yet for this person." : q ? "No changes match." : "No changes yet."}</p>}
      {loading && <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>}
      {!loading && entries.length < total && (
        <div className="pt-3">
          <Button variant="outline" size="sm" onClick={() => load(entries.length, true)}>
            Show more ({total - entries.length} older)
          </Button>
        </div>
      )}
    </div>
  );

  if (compact) return list;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Changes</CardTitle>
            <CardDescription>Every add, edit and removal on this plan, newest first, with who made it and each value before and after. Seeding, adjustments, tags and allocations all land here.</CardDescription>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person or field" aria-label="Find a person or field in the changes" className="h-8 w-[220px] pl-7 text-sm" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-2 text-xs text-muted-foreground">{total} {total === 1 ? "change" : "changes"}</div>
        {list}
      </CardContent>
    </Card>
  );
}

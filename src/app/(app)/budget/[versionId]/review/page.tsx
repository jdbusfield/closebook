"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useBudgetVersion } from "../version-shell";
import { fmtUsd, fmtPct, MONTH_ABBRS } from "@/lib/budget/format";
import { cn } from "@/lib/utils";

interface MasterComparable {
  masterId: string;
  accountNumber: string | null;
  name: string;
  classification: string;
  accountType: string;
  actualsByYear: Record<number, number[]>;
  trailing3Annualized: number;
  trailing6Annualized: number;
  trailing12: number;
  meanMonthly: number;
  stdDevMonthly: number;
  monthsWithData: number;
  priorBudget: number | null;
  priorActual: number | null;
  priorAccuracyPct: number | null;
}
interface Freshness {
  year: number;
  month: number;
  oldestSyncedAt: string | null;
  missingEntities: string[];
  closeStatuses: Record<string, string>;
  comparable: boolean;
  reason: string;
}
interface Comparables {
  years: number[];
  masters: MasterComparable[];
  freshness: Freshness[];
}
interface Line {
  masterAccountId: string;
  classId: string | null;
  months: number[];
  sources: string[];
  builds: Record<string, number>;
  note: string | null;
  reviewFlag: string | null;
}
interface Section {
  id: string;
  title: string;
  masters: Array<{ id: string; parentAccountId: string | null }>;
}

const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);

type Verdict = "aggressive" | "conservative" | "ok" | "no_history";

function verdictFor(budgetMonths: number[], c: MasterComparable): { verdict: Verdict; band: [number, number] } {
  const mean = c.meanMonthly;
  const sd = c.stdDevMonthly;
  const band: [number, number] = [mean - sd, mean + sd];
  if (c.monthsWithData < 6) return { verdict: "no_history", band };
  const budgetMean = sum(budgetMonths) / 12;
  const expense = c.classification === "Expense";
  if (budgetMean > band[1]) return { verdict: expense ? "conservative" : "aggressive", band };
  if (budgetMean < band[0]) return { verdict: expense ? "aggressive" : "conservative", band };
  return { verdict: "ok", band };
}

export default function BudgetReviewPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const { info, readOnly } = useBudgetVersion();
  const [comp, setComp] = useState<Comparables | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([
        fetch(`/api/budget/comparables?versionId=${versionId}`).then((r) => r.json()),
        fetch(`/api/budget/lines?versionId=${versionId}&actuals=0`).then((r) => r.json()),
      ]);
      if (c.error) throw new Error(c.error);
      if (l.error) throw new Error(l.error);
      setComp(c);
      setLines(l.lines ?? []);
      setSections(l.sections ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load review");
    } finally {
      setLoading(false);
    }
  }, [versionId]);

  useEffect(() => {
    load();
  }, [load]);

  // Budget per parent master (children and classes rolled up)
  const budgetByMaster = useMemo(() => {
    const parentOf = new Map<string, string>();
    for (const s of sections) for (const m of s.masters) if (m.parentAccountId) parentOf.set(m.id, m.parentAccountId);
    const out = new Map<string, number[]>();
    for (const l of lines) {
      const id = parentOf.get(l.masterAccountId) ?? l.masterAccountId;
      const arr = out.get(id) ?? new Array(12).fill(0);
      for (let i = 0; i < 12; i++) arr[i] += l.months[i];
      out.set(id, arr);
    }
    return out;
  }, [lines, sections]);

  const noteFor = (masterId: string) => lines.find((l) => l.masterAccountId === masterId && !l.classId);

  const saveNote = async (masterId: string, fields: { note?: string; reviewFlag?: string | null }) => {
    const existing = noteFor(masterId);
    const res = await fetch("/api/budget/lines", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId, masterAccountId: masterId, note: fields.note ?? existing?.note ?? null, reviewFlag: fields.reviewFlag === undefined ? existing?.reviewFlag ?? null : fields.reviewFlag }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Could not save");
      return;
    }
    setLines((ls) => {
      const idx = ls.findIndex((l) => l.masterAccountId === masterId && !l.classId);
      const next = [...ls];
      if (idx >= 0) next[idx] = { ...next[idx], note: fields.note ?? next[idx].note, reviewFlag: fields.reviewFlag === undefined ? next[idx].reviewFlag : fields.reviewFlag };
      else next.push({ masterAccountId: masterId, classId: null, months: new Array(12).fill(0), sources: [], builds: {}, note: fields.note ?? null, reviewFlag: fields.reviewFlag ?? null });
      return next;
    });
  };

  if (loading || !comp) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading comparables
      </div>
    );
  }

  const year = info?.version.fiscal_year ?? 0;
  const py = year - 1;
  const rows = comp.masters
    .map((c) => {
      const budget = budgetByMaster.get(c.masterId) ?? new Array(12).fill(0);
      const { verdict, band } = verdictFor(budget, c);
      return { c, budget, verdict, band, total: sum(budget) };
    })
    .filter((r) => r.total !== 0 || r.c.trailing12 !== 0)
    .filter((r) => !onlyFlagged || r.verdict === "aggressive" || r.verdict === "conservative");

  const comparableCount = comp.freshness.filter((f) => f.comparable).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Is {py} safe to compare against?</CardTitle>
          <CardDescription>
            A month counts when every entity in the group has a fresh trial balance and the period is at least soft-closed. {comparableCount} of 12 months qualify.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="grid grid-cols-6 gap-2 md:grid-cols-12">
            {comp.freshness.map((f) => (
              <div key={f.month} className={cn("rounded-md border p-2 text-xs", f.comparable ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30")} title={f.reason}>
                <div className="font-medium">{MONTH_ABBRS[f.month - 1]}</div>
                <div className="text-muted-foreground">{f.oldestSyncedAt ? new Date(f.oldestSyncedAt).toLocaleDateString() : "no TB"}</div>
                <div className="truncate text-muted-foreground">{Object.values(f.closeStatuses).every((s) => s === Object.values(f.closeStatuses)[0]) ? Object.values(f.closeStatuses)[0] : "mixed"}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Budget against history</CardTitle>
            <CardDescription>
              Band = mean monthly actual over three years ± one standard deviation. A budget outside the band is flagged and asks for a note. Accuracy = how far {py} actuals landed from the {py} budget.
            </CardDescription>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input id="review-flagged" type="checkbox" className="h-4 w-4" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
            Only flagged
          </label>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">{year} budget</TableHead>
                <TableHead className="text-right">{py} actual</TableHead>
                <TableHead className="text-right">vs {py}</TableHead>
                <TableHead className="text-right">{py - 1}</TableHead>
                <TableHead className="text-right">{py - 2}</TableHead>
                <TableHead className="text-right">T3 ann.</TableHead>
                <TableHead className="text-right">Band / mo</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead className="text-right">{py} accuracy</TableHead>
                <TableHead className="min-w-[140px]">Review</TableHead>
                <TableHead className="min-w-[220px]">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ c, verdict, band, total }) => {
                const prior = sum(c.actualsByYear[py] ?? []);
                const delta = prior ? (total - prior) / Math.abs(prior) : null;
                const n = noteFor(c.masterId);
                return (
                  <TableRow key={c.masterId}>
                    <TableCell className="whitespace-nowrap">
                      <span className="mr-2 text-xs text-muted-foreground tabular-nums">{c.accountNumber}</span>
                      {c.name}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmtUsd(total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtUsd(prior)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", delta != null && Math.abs(delta) > 0.15 && "font-medium")}>{delta == null ? "" : fmtPct(delta * 100, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmtUsd(sum(c.actualsByYear[py - 1] ?? []))}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmtUsd(sum(c.actualsByYear[py - 2] ?? []))}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmtUsd(c.trailing3Annualized)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                      {fmtUsd(band[0])} to {fmtUsd(band[1])}
                    </TableCell>
                    <TableCell>
                      <Badge variant={verdict === "ok" ? "secondary" : verdict === "no_history" ? "outline" : "default"} className={cn(verdict === "aggressive" && "bg-amber-600", verdict === "conservative" && "bg-sky-700")}>
                        {verdict.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.priorAccuracyPct == null ? <span className="text-xs text-muted-foreground">no {py} budget</span> : fmtPct(c.priorAccuracyPct, 0)}</TableCell>
                    <TableCell>
                      <Select value={n?.reviewFlag ?? "unset"} onValueChange={(v) => saveNote(c.masterId, { reviewFlag: v === "unset" ? null : v })} disabled={readOnly}>
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unset">Not reviewed</SelectItem>
                          <SelectItem value="ok">Accepted</SelectItem>
                          <SelectItem value="needs_note">Needs a note</SelectItem>
                          <SelectItem value="aggressive">Aggressive</SelectItem>
                          <SelectItem value="conservative">Conservative</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`review-note-${c.masterId}`}
                        defaultValue={n?.note ?? ""}
                        disabled={readOnly}
                        placeholder={verdict === "aggressive" || verdict === "conservative" ? "Why this differs from history" : ""}
                        onBlur={(e) => { if (e.target.value !== (n?.note ?? "")) saveNote(c.masterId, { note: e.target.value }); }}
                        className="h-8"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

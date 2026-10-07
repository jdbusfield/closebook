"use client";

import { use, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Lock, Download } from "lucide-react";
import { useBudgetVersion } from "./version-shell";
import { fmtUsd, MONTH_ABBRS } from "@/lib/budget/format";

export default function BudgetVersionOverviewPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const { info, reload, readOnly } = useBudgetVersion();
  const [recomputing, setRecomputing] = useState(false);
  const [approving, setApproving] = useState(false);
  // Last year's closed months shown in the master list (JD: Jan-Aug 2026 are closed)
  const [closedThrough, setClosedThrough] = useState(8);
  const [lastRun, setLastRun] = useState<{ positions?: number; buildsWritten?: number; personnelTotal?: number; linesUpserted: number } | null>(null);

  const recompute = async () => {
    setRecomputing(true);
    try {
      const res = await fetch("/api/budget/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, scope: "all" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Recompute failed");
      setLastRun({ positions: data.personnel?.positions, buildsWritten: data.personnel?.buildsWritten, personnelTotal: undefined, linesUpserted: data.lines?.linesUpserted ?? 0 });
      for (const w of data.warnings ?? []) toast.warning(w);
      toast.success(`Recomputed every build; ${data.lines?.linesUpserted ?? 0} cells written`);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recompute failed");
    } finally {
      setRecomputing(false);
    }
  };

  const approve = async () => {
    if (!window.confirm("Approve and lock this version? It becomes the active version the Financial Model reads, and it can no longer be edited. Later changes go into a new version.")) return;
    setApproving(true);
    try {
      const res = await fetch("/api/budget/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Approve failed");
      toast.success("Approved and locked. Snapshots saved: " + (data.snapshots ?? []).join(", "));
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setApproving(false);
    }
  };

  if (!info) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading
      </div>
    );
  }

  const steps = [
    { title: "Assumptions", href: `/budget/${versionId}/assumptions`, done: info.counts.assumptions > 0, text: info.counts.assumptions > 0 ? `${info.counts.assumptions} overrides set` : "Using catalog defaults (tax tables for the year)" },
    { title: "Headcount", href: `/budget/${versionId}/headcount`, done: info.counts.headcount > 0, text: info.counts.headcount > 0 ? `${info.counts.headcount} positions from the shared payroll plan` : "Seed the shared payroll plan to start" },
    { title: "Builds", href: `/budget/${versionId}/drivers`, done: info.counts.builds > 0, text: info.counts.builds > 0 ? `${info.counts.builds} builds` : "Run recompute after headcount is in" },
    { title: "Lines", href: `/budget/${versionId}/lines`, done: info.counts.lines > 0, text: info.counts.lines > 0 ? `${info.counts.lines} month cells` : "No amounts yet" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s) => (
          <Card key={s.title}>
            <CardHeader className="pb-2">
              <CardDescription>{s.title}</CardDescription>
              <CardTitle className="text-lg">{s.done ? "Ready" : "Not started"}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>{s.text}</span>
              <Button variant="ghost" size="sm" asChild>
                <Link href={s.href}>Open</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recompute</CardTitle>
          <CardDescription>
            Re-prices every headcount row, refreshes schedule, driver and trend builds from their sources, and sets each line to the sum of its builds. Manual items and typed-in lines on accounts without builds are left alone.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Button onClick={recompute} disabled={recomputing || readOnly}>
            {recomputing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Recompute everything
          </Button>
          {lastRun && (
            <span className="text-sm text-muted-foreground">
              {lastRun.positions != null && `${lastRun.positions} positions, ${lastRun.buildsWritten} headcount builds, `}
              {lastRun.linesUpserted} cells written{lastRun.personnelTotal != null ? `, personnel ${fmtUsd(lastRun.personnelTotal)}` : ""}
            </span>
          )}
          {readOnly && <span className="text-sm text-muted-foreground">This version is read only.</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approve and export</CardTitle>
          <CardDescription>
            Approving snapshots the comparables, assumptions, lines and headcount, makes this the active {info.version.kind} for {info.version.fiscal_year}, and locks it. Export gives the lines, headcount and builds as a workbook. The master list puts every group&apos;s lines and their items on one tab, with last year&apos;s closed months, its monthly average, this budget and a Consolidated block.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button variant="outline" asChild>
            <a href={`/api/budget/export?versionId=${versionId}`}>
              <Download className="mr-2 h-4 w-4" />
              Export XLSX
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/api/budget/export?fiscalYear=${info.version.fiscal_year}&kind=${info.version.kind}`}>
              <Download className="mr-2 h-4 w-4" />
              Export consolidated {info.version.fiscal_year}
            </a>
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <a href={`/api/budget/export/master?fiscalYear=${info.version.fiscal_year}&kind=${info.version.kind}&through=${closedThrough}`}>
                <Download className="mr-2 h-4 w-4" />
                Export master list
              </a>
            </Button>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {info.version.fiscal_year - 1} closed through
              <select className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={closedThrough} onChange={(e) => setClosedThrough(Number(e.target.value))}>
                {MONTH_ABBRS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </label>
          </div>
          {!info.version.locked_at && (
            <Button onClick={approve} disabled={approving || !info.canEdit}>
              {approving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
              Approve and lock
            </Button>
          )}
          {info.version.locked_at && (
            <span className="text-sm text-muted-foreground">Approved {new Date(info.version.approved_at ?? info.version.locked_at).toLocaleString()}.</span>
          )}
        </CardContent>
      </Card>

      {info.version.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{info.version.notes}</CardContent>
        </Card>
      )}
    </div>
  );
}

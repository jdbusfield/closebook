"use client";

import { use, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { useBudgetVersion } from "./version-shell";
import { fmtUsd } from "@/lib/budget/format";

export default function BudgetVersionOverviewPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const { info, reload, readOnly } = useBudgetVersion();
  const [recomputing, setRecomputing] = useState(false);
  const [lastRun, setLastRun] = useState<{ positions: number; buildsWritten: number; personnelTotal: number; linesUpserted: number } | null>(null);

  const recompute = async () => {
    setRecomputing(true);
    try {
      const res = await fetch("/api/budget/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Recompute failed");
      setLastRun(data);
      if (data.missingSubMasters?.length) {
        toast.warning(`Personnel sub-masters missing: ${data.missingSubMasters.join(", ")}. Builds landed on 6100.`);
      } else {
        toast.success(`Recomputed ${data.positions} positions into ${data.buildsWritten} builds`);
      }
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recompute failed");
    } finally {
      setRecomputing(false);
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
    {
      title: "Assumptions",
      href: `/budget/${versionId}/assumptions`,
      done: info.counts.assumptions > 0,
      text: info.counts.assumptions > 0 ? `${info.counts.assumptions} overrides set` : "Using catalog defaults (tax tables for the year)",
    },
    {
      title: "Headcount",
      href: `/budget/${versionId}/headcount`,
      done: info.counts.headcount > 0,
      text: info.counts.headcount > 0 ? `${info.counts.headcount} positions` : "Seed from Paylocity to start",
    },
    {
      title: "Builds",
      href: `/budget/${versionId}/drivers`,
      done: info.counts.builds > 0,
      text: info.counts.builds > 0 ? `${info.counts.builds} builds` : "Run recompute after headcount is in",
    },
    {
      title: "Lines",
      href: `/budget/${versionId}/lines`,
      done: info.counts.lines > 0,
      text: info.counts.lines > 0 ? `${info.counts.lines} month cells` : "No amounts yet",
    },
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
            Re-prices every headcount row with the current assumptions, rewrites the headcount builds, and sets each line to the sum of its builds. Manual lines on accounts without builds are left alone.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Button onClick={recompute} disabled={recomputing || readOnly}>
            {recomputing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Recompute builds and lines
          </Button>
          {lastRun && (
            <span className="text-sm text-muted-foreground">
              {lastRun.positions} positions, {lastRun.buildsWritten} builds, personnel {fmtUsd(lastRun.personnelTotal)}, {lastRun.linesUpserted} cells written
            </span>
          )}
          {readOnly && <span className="text-sm text-muted-foreground">This version is read only.</span>}
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

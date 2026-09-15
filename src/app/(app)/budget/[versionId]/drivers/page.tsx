"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";
import { useBudgetVersion } from "../version-shell";
import { fmtUsd, MONTH_ABBRS } from "@/lib/budget/format";

interface Build {
  id: string;
  master_account_id: string;
  qbo_class_id: string | null;
  build_type: string;
  source_table: string | null;
  source_id: string | null;
  component: string | null;
  label: string;
  amounts: Record<string, number>;
  assumption_keys: string[];
  is_computed: boolean;
  meta: Record<string, unknown> | null;
  note: string | null;
  computed_at: string | null;
}

interface Master {
  id: string;
  account_number: string | null;
  name: string;
}

const TYPE_LABELS: Record<string, { title: string; text: string; scope: string }> = {
  headcount: { title: "Headcount", text: "One build per position and sub-master, priced by the personnel engine.", scope: "personnel" },
  schedule: { title: "Schedules", text: "Debt interest, leases and subleases, depreciation of existing assets, insurance premiums, intercompany allocations.", scope: "schedules" },
  capex: { title: "Capex plan", text: "Depreciation, financing interest and disposal effects from the capex and disposal plan.", scope: "schedules" },
  driver: { title: "Drivers", text: "Rental revenue from units in service, utilization by month and revenue per rental day.", scope: "drivers" },
  trend: { title: "Trend", text: "Lines with no other build: trailing run rate shaped by three years of seasonality, times growth or inflation.", scope: "trend" },
  manual: { title: "Manual items", text: "Named items added on the Lines page. A recompute never changes these.", scope: "" },
};

const ORDER = ["headcount", "schedule", "capex", "driver", "trend", "manual"];

export default function BudgetDriversPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const search = useSearchParams();
  const masterFilter = search.get("master");
  const { readOnly, reload: reloadVersion } = useBudgetVersion();
  const [builds, setBuilds] = useState<Build[]>([]);
  const [masters, setMasters] = useState<Map<string, Master>>(new Map());
  const [classes, setClasses] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const url = `/api/budget/builds?versionId=${versionId}${masterFilter ? `&masterAccountId=${masterFilter}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setBuilds(data.builds ?? []);
      setMasters(new Map((data.masters ?? []).map((m: Master) => [m.id, m])));
      setClasses(new Map((data.classes ?? []).map((c: { id: string; name: string }) => [c.id, c.name])));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load builds");
    } finally {
      setLoading(false);
    }
  }, [versionId, masterFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (scope: string) => {
    setRunning(scope);
    try {
      const res = await fetch("/api/budget/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, scope }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Recompute failed");
      const parts: string[] = [];
      if (data.personnel) parts.push(`${data.personnel.buildsWritten} headcount builds`);
      if (data.schedules) parts.push(`${Object.values(data.schedules as Record<string, number>).reduce((t, v) => t + v, 0)} schedule builds`);
      if (data.drivers) parts.push(`${data.drivers.fleetRevenue} driver builds`);
      if (data.trend) parts.push(`${data.trend.builds} trend builds`);
      toast.success(`Recomputed: ${parts.join(", ")}; ${data.lines.linesUpserted} cells written`);
      for (const w of data.warnings ?? []) toast.warning(w);
      await load();
      reloadVersion();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recompute failed");
    } finally {
      setRunning(null);
    }
  };

  const grouped = useMemo(() => {
    const m = new Map<string, Build[]>();
    for (const b of builds) {
      const list = m.get(b.build_type) ?? [];
      list.push(b);
      m.set(b.build_type, list);
    }
    return ORDER.filter((t) => m.has(t) || t !== "manual").map((t) => [t, m.get(t) ?? []] as const);
  }, [builds]);

  const total = (b: Build) => Object.values(b.amounts ?? {}).reduce((t, v) => t + Number(v ?? 0), 0);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading builds
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every computed build under this version, by source. Refresh a group after its source changes (a new lease, a capex item, a pay raise). Lines are the sum of their builds.
          {masterFilter && " Showing one account; clear the filter from the Lines page."}
        </p>
        <Button onClick={() => run("all")} disabled={readOnly || running !== null}>
          {running === "all" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh everything
        </Button>
      </div>

      {grouped.map(([type, list]) => {
        const info = TYPE_LABELS[type];
        const groupTotal = list.reduce((t, b) => t + total(b), 0);
        return (
          <Card key={type}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle>
                  {info.title} <span className="ml-2 text-sm font-normal text-muted-foreground">{list.length} build{list.length === 1 ? "" : "s"} · {fmtUsd(groupTotal)}</span>
                </CardTitle>
                <CardDescription>{info.text}</CardDescription>
              </div>
              {info.scope && (
                <Button variant="outline" size="sm" onClick={() => run(info.scope)} disabled={readOnly || running !== null}>
                  {running === info.scope ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                  Refresh
                </Button>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet. Refresh to build from the current sources.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Component</TableHead>
                      <TableHead className="text-right">Year</TableHead>
                      <TableHead>Computed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((b) => {
                      const m = masters.get(b.master_account_id);
                      const open = expanded === b.id;
                      return (
                        <TableRow key={b.id} className="align-top">
                          <TableCell>
                            <button type="button" className="text-left font-medium hover:underline" onClick={() => setExpanded(open ? null : b.id)}>
                              {b.label}
                            </button>
                            {b.qbo_class_id && <div className="text-xs text-muted-foreground">Class: {classes.get(b.qbo_class_id) ?? b.qbo_class_id}</div>}
                            {open && (
                              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                                <div className="grid grid-cols-6 gap-x-3 gap-y-0.5 tabular-nums sm:grid-cols-12">
                                  {MONTH_ABBRS.map((mo, i) => (
                                    <div key={mo}>
                                      <span className="text-[10px] uppercase">{mo}</span>
                                      <div className="text-foreground">{fmtUsd(Number(b.amounts?.[String(i + 1)] ?? 0))}</div>
                                    </div>
                                  ))}
                                </div>
                                {b.meta && <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(b.meta, null, 1)}</pre>}
                                {b.assumption_keys?.length > 0 && <div>Assumptions: {b.assumption_keys.join(", ")}</div>}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{m ? `${m.account_number ?? ""} ${m.name}` : b.master_account_id}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{b.component ?? b.build_type}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{fmtUsd(total(b))}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{b.computed_at ? new Date(b.computed_at).toLocaleString() : ""}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

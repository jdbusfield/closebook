"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Star, Lock } from "lucide-react";

interface VersionRow {
  id: string;
  name: string;
  fiscal_year: number;
  kind: string;
  status: string;
  is_active: boolean;
  locked_at: string | null;
  approved_at: string | null;
  reporting_entity_id: string | null;
  entity_id: string | null;
  created_at: string;
  ownerName: string;
  ownerCode: string;
  ownerType: "reporting_entity" | "entity";
  counts?: { headcount: number; builds: number; lines: number };
}

interface ReportingEntity {
  id: string;
  name: string;
  code: string;
}

interface PlanRow {
  id: string;
  fiscal_year: number;
  status: string;
  revenue_shares_as_of: string | null;
  rowCount: number;
}

export default function BudgetOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [reportingEntities, setReportingEntities] = useState<ReportingEntity[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const nextYear = new Date().getFullYear() + 1;
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    reportingEntityId: "",
    fiscalYear: String(nextYear),
    name: `FY ${nextYear} Budget`,
    kind: "budget",
    baseVersionId: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/budget/versions");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setVersions(data.versions ?? []);
      setReportingEntities(data.reportingEntities ?? []);
      setPlans(data.plans ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byYear = useMemo(() => {
    const m = new Map<number, VersionRow[]>();
    for (const v of versions) {
      const list = m.get(v.fiscal_year) ?? [];
      list.push(v);
      m.set(v.fiscal_year, list);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [versions]);

  const create = async () => {
    if (!form.reportingEntityId || !form.name || !form.fiscalYear) {
      toast.error("Pick a reporting entity, a year and a name.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/budget/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportingEntityId: form.reportingEntityId,
          fiscalYear: Number(form.fiscalYear),
          name: form.name,
          kind: form.kind,
          baseVersionId: form.baseVersionId || undefined,
          notes: form.notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      toast.success("Version created");
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const setActive = async (v: VersionRow) => {
    const res = await fetch("/api/budgets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: v.id, is_active: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Could not set active");
      return;
    }
    toast.success(`${v.name} is now the active ${v.kind}`);
    load();
  };

  const remove = async (v: VersionRow) => {
    if (!window.confirm(`Delete "${v.name}" and everything in it? This cannot be undone.`)) return;
    const res = await fetch(`/api/budgets?versionId=${v.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Delete failed");
      return;
    }
    toast.success("Version deleted");
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Budget</h1>
          <p className="text-sm text-muted-foreground">
            One version per reporting group per year. Headcount, schedules and drivers build the lines; the Financial Model reads the active version.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New version
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading versions
        </div>
      ) : versions.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No budget versions yet</CardTitle>
            <CardDescription>Create the first version for a reporting group to start seeding headcount.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        byYear.map(([year, list]) => (
          <Card key={year}>
            <CardHeader>
              <CardTitle>Fiscal year {year}</CardTitle>
              <CardDescription>
                {list.filter((v) => v.is_active && v.kind === "budget").length} active budget{list.filter((v) => v.is_active && v.kind === "budget").length === 1 ? "" : "s"},{" "}
                {list.filter((v) => v.kind === "forecast").length} forecast{list.filter((v) => v.kind === "forecast").length === 1 ? "" : "s"}
              </CardDescription>
              <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">Shared payroll plan</span>
                <span className="text-muted-foreground">
                  {(() => {
                    const p = plans.find((x) => x.fiscal_year === year);
                    return p ? `${p.rowCount} positions, ${p.status}` : "Not started";
                  })()}
                </span>
                <Button asChild variant="outline" size="sm" className="ml-auto">
                  <Link href={`/budget/payroll/${year}`}>Open</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reporting group</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Headcount</TableHead>
                    <TableHead className="text-right">Builds</TableHead>
                    <TableHead className="text-right">Line cells</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell>
                        <div className="font-medium">{v.ownerName}</div>
                        <div className="text-xs text-muted-foreground">
                          {v.ownerType === "entity" ? "Legacy entity budget" : v.ownerCode}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/budget/${v.id}`} className="font-medium underline-offset-4 hover:underline">
                          {v.name}
                        </Link>
                      </TableCell>
                      <TableCell className="capitalize">{v.kind}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={v.status === "approved" ? "default" : v.status === "archived" ? "outline" : "secondary"}>
                            {v.status}
                          </Badge>
                          {v.is_active && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-label="Active" />}
                          {v.locked_at && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Locked" />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{v.counts?.headcount ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.counts?.builds ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.counts?.lines ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/budget/${v.id}`}>Open</Link>
                          </Button>
                          {!v.is_active && (
                            <Button variant="ghost" size="sm" onClick={() => setActive(v)}>
                              Set active
                            </Button>
                          )}
                          {!v.locked_at && (
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(v)}>
                              Delete
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New budget version</DialogTitle>
            <DialogDescription>Versions belong to a reporting group. Start empty or copy an existing version.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="budget-new-re">Reporting group</Label>
              <Select value={form.reportingEntityId} onValueChange={(v) => setForm((f) => ({ ...f, reportingEntityId: v }))}>
                <SelectTrigger id="budget-new-re">
                  <SelectValue placeholder="Choose a reporting group" />
                </SelectTrigger>
                <SelectContent>
                  {reportingEntities.map((re) => (
                    <SelectItem key={re.id} value={re.id}>
                      {re.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="budget-new-year">Fiscal year</Label>
                <Input
                  id="budget-new-year"
                  type="number"
                  value={form.fiscalYear}
                  onChange={(e) => setForm((f) => ({ ...f, fiscalYear: e.target.value, name: f.name.replace(/\d{4}/, e.target.value) }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="budget-new-kind">Kind</Label>
                <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v }))}>
                  <SelectTrigger id="budget-new-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="budget">Budget</SelectItem>
                    <SelectItem value="forecast">Forecast</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="budget-new-name">Name</Label>
              <Input id="budget-new-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="budget-new-base">Copy from</Label>
              <Select value={form.baseVersionId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, baseVersionId: v === "none" ? "" : v }))}>
                <SelectTrigger id="budget-new-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Start empty</SelectItem>
                  {versions
                    .filter((v) => v.ownerType === "reporting_entity" && (!form.reportingEntityId || v.reporting_entity_id === form.reportingEntityId))
                    .map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.ownerCode} {v.fiscal_year} {v.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="budget-new-notes">Notes</Label>
              <Textarea id="budget-new-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={creating}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

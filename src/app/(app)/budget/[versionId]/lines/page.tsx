"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Save, Plus } from "lucide-react";
import { useBudgetVersion } from "../version-shell";
import { fmtUsd, MONTH_ABBRS } from "@/lib/budget/format";
import { cn } from "@/lib/utils";

interface MasterRef {
  id: string;
  accountNumber: string | null;
  name: string;
  parentAccountId: string | null;
}
interface Section {
  id: string;
  title: string;
  masters: MasterRef[];
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
interface Payload {
  sections: Section[];
  lines: Line[];
  classes: Array<{ id: string; name: string }>;
  priorYear: Record<string, number[]>;
  priorYear2: Record<string, number[]>;
}

const NIL = "00000000-0000-0000-0000-000000000000";
const key = (masterId: string, classId: string | null) => `${masterId}|${classId ?? NIL}`;
const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);

export default function BudgetLinesPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const { info, readOnly, reload: reloadVersion } = useBudgetVersion();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPrior, setShowPrior] = useState(true);
  const [edits, setEdits] = useState<Record<string, number[]>>({}); // line key -> 12 months
  const [saving, setSaving] = useState(false);

  const [spreadOpen, setSpreadOpen] = useState<{ masterId: string; name: string } | null>(null);
  const [spreadAnnual, setSpreadAnnual] = useState("");
  const [spreadMode, setSpreadMode] = useState<"even" | "seasonal">("seasonal");
  const [cloneOpen, setCloneOpen] = useState(false);
  const [clonePct, setClonePct] = useState("100");
  const [manualOpen, setManualOpen] = useState<{ masterId: string; name: string } | null>(null);
  const [manual, setManual] = useState({ label: "", annual: "", note: "" });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/budget/lines?versionId=${versionId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json);
      setEdits({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load lines");
    } finally {
      setLoading(false);
    }
  }, [versionId]);

  useEffect(() => {
    load();
  }, [load]);

  const lineMap = useMemo(() => new Map((data?.lines ?? []).map((l) => [key(l.masterAccountId, l.classId), l])), [data]);
  const classNames = useMemo(() => new Map((data?.classes ?? []).map((c) => [c.id, c.name])), [data]);
  const year = info?.version.fiscal_year ?? 0;

  const valuesFor = (masterId: string, classId: string | null): number[] => {
    const k = key(masterId, classId);
    return edits[k] ?? lineMap.get(k)?.months ?? new Array(12).fill(0);
  };
  const isDerived = (masterId: string, classId: string | null) => {
    const l = lineMap.get(key(masterId, classId));
    return !!l && Object.keys(l.builds).length > 0;
  };
  const setCell = (masterId: string, classId: string | null, i: number, v: number) => {
    const k = key(masterId, classId);
    setEdits((e) => {
      const arr = [...(e[k] ?? lineMap.get(k)?.months ?? new Array(12).fill(0))];
      arr[i] = v;
      return { ...e, [k]: arr };
    });
  };
  const setRow = (masterId: string, classId: string | null, arr: number[]) => {
    setEdits((e) => ({ ...e, [key(masterId, classId)]: arr.map((v) => Math.round(v * 100) / 100) }));
  };

  // Rows in statement order: parent masters with children beneath; classes beneath each master
  const rows = useMemo(() => {
    if (!data) return [];
    const out: Array<{ section: Section; master: MasterRef; depth: number; classId: string | null; isSectionTotal?: boolean }> = [];
    for (const s of data.sections) {
      const parents = s.masters.filter((m) => !m.parentAccountId);
      const childrenOf = (id: string) => s.masters.filter((m) => m.parentAccountId === id);
      const push = (m: MasterRef, depth: number) => {
        out.push({ section: s, master: m, depth, classId: null });
        for (const l of data.lines.filter((l) => l.masterAccountId === m.id && l.classId)) {
          out.push({ section: s, master: m, depth: depth + 1, classId: l.classId });
        }
      };
      for (const p of parents) {
        push(p, 0);
        for (const c of childrenOf(p.id)) push(c, 1);
      }
    }
    return out;
  }, [data]);

  // Totals per section (parent-level lines only; children already roll to the parent in the statement, but
  // budgets are stored per child, so sum whichever level carries the amounts)
  const sectionTotals = useMemo(() => {
    const totals = new Map<string, number[]>();
    if (!data) return totals;
    for (const s of data.sections) {
      const t = new Array(12).fill(0);
      for (const m of s.masters) {
        const v = valuesFor(m.id, null);
        for (let i = 0; i < 12; i++) t[i] += v[i];
        for (const l of data.lines.filter((l) => l.masterAccountId === m.id && l.classId)) {
          const cv = valuesFor(m.id, l.classId);
          for (let i = 0; i < 12; i++) t[i] += cv[i];
        }
      }
      totals.set(s.id, t);
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, edits, lineMap]);

  const computed = useMemo(() => {
    const g = (id: string) => sectionTotals.get(id) ?? new Array(12).fill(0);
    const rev = g("revenue");
    const gross = rev.map((v, i) => v - g("direct_operating_costs")[i]);
    const op = gross.map((v, i) => v - g("other_operating_costs")[i]);
    const net = op.map((v, i) => v - g("other_expense")[i] + g("other_income")[i]);
    return { gross, op, net };
  }, [sectionTotals]);

  const dirty = Object.keys(edits).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const cells: Array<{ masterAccountId: string; classId: string | null; periodYear: number; periodMonth: number; amount: number; source: string }> = [];
      for (const [k, arr] of Object.entries(edits)) {
        const [masterId, classKey] = k.split("|");
        const classId = classKey === NIL ? null : classKey;
        const before = lineMap.get(k)?.months ?? new Array(12).fill(0);
        for (let i = 0; i < 12; i++) {
          if (Math.round(arr[i] * 100) === Math.round(before[i] * 100)) continue;
          cells.push({ masterAccountId: masterId, classId, periodYear: year, periodMonth: i + 1, amount: arr[i], source: "manual" });
        }
      }
      if (cells.length === 0) {
        setEdits({});
        return;
      }
      const res = await fetch("/api/budget/amounts/batch", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, cells }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      toast.success(`Saved ${json.upserted} cell${json.upserted === 1 ? "" : "s"}${json.deleted ? `, cleared ${json.deleted}` : ""}`);
      await load();
      reloadVersion();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const applySpread = () => {
    if (!spreadOpen || !data) return;
    const annual = Number(spreadAnnual);
    if (!annual && annual !== 0) return;
    const py = data.priorYear[spreadOpen.masterId];
    const pyTotal = py ? sum(py) : 0;
    const arr =
      spreadMode === "seasonal" && py && Math.abs(pyTotal) > 0.005
        ? py.map((v) => (annual * v) / pyTotal)
        : new Array(12).fill(annual / 12);
    setRow(spreadOpen.masterId, null, arr);
    setSpreadOpen(null);
    setSpreadAnnual("");
  };

  const applyClone = () => {
    if (!data) return;
    const pct = Number(clonePct) / 100;
    let n = 0;
    for (const s of data.sections) {
      for (const m of s.masters) {
        if (isDerived(m.id, null)) continue;
        const py = data.priorYear[m.id];
        if (!py || sum(py) === 0) continue;
        setRow(m.id, null, py.map((v) => v * pct));
        n++;
      }
    }
    setCloneOpen(false);
    toast.success(`Filled ${n} lines from ${year - 1} actuals × ${clonePct}%. Save to keep them.`);
  };

  const addManual = async () => {
    if (!manualOpen || !manual.label) return;
    const annual = Number(manual.annual || 0);
    const py = data?.priorYear[manualOpen.masterId];
    const pyTotal = py ? sum(py) : 0;
    const amounts: Record<string, number> = {};
    for (let i = 0; i < 12; i++) amounts[String(i + 1)] = py && Math.abs(pyTotal) > 0.005 ? (annual * py[i]) / pyTotal : annual / 12;
    const res = await fetch("/api/budget/builds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId, masterAccountId: manualOpen.masterId, label: manual.label, amounts, note: manual.note || null }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "Could not add item");
      return;
    }
    toast.success("Item added; the line now equals the sum of its items");
    setManualOpen(null);
    setManual({ label: "", annual: "", note: "" });
    await load();
    reloadVersion();
  };

  if (loading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading lines
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Lines with builds are read only here and change through their source (headcount, schedules, drivers, manual items). Other lines are typed in, spread from an annual figure, or filled from last year.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch id="lines-prior" checked={showPrior} onCheckedChange={setShowPrior} />
            <span>Show {year - 1} actuals</span>
          </label>
          <Button variant="outline" onClick={() => setCloneOpen(true)} disabled={readOnly}>
            Fill from {year - 1}
          </Button>
          <Button onClick={save} disabled={!dirty || saving || readOnly}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save changes
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 min-w-[260px] bg-background">Account</TableHead>
                {MONTH_ABBRS.map((m) => <TableHead key={m} className="min-w-[92px] text-right">{m}</TableHead>)}
                <TableHead className="min-w-[110px] text-right">Total</TableHead>
                <TableHead className="min-w-[110px] text-right">{year - 1}</TableHead>
                <TableHead className="min-w-[140px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sections.map((s) => {
                const sectionRows = rows.filter((r) => r.section.id === s.id);
                const t = sectionTotals.get(s.id) ?? new Array(12).fill(0);
                const pyT = s.masters.reduce((acc, m) => acc + sum(data.priorYear[m.id] ?? []), 0);
                return [
                  <TableRow key={`${s.id}-head`} className="bg-muted/40">
                    <TableCell colSpan={16} className="sticky left-0 font-semibold">{s.title}</TableCell>
                  </TableRow>,
                  ...sectionRows.map((r) => {
                    const derived = isDerived(r.master.id, r.classId);
                    const vals = valuesFor(r.master.id, r.classId);
                    const py = r.classId ? null : data.priorYear[r.master.id];
                    const k = key(r.master.id, r.classId);
                    const line = lineMap.get(k);
                    const editedRow = k in edits;
                    return [
                      <TableRow key={k} className={cn(editedRow && "bg-amber-50/60 dark:bg-amber-950/20")}>
                        <TableCell className="sticky left-0 z-10 bg-background">
                          <div className={cn("flex items-center gap-2", r.depth > 0 && "pl-4")}>
                            <span className="text-xs text-muted-foreground tabular-nums">{r.classId ? "" : r.master.accountNumber}</span>
                            <span className={cn(r.depth === 0 ? "font-medium" : "text-sm")}>{r.classId ? `Class: ${classNames.get(r.classId) ?? "unknown"}` : r.master.name}</span>
                          </div>
                          {line?.note && <div className="text-xs text-muted-foreground">{line.note}</div>}
                        </TableCell>
                        {vals.map((v, i) => (
                          <TableCell key={i} className="p-1 text-right">
                            {derived || readOnly ? (
                              <span className={cn("block px-1.5 py-1 text-xs tabular-nums", derived && "text-muted-foreground")}>{v ? fmtUsd(v) : ""}</span>
                            ) : (
                              <Input
                                id={`cell-${k}-${i}`}
                                type="number"
                                step="1"
                                value={v === 0 ? "" : String(Math.round(v * 100) / 100)}
                                onChange={(e) => setCell(r.master.id, r.classId, i, Number(e.target.value || 0))}
                                className="h-7 w-[88px] px-1.5 text-right text-xs tabular-nums"
                              />
                            )}
                          </TableCell>
                        ))}
                        <TableCell className="text-right text-sm font-medium tabular-nums">{fmtUsd(sum(vals))}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{py ? fmtUsd(sum(py)) : ""}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {derived ? (
                            <Link href={`/budget/${versionId}/drivers?master=${r.master.id}`} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                              {Object.entries(line!.builds).map(([t2, n]) => `${n} ${t2}`).join(", ")}
                            </Link>
                          ) : !readOnly && !r.classId ? (
                            <div className="flex gap-1">
                              <Button variant="ghost" size="xs" onClick={() => { setSpreadOpen({ masterId: r.master.id, name: r.master.name }); setSpreadAnnual(String(Math.round(sum(vals)))); }}>
                                Spread
                              </Button>
                              <Button variant="ghost" size="xs" onClick={() => setRow(r.master.id, null, new Array(12).fill(vals[0]))} title="Copy January across">
                                Fill →
                              </Button>
                              <Button variant="ghost" size="xs" onClick={() => setManualOpen({ masterId: r.master.id, name: r.master.name })} title="Add a named item">
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>,
                      showPrior && py && sum(py) !== 0 && !r.classId ? (
                        <TableRow key={`${k}-py`} className="text-xs text-muted-foreground">
                          <TableCell className={cn("sticky left-0 z-10 bg-background py-0.5", r.depth > 0 ? "pl-10" : "pl-6")}>{year - 1} actual</TableCell>
                          {py.map((v, i) => <TableCell key={i} className="py-0.5 text-right tabular-nums">{v ? fmtUsd(v) : ""}</TableCell>)}
                          <TableCell className="py-0.5 text-right tabular-nums">{fmtUsd(sum(py))}</TableCell>
                          <TableCell colSpan={2} />
                        </TableRow>
                      ) : null,
                    ];
                  }),
                  <TableRow key={`${s.id}-total`} className="font-medium">
                    <TableCell className="sticky left-0 z-10 bg-background">Total {s.title.toLowerCase()}</TableCell>
                    {t.map((v, i) => <TableCell key={i} className="text-right text-sm tabular-nums">{fmtUsd(v)}</TableCell>)}
                    <TableCell className="text-right text-sm tabular-nums">{fmtUsd(sum(t))}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{fmtUsd(pyT)}</TableCell>
                    <TableCell />
                  </TableRow>,
                  s.id === "direct_operating_costs" ? computedRow("Gross margin", computed.gross) : null,
                  s.id === "other_operating_costs" ? computedRow("Operating margin", computed.op) : null,
                  s.id === "other_income" ? computedRow("Net income", computed.net) : null,
                ];
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Spread dialog */}
      <Dialog open={!!spreadOpen} onOpenChange={(o) => { if (!o) setSpreadOpen(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Spread an annual amount</DialogTitle>
            <DialogDescription>{spreadOpen?.name}: enter the year total and choose how it lands across the months.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="spread-annual">Annual amount</Label>
              <Input id="spread-annual" type="number" value={spreadAnnual} onChange={(e) => setSpreadAnnual(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant={spreadMode === "seasonal" ? "default" : "outline"} size="sm" onClick={() => setSpreadMode("seasonal")}>
                {year - 1} shape
              </Button>
              <Button variant={spreadMode === "even" ? "default" : "outline"} size="sm" onClick={() => setSpreadMode("even")}>
                Even twelfths
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpreadOpen(null)}>Cancel</Button>
            <Button onClick={applySpread}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clone dialog */}
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fill from {year - 1} actuals</DialogTitle>
            <DialogDescription>Every line without builds gets last year&apos;s monthly actuals times the percentage. Lines with builds are skipped. Nothing is saved until you click Save.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="clone-pct">Percentage of {year - 1}</Label>
            <Input id="clone-pct" type="number" value={clonePct} onChange={(e) => setClonePct(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneOpen(false)}>Cancel</Button>
            <Button onClick={applyClone}>Fill</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual item dialog */}
      <Dialog open={!!manualOpen} onOpenChange={(o) => { if (!o) setManualOpen(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a named item</DialogTitle>
            <DialogDescription>{manualOpen?.name}: a contract, retainer or known cost. The line becomes the sum of its items and turns read only.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="manual-label">Item</Label>
              <Input id="manual-label" value={manual.label} onChange={(e) => setManual((m) => ({ ...m, label: e.target.value }))} placeholder="Audit and tax, Sheakley" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="manual-annual">Annual amount (spread by last year&apos;s shape)</Label>
              <Input id="manual-annual" type="number" value={manual.annual} onChange={(e) => setManual((m) => ({ ...m, annual: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="manual-note">Note</Label>
              <Input id="manual-note" value={manual.note} onChange={(e) => setManual((m) => ({ ...m, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(null)}>Cancel</Button>
            <Button onClick={addManual} disabled={!manual.label}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  function computedRow(label: string, arr: number[]) {
    return (
      <TableRow key={label} className="bg-muted/30 font-semibold">
        <TableCell className="sticky left-0 z-10 bg-muted/30">{label}</TableCell>
        {arr.map((v, i) => <TableCell key={i} className="text-right text-sm tabular-nums">{fmtUsd(v)}</TableCell>)}
        <TableCell className="text-right text-sm tabular-nums">{fmtUsd(sum(arr))}</TableCell>
        <TableCell colSpan={2} />
      </TableRow>
    );
  }
}

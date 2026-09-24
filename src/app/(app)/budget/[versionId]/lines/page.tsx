"use client";

import { Fragment, use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Plus, RefreshCw } from "lucide-react";
import { useBudgetVersion } from "../version-shell";
import { fmtPct, fmtUsd, MONTH_ABBRS } from "@/lib/budget/format";
import { METHOD_KINDS, type LineMethod, type MethodKind } from "@/lib/budget/line-methods";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  kind: "payroll" | "schedule" | "driver" | "capex" | "run_rate" | "method" | "manual" | "entered";
  label: string;
  source: string;
  sourceHref: string | null;
  methodText: string | null;
  method: LineMethod | null;
  note: string | null;
  count: number | null;
  months: number[];
  total: number;
  editable: boolean;
  history: { priorYear: number; trailing12: number } | null;
}
interface MasterLine {
  id: string;
  accountNumber: string | null;
  name: string;
  months: number[];
  items: Item[];
  note: string | null;
  reviewFlag: string | null;
}
interface Section {
  id: string;
  title: string;
  /** Rolls up to EBITDA; the rest sit under the schedules line */
  model: boolean;
  masters: MasterLine[];
}
interface Payload {
  sections: Section[];
  priorYear: Record<string, number[]>;
  belowEbitda: { months: number[]; priorYear: number[] };
  lineMasters: Array<{ id: string; name: string; accountNumber: string | null }>;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
const addTo = (t: number[], s: number[]) => s.forEach((v, i) => (t[i] += v));
const zeros = () => new Array(12).fill(0) as number[];

function changePct(now: number, prior: number): string {
  if (!prior) return now ? "new" : "";
  const p = ((now - prior) / Math.abs(prior)) * 100;
  return `${p > 0 ? "+" : ""}${fmtPct(p)}`;
}

/** Row of twelve month cells plus total, prior and change */
function MonthCells({ months, prior, showPrior, className, bold, invert }: { months: number[]; prior?: number[]; showPrior: boolean; className?: string; bold?: boolean; invert?: boolean }) {
  const total = sum(months);
  const priorTotal = prior ? sum(prior) : 0;
  const pct = prior ? changePct(total, priorTotal) : "";
  const up = total > priorTotal;
  // For costs, up is red; for revenue (invert), up is green
  const tone = !prior || !pct || pct === "new" ? "" : up === !invert ? "text-red-700" : "text-emerald-700";
  return (
    <>
      {months.map((v, i) => (
        <TableCell key={i} className={cn("whitespace-nowrap text-right tabular-nums", className, bold && "font-medium")}>{v ? fmtUsd(v) : ""}</TableCell>
      ))}
      <TableCell className={cn("whitespace-nowrap text-right tabular-nums", className, "font-medium")}>{fmtUsd(total)}</TableCell>
      {showPrior && (
        <>
          <TableCell className={cn("whitespace-nowrap text-right tabular-nums text-muted-foreground", className)}>{prior ? fmtUsd(priorTotal) : ""}</TableCell>
          <TableCell className={cn("whitespace-nowrap text-right tabular-nums text-xs", className, tone)}>{pct}</TableCell>
        </>
      )}
    </>
  );
}

export default function BudgetModelPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const { info, readOnly } = useBudgetVersion();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPrior, setShowPrior] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ master: MasterLine; item: Item | null } | null>(null);
  const [removing, setRemoving] = useState<{ master: MasterLine; item: Item } | null>(null);
  const fiscalYear = info?.version.fiscal_year ?? new Date().getFullYear() + 1;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/budget/lines?versionId=${versionId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData({ ...json, sections: (json.sections as Section[]).filter((s) => s.model) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load the model");
    } finally {
      setLoading(false);
    }
  }, [versionId]);
  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allIds = useMemo(() => (data ? data.sections.flatMap((s) => s.masters.map((m) => m.id)) : []), [data]);

  const totals = useMemo(() => {
    if (!data) return null;
    const bySection: Record<string, number[]> = {};
    const priorBySection: Record<string, number[]> = {};
    for (const s of data.sections) {
      const t = zeros();
      const p = zeros();
      for (const m of s.masters) {
        addTo(t, m.months);
        addTo(p, data.priorYear[m.id] ?? zeros());
      }
      bySection[s.id] = t;
      priorBySection[s.id] = p;
    }
    const get = (k: string, src: Record<string, number[]>) => src[k] ?? zeros();
    const line = (src: Record<string, number[]>) => {
      const rev = get("revenue", src);
      const doc = get("direct_operating_costs", src);
      const ooc = get("other_operating_costs", src);
      const gross = rev.map((v, i) => v - doc[i]);
      const ebitda = gross.map((v, i) => v - ooc[i]);
      return { rev, gross, ebitda };
    };
    const now = line(bySection);
    const prior = line(priorBySection);
    const netIncome = now.ebitda.map((v, i) => v - data.belowEbitda.months[i]);
    const netIncomePrior = prior.ebitda.map((v, i) => v - data.belowEbitda.priorYear[i]);
    return { bySection, priorBySection, now, prior, netIncome, netIncomePrior };
  }, [data]);

  const recompute = async () => {
    setBusy("recompute");
    try {
      const res = await fetch("/api/budget/recompute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId, scope: "all" }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Recompute failed");
      toast.success("Recomputed from every source");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recompute failed");
    } finally {
      setBusy(null);
    }
  };

  const breakout = async (master: MasterLine) => {
    setBusy(master.id);
    try {
      const res = await fetch("/api/budget/builds/breakout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId, masterAccountId: master.id }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Breakout failed");
      toast.success(json.items ? `${master.name}: ${json.items} items from ${json.accounts} accounts` : `${master.name}: nothing booked last year to break out`);
      setOpen((prev) => new Set(prev).add(master.id));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Breakout failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(removing.item.id);
    try {
      const res = await fetch(`/api/budget/builds?id=${removing.item.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Remove failed");
      setRemoving(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the model
      </div>
    );
  }
  if (!data || !totals) return <p className="text-sm text-muted-foreground">Nothing to show.</p>;

  const colSpan = 1 + 12 + 1 + (showPrior ? 2 : 0);
  const prior = fiscalYear - 1;

  const subtotalRow = (label: string, months: number[], priorMonths: number[], opts?: { strong?: boolean; invert?: boolean; pctOf?: number[] }) => (
    <TableRow className={cn("bg-muted/30", opts?.strong ? "border-t-2 font-semibold" : "font-medium")}>
      <TableCell className="whitespace-nowrap">{label}</TableCell>
      <MonthCells months={months} prior={priorMonths} showPrior={showPrior} bold invert={opts?.invert} />
    </TableRow>
  );
  const pctRow = (label: string, num: number[], den: number[]) => (
    <TableRow className="text-xs text-muted-foreground">
      <TableCell className="whitespace-nowrap">{label}</TableCell>
      {num.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{den[i] ? fmtPct((v / den[i]) * 100) : ""}</TableCell>)}
      <TableCell className="text-right tabular-nums">{sum(den) ? fmtPct((sum(num) / sum(den)) * 100) : ""}</TableCell>
      {showPrior && <TableCell colSpan={2} />}
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle>Budget model</CardTitle>
              <CardDescription>
                The income statement the way the Financial Model shows it, through EBITDA. Each line is the sum of the items under it. Payroll comes from the Payroll plan, rent from the Real Estate leases, insurance from the policies and fleet revenue from the driver. Every other line runs at its trailing rate until you replace that with items that say what the money is and why.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <Switch checked={showPrior} onCheckedChange={setShowPrior} />
                <span>{prior} actual</span>
              </label>
              <Button variant="outline" size="sm" onClick={() => setOpen(open.size === allIds.length ? new Set() : new Set(allIds))}>
                {open.size === allIds.length ? "Collapse all" : "Expand all"}
              </Button>
              {!readOnly && (
                <Button variant="outline" size="sm" onClick={recompute} disabled={busy === "recompute"}>
                  {busy === "recompute" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Recompute
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[380px] min-w-[380px] max-w-[380px]">Account</TableHead>
                {MONTH_ABBRS.map((m) => <TableHead key={m} className="text-right">{m}</TableHead>)}
                <TableHead className="text-right">Total</TableHead>
                {showPrior && (
                  <>
                    <TableHead className="text-right">{prior}</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sections.map((s) => {
                const invert = s.id === "revenue";
                return (
                  <Fragment key={s.id}>
                    <TableRow className="bg-muted/50">
                      <TableCell colSpan={colSpan} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</TableCell>
                    </TableRow>
                    {s.masters.map((m) => {
                      const expanded = open.has(m.id);
                      const p = data.priorYear[m.id];
                      const runRate = m.items.find((it) => it.kind === "run_rate");
                      return (
                        <Fragment key={m.id}>
                          <TableRow className={cn(expanded && "bg-muted/20")}>
                            <TableCell className="whitespace-nowrap">
                              <button type="button" onClick={() => toggle(m.id)} className="flex items-center gap-1.5 text-left" aria-expanded={expanded}>
                                {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                <span className="text-xs tabular-nums text-muted-foreground">{m.accountNumber}</span>
                                <span className="font-medium">{m.name}</span>
                                {m.items.length > 0 && <span className="text-xs text-muted-foreground">{m.items.length === 1 && runRate ? "run rate" : `${m.items.length} item${m.items.length === 1 ? "" : "s"}`}</span>}
                              </button>
                            </TableCell>
                            <MonthCells months={m.months} prior={p} showPrior={showPrior} invert={invert} />
                          </TableRow>
                          {expanded && (
                            <>
                              {m.items.map((it) => (
                                <TableRow key={it.id} className="text-sm">
                                  <TableCell className="w-[380px] min-w-[380px] max-w-[380px] whitespace-normal py-1.5 pl-9 align-top">
                                    <div className="flex items-start gap-2">
                                      <div className="min-w-0 break-words">
                                        <div className="flex flex-wrap items-center gap-x-2">
                                          <span>{it.label}</span>
                                          {it.count != null && <span className="text-xs text-muted-foreground">{it.count} {it.kind === "payroll" ? "people" : "rows"}</span>}
                                          <span className={cn("rounded border px-1.5 text-[11px] leading-5", it.editable ? "border-foreground/30" : "text-muted-foreground")}>{it.source}</span>
                                          {it.sourceHref && (
                                            <Link href={it.sourceHref} className="text-muted-foreground hover:text-foreground" aria-label={`Open ${it.source}`}>
                                              <ExternalLink className="h-3 w-3" />
                                            </Link>
                                          )}
                                        </div>
                                        {it.methodText && <div className="text-xs text-muted-foreground">{it.methodText}{it.history && it.history.priorYear ? ` · ${prior} ${fmtUsd(it.history.priorYear)}` : ""}</div>}
                                        {it.note && <div className="text-xs italic text-muted-foreground">{it.note}</div>}
                                      </div>
                                      {!readOnly && it.editable && (
                                        <div className="ml-auto flex shrink-0 gap-1">
                                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setEditing({ master: m, item: it })}>Edit</Button>
                                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => setRemoving({ master: m, item: it })}>Remove</Button>
                                        </div>
                                      )}
                                      {!readOnly && it.kind === "run_rate" && (
                                        <div className="ml-auto flex shrink-0 gap-1">
                                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setEditing({ master: m, item: null })}>Replace with items</Button>
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                  <MonthCells months={it.months} showPrior={showPrior} className="py-1.5 text-xs text-muted-foreground" />
                                </TableRow>
                              ))}
                              {m.items.length === 0 && (
                                <TableRow className="text-sm">
                                  <TableCell colSpan={colSpan} className="py-1.5 pl-9 text-xs text-muted-foreground">Nothing under this line yet.</TableCell>
                                </TableRow>
                              )}
                              {!readOnly && (
                                <TableRow>
                                  <TableCell colSpan={colSpan} className="py-1.5 pl-9">
                                    <div className="flex flex-wrap gap-2">
                                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditing({ master: m, item: null })}>
                                        <Plus className="mr-1 h-3 w-3" /> Add item
                                      </Button>
                                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => breakout(m)} disabled={busy === m.id} title="One run-rate item per account that fed this line last year">
                                        {busy === m.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                                        Break out by account
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                              {showPrior && p && (
                                <TableRow className="text-xs text-muted-foreground">
                                  <TableCell className="py-1 pl-9">{prior} actual</TableCell>
                                  {p.map((v, i) => <TableCell key={i} className="py-1 text-right tabular-nums">{v ? fmtUsd(v) : ""}</TableCell>)}
                                  <TableCell className="py-1 text-right tabular-nums">{fmtUsd(sum(p))}</TableCell>
                                  <TableCell colSpan={2} />
                                </TableRow>
                              )}
                            </>
                          )}
                        </Fragment>
                      );
                    })}
                    {subtotalRow(`Total ${s.title.toLowerCase()}`, totals.bySection[s.id] ?? zeros(), totals.priorBySection[s.id] ?? zeros(), { invert })}
                    {s.id === "direct_operating_costs" && (
                      <>
                        {subtotalRow("Gross margin", totals.now.gross, totals.prior.gross, { strong: true, invert: true })}
                        {pctRow("Gross margin %", totals.now.gross, totals.now.rev)}
                      </>
                    )}
                    {s.id === "other_operating_costs" && (
                      <>
                        {subtotalRow("Total EBITDA", totals.now.ebitda, totals.prior.ebitda, { strong: true, invert: true })}
                        {pctRow("EBITDA %", totals.now.ebitda, totals.now.rev)}
                      </>
                    )}
                  </Fragment>
                );
              })}
              <TableRow className="text-sm text-muted-foreground">
                <TableCell className="whitespace-nowrap">
                  Below EBITDA, from the debt, asset and capex schedules
                  <Link href={`/budget/${versionId}/drivers`} className="ml-2 text-xs underline-offset-2 hover:underline">Drivers</Link>
                </TableCell>
                <MonthCells months={data.belowEbitda.months} prior={data.belowEbitda.priorYear} showPrior={showPrior} className="text-muted-foreground" />
              </TableRow>
              {subtotalRow("Net income", totals.netIncome, totals.netIncomePrior, { strong: true, invert: true })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <ItemDialog
          versionId={versionId}
          master={editing.master}
          item={editing.item}
          lineMasters={data.lineMasters}
          fiscalYear={fiscalYear}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setOpen((prev) => new Set(prev).add(editing.master.id));
            await load();
          }}
        />
      )}

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this item?</DialogTitle>
            <DialogDescription>{removing ? `${removing.item.label} comes off ${removing.master.name}. The line becomes the sum of what is left.` : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>Keep it</Button>
            <Button variant="destructive" onClick={remove} disabled={!!busy}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Add or edit one item: what it is, why, and the method that prices it. */
function ItemDialog({
  versionId,
  master,
  item,
  lineMasters,
  fiscalYear,
  onClose,
  onSaved,
}: {
  versionId: string;
  master: MasterLine;
  item: Item | null;
  lineMasters: Array<{ id: string; name: string; accountNumber: string | null }>;
  fiscalYear: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const initialMethod: LineMethod = item?.method ?? (item?.kind === "manual" ? { kind: "months", months: item.months } : { kind: "run_rate", pct: 0 });
  const [label, setLabel] = useState(item?.label ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [kind, setKind] = useState<MethodKind>(initialMethod.kind);
  const [amount, setAmount] = useState(initialMethod.amount != null ? String(initialMethod.amount) : "");
  const [pct, setPct] = useState(initialMethod.pct != null ? String(initialMethod.pct) : "");
  const [startMonth, setStartMonth] = useState(String(initialMethod.start_month ?? 1));
  const [endMonth, setEndMonth] = useState(String(initialMethod.end_month ?? 12));
  const [month, setMonth] = useState(String(initialMethod.month ?? 1));
  const [spread, setSpread] = useState<"even" | "shape">(initialMethod.spread ?? "shape");
  const [basis, setBasis] = useState<"trailing_12" | "trailing_3">(initialMethod.basis ?? "trailing_12");
  const [sourceMaster, setSourceMaster] = useState(initialMethod.source_master_id ?? lineMasters.find((m) => m.id !== master.id)?.id ?? "");
  const [months, setMonths] = useState<string[]>((initialMethod.months ?? item?.months ?? zeros()).map((v) => (v ? String(v) : "")));
  const [saving, setSaving] = useState(false);
  const accountIds = initialMethod.account_ids;
  const prior = fiscalYear - 1;

  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const method = (): LineMethod => {
    const base: LineMethod = { kind, account_ids: accountIds };
    if (kind === "flat" || kind === "annual" || kind === "one_time") base.amount = num(amount) ?? 0;
    if (kind === "prior_year" || kind === "run_rate" || kind === "pct_of_line") base.pct = num(pct) ?? 0;
    if (kind === "flat" || kind === "annual" || kind === "prior_year" || kind === "run_rate" || kind === "pct_of_line") {
      base.start_month = Number(startMonth);
      base.end_month = Number(endMonth);
    }
    if (kind === "one_time") base.month = Number(month);
    if (kind === "annual") base.spread = spread;
    if (kind === "run_rate") base.basis = basis;
    if (kind === "pct_of_line") base.source_master_id = sourceMaster;
    if (kind === "months") base.months = months.map((s) => Number(s) || 0);
    return base;
  };

  const save = async () => {
    if (!label.trim()) {
      toast.error("Give the item a name.");
      return;
    }
    setSaving(true);
    try {
      const body = item
        ? { id: item.id, label: label.trim(), note: note.trim() || null, method: method() }
        : { versionId, masterAccountId: master.id, label: label.trim(), note: note.trim() || null, method: method() };
      const res = await fetch("/api/budget/builds", { method: item ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      toast.success(item ? "Item updated" : "Item added");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const monthSelect = (value: string, onChange: (v: string) => void, id: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-8 text-sm"><SelectValue /></SelectTrigger>
      <SelectContent>{MONTH_NAMES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
    </Select>
  );
  const hasRange = kind === "flat" || kind === "annual" || kind === "prior_year" || kind === "run_rate" || kind === "pct_of_line";
  const help = METHOD_KINDS.find((k) => k.kind === kind)?.help ?? "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? "Edit item" : "Add item"} under {master.name}</DialogTitle>
          <DialogDescription>What the money is, why it is what it is, and the method that prices it. The line becomes the sum of its items.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="item-label">Name</Label>
              <Input id="item-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Software subscriptions" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="item-note">Why</Label>
              <Input id="item-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Two new seats in March" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="item-kind">Method</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as MethodKind)}>
              <SelectTrigger id="item-kind" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{METHOD_KINDS.map((k) => <SelectItem key={k.kind} value={k.kind}>{k.label}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{help}{accountIds?.length ? ` History comes from ${accountIds.length} account${accountIds.length === 1 ? "" : "s"} under this line.` : ""}</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {(kind === "flat" || kind === "annual" || kind === "one_time") && (
              <div className="grid gap-1.5">
                <Label htmlFor="item-amount">{kind === "flat" ? "Amount per month" : kind === "annual" ? "Amount for the year" : "Amount"}</Label>
                <Input id="item-amount" type="number" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            )}
            {(kind === "prior_year" || kind === "run_rate") && (
              <div className="grid gap-1.5">
                <Label htmlFor="item-pct">Change %</Label>
                <Input id="item-pct" type="number" step="0.1" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="0" />
              </div>
            )}
            {kind === "pct_of_line" && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="item-pct">Percent</Label>
                  <Input id="item-pct" type="number" step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="2.5" />
                </div>
                <div className="col-span-2 grid gap-1.5">
                  <Label htmlFor="item-source">Of line</Label>
                  <Select value={sourceMaster} onValueChange={setSourceMaster}>
                    <SelectTrigger id="item-source" className="h-9"><SelectValue placeholder="Choose a line" /></SelectTrigger>
                    <SelectContent>
                      {lineMasters.filter((m) => m.id !== master.id).map((m) => <SelectItem key={m.id} value={m.id}>{m.accountNumber} {m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {kind === "annual" && (
              <div className="grid gap-1.5">
                <Label>Spread</Label>
                <div className="flex w-fit overflow-hidden rounded-md border">
                  {([["shape", `${prior}'s shape`], ["even", "Evenly"]] as const).map(([v, l], i) => (
                    <button key={v} type="button" onClick={() => setSpread(v)} aria-pressed={spread === v} className={cn("px-3 py-1.5 text-sm", i > 0 && "border-l", spread === v ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted/40")}>{l}</button>
                  ))}
                </div>
              </div>
            )}
            {kind === "run_rate" && (
              <div className="grid gap-1.5">
                <Label>Basis</Label>
                <div className="flex w-fit overflow-hidden rounded-md border">
                  {([["trailing_12", "Trailing 12"], ["trailing_3", "Last 3, annualized"]] as const).map(([v, l], i) => (
                    <button key={v} type="button" onClick={() => setBasis(v)} aria-pressed={basis === v} className={cn("px-3 py-1.5 text-sm", i > 0 && "border-l", basis === v ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted/40")}>{l}</button>
                  ))}
                </div>
              </div>
            )}
            {kind === "one_time" && (
              <div className="grid gap-1.5">
                <Label htmlFor="item-month">Month</Label>
                {monthSelect(month, setMonth, "item-month")}
              </div>
            )}
            {hasRange && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="item-start">From</Label>
                  {monthSelect(startMonth, setStartMonth, "item-start")}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="item-end">Through</Label>
                  {monthSelect(endMonth, setEndMonth, "item-end")}
                </div>
              </>
            )}
          </div>

          {kind === "months" && (
            <div className="grid grid-cols-6 gap-2">
              {MONTH_ABBRS.map((m, i) => (
                <div key={m} className="grid gap-1">
                  <Label htmlFor={`item-m-${i}`} className="text-xs">{m}</Label>
                  <Input id={`item-m-${i}`} type="number" step="1" value={months[i]} onChange={(e) => setMonths((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))} className="h-8 text-right text-sm" />
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {item ? "Save" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

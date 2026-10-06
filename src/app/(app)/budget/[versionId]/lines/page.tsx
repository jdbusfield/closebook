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
import { MonthCells } from "@/components/budget/month-cells";

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
  history: { priorYear: number; trailing12: number; priorYearMonths?: number[] } | null;
  parts?: Array<{ label: string; months: number[]; total: number; note: string | null }>;
  priorBase?: boolean;
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
  /** Months of last year that are booked; averages divide by this */
  priorYearMonths: number;
  /** Where last year's actuals come from: the Financial Model (pro forma and allocations on) or the raw GL */
  priorYearSource?: "financial_model" | "gl";
  belowEbitda: { months: number[]; priorYear: number[] };
  lineMasters: Array<{ id: string; name: string; accountNumber: string | null }>;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
const addTo = (t: number[], s: number[]) => s.forEach((v, i) => (t[i] += v));
const zeros = () => new Array(12).fill(0) as number[];
/**
 * Last year's total for an item over the booked months. Items recomputed before months were kept
 * only have a full-year total that can include the month in progress, so show nothing until a
 * Recompute fills the months (unless last year is complete).
 */
const itemPriorTotal = (h: Item["history"], bookedMonths: number): number | null =>
  !h ? null : h.priorYearMonths ? sum(h.priorYearMonths.slice(0, bookedMonths)) : bookedMonths >= 12 ? h.priorYear : null;

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
  // "Build from last year": every revenue line, or just one (only)
  const [fromPrior, setFromPrior] = useState<{ only: string | null } | null>(null);
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

  const colSpan = 1 + 12 + 1 + (showPrior ? 3 : 0);
  const prior = fiscalYear - 1;
  const pm = data.priorYearMonths ?? 0;
  const priorHead = pm > 0 && pm < 12 ? `${prior} (Jan–${MONTH_ABBRS[pm - 1]})` : String(prior);

  const subtotalRow = (label: string, months: number[], priorMonths: number[], opts?: { strong?: boolean; invert?: boolean; pctOf?: number[] }) => (
    <TableRow className={cn("bg-muted/30", opts?.strong ? "border-t-2 font-semibold" : "font-medium")}>
      <TableCell className="whitespace-nowrap">{label}</TableCell>
      <MonthCells months={months} prior={priorMonths} priorMonths={pm} showPrior={showPrior} bold invert={opts?.invert} />
    </TableRow>
  );
  const pctRow = (label: string, num: number[], den: number[]) => (
    <TableRow className="text-xs text-muted-foreground">
      <TableCell className="whitespace-nowrap">{label}</TableCell>
      {num.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{den[i] ? fmtPct((v / den[i]) * 100) : ""}</TableCell>)}
      <TableCell className="text-right tabular-nums">{sum(den) ? fmtPct((sum(num) / sum(den)) * 100) : ""}</TableCell>
      {showPrior && <TableCell colSpan={3} />}
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
                <span title={data?.priorYearSource === "financial_model" ? `${prior} as the Financial Model shows it: pro forma adjustments and allocations on` : `${prior} from the general ledger`}>
                  {prior} actual{data?.priorYearSource === "financial_model" ? " (Financial Model)" : ""}
                </span>
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
                    <TableHead className="whitespace-nowrap text-right">{priorHead}</TableHead>
                    <TableHead className="whitespace-nowrap text-right">{prior} avg / mo</TableHead>
                    <TableHead className="whitespace-nowrap text-right" title={`${fiscalYear} average month vs ${prior} average month`}>Change</TableHead>
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
                      <TableCell colSpan={colSpan} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <div className="flex items-center gap-3">
                          <span>{s.title}</span>
                          {s.id === "revenue" && !readOnly && (
                            <Button variant="outline" size="sm" className="h-6 px-2 text-xs normal-case tracking-normal" onClick={() => setFromPrior({ only: null })}>
                              Build revenue from {prior}
                            </Button>
                          )}
                        </div>
                      </TableCell>
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
                            <MonthCells months={m.months} prior={p} priorMonths={pm} showPrior={showPrior} invert={invert} />
                          </TableRow>
                          {expanded && (
                            <>
                              {m.items.map((it) => (
                                <Fragment key={it.id}>
                                <TableRow className="text-sm">
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
                                  <MonthCells months={it.months} priorTotal={itemPriorTotal(it.history, pm)} priorMonths={pm} invert={invert} showPrior={showPrior} className={cn("py-1.5 text-xs", it.parts ? "text-foreground" : "text-muted-foreground")} />
                                </TableRow>
                                {(it.parts ?? []).map((p, idx) => (
                                  <TableRow key={idx} className="text-xs text-muted-foreground">
                                    <TableCell className="w-[380px] min-w-[380px] max-w-[380px] whitespace-normal py-1 pl-14">
                                      {p.label}
                                      {p.note && <span className="ml-2 italic">{p.note}</span>}
                                    </TableCell>
                                    <MonthCells months={p.months} priorMonths={pm} showPrior={showPrior} className="py-1 text-xs text-muted-foreground" />
                                  </TableRow>
                                ))}
                                </Fragment>
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
                                      {s.id === "revenue" && (
                                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFromPrior({ only: m.id })} title={`${prior} actuals or the active ${prior} budget as this line's base`}>
                                          Build from {prior}
                                        </Button>
                                      )}
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
                                  {p.map((v, i) => <TableCell key={i} className="py-1 text-right tabular-nums">{v && i < pm ? fmtUsd(v) : ""}</TableCell>)}
                                  <TableCell className="py-1 text-right tabular-nums">{fmtUsd(sum(p.slice(0, pm)))}</TableCell>
                                  <TableCell colSpan={3} />
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
                <MonthCells months={data.belowEbitda.months} prior={data.belowEbitda.priorYear} priorMonths={pm} showPrior={showPrior} className="text-muted-foreground" />
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
          priorLine={data.priorYear[editing.master.id] ?? null}
          priorMonths={pm}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setOpen((prev) => new Set(prev).add(editing.master.id));
            await load();
          }}
        />
      )}

      {fromPrior && (
        <BuildFromPriorDialog
          versionId={versionId}
          prior={prior}
          only={fromPrior.only}
          onClose={() => setFromPrior(null)}
          onSaved={async (ids) => {
            setFromPrior(null);
            setOpen((prev) => new Set([...prev, ...ids]));
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
  priorLine,
  priorMonths,
  onClose,
  onSaved,
}: {
  versionId: string;
  master: MasterLine;
  item: Item | null;
  lineMasters: Array<{ id: string; name: string; accountNumber: string | null }>;
  fiscalYear: number;
  /** Last year's months for the whole line */
  priorLine: number[] | null;
  /** Months of last year that are booked */
  priorMonths: number;
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

  // Last year for this item: its own accounts once broken out, else the whole line
  const own = accountIds?.length && item?.history && itemPriorTotal(item.history, priorMonths) != null ? item.history : null;
  // An item broken out by account uses only its own accounts; until a Recompute stores them, show
  // nothing rather than the whole line's figures, which would double count the line
  const brokenOut = !!accountIds?.length;
  const priorSeries = own ? (own.priorYearMonths ?? null) : brokenOut ? null : priorLine;
  const priorTotal = own ? itemPriorTotal(own, priorMonths) : brokenOut ? null : priorLine ? sum(priorLine.slice(0, priorMonths)) : null;
  const priorAvg = priorTotal != null && priorMonths > 0 ? priorTotal / priorMonths : null;
  const priorSpan = priorMonths > 0 && priorMonths < 12 ? `Jan–${MONTH_ABBRS[priorMonths - 1]}` : "full year";
  const whose = own ? `${accountIds!.length === 1 ? "this account" : `these ${accountIds!.length} accounts`}` : master.name;
  const useStraightLine = () => {
    if (priorAvg == null) return;
    setKind("flat");
    setAmount(String(Math.round(priorAvg)));
    setStartMonth("1");
    setEndMonth("12");
    if (!label.trim()) setLabel(`${master.name}: ${prior} average`);
  };
  const useMonthsFromPrior = () => {
    if (!priorSeries || priorAvg == null) return;
    setKind("months");
    setMonths(priorSeries.map((v, i) => String(Math.round(i < priorMonths ? v : priorAvg))));
    if (!label.trim()) setLabel(`${master.name}: ${prior} months`);
  };

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
          {priorAvg != null && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">{prior} actual ({priorSpan}), {whose}</div>
                <div className="tabular-nums">
                  {fmtUsd(priorTotal ?? 0)} <span className="text-muted-foreground">·</span> <span className="font-medium">{fmtUsd(priorAvg)} / month</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={useStraightLine} title={`Flat: ${fmtUsd(priorAvg)} every month`}>
                  Straight line at {prior} avg
                </Button>
                {priorSeries && (
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={useMonthsFromPrior} title={priorMonths < 12 ? `Booked months as they were; the rest at the ${prior} average` : `Last year's twelve months`}>
                    12 months from {prior}
                  </Button>
                )}
              </div>
            </div>
          )}
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

interface PriorBaseLine {
  masterId: string;
  accountNumber: string | null;
  name: string;
  blockedBy: string | null;
  otherItems: number;
  hasBase: boolean;
  actualBooked: number;
  actualMonths: number[];
  budgetMonths: number[] | null;
}

/** Revenue lines from last year: actuals or the active budget version, moved by a percent, line by line. */
function BuildFromPriorDialog({ versionId, prior, only, onClose, onSaved }: { versionId: string; prior: number; only: string | null; onClose: () => void; onSaved: (masterIds: string[]) => Promise<void> }) {
  const [preview, setPreview] = useState<{ bookedMonths: number; budgetVersions: number; lines: PriorBaseLine[] } | null>(null);
  const [basis, setBasis] = useState<"actuals" | "budget">("actuals");
  const [pct, setPct] = useState("");
  const [replaceItems, setReplaceItems] = useState(false);
  // Replacing deletes items for good, so the first click only asks
  const [confirming, setConfirming] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/budget/builds/from-prior?versionId=${versionId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load last year");
        if (!live) return;
        setPreview(json);
        const usable = (json.lines as PriorBaseLine[]).filter((l) => !l.blockedBy && (only ? l.masterId === only : l.otherItems === 0));
        setPicked(new Set(usable.map((l) => l.masterId)));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load last year");
      }
    })();
    return () => {
      live = false;
    };
  }, [versionId, only]);

  const p = Number(pct) || 0;
  const booked = preview?.bookedMonths ?? 0;
  const lines = (preview?.lines ?? []).filter((l) => (only ? l.masterId === only : true));
  const baseOf = (l: PriorBaseLine) => (basis === "actuals" ? (booked > 0 ? l.actualMonths : null) : l.budgetMonths);
  const resultOf = (l: PriorBaseLine) => {
    const b = baseOf(l);
    return b ? sum(b) * (1 + p / 100) : null;
  };
  const canBuild = (l: PriorBaseLine) => !l.blockedBy && !!baseOf(l);
  const chosen = lines.filter((l) => picked.has(l.masterId) && canBuild(l));
  const span = booked > 0 && booked < 12 ? `Jan–${MONTH_ABBRS[booked - 1]}` : String(prior);

  const removing = replaceItems ? chosen.reduce((t, l) => t + l.otherItems, 0) : 0;
  const removingLines = replaceItems ? chosen.filter((l) => l.otherItems > 0).length : 0;
  const apply = async () => {
    if (!chosen.length) return;
    if (removing > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/budget/builds/from-prior", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId, masterAccountIds: chosen.map((l) => l.masterId), basis, pct: p, replaceItems }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Build failed");
      const built = (json.built ?? []) as string[];
      const skipped = (json.skipped ?? []) as Array<{ name: string; reason: string }>;
      toast.success(`${built.length} line${built.length === 1 ? "" : "s"} built from ${prior} ${basis}${skipped.length ? `; skipped ${skipped.map((x) => `${x.name} (${x.reason})`).join(", ")}` : ""}`);
      await onSaved(chosen.map((l) => l.masterId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Build failed");
    } finally {
      setSaving(false);
    }
  };

  const noteFor = (l: PriorBaseLine) => {
    if (l.blockedBy) return l.blockedBy;
    if (!baseOf(l)) return `No ${prior} ${basis}`;
    const parts: string[] = [];
    if (l.hasBase) parts.push("replaces its base");
    if (l.otherItems > 0) parts.push(replaceItems ? `replaces ${l.otherItems} other item${l.otherItems === 1 ? "" : "s"}` : `adds to ${l.otherItems} item${l.otherItems === 1 ? "" : "s"} already here: the line would double`);
    return parts.join("; ");
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{only ? "Build this line" : "Build revenue"} from {prior}</DialogTitle>
          <DialogDescription>
            Each chosen line gets one item for {prior + 1}: twelve months of {prior}, moved by the percent. Building again replaces that item. Other items on the line stay unless you replace them, so lines that already have items start unticked.
            Actuals use the booked months as they were ({span}) and the rest at their average.
          </DialogDescription>
        </DialogHeader>
        {!preview ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading {prior}</div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid gap-1.5">
                <Label>Base</Label>
                <div className="flex w-fit overflow-hidden rounded-md border">
                  {([["actuals", `${prior} actuals`], ["budget", `${prior} budget`]] as const).map(([v, l], i) => (
                    <button key={v} type="button" onClick={() => setBasis(v)} aria-pressed={basis === v} className={cn("px-3 py-1.5 text-sm", i > 0 && "border-l", basis === v ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted/40")}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="prior-pct">Change %</Label>
                <Input id="prior-pct" type="number" step="0.1" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="0" className="h-9 w-28" />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Switch checked={replaceItems} onCheckedChange={(v) => { setReplaceItems(v); setConfirming(false); }} />
                <span>Replace the line&apos;s other items</span>
              </label>
              {basis === "budget" && preview.budgetVersions === 0 && <span className="text-xs text-muted-foreground">No active {prior} budget version covers this group.</span>}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Line</TableHead>
                  <TableHead className="whitespace-nowrap text-right">{prior} actual ({span})</TableHead>
                  <TableHead className="whitespace-nowrap text-right">{prior} actuals, 12 mo</TableHead>
                  <TableHead className="whitespace-nowrap text-right">{prior} budget</TableHead>
                  <TableHead className="whitespace-nowrap text-right">{prior + 1} base</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const ok = canBuild(l);
                  const result = resultOf(l);
                  return (
                    <TableRow key={l.masterId} className={cn(!ok && "text-muted-foreground")}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Build ${l.name}`}
                          disabled={!ok}
                          checked={ok && picked.has(l.masterId)}
                          onChange={(e) => {
                            setConfirming(false);
                            setPicked((prev) => {
                              const n = new Set(prev);
                              if (e.target.checked) n.add(l.masterId);
                              else n.delete(l.masterId);
                              return n;
                            });
                          }}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap"><span className="mr-1.5 text-xs tabular-nums text-muted-foreground">{l.accountNumber}</span>{l.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(l.actualBooked)}</TableCell>
                      <TableCell className="text-right tabular-nums">{booked > 0 ? fmtUsd(sum(l.actualMonths)) : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.budgetMonths ? fmtUsd(sum(l.budgetMonths)) : "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{ok && result != null ? fmtUsd(result) : ""}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{noteFor(l)}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="font-medium">
                  <TableCell />
                  <TableCell>Chosen lines</TableCell>
                  <TableCell colSpan={3} />
                  <TableCell className="text-right tabular-nums">{fmtUsd(chosen.reduce((t, l) => t + (resultOf(l) ?? 0), 0))}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
        {confirming && removing > 0 && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            This permanently removes {removing} item{removing === 1 ? "" : "s"} on {removingLines} line{removingLines === 1 ? "" : "s"} (typed and method items; entered amounts and run rates are not touched). There is no undo.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={apply} disabled={saving || !chosen.length} variant={confirming && removing > 0 ? "destructive" : "default"}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {confirming && removing > 0 ? `Remove ${removing} item${removing === 1 ? "" : "s"} and build` : `Build ${chosen.length} line${chosen.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

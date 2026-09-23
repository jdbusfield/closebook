"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Download, FileSpreadsheet, RefreshCw, Settings, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils/dates";
import type { AccrualItem, AccrualSettings } from "@/lib/revenue-accrual/types";
import type { AccrualReport } from "@/lib/revenue-accrual/report";
import { accountLabel } from "@/lib/revenue-accrual/engine";
import { parseQuotesWorkbook } from "./quotes-parse";

interface Meta {
  quotes: { fileName: string; uploadedAt: string; count: number; sheet: string } | null;
  qbo: { pulledAt: string; from: string; to: string; docs: number; companyName: string | null } | null;
  decisionsUpdatedAt: string | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TIER: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  confirmed: { label: "Confirmed", variant: "default" },
  job: { label: "Matched On The Job", variant: "secondary" },
  quote: { label: "From Quote Dates", variant: "outline" },
  review: { label: "Needs Review", variant: "destructive" },
};

function lastMonths(n: number) {
  const now = new Date();
  const out: { year: number; month: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return out;
}

const when = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "";

export default function RevenueAccrualPage() {
  const { entityId } = useParams() as { entityId: string };
  const months = useMemo(() => lastMonths(13), []);
  const [period, setPeriod] = useState(months[1]); // last closed month
  const [meta, setMeta] = useState<Meta | null>(null);
  const [settings, setSettings] = useState<AccrualSettings | null>(null);
  const [report, setReport] = useState<AccrualReport | null>(null);
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/revenue-accrual?entityId=${entityId}&year=${period.year}&month=${period.month}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMeta(json.meta);
      setSettings(json.settings);
      setReport(json.report);
      setDecisions(json.report?.decisions ?? {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the report");
    } finally {
      setLoading(false);
    }
  }, [entityId, period]);

  useEffect(() => {
    load();
  }, [load]);

  const included = useCallback(
    (it: AccrualItem) => (it.id in decisions ? decisions[it.id] : it.defaultInclude),
    [decisions],
  );

  const persistDecisions = (next: Record<string, boolean>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch("/api/revenue-accrual/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, ...period, decisions: next }),
      });
      if (!res.ok) toast.error((await res.json().catch(() => ({}))).error ?? "Could not save the choice");
      else load();
    }, 700);
  };

  const toggle = (it: AccrualItem, value: boolean) => {
    const next = { ...decisions };
    if (value === it.defaultInclude) delete next[it.id];
    else next[it.id] = value;
    setDecisions(next);
    persistDecisions(next);
  };

  async function onQuotesFile(file: File) {
    setBusy("quotes");
    try {
      const keepFrom = `${period.year - 1}-${String(period.month).padStart(2, "0")}-01`;
      const parsed = await parseQuotesWorkbook(file, keepFrom);
      const res = await fetch("/api/revenue-accrual/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, fileName: file.name, sheet: parsed.sheet, quotes: parsed.quotes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast.success(`Saved ${json.count.toLocaleString()} quotes from the "${parsed.sheet}" tab`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the Quotes Report");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function pullQbo() {
    setBusy("qbo");
    try {
      const res = await fetch("/api/revenue-accrual/qbo-pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, ...period }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast.success(`Pulled ${json.docs.toLocaleString()} documents and ${json.journals} journal entries`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "QuickBooks pull failed");
    } finally {
      setBusy(null);
    }
  }

  const download = (kind: "working" | "journals") => {
    window.location.href = `/api/revenue-accrual/export?entityId=${entityId}&year=${period.year}&month=${period.month}&kind=${kind}`;
  };

  const items = report?.result.items ?? [];
  const accruals = items.filter((i) => i.kind === "accrual" && i.tier !== "review");
  const deferrals = items.filter((i) => i.kind === "deferral" && i.tier !== "review");
  const review = items.filter((i) => i.tier === "review");
  const monthLabel = `${MONTHS[period.month - 1]} ${period.year}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Revenue Accrual</h1>
          <p className="text-muted-foreground">Month-end accrual and deferral from the Quotes Report and QuickBooks</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={`${period.year}-${period.month}`}
            onValueChange={(v) => {
              const [y, m] = v.split("-").map(Number);
              setPeriod({ year: y, month: m });
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                  {MONTHS[m.month - 1]} {m.year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setSettingsOpen(true)} disabled={!settings}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Quotes Report</CardTitle>
            <CardDescription>
              {meta?.quotes
                ? `${meta.quotes.fileName}: ${meta.quotes.count.toLocaleString()} quotes, uploaded ${when(meta.quotes.uploadedAt)}`
                : "Upload the Quotes Report workbook (the Query1 tab is read)."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onQuotesFile(e.target.files[0])}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={busy !== null}>
              <Upload className="mr-2 h-4 w-4" />
              {busy === "quotes" ? "Reading The Workbook..." : meta?.quotes ? "Upload A New Quotes Report" : "Upload Quotes Report"}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. QuickBooks</CardTitle>
            <CardDescription>
              {meta?.qbo
                ? `${meta.qbo.docs.toLocaleString()} documents dated ${meta.qbo.from} to ${meta.qbo.to}, pulled ${when(meta.qbo.pulledAt)}`
                : "Pull invoices, sales receipts, credit memos, refunds and journal entries."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={pullQbo} disabled={busy !== null}>
              <RefreshCw className={`mr-2 h-4 w-4 ${busy === "qbo" ? "animate-spin" : ""}`} />
              {busy === "qbo" ? "Pulling From QuickBooks..." : meta?.qbo ? "Pull Again" : "Pull From QuickBooks"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {loading && !report ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : !report ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Upload the Quotes Report and pull from QuickBooks to build the {monthLabel} accrual.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Accrual To Book</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{formatCurrency(report.totals.accrual)}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Already booked for {monthLabel}: {formatCurrency(report.booked.accrualTotal)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Deferral To Book</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{formatCurrency(report.totals.deferral)}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Already booked for {monthLabel}: {formatCurrency(report.booked.deferralTotal)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Needs Review</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {formatCurrency(review.reduce((s, i) => s + i.amount, 0))}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {review.length} lines; {review.filter(included).length} included so far
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Prior Month Check ({MONTHS[report.prior.period.month - 1]})</CardDescription>
                <CardTitle className={`text-2xl tabular-nums ${report.prior.shortfall > 0.005 ? "text-destructive" : ""}`}>
                  {report.prior.shortfall > 0.005 ? "Short " : report.prior.shortfall < -0.005 ? "Over " : ""}
                  {formatCurrency(Math.abs(report.prior.shortfall))}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Booked {formatCurrency(report.prior.bookedAccrual)}; this method now finds{" "}
                {formatCurrency(report.prior.recomputedAccrual)}
                {report.prior.enteredBeforeBooking != null &&
                  `, ${formatCurrency(report.prior.enteredBeforeBooking)} of it already invoiced when that accrual was booked`}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => download("journals")}>
              <Download className="mr-2 h-4 w-4" />
              Download Journal Entries
            </Button>
            <Button variant="outline" onClick={() => download("working")}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Download Working File
            </Button>
          </div>

          <Tabs defaultValue="accruals">
            <TabsList className="flex-wrap">
              <TabsTrigger value="accruals">Accruals ({accruals.length})</TabsTrigger>
              <TabsTrigger value="deferrals">Deferrals ({deferrals.length})</TabsTrigger>
              <TabsTrigger value="review">Needs Review ({review.length})</TabsTrigger>
              <TabsTrigger value="journals">Journal Entries ({report.journals.length})</TabsTrigger>
              <TabsTrigger value="unmatched">Invoices Without A Quote ({report.result.unmatchedDocs.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="accruals">
              <ItemTable items={accruals} included={included} onToggle={toggle} />
            </TabsContent>
            <TabsContent value="deferrals">
              <ItemTable items={deferrals} included={included} onToggle={toggle} />
            </TabsContent>
            <TabsContent value="review">
              <p className="mb-3 text-sm text-muted-foreground">
                These are left out unless you check them. Check a line when you know the work belongs in {monthLabel}.
              </p>
              <ItemTable items={review} included={included} onToggle={toggle} />
            </TabsContent>
            <TabsContent value="journals" className="space-y-6">
              {report.journals.map((j) => (
                <Card key={j.number}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {j.number}{" "}
                      <span className="font-normal text-muted-foreground">
                        dated {j.date}, {j.title.toLowerCase()}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead className="text-right">Debits</TableHead>
                          <TableHead className="text-right">Credits</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Class</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {j.rows.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="whitespace-normal">{r.account}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.debit != null ? formatCurrency(r.debit) : ""}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.credit != null ? formatCurrency(r.credit) : ""}</TableCell>
                            <TableCell>{r.description}</TableCell>
                            <TableCell>{r.className}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="font-semibold">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(j.total)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(j.rows.reduce((s, r) => s + (r.credit ?? 0), 0))}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
            <TabsContent value="unmatched">
              <p className="mb-3 text-sm text-muted-foreground">
                QuickBooks documents since the start of the prior month that do not tie to a single quote. Loss and damage,
                walk-up sales and combined billing show up here.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.result.unmatchedDocs.map((d, i) => (
                    <TableRow key={`${d.type}-${d.num}-${i}`}>
                      <TableCell>{d.type}</TableCell>
                      <TableCell>{d.num}</TableCell>
                      <TableCell>{d.date}</TableCell>
                      <TableCell className="whitespace-normal">{d.customer}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(d.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </>
      )}

      {settings && settingsOpen && (
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} entityId={entityId} settings={settings} onSaved={load} />
      )}
    </div>
  );
}

function ItemTable({
  items,
  included,
  onToggle,
}: {
  items: AccrualItem[];
  included: (it: AccrualItem) => boolean;
  onToggle: (it: AccrualItem, v: boolean) => void;
}) {
  if (!items.length) return <p className="py-6 text-sm text-muted-foreground">Nothing here for this month.</p>;
  const total = items.filter(included).reduce((s, i) => s + i.amount, 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">Include</TableHead>
          <TableHead>Customer And Quote</TableHead>
          <TableHead>Invoice</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Accounts And Classes</TableHead>
          <TableHead>Why</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((it) => (
          <TableRow key={it.id} className="align-top">
            <TableCell>
              <Checkbox checked={included(it)} onCheckedChange={(v) => onToggle(it, v === true)} />
            </TableCell>
            <TableCell className="whitespace-normal">
              <Badge variant={TIER[it.tier]?.variant ?? "outline"} className="mb-1">
                {TIER[it.tier]?.label ?? it.tier}
              </Badge>
              <div>{it.customer ?? it.project ?? ""}</div>
              {it.quoteId && (
                <div className="text-sm text-muted-foreground">
                  {it.quoteId}
                  {it.project && it.customer ? `, ${it.project}` : ""}
                  {it.quoteStart ? `, ${it.quoteStart} to ${it.quoteEnd}` : ""}
                  {it.quoteAmount != null ? `, ${formatCurrency(it.quoteAmount)}` : ""}
                </div>
              )}
            </TableCell>
            <TableCell className="whitespace-normal text-sm">
              {it.docNum ? (
                <>
                  <div>
                    {it.docType === "SalesReceipt" ? "Receipt" : it.docType} {it.docNum}, {it.docDate}
                  </div>
                  {it.docAmount != null && <div className="text-muted-foreground">{formatCurrency(it.docAmount)}</div>}
                  {it.docCreated && <div className="text-muted-foreground">Entered {when(it.docCreated)}</div>}
                </>
              ) : (
                <span className="text-muted-foreground">Not invoiced yet</span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatCurrency(it.amount)}</TableCell>
            <TableCell className="whitespace-normal text-sm">
              {it.allocation.map((a, i) => (
                <div key={i}>
                  {accountLabel(a.account)} / {a.className ?? "No class"}: {formatCurrency(a.amount)}
                </div>
              ))}
              <div className="text-muted-foreground">{it.allocationSource}</div>
            </TableCell>
            <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">
              {it.reason}
              {it.memo ? ` Memo: "${it.memo}"` : ""}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="font-semibold">
          <TableCell />
          <TableCell>Total Included</TableCell>
          <TableCell />
          <TableCell className="text-right tabular-nums">{formatCurrency(total)}</TableCell>
          <TableCell />
          <TableCell />
        </TableRow>
      </TableBody>
    </Table>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  entityId,
  settings,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entityId: string;
  settings: AccrualSettings;
  onSaved: () => void;
}) {
  const [accrued, setAccrued] = useState(settings.accruedAccount);
  const [deferred, setDeferred] = useState(settings.deferredAccount);
  const [aliases, setAliases] = useState<[string, string][]>(Object.entries(settings.aliases));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch("/api/revenue-accrual/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityId,
        accruedAccount: accrued,
        deferredAccount: deferred,
        aliases: Object.fromEntries(aliases.filter(([a, b]) => a.trim() && b.trim())),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Could not save settings");
      return;
    }
    toast.success("Settings saved");
    onOpenChange(false);
    onSaved();
  }

  const accountFields: [string, typeof accrued, (v: typeof accrued) => void][] = [
    ["Accrued Revenue Account", accrued, setAccrued],
    ["Deferred Revenue Account", deferred, setDeferred],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revenue Accrual Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {accountFields.map(([label, value, set]) => (
              <div key={label} className="space-y-1">
                <Label>{label}</Label>
                <div className="flex gap-2">
                  <Input
                    className="w-24"
                    value={value.number ?? ""}
                    placeholder="Number"
                    onChange={(e) => set({ ...value, number: e.target.value || null })}
                  />
                  <Input value={value.name} placeholder="Name" onChange={(e) => set({ ...value, name: e.target.value })} />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Quote Names That Bill Under Another QuickBooks Customer</Label>
            <p className="text-sm text-muted-foreground">
              Left: the project name on the quote. Right: the QuickBooks customer or job it is invoiced under.
            </p>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {aliases.map(([a, b], i) => (
                <div key={i} className="flex gap-2">
                  <Input value={a} onChange={(e) => setAliases(aliases.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} />
                  <Input value={b} onChange={(e) => setAliases(aliases.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
                  <Button variant="ghost" onClick={() => setAliases(aliases.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="outline" onClick={() => setAliases([...aliases, ["", ""]])}>
              Add A Name
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

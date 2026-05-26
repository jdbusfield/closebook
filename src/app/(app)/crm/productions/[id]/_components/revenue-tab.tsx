"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search, Trash2, DollarSign, Receipt, TrendingUp, Calendar } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { ProductionInvoiceRow, ProductionRevenueSummary, MonthlyRevenueBucket, RwCustomerLink, ExternalCustomerLink, RwCustomerOption } from "@/lib/db/queries/crm-revenue";

interface Props {
  productionId: string;
  initialSummary: ProductionRevenueSummary;
  initialMonthly: MonthlyRevenueBucket[];
  initialInvoices: ProductionInvoiceRow[];
  initialRwLinks: RwCustomerLink[];
  initialExternalLinks: ExternalCustomerLink[];
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function moneyExact(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtMonth(m: string) {
  const [y, mm] = m.split("-");
  return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function RevenueTab(props: Props) {
  const router = useRouter();
  const [_isPending, startTransition] = useTransition();

  const refresh = () => startTransition(() => router.refresh());

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <RwCustomersPanel productionId={props.productionId} links={props.initialRwLinks} onChange={refresh} />
        <ExternalCustomersPanel productionId={props.productionId} links={props.initialExternalLinks} onChange={refresh} />
      </div>

      <KpiRow summary={props.initialSummary} />
      <MonthlyChart data={props.initialMonthly} />
      <InvoicesTable invoices={props.initialInvoices} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

function KpiRow({ summary }: { summary: ProductionRevenueSummary }) {
  const tiles = [
    { label: "YTD Revenue", value: money(summary.ytd_revenue), icon: TrendingUp, hint: "Current calendar year" },
    { label: "Lifetime Revenue", value: money(summary.lifetime_revenue), icon: DollarSign, hint: `${money(summary.rw_lifetime)} RW · ${money(summary.cars_plus_lifetime)} Cars Plus` },
    { label: "Invoices", value: summary.invoice_count.toLocaleString(), icon: Receipt, hint: "Combined across sources" },
    { label: "Last invoice", value: fmtDate(summary.last_invoice_date), icon: Calendar, hint: summary.last_invoice_date ? "Most recent date" : "No invoices yet" },
  ] as const;
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {tiles.map(t => (
        <Card key={t.label}>
          <CardContent className="flex items-start justify-between p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</p>
              <p className="mt-1 text-2xl font-semibold">{t.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
            </div>
            <t.icon className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 12-month chart
// ---------------------------------------------------------------------------

function MonthlyChart({ data }: { data: MonthlyRevenueBucket[] }) {
  const chartData = data.map(d => ({ month: fmtMonth(d.month), RW: d.rw, "Cars Plus": d.cars_plus }));
  const max = Math.max(...data.map(d => d.total), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>12-month revenue</CardTitle>
        <CardDescription>Stacked by source. RW = current platform, Cars Plus = legacy uploads.</CardDescription>
      </CardHeader>
      <CardContent>
        {max === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No invoice activity in the last 12 months. Link a RentalWorks or Cars Plus customer above to see revenue here.
          </p>
        ) : (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => moneyExact(typeof v === "number" ? v : Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="RW" stackId="rev" fill="#3b82f6" />
                <Bar dataKey="Cars Plus" stackId="rev" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Invoices table
// ---------------------------------------------------------------------------

function InvoicesTable({ invoices }: { invoices: ProductionInvoiceRow[] }) {
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(invoices.length / pageSize));
  const visible = invoices.slice(page * pageSize, (page + 1) * pageSize);

  function downloadCsv() {
    const header = "Date,Source,Invoice #,Customer,Amount,Description\n";
    const rows = invoices.map(i =>
      [i.date, i.source, i.invoice_number ?? "", i.customer ?? "", i.amount.toFixed(2), (i.description ?? "").replace(/"/g, '""')]
        .map(c => `"${c}"`)
        .join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `invoices.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Invoices ({invoices.length})</CardTitle>
          <CardDescription>All RentalWorks + Cars Plus invoices for linked customers, newest first.</CardDescription>
        </div>
        {invoices.length > 0 && (
          <Button size="sm" variant="outline" onClick={downloadCsv}>Export CSV</Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {invoices.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Source</th>
                  <th className="px-4 py-2 text-left">Invoice #</th>
                  <th className="px-4 py-2 text-left">Customer</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-left">Description</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(inv => (
                  <tr key={inv.id} className="border-t">
                    <td className="px-4 py-2 whitespace-nowrap">{fmtDate(inv.date)}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className={inv.source === "rw"
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-amber-300 bg-amber-50 text-amber-700"}>
                        {inv.source === "rw" ? "RW" : "Cars Plus"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{inv.invoice_number ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{inv.customer ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-medium">{moneyExact(inv.amount)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[280px]">{inv.description ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-2 text-xs">
                <span className="text-muted-foreground">Page {page + 1} of {pages}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                  <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RW customer linkage panel
// ---------------------------------------------------------------------------

function RwCustomersPanel({ productionId, links, onChange }: { productionId: string; links: RwCustomerLink[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(linkId: string) {
    setBusyId(linkId);
    setError(null);
    const res = await fetch(`/api/crm/productions/${productionId}/rw-customers/${linkId}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to remove link");
    } else {
      onChange();
    }
    setBusyId(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">RentalWorks customer #s</CardTitle>
        <CardDescription>Revenue rolls up from <code className="text-xs">rw_invoices_cache</code> for any linked customer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No RentalWorks customers linked yet.</p>
        ) : (
          links.map(l => (
            <div key={l.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{l.customer_name ?? <span className="text-muted-foreground italic">(no invoices yet)</span>}</div>
                <div className="text-xs text-muted-foreground font-mono">{l.rw_customer_id}{l.label ? ` · ${l.label}` : ""}</div>
              </div>
              <Button size="icon" variant="ghost" disabled={busyId === l.id} onClick={() => remove(l.id)} aria-label="Unlink">
                {busyId === l.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              </Button>
            </div>
          ))
        )}

        {adding ? (
          <RwCustomerSearchInline
            productionId={productionId}
            onDone={() => { setAdding(false); onChange(); }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="w-full">
            <Plus className="mr-1 h-3 w-3" /> Add RW account
          </Button>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

function RwCustomerSearchInline({ productionId, onDone, onCancel }: { productionId: string; onDone: () => void; onCancel: () => void }) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RwCustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      const res = await fetch(`/api/crm/rw-customers/search?q=${encodeURIComponent(query)}`);
      const j = (await res.json()) as { results?: RwCustomerOption[] };
      setResults(j.results ?? []);
      setLoading(false);
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  async function pick(opt: RwCustomerOption) {
    if (opt.already_linked_production) {
      setError(`Already linked to "${opt.already_linked_production.name}"`);
      return;
    }
    setAdding(true);
    setError(null);
    const res = await fetch(`/api/crm/productions/${productionId}/rw-customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rw_customer_id: opt.rw_customer_id, label: opt.customer }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to link");
      setAdding(false);
      return;
    }
    setOpen(false);
    onDone();
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) onCancel(); }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="w-full justify-start">
          <Search className="mr-1 h-3 w-3" /> Search RentalWorks customers…
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[480px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Type a customer name…" value={query} onValueChange={setQuery} />
          <CommandList>
            {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
            <CommandEmpty>{loading ? "" : "No customers match."}</CommandEmpty>
            <CommandGroup>
              {results.map(r => (
                <CommandItem
                  key={r.rw_customer_id}
                  value={r.rw_customer_id}
                  onSelect={() => pick(r)}
                  disabled={adding || !!r.already_linked_production}
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{r.customer}</div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{r.rw_customer_id}</span> · {r.invoice_count} invoice{r.invoice_count === 1 ? "" : "s"}
                      </div>
                      {r.already_linked_production && (
                        <div className="text-xs text-amber-600">Already on “{r.already_linked_production.name}”</div>
                      )}
                    </div>
                    {adding && <Loader2 className="h-3 w-3 animate-spin" />}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {error && <p className="border-t px-3 py-2 text-xs text-rose-600">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Cars Plus / external customer linkage panel
// ---------------------------------------------------------------------------

function ExternalCustomersPanel({ productionId, links, onChange }: { productionId: string; links: ExternalCustomerLink[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extId, setExtId] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const carsPlusLinks = useMemo(() => links.filter(l => l.source === "cars_plus"), [links]);
  const otherLinks   = useMemo(() => links.filter(l => l.source !== "cars_plus"), [links]);

  async function submit() {
    if (!extId.trim()) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/crm/productions/${productionId}/external-customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ external_customer_id: extId.trim(), label: label.trim() || null }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to link");
      setSubmitting(false);
      return;
    }
    setExtId("");
    setLabel("");
    setSubmitting(false);
    setAdding(false);
    onChange();
  }

  async function remove(linkId: string) {
    setBusyId(linkId);
    setError(null);
    const res = await fetch(`/api/crm/productions/${productionId}/external-customers/${linkId}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to remove");
    } else {
      onChange();
    }
    setBusyId(null);
  }

  function renderLink(l: ExternalCustomerLink) {
    return (
      <div key={l.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
        <div className="min-w-0 flex-1">
          <div className="font-mono font-medium truncate">{l.external_customer_id}</div>
          {l.label && <div className="text-xs text-muted-foreground truncate">{l.label}</div>}
        </div>
        <Button size="icon" variant="ghost" disabled={busyId === l.id} onClick={() => remove(l.id)} aria-label="Unlink">
          {busyId === l.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cars Plus customer #s</CardTitle>
        <CardDescription>Revenue from uploaded Cars Plus invoice exports rolls up via these IDs.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Cars Plus customers linked yet.</p>
        ) : (
          <>
            {carsPlusLinks.map(renderLink)}
            {otherLinks.length > 0 && (
              <div className="pt-2 text-xs text-muted-foreground">Other legacy sources:</div>
            )}
            {otherLinks.map(renderLink)}
          </>
        )}

        {adding ? (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="grid gap-2">
              <Label htmlFor="ext-id" className="text-xs">Cars Plus customer #</Label>
              <Input id="ext-id" value={extId} onChange={e => setExtId(e.target.value)} placeholder="e.g. 12345" />
              <Label htmlFor="ext-label" className="text-xs">Label (optional)</Label>
              <Input id="ext-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. main account" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={submit} disabled={submitting || !extId.trim()}>
                {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Link
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setError(null); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="w-full">
            <Plus className="mr-1 h-3 w-3" /> Add Cars Plus account
          </Button>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

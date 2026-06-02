"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Upload, Loader2, ArrowLeft, CheckCircle2, AlertCircle, FileSpreadsheet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DiffRow, RevenueImportDiff, RevenueImportApplyPayload } from "@/lib/crm/revenue-import-types";

type Phase = "idle" | "uploading" | "diff" | "applying" | "done" | "error";

interface ApplyResult {
  invoices_inserted: number;
  links_created: number;
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function RevenueUploadPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [diff, setDiff] = useState<RevenueImportDiff | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  /** Per-unmapped-row decisions: index -> productionId (or "skip") */
  const [decisions, setDecisions] = useState<Record<number, string>>({});

  async function handleUpload(f: File) {
    setFile(f);
    setPhase("uploading");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const resp = await fetch("/api/crm/revenue/upload", { method: "POST", body: fd });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      setDiff(json as RevenueImportDiff);
      setDecisions({});
      setPhase("diff");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }

  async function applyDiff() {
    if (!diff) return;
    setPhase("applying");
    setError(null);
    try {
      const payload: RevenueImportApplyPayload = {
        upload_batch_id: diff.upload_batch_id,
        file_name: diff.file_name,
        rows: diff.rows,
        decisions: Object.entries(decisions).map(([k, v]) => {
          const idx = Number(k);
          if (v === "skip") return { source_row_index: idx, skip: true };
          return { source_row_index: idx, production_id: v };
        }),
      };
      const resp = await fetch("/api/crm/revenue/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      setResult(json as ApplyResult);
      setPhase("done");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }

  const groupedRows = useMemo(() => {
    if (!diff) return { mapped: [], unmapped: [], duplicate: [] };
    const mapped: DiffRow[] = [];
    const unmapped: DiffRow[] = [];
    const duplicate: DiffRow[] = [];
    for (const r of diff.rows) {
      if (r.bucket === "mapped") mapped.push(r);
      else if (r.bucket === "unmapped") unmapped.push(r);
      else duplicate.push(r);
    }
    return { mapped, unmapped, duplicate };
  }, [diff]);

  const unmappedDecided = useMemo(() => {
    if (!diff) return 0;
    return diff.rows.filter(r => r.bucket === "unmapped" && (decisions[r.source_row_index] === "skip" || (decisions[r.source_row_index] && decisions[r.source_row_index] !== "skip"))).length;
  }, [diff, decisions]);

  const canApply = diff && diff.counts.unmapped === Object.values(decisions).filter(v => !!v).length;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/crm/revenue" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ArrowLeft className="h-3 w-3" /> Back to Revenue
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <FileSpreadsheet className="h-6 w-6" /> Upload Cars Plus invoice export
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop an .xlsx or .csv export from Cars Plus. Each row will be matched to a production via the customer number you&apos;ve linked.
          Expected columns (any case, with common aliases like <code className="text-xs">cust_no</code>): <code className="text-xs">customer_number</code>, <code className="text-xs">invoice_number</code>, <code className="text-xs">invoice_date</code>, <code className="text-xs">amount</code>, optional <code className="text-xs">description</code> and <code className="text-xs">customer_name</code>.
        </p>
      </div>

      {phase === "idle" && (
        <Card>
          <CardContent className="p-8">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-12 text-center hover:bg-muted/30">
              <Upload className="h-10 w-10 text-muted-foreground" />
              <span className="font-medium">Choose a Cars Plus export</span>
              <span className="text-sm text-muted-foreground">.xlsx or .csv up to 20MB</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
              />
            </label>
          </CardContent>
        </Card>
      )}

      {(phase === "uploading" || phase === "applying") && (
        <Card>
          <CardContent className="flex items-center gap-3 p-8">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>{phase === "uploading" ? `Parsing ${file?.name}…` : "Applying…"}</span>
          </CardContent>
        </Card>
      )}

      {phase === "error" && (
        <Card className="border-rose-300">
          <CardContent className="flex items-start gap-3 p-6">
            <AlertCircle className="mt-0.5 h-5 w-5 text-rose-500" />
            <div>
              <p className="font-medium">Something went wrong</p>
              <p className="text-sm text-rose-700">{error}</p>
              <Button className="mt-3" variant="outline" size="sm" onClick={() => { setPhase("idle"); setError(null); setFile(null); setDiff(null); }}>Try again</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {phase === "done" && result && (
        <Card className="border-emerald-300">
          <CardContent className="flex items-start gap-3 p-6">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
            <div>
              <p className="font-medium">Upload complete.</p>
              <ul className="mt-1 text-sm text-muted-foreground">
                <li>{result.invoices_inserted} invoice{result.invoices_inserted === 1 ? "" : "s"} imported</li>
                <li>{result.links_created} new production link{result.links_created === 1 ? "" : "s"}</li>
              </ul>
              <div className="mt-3 flex gap-2">
                <Button asChild size="sm" variant="outline"><Link href="/crm/revenue">View revenue list</Link></Button>
                <Button size="sm" onClick={() => { setPhase("idle"); setFile(null); setDiff(null); setResult(null); setDecisions({}); }}>Upload another</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {phase === "diff" && diff && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>
                {diff.total_rows} row{diff.total_rows === 1 ? "" : "s"} parsed from {diff.file_name}.
                Columns detected: {Object.entries(diff.detected_columns).map(([k, v]) => `${k}=${v}`).join(", ")}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3 text-sm">
                <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">{diff.counts.mapped} mapped</Badge>
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">{diff.counts.unmapped} unmapped</Badge>
                <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-600">{diff.counts.duplicate} duplicate</Badge>
                {diff.parse_errors.length > 0 && (
                  <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-700">{diff.parse_errors.length} parse error{diff.parse_errors.length === 1 ? "" : "s"}</Badge>
                )}
              </div>
              {diff.parse_errors.length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Show parse errors</summary>
                  <ul className="mt-2 space-y-1">
                    {diff.parse_errors.slice(0, 20).map((e, i) => (
                      <li key={i} className="text-rose-700">Row {e.row}: {e.message}</li>
                    ))}
                    {diff.parse_errors.length > 20 && <li className="text-muted-foreground">…and {diff.parse_errors.length - 20} more</li>}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>

          {groupedRows.mapped.length > 0 && (
            <Bucket title="Will import" tone="emerald" count={groupedRows.mapped.length}>
              <RowTable rows={groupedRows.mapped} showProduction />
            </Bucket>
          )}

          {groupedRows.unmapped.length > 0 && (
            <Bucket title="Needs mapping" tone="amber" count={groupedRows.unmapped.length}>
              <p className="mb-3 text-xs text-muted-foreground">
                These Cars Plus customer #s aren&apos;t linked to a production yet. Pick a production for each one (or skip), then apply.
                Picking a production creates the link permanently — future uploads with the same customer # will land automatically.
              </p>
              <RowTable
                rows={groupedRows.unmapped}
                selectable
                decision={decisions}
                onPick={(idx, prodId) => setDecisions(d => ({ ...d, [idx]: prodId }))}
              />
            </Bucket>
          )}

          {groupedRows.duplicate.length > 0 && (
            <Bucket title="Already imported (skipped)" tone="slate" count={groupedRows.duplicate.length}>
              <RowTable rows={groupedRows.duplicate} />
            </Bucket>
          )}

          <div className="sticky bottom-0 -mx-6 border-t bg-background px-6 py-3 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {diff.counts.mapped} ready · {unmappedDecided}/{diff.counts.unmapped} unmapped resolved · {diff.counts.duplicate} skipped
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setPhase("idle"); setFile(null); setDiff(null); setDecisions({}); }}>Cancel</Button>
                <Button onClick={applyDiff} disabled={!canApply}>Apply import</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Bucket({ title, tone, count, children }: { title: string; tone: "emerald" | "amber" | "slate"; count: number; children: React.ReactNode }) {
  const toneClass =
    tone === "emerald" ? "border-emerald-300" :
    tone === "amber" ? "border-amber-300" : "border-slate-300";
  return (
    <Card className={toneClass}>
      <CardHeader>
        <CardTitle className="text-base">{title} ({count})</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function RowTable({
  rows,
  showProduction,
  selectable,
  decision,
  onPick,
}: {
  rows: DiffRow[];
  showProduction?: boolean;
  selectable?: boolean;
  decision?: Record<number, string>;
  onPick?: (idx: number, productionId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="px-2 py-1">Date</th>
            <th className="px-2 py-1">Cust #</th>
            <th className="px-2 py-1">Customer</th>
            <th className="px-2 py-1">Inv #</th>
            <th className="px-2 py-1 text-right">Amount</th>
            {(showProduction || selectable) && <th className="px-2 py-1">Production</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.source_row_index} className="border-t">
              <td className="px-2 py-1 whitespace-nowrap">{r.data.invoice_date}</td>
              <td className="px-2 py-1 font-mono">{r.data.external_customer_id}</td>
              <td className="px-2 py-1 truncate max-w-[180px]">{r.data.customer_name ?? "—"}</td>
              <td className="px-2 py-1 font-mono">{r.data.invoice_number ?? "—"}</td>
              <td className="px-2 py-1 text-right font-medium">{money(r.data.amount)}</td>
              {showProduction && (
                <td className="px-2 py-1">
                  {r.matched_production ? r.matched_production.name : "—"}
                </td>
              )}
              {selectable && (
                <td className="px-2 py-1">
                  <select
                    className="rounded border bg-background px-2 py-1 text-xs"
                    value={decision?.[r.source_row_index] ?? ""}
                    onChange={e => onPick?.(r.source_row_index, e.target.value)}
                  >
                    <option value="">Choose…</option>
                    <option value="skip">Skip this row</option>
                    <option disabled>──────</option>
                    {r.candidate_productions?.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.status})</option>
                    ))}
                  </select>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  ImportDiff,
  ApplyDiffPayload,
  StatusChangeItem,
  AliasSuggestionItem,
  NewProductionItem,
  FellOffItem,
} from "@/lib/crm/import-types";
import { ProductionMatchCombobox } from "./_components/production-match-combobox";

type Phase = "idle" | "uploading" | "diff" | "applying" | "done" | "error";

interface ApplyResult {
  status_updates: number;
  aliases_created: number;
  productions_created: number;
  companies_created: number;
  studios_linked_or_created: number;
  contacts_created: number;
  marked_completed: number;
  manual_matches_applied: number;
  errors: string[];
}

export default function CrmImportPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Selection state
  const [statusYes, setStatusYes] = useState<Set<string>>(new Set());
  const [aliasYes, setAliasYes] = useState<Set<string>>(new Set());
  const [newProdYes, setNewProdYes] = useState<Set<string>>(new Set());
  const [completedYes, setCompletedYes] = useState<Set<string>>(new Set());
  // Edits for new productions: prodIndex -> overrides
  const [newProdEdits, setNewProdEdits] = useState<Record<string, { start_date: string; end_date: string; studio_id: string }>>({});
  /** Manual match: which existing production a "new" PDF row is actually aliased to. */
  const [newProdMatches, setNewProdMatches] = useState<Record<string, string | null>>({});

  async function handleUpload(f: File) {
    setFile(f);
    setPhase("uploading");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const resp = await fetch("/api/crm/import-report", { method: "POST", body: fd });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      const d = json as ImportDiff;
      setDiff(d);
      setStatusYes(new Set(d.status_changes.map(s => s.production_id)));
      setAliasYes(new Set(d.alias_suggestions.map((_, i) => `alias-${i}`)));
      setNewProdYes(new Set());
      setCompletedYes(new Set());
      setPhase("diff");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const copy = new Set(set);
    if (copy.has(key)) copy.delete(key);
    else copy.add(key);
    setter(copy);
  }

  async function applyDiff() {
    if (!diff) return;
    setPhase("applying");

    const accept_status_changes = diff.status_changes
      .filter(c => statusYes.has(c.production_id))
      .map(c => ({ production_id: c.production_id, from_status: c.current_status, new_status: c.new_status }));

    const accept_alias_suggestions = diff.alias_suggestions
      .filter((_, i) => aliasYes.has(`alias-${i}`))
      .map(a => ({ pdf_row: a.pdf_row, matched_production_id: a.matched_production_id }));

    // Split new productions: ones the user manually matched go into manual_alias_matches
    const checkedNewProdIndexes = diff.new_productions
      .map((np, i) => ({ np, i, key: `np-${i}` }))
      .filter(({ key }) => newProdYes.has(key));

    const accept_new_productions = checkedNewProdIndexes
      .filter(({ key }) => !newProdMatches[key])
      .map(({ np, key }) => {
        const edits = newProdEdits[key];
        return {
          pdf_row: np.pdf_row,
          company_id: np.suggested_company_id,
          studio_id: edits?.studio_id || np.research?.matched_studio_id || null,
          start_date: edits?.start_date || np.research?.estimated_start_date || null,
          end_date: edits?.end_date || np.research?.estimated_end_date || null,
        };
      });

    const manual_alias_matches = checkedNewProdIndexes
      .filter(({ key }) => newProdMatches[key])
      .map(({ np, key }) => ({
        pdf_row: np.pdf_row,
        matched_production_id: newProdMatches[key] as string,
      }));

    const mark_completed = Array.from(completedYes);

    const payload: ApplyDiffPayload = {
      report_metadata: diff.report_metadata,
      accept_status_changes,
      accept_alias_suggestions,
      accept_new_productions,
      manual_alias_matches,
      mark_completed,
    };
    try {
      const resp = await fetch("/api/crm/import-report/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await resp.json()) as ApplyResult;
      if (!resp.ok) throw new Error((json as unknown as { error?: string }).error || "Apply failed");
      setResult(json);
      setPhase("done");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }

  function reset() {
    setPhase("idle");
    setFile(null);
    setDiff(null);
    setResult(null);
    setError(null);
    setStatusYes(new Set());
    setAliasYes(new Set());
    setNewProdYes(new Set());
    setCompletedYes(new Set());
    setNewProdEdits({});
    setNewProdMatches({});
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <Link href="/crm/clients" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ArrowLeft className="h-3 w-3" /> Back to CRM
        </Link>
        <h1 className="text-2xl font-semibold">Import weekly production report</h1>
        <p className="text-sm text-muted-foreground">
          Drop a Teamsters 399 / Daily Production Report PDF. Claude parses it, matches against your existing data,
          and a research agent fills in shoot dates + parent studio for any new productions.
        </p>
      </div>

      {/* ---------------- IDLE: upload zone ---------------- */}
      {phase === "idle" && (
        <Card>
          <CardContent className="p-12">
            <label className="block cursor-pointer rounded-lg border-2 border-dashed bg-muted/20 p-12 text-center transition hover:border-primary hover:bg-muted/30">
              <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-base font-medium">Drop a PDF here or click to choose</p>
              <p className="mt-1 text-xs text-muted-foreground">10 MB max</p>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                }}
              />
            </label>
          </CardContent>
        </Card>
      )}

      {/* ---------------- UPLOADING ---------------- */}
      {phase === "uploading" && (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <p className="mt-4 text-base font-medium">Parsing {file?.name}…</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Claude is extracting rows from the PDF. New productions will also get a web-search pass for shoot dates and parent studio — this may take up to 2 minutes.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ---------------- ERROR ---------------- */}
      {phase === "error" && (
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <div>
                <p className="font-medium text-destructive">Something went wrong</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                <Button onClick={reset} variant="outline" size="sm" className="mt-3">
                  <RefreshCw className="mr-1 h-3 w-3" /> Try again
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------- DIFF ---------------- */}
      {phase === "diff" && diff && (
        <>
          <div className="grid gap-3 md:grid-cols-5">
            <Card><CardContent className="p-3 text-center"><p className="text-2xl font-semibold">{diff.report_metadata.total_rows}</p><p className="text-xs text-muted-foreground">PDF rows</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><p className="text-2xl font-semibold">{diff.status_changes.length}</p><p className="text-xs text-muted-foreground">Status changes</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><p className="text-2xl font-semibold">{diff.alias_suggestions.length}</p><p className="text-xs text-muted-foreground">Alias suggestions</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><p className="text-2xl font-semibold">{diff.new_productions.length}</p><p className="text-xs text-muted-foreground">New productions</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><p className="text-2xl font-semibold">{diff.fell_off.length}</p><p className="text-xs text-muted-foreground">Fell off report</p></CardContent></Card>
          </div>

          {/* Status changes */}
          {diff.status_changes.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Status changes</CardTitle>
                  <CardDescription>Production status differs between CRM and this week&apos;s report</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setStatusYes(new Set(diff.status_changes.map(s => s.production_id)))}>Accept all</Button>
                  <Button size="sm" variant="ghost" onClick={() => setStatusYes(new Set())}>Clear</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left w-10"></th>
                      <th className="px-4 py-2 text-left">Production</th>
                      <th className="px-4 py-2 text-left">From</th>
                      <th className="px-4 py-2 text-left">→</th>
                      <th className="px-4 py-2 text-left">To</th>
                      <th className="px-4 py-2 text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.status_changes.map((c: StatusChangeItem) => (
                      <tr key={c.production_id} className="border-t">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={statusYes.has(c.production_id)}
                            onChange={() => toggle(statusYes, c.production_id, setStatusYes)}
                          />
                        </td>
                        <td className="px-4 py-2 font-medium">
                          <Link href={`/crm/productions/${c.production_id}`} className="hover:underline" target="_blank">
                            {c.production_name}
                          </Link>
                        </td>
                        <td className="px-4 py-2"><Badge variant="outline" className="text-xs">{c.current_status}</Badge></td>
                        <td className="px-4 py-2 text-muted-foreground">→</td>
                        <td className="px-4 py-2"><Badge className="bg-emerald-100 text-emerald-800 text-xs" variant="secondary">{c.new_status}</Badge></td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{c.notes ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Alias suggestions */}
          {diff.alias_suggestions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Alias suggestions</CardTitle>
                <CardDescription>PDF row name doesn&apos;t match any production, but its &quot;aka&quot; name does. Link as alias?</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 p-4">
                {diff.alias_suggestions.map((a: AliasSuggestionItem, i) => (
                  <label key={i} className="flex items-start gap-3 rounded-md border p-3">
                    <input
                      type="checkbox"
                      checked={aliasYes.has(`alias-${i}`)}
                      onChange={() => toggle(aliasYes, `alias-${i}`, setAliasYes)}
                      className="mt-1"
                    />
                    <div className="flex-1 text-sm">
                      <p><strong>{a.pdf_row.production_name}</strong> from the PDF</p>
                      <p className="text-xs text-muted-foreground">{a.reason}</p>
                      <p className="mt-1">
                        Link as alias of:{" "}
                        <Link href={`/crm/productions/${a.matched_production_id}`} className="font-medium hover:underline" target="_blank">
                          {a.matched_production_name}
                        </Link>
                      </p>
                    </div>
                  </label>
                ))}
              </CardContent>
            </Card>
          )}

          {/* New productions */}
          {diff.new_productions.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>New productions</CardTitle>
                  <CardDescription>Not in your CRM. Research agent has filled in dates + parent studio where possible.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setNewProdYes(new Set(diff.new_productions.map((_, i) => `np-${i}`)))}>Accept all</Button>
                  <Button size="sm" variant="ghost" onClick={() => setNewProdYes(new Set())}>Clear</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                {diff.new_productions.map((np: NewProductionItem, i) => {
                  const key = `np-${i}`;
                  const edits = newProdEdits[key] ?? { start_date: "", end_date: "", studio_id: "" };
                  const matchedId = newProdMatches[key] ?? null;
                  const matchedProd = matchedId
                    ? diff.active_candidates.find(c => c.id === matchedId) ?? null
                    : null;
                  return (
                    <div key={key} className={`rounded-lg border p-3 ${matchedProd ? "border-emerald-300 bg-emerald-50/30" : ""}`}>
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={newProdYes.has(key)}
                          onChange={() => toggle(newProdYes, key, setNewProdYes)}
                          className="mt-1"
                        />
                        <div className="flex-1 space-y-2">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-base font-semibold">{np.pdf_row.production_name}</span>
                            {np.pdf_row.alias_name && (
                              <Badge variant="outline" className="text-[10px]">aka {np.pdf_row.alias_name}</Badge>
                            )}
                            <Badge variant="outline" className="text-[10px]">{np.pdf_row.status_label}</Badge>
                            {np.pdf_row.production_company && (
                              <span className="text-sm text-muted-foreground">from {np.pdf_row.production_company}</span>
                            )}
                          </div>

                          {/* Manual match combobox — escape hatch for misses */}
                          <div className="rounded-md border bg-background p-2">
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Match to existing production
                            </p>
                            <ProductionMatchCombobox
                              candidates={diff.active_candidates}
                              selectedId={matchedId}
                              onSelect={(id) => {
                                setNewProdMatches({ ...newProdMatches, [key]: id });
                                // Auto-check the row when a match is picked so it actually
                                // gets included on apply. Don't auto-uncheck when cleared —
                                // user may want to keep the row as a new production.
                                if (id && !newProdYes.has(key)) {
                                  const copy = new Set(newProdYes);
                                  copy.add(key);
                                  setNewProdYes(copy);
                                }
                              }}
                              pdfRowName={np.pdf_row.production_name}
                            />
                            {matchedProd && (
                              <p className="mt-2 rounded bg-emerald-100 px-2 py-1 text-[11px] text-emerald-800">
                                ✓ Will create alias <strong>&quot;{np.pdf_row.production_name}&quot;</strong> on{" "}
                                <strong>{matchedProd.name}</strong> and update its status to{" "}
                                <strong>{np.pdf_row.status_label.toLowerCase()}</strong>. No new production will be created.
                              </p>
                            )}
                          </div>

                          {/* Below this point: only show the "create new" details if user has NOT matched */}
                          {!matchedProd && (
                            <>
                              {np.suggested_company_id ? (
                                <p className="text-xs text-emerald-700">
                                  ✓ Will link to existing company &quot;{np.suggested_company_name}&quot;
                                </p>
                              ) : np.pdf_row.production_company ? (
                                <p className="text-xs text-amber-700">
                                  No matching company in CRM — will create &quot;{np.pdf_row.production_company}&quot;
                                </p>
                              ) : null}

                              {/* Research panel */}
                              <div className="rounded-md bg-muted/40 p-2 text-xs">
                                <p className="font-semibold uppercase tracking-wide text-muted-foreground">🤖 Researched</p>
                                {np.research && !np.research.failed ? (
                                  <div className="mt-1 space-y-1">
                                    <p>
                                      <span className="text-muted-foreground">Dates:</span>{" "}
                                      {np.research.estimated_start_date ?? "Unknown"} → {np.research.estimated_end_date ?? "Unknown"}
                                      {" · "}
                                      <Badge className={
                                        np.research.confidence === "high" ? "bg-emerald-100 text-emerald-800 text-[10px]"
                                        : np.research.confidence === "medium" ? "bg-amber-100 text-amber-800 text-[10px]"
                                        : "bg-slate-100 text-slate-700 text-[10px]"
                                      } variant="secondary">
                                        {np.research.confidence}
                                      </Badge>
                                    </p>
                                    <p>
                                      <span className="text-muted-foreground">Parent studio:</span>{" "}
                                      {np.research.parent_studio_name ?? "Unknown"}
                                      {np.research.matched_studio_id && <span className="ml-1 text-emerald-700">(matched existing studio ✓)</span>}
                                    </p>
                                    <p className="text-muted-foreground">
                                      Source: {np.research.source_note}
                                      {np.research.source_url && (
                                        <> · <a href={np.research.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">link</a></>
                                      )}
                                    </p>
                                  </div>
                                ) : (
                                  <p className="mt-1 text-muted-foreground">No research result.</p>
                                )}
                              </div>

                              {/* Editable overrides */}
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                <label className="text-xs">
                                  <span className="text-muted-foreground">Start date</span>
                                  <input
                                    type="date"
                                    className="mt-1 block w-full rounded-md border bg-background px-2 py-1 text-sm"
                                    defaultValue={np.research?.estimated_start_date ?? ""}
                                    onChange={e => setNewProdEdits({ ...newProdEdits, [key]: { ...edits, start_date: e.target.value } })}
                                  />
                                </label>
                                <label className="text-xs">
                                  <span className="text-muted-foreground">End date</span>
                                  <input
                                    type="date"
                                    className="mt-1 block w-full rounded-md border bg-background px-2 py-1 text-sm"
                                    defaultValue={np.research?.estimated_end_date ?? ""}
                                    onChange={e => setNewProdEdits({ ...newProdEdits, [key]: { ...edits, end_date: e.target.value } })}
                                  />
                                </label>
                                {np.research?.matched_studio_id && (
                                  <label className="text-xs">
                                    <span className="text-muted-foreground">Studio</span>
                                    <input
                                      readOnly
                                      value={np.research.parent_studio_name ?? ""}
                                      className="mt-1 block w-full rounded-md border bg-muted px-2 py-1 text-sm"
                                    />
                                  </label>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Fell off */}
          {diff.fell_off.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Fell off the report</CardTitle>
                <CardDescription>Active productions in CRM that don&apos;t appear on this week&apos;s PDF. Check the box to mark each as completed.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left w-10">Mark completed</th>
                      <th className="px-4 py-2 text-left">Production</th>
                      <th className="px-4 py-2 text-left">Current status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.fell_off.map((f: FellOffItem) => (
                      <tr key={f.production_id} className="border-t">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={completedYes.has(f.production_id)}
                            onChange={() => toggle(completedYes, f.production_id, setCompletedYes)}
                          />
                        </td>
                        <td className="px-4 py-2 font-medium">
                          <Link href={`/crm/productions/${f.production_id}`} className="hover:underline" target="_blank">
                            {f.production_name}
                          </Link>
                        </td>
                        <td className="px-4 py-2"><Badge variant="outline" className="text-xs">{f.current_status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Apply bar */}
          <div className="sticky bottom-0 flex items-center justify-between rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur">
            <div className="text-sm text-muted-foreground">
              {(() => {
                const matched = Array.from(newProdYes).filter(k => newProdMatches[k]).length;
                const truNew = newProdYes.size - matched;
                return `${statusYes.size} status updates · ${aliasYes.size} aliases · ${truNew} new · ${matched} manual matches · ${completedYes.size} marked completed`;
              })()}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>Cancel</Button>
              <Button
                size="sm"
                disabled={(statusYes.size + aliasYes.size + newProdYes.size + completedYes.size) === 0}
                onClick={() => startTransition(applyDiff)}
              >
                Apply selected <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ---------------- APPLYING ---------------- */}
      {phase === "applying" && (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <p className="mt-4 text-base font-medium">Applying changes…</p>
          </CardContent>
        </Card>
      )}

      {/* ---------------- DONE ---------------- */}
      {phase === "done" && result && (
        <Card className="border-emerald-300">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              <div className="flex-1">
                <p className="text-lg font-semibold text-emerald-700">Done</p>
                <ul className="mt-2 space-y-1 text-sm">
                  <li>• {result.status_updates} status updates</li>
                  <li>• {result.productions_created} new productions created</li>
                  <li>• {result.manual_matches_applied} manual matches resolved</li>
                  <li>• {result.aliases_created} aliases added</li>
                  <li>• {result.companies_created} companies created</li>
                  <li>• {result.studios_linked_or_created} studios linked or created</li>
                  <li>• {result.contacts_created} contacts created</li>
                  <li>• {result.marked_completed} productions marked completed</li>
                </ul>
                {result.errors.length > 0 && (
                  <div className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                    <p className="font-semibold">{result.errors.length} non-fatal errors:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
                <div className="mt-4 flex gap-2">
                  <Button size="sm" onClick={() => router.push("/crm/clients")}>Open Clients board</Button>
                  <Button size="sm" variant="outline" onClick={reset}>Import another</Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {pending && null}
    </div>
  );
}

"use client";

import { Fragment, use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { MonthCells } from "@/components/budget/month-cells";
import { MasterExportButton } from "@/components/budget/master-export-button";
import { fmtPct, fmtUsd, MONTH_ABBRS } from "@/lib/budget/format";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  kind: string;
  label: string;
  source: string;
  sourceHref: string | null;
  methodText: string | null;
  note: string | null;
  count: number | null;
  months: number[];
  total: number;
  parts?: Array<{ label: string; months: number[]; total: number; note: string | null }>;
}
interface GroupLine {
  reportingEntityId: string;
  code: string;
  name: string;
  versionId: string;
  months: number[];
  total: number;
  priorYear: number[] | null;
  items: Item[];
}
interface Line {
  id: string;
  accountNumber: string | null;
  name: string;
  months: number[];
  priorYear: number[];
  groups: GroupLine[];
}
interface Section {
  id: string;
  title: string;
  masters: Line[];
}
interface Group {
  reportingEntityId: string;
  code: string;
  name: string;
  version: { id: string; name: string; status: string; isActive: boolean } | null;
}
interface Payload {
  groups: Group[];
  sections: Section[];
  eliminated: Array<{ id: string; accountNumber: string | null; name: string; groups: Array<{ code: string; total: number }>; total: number }>;
}

const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
const addTo = (t: number[], s: number[]) => s.forEach((v, i) => (t[i] += v));
const zeros = () => new Array(12).fill(0) as number[];

/**
 * Every reporting group's budget for a year in one read-only model through
 * EBITDA (JD): each line opens to the group subtotals, and each group to the
 * items behind it. Edits stay in the group versions.
 */
export default function ConsolidatedBudgetPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = use(params);
  const fiscalYear = Number(year);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPrior, setShowPrior] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/budget/consolidated-model?fiscalYear=${fiscalYear}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load the consolidated budget");
    } finally {
      setLoading(false);
    }
  }, [fiscalYear]);
  useEffect(() => {
    if (Number.isFinite(fiscalYear) && fiscalYear > 2000) load();
  }, [load, fiscalYear]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const lineIds = useMemo(() => (data ? data.sections.flatMap((s) => s.masters.map((m) => m.id)) : []), [data]);
  const allOpen = lineIds.length > 0 && lineIds.every((id) => open.has(id));

  const totals = useMemo(() => {
    if (!data) return null;
    const bySection: Record<string, number[]> = {};
    const priorBySection: Record<string, number[]> = {};
    for (const s of data.sections) {
      const t = zeros();
      const p = zeros();
      for (const m of s.masters) {
        addTo(t, m.months);
        addTo(p, m.priorYear);
      }
      bySection[s.id] = t;
      priorBySection[s.id] = p;
    }
    const line = (src: Record<string, number[]>) => {
      const rev = src.revenue ?? zeros();
      const doc = src.direct_operating_costs ?? zeros();
      const ooc = src.other_operating_costs ?? zeros();
      const gross = rev.map((v, i) => v - doc[i]);
      const ebitda = gross.map((v, i) => v - ooc[i]);
      return { rev, gross, ebitda };
    };
    const now = line(bySection);
    const prior = line(priorBySection);
    return { bySection, priorBySection, now, prior };
  }, [data]);

  if (!Number.isFinite(fiscalYear) || fiscalYear <= 2000) return <p className="text-sm text-destructive">Not a valid year.</p>;

  const colSpan = 1 + 12 + 1 + (showPrior ? 2 : 0);
  const prior = fiscalYear - 1;

  const subtotalRow = (label: string, months: number[], priorMonths: number[], opts?: { strong?: boolean; invert?: boolean }) => (
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link href="/budget" className="hover:underline">Budget</Link> / Consolidated
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Consolidated budget {fiscalYear}</h1>
        </div>
        <MasterExportButton fiscalYear={fiscalYear} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading every reporting group
        </div>
      ) : !data || !totals ? (
        <p className="text-sm text-muted-foreground">Nothing to show.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.groups.map((g) => (
              <Card key={g.reportingEntityId}>
                <CardContent className="space-y-1 p-4 text-sm">
                  <div className="font-medium">{g.name}</div>
                  {g.version ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/budget/${g.version.id}/lines`} className="underline-offset-2 hover:underline">{g.version.name}</Link>
                      <Badge variant="outline">{g.version.status}</Badge>
                      <Badge variant={g.version.isActive ? "default" : "secondary"}>{g.version.isActive ? "Active" : "Latest"}</Badge>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">No {fiscalYear} version</div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Budget model</CardTitle>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <Switch checked={showPrior} onCheckedChange={setShowPrior} />
                    <span>{prior} actual</span>
                  </label>
                  <Button variant="outline" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set(lineIds))}>
                    {allOpen ? "Collapse all" : "Expand all"}
                  </Button>
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
                          return (
                            <Fragment key={m.id}>
                              <TableRow className={cn(expanded && "bg-muted/20")}>
                                <TableCell className="whitespace-nowrap">
                                  <button type="button" onClick={() => toggle(m.id)} className="flex items-center gap-1.5 text-left" aria-expanded={expanded}>
                                    {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                    <span className="text-xs tabular-nums text-muted-foreground">{m.accountNumber}</span>
                                    <span className="font-medium">{m.name}</span>
                                    {m.groups.length > 0 && <span className="text-xs text-muted-foreground">{m.groups.map((g) => g.code).join(", ")}</span>}
                                  </button>
                                </TableCell>
                                <MonthCells months={m.months} prior={m.priorYear} showPrior={showPrior} invert={invert} />
                              </TableRow>
                              {expanded &&
                                m.groups.map((g) => {
                                  const gid = `${m.id}|${g.reportingEntityId}`;
                                  const gOpen = open.has(gid);
                                  return (
                                    <Fragment key={gid}>
                                      <TableRow className="text-sm">
                                        <TableCell className="w-[380px] min-w-[380px] max-w-[380px] whitespace-nowrap py-1.5 pl-7">
                                          <div className="flex items-center gap-2">
                                            <button type="button" onClick={() => toggle(gid)} className="flex items-center gap-1.5 text-left" aria-expanded={gOpen}>
                                              {gOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                              <span className="font-medium">{g.name}</span>
                                              <span className="text-xs text-muted-foreground">{g.items.length} item{g.items.length === 1 ? "" : "s"}</span>
                                            </button>
                                            <Link href={`/budget/${g.versionId}/lines`} className="text-muted-foreground hover:text-foreground" aria-label={`Open ${g.name} budget`}>
                                              <ExternalLink className="h-3 w-3" />
                                            </Link>
                                          </div>
                                        </TableCell>
                                        <MonthCells months={g.months} prior={g.priorYear ?? undefined} showPrior={showPrior} invert={invert} className="py-1.5" />
                                      </TableRow>
                                      {gOpen &&
                                        g.items.map((it) => (
                                          <Fragment key={it.id}>
                                            <TableRow className="text-sm">
                                              <TableCell className="w-[380px] min-w-[380px] max-w-[380px] whitespace-normal py-1.5 pl-14 align-top">
                                                <div className="min-w-0 break-words">
                                                  <div className="flex flex-wrap items-center gap-x-2">
                                                    <span>{it.label}</span>
                                                    {it.count != null && <span className="text-xs text-muted-foreground">{it.count} {it.kind === "payroll" ? "people" : "rows"}</span>}
                                                    <span className="rounded border px-1.5 text-[11px] leading-5 text-muted-foreground">{it.source}</span>
                                                    {it.sourceHref && (
                                                      <Link href={it.sourceHref} className="text-muted-foreground hover:text-foreground" aria-label={`Open ${it.source}`}>
                                                        <ExternalLink className="h-3 w-3" />
                                                      </Link>
                                                    )}
                                                  </div>
                                                  {it.methodText && <div className="text-xs text-muted-foreground">{it.methodText}</div>}
                                                  {it.note && <div className="text-xs italic text-muted-foreground">{it.note}</div>}
                                                </div>
                                              </TableCell>
                                              <MonthCells months={it.months} showPrior={showPrior} className={cn("py-1.5 text-xs", it.parts ? "text-foreground" : "text-muted-foreground")} />
                                            </TableRow>
                                            {(it.parts ?? []).map((p, idx) => (
                                              <TableRow key={idx} className="text-xs text-muted-foreground">
                                                <TableCell className="w-[380px] min-w-[380px] max-w-[380px] whitespace-normal py-1 pl-20">
                                                  {p.label}
                                                  {p.note && <span className="ml-2 italic">{p.note}</span>}
                                                </TableCell>
                                                <MonthCells months={p.months} showPrior={showPrior} className="py-1 text-xs text-muted-foreground" />
                                              </TableRow>
                                            ))}
                                          </Fragment>
                                        ))}
                                    </Fragment>
                                  );
                                })}
                              {expanded && m.groups.length === 0 && (
                                <TableRow className="text-sm">
                                  <TableCell colSpan={colSpan} className="py-1.5 pl-9 text-xs text-muted-foreground">Nothing under this line.</TableCell>
                                </TableRow>
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
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {data.eliminated.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Intercompany, eliminated</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>By group</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.eliminated.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          <span className="mr-2 text-xs tabular-nums text-muted-foreground">{e.accountNumber}</span>
                          {e.name}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.groups.map((g) => `${g.code} ${fmtUsd(g.total)}`).join(" · ")}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtUsd(e.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

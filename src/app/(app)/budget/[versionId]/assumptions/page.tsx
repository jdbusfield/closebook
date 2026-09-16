"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save } from "lucide-react";
import { useBudgetVersion } from "../version-shell";

interface CatalogKey {
  key: string;
  label: string;
  group: string;
  unit: string;
  defaultValue: number;
  description: string;
  scopes: string[];
}

interface AssumptionRow {
  id: string;
  scope: string;
  scope_id: string | null;
  key: string;
  value: number | null;
  source_note: string | null;
}

const GROUP_LABELS: Record<string, string> = {
  payroll_tax: "Employer payroll taxes",
  benefits: "Benefits and soft costs",
  personnel: "Personnel",
  revenue: "Revenue drivers",
  cost: "Cost drivers",
  capex: "Capex",
  general: "General",
};

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatDefault(value: number, unit: string): string {
  switch (unit) {
    case "usd":
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
    case "pct":
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value)}%`;
    case "rate_per_100":
      return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)} per $100`;
    case "hours":
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} h`;
    case "month":
      return MONTH_NAMES[Math.max(1, Math.min(12, Math.round(value))) - 1] ?? String(value);
    case "ratio":
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}x`;
    default:
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }
}

const COMPANIES = [
  { id: "132427", label: "Silverco (Paylocity 132427)" },
  { id: "316791", label: "HDR (Paylocity 316791)" },
];

export default function BudgetAssumptionsPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const { readOnly } = useBudgetVersion();
  const [catalog, setCatalog] = useState<CatalogKey[]>([]);
  const [rows, setRows] = useState<AssumptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // edits keyed by scope|scopeId|key -> string value ("" = clear)
  const [edits, setEdits] = useState<Record<string, { value: string; note?: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/budget/assumptions?versionId=${versionId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setCatalog(data.catalog ?? []);
      setRows(data.rows ?? []);
      setEdits({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load assumptions");
    } finally {
      setLoading(false);
    }
  }, [versionId]);

  useEffect(() => {
    load();
  }, [load]);

  const stored = useMemo(() => {
    const m = new Map<string, AssumptionRow>();
    for (const r of rows) m.set(`${r.scope}|${r.scope_id ?? ""}|${r.key}`, r);
    return m;
  }, [rows]);

  const groups = useMemo(() => {
    const m = new Map<string, CatalogKey[]>();
    for (const k of catalog) {
      const list = m.get(k.group) ?? [];
      list.push(k);
      m.set(k.group, list);
    }
    return [...m.entries()];
  }, [catalog]);

  const cellKey = (scope: string, scopeId: string | null, key: string) => `${scope}|${scopeId ?? ""}|${key}`;

  const currentValue = (scope: string, scopeId: string | null, key: string): string => {
    const ck = cellKey(scope, scopeId, key);
    if (ck in edits) return edits[ck].value;
    const r = stored.get(ck);
    return r?.value == null ? "" : String(r.value);
  };

  const dirty = Object.keys(edits).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const payload = Object.entries(edits).map(([ck, e]) => {
        const [scope, scopeId, key] = ck.split("|");
        return {
          scope,
          scopeId: scopeId || null,
          key,
          value: e.value.trim() === "" ? null : Number(e.value),
          sourceNote: e.note ?? stored.get(ck)?.source_note ?? null,
        };
      });
      const res = await fetch("/api/budget/assumptions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, rows: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      toast.success(`Saved ${data.upserted} value${data.upserted === 1 ? "" : "s"}${data.deleted ? `, cleared ${data.deleted}` : ""}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading assumptions
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Blank means the default shown in grey. Percentages are whole numbers (6.2 = 6.2%). Every build records the keys it used, so a change here shows up in the next recompute.
        </p>
        <Button onClick={save} disabled={!dirty || saving || readOnly}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save changes
        </Button>
      </div>

      {groups.map(([group, keys]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{GROUP_LABELS[group] ?? group}</CardTitle>
            {group === "payroll_tax" && (
              <CardDescription>
                Defaults come from the tax table for the budget year. Enter the CA SUI experience rate per Paylocity company when the EDD notice arrives.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[280px]">Assumption</TableHead>
                  <TableHead className="w-[130px] text-right">Default</TableHead>
                  <TableHead className="w-[140px] text-right">Organization</TableHead>
                  {group === "payroll_tax" || group === "benefits" || group === "personnel"
                    ? COMPANIES.map((c) => <TableHead key={c.id} className="w-[140px] text-right">{c.label.split(" (")[0]}</TableHead>)
                    : null}
                  <TableHead className="min-w-[240px]">Source note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => {
                  const orgKey = cellKey("org", null, k.key);
                  const showCompany = k.scopes.includes("company");
                  return (
                    <TableRow key={k.key}>
                      <TableCell>
                        <div className="font-medium">{k.label}</div>
                        {k.description && <div className="text-xs text-muted-foreground">{k.description}</div>}
                        {k.key === "wc_rate" && (
                          <div className="text-xs text-muted-foreground">Set per class code on the Headcount page (scope = class code).</div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                        {formatDefault(k.defaultValue, k.unit)}
                      </TableCell>
                      <TableCell>
                        <Input
                          id={`assumption-org-${k.key}`}
                          type="number"
                          step="any"
                          disabled={readOnly || k.key === "wc_rate"}
                          value={currentValue("org", null, k.key)}
                          placeholder={String(k.defaultValue)}
                          onChange={(e) => setEdits((d) => ({ ...d, [orgKey]: { ...d[orgKey], value: e.target.value } }))}
                          className="h-8 text-right tabular-nums"
                        />
                      </TableCell>
                      {(group === "payroll_tax" || group === "benefits" || group === "personnel") &&
                        COMPANIES.map((c) => (
                          <TableCell key={c.id}>
                            {showCompany ? (
                              <Input
                                id={`assumption-${c.id}-${k.key}`}
                                type="number"
                                step="any"
                                disabled={readOnly}
                                value={currentValue("company", c.id, k.key)}
                                placeholder="same as org"
                                onChange={(e) =>
                                  setEdits((d) => ({
                                    ...d,
                                    [cellKey("company", c.id, k.key)]: { ...d[cellKey("company", c.id, k.key)], value: e.target.value },
                                  }))
                                }
                                className="h-8 text-right tabular-nums"
                              />
                            ) : (
                              <span className="block text-right text-xs text-muted-foreground">org only</span>
                            )}
                          </TableCell>
                        ))}
                      <TableCell>
                        <Input
                          id={`assumption-note-${k.key}`}
                          disabled={readOnly}
                          value={edits[orgKey]?.note ?? stored.get(orgKey)?.source_note ?? ""}
                          placeholder="Where this number came from"
                          onChange={(e) =>
                            setEdits((d) => ({
                              ...d,
                              [orgKey]: { value: d[orgKey]?.value ?? currentValue("org", null, k.key), note: e.target.value },
                            }))
                          }
                          className="h-8"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

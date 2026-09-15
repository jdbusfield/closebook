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

const UNIT_SUFFIX: Record<string, string> = {
  pct: "%",
  usd: "$",
  rate_per_100: "per $100",
  hours: "h",
  month: "month",
  count: "",
  ratio: "x",
};

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
                  <TableHead className="w-[260px]">Assumption</TableHead>
                  <TableHead className="w-[120px]">Default</TableHead>
                  <TableHead className="w-[160px]">Organization</TableHead>
                  {group === "payroll_tax" || group === "benefits" || group === "personnel"
                    ? COMPANIES.map((c) => <TableHead key={c.id} className="w-[160px]">{c.label.split(" (")[0]}</TableHead>)
                    : null}
                  <TableHead>Source note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => {
                  const suffix = UNIT_SUFFIX[k.unit] ?? "";
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
                      <TableCell className="tabular-nums text-muted-foreground">
                        {k.defaultValue} {suffix}
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
                          className="h-8 tabular-nums"
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
                                placeholder="org"
                                onChange={(e) =>
                                  setEdits((d) => ({
                                    ...d,
                                    [cellKey("company", c.id, k.key)]: { ...d[cellKey("company", c.id, k.key)], value: e.target.value },
                                  }))
                                }
                                className="h-8 tabular-nums"
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">n/a</span>
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

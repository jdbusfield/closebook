"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";

interface ResolvedSide {
  masterId: string;
  masterName: string;
  masterNumber: string | null;
  rootMasterId: string;
  rootMasterName: string;
  rootMasterNumber: string | null;
  classification: string;
}

interface MappingDiffRow {
  glAccountId: string;
  glAccountName: string;
  glAccountNumber: string | null;
  glClassification: string;
  entityId: string;
  entityCode: string;
  entityName: string;
  acc: ResolvedSide | null;
  mgt: ResolvedSide | null;
  status: "same" | "different" | "unmapped_acc" | "unmapped_mgt" | "unmapped_both";
}

interface BridgeMappingDiffProps {
  organizationId: string;
  reportingEntityId?: string | null;
}

/**
 * "Where does each QBO GL account land on each chart?" view.
 *
 * Defaults to showing only differences (the most actionable rows). Filters
 * let the auditor inspect a specific line ("Vehicle Rental Revenue") and
 * see all GL accounts feeding it on each chart.
 */
export function BridgeMappingDiff({
  organizationId,
  reportingEntityId,
}: BridgeMappingDiffProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<MappingDiffRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<
    "all" | "different" | "same" | "unmapped"
  >("different");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [lineFilter, setLineFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/financial-statements/bridge/mapping-diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          ...(reportingEntityId ? { reportingEntityId } : {}),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { rows: MappingDiffRow[] };
      setRows(json.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [organizationId, reportingEntityId]);

  useEffect(() => {
    if (open && !rows && !loading) fetchData();
  }, [open, rows, loading, fetchData]);

  const entities = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, string>();
    for (const r of rows) {
      if (!map.has(r.entityId)) map.set(r.entityId, r.entityCode || r.entityName);
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [rows]);

  const lines = useMemo(() => {
    if (!rows) return [];
    const set = new Set<string>();
    for (const r of rows) {
      if (r.acc) set.add(r.acc.rootMasterName);
      if (r.mgt) set.add(r.mgt.rootMasterName);
    }
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      if (statusFilter === "different" && r.status !== "different") return false;
      if (statusFilter === "same" && r.status !== "same") return false;
      if (
        statusFilter === "unmapped" &&
        r.status !== "unmapped_acc" &&
        r.status !== "unmapped_mgt" &&
        r.status !== "unmapped_both"
      ) {
        return false;
      }
      if (entityFilter !== "all" && r.entityId !== entityFilter) return false;
      if (lineFilter !== "all") {
        const accLine = r.acc?.rootMasterName ?? "";
        const mgtLine = r.mgt?.rootMasterName ?? "";
        if (accLine !== lineFilter && mgtLine !== lineFilter) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        const hay = [
          r.glAccountName,
          r.glAccountNumber,
          r.acc?.rootMasterName,
          r.mgt?.rootMasterName,
          r.entityCode,
          r.entityName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, entityFilter, lineFilter, search]);

  const counts = useMemo(() => {
    if (!rows) return { all: 0, different: 0, same: 0, unmapped: 0 };
    let different = 0, same = 0, unmapped = 0;
    for (const r of rows) {
      if (r.status === "different") different++;
      else if (r.status === "same") same++;
      else unmapped++;
    }
    return { all: rows.length, different, same, unmapped };
  }, [rows]);

  function statusBadge(s: MappingDiffRow["status"]) {
    if (s === "same") {
      return (
        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
          <CheckCircle2 className="h-3 w-3" /> Same
        </span>
      );
    }
    if (s === "different") {
      return (
        <span className="inline-flex items-center gap-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
          <AlertTriangle className="h-3 w-3" /> Different
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
        <MinusCircle className="h-3 w-3" />
        {s === "unmapped_acc"
          ? "ACC unmapped"
          : s === "unmapped_mgt"
            ? "MGT unmapped"
            : "Both unmapped"}
      </span>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <div className="flex items-center gap-2">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <CardTitle className="text-base">GL account mapping diff</CardTitle>
          </div>
          {rows && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{counts.all.toLocaleString()} GL accounts</span>
              {counts.different > 0 && (
                <span className="rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 px-1.5 py-0.5 uppercase tracking-wider">
                  {counts.different} different
                </span>
              )}
            </div>
          )}
        </button>
        {open && (
          <p className="text-xs text-muted-foreground">
            For every QBO GL account mapped on either chart, see which line it
            feeds on each. Defaults to showing only mismatches.
          </p>
        )}
      </CardHeader>
      {open && (
        <CardContent className="overflow-x-auto pt-0 space-y-3">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {loading && !rows && (
            <p className="text-xs text-muted-foreground">Loading mapping data...</p>
          )}

          {rows && (
            <>
              <div className="flex flex-wrap items-end gap-2 text-xs">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Status</Label>
                  <Select
                    value={statusFilter}
                    onValueChange={(v) =>
                      setStatusFilter(v as "all" | "different" | "same" | "unmapped")
                    }
                  >
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="different">
                        Different ({counts.different})
                      </SelectItem>
                      <SelectItem value="same">Same ({counts.same})</SelectItem>
                      <SelectItem value="unmapped">
                        Unmapped ({counts.unmapped})
                      </SelectItem>
                      <SelectItem value="all">All ({counts.all})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Entity</Label>
                  <Select value={entityFilter} onValueChange={setEntityFilter}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All entities</SelectItem>
                      {entities.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <Label className="text-[10px] text-muted-foreground">Line</Label>
                  <Select value={lineFilter} onValueChange={setLineFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All lines</SelectItem>
                      {lines.map((ln) => (
                        <SelectItem key={ln} value={ln}>
                          {ln}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <Label className="text-[10px] text-muted-foreground">Search</Label>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Account name / number / line..."
                    className="h-8 text-xs"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchData}
                  disabled={loading}
                >
                  Refresh
                </Button>
              </div>

              <table className="text-xs w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-2 font-medium">Status</th>
                    <th className="text-left py-2 pr-2 font-medium">Entity</th>
                    <th className="text-left py-2 pr-2 font-medium">QBO Account</th>
                    <th className="text-left py-2 pr-2 font-medium">Accountant line</th>
                    <th className="text-left py-2 pr-2 font-medium">Company line</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-3 text-muted-foreground text-center">
                        No rows match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((r) => (
                      <tr
                        key={`${r.entityId}_${r.glAccountId}`}
                        className="border-b last:border-b-0"
                      >
                        <td className="py-1 pr-2">{statusBadge(r.status)}</td>
                        <td className="py-1 pr-2">{r.entityCode}</td>
                        <td className="py-1 pr-2">
                          <div className="font-medium">
                            {r.glAccountNumber ? `${r.glAccountNumber} — ` : ""}
                            {r.glAccountName}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {r.glClassification}
                          </div>
                        </td>
                        <td className="py-1 pr-2">
                          {r.acc ? (
                            <div>
                              <div className="font-medium">{r.acc.rootMasterName}</div>
                              {r.acc.rootMasterId !== r.acc.masterId && (
                                <div className="text-[10px] text-muted-foreground">
                                  via {r.acc.masterName}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">unmapped</span>
                          )}
                        </td>
                        <td className="py-1 pr-2">
                          {r.mgt ? (
                            <div>
                              <div className="font-medium">{r.mgt.rootMasterName}</div>
                              {r.mgt.rootMasterId !== r.mgt.masterId && (
                                <div className="text-[10px] text-muted-foreground">
                                  via {r.mgt.masterName}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">unmapped</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {filteredRows.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Showing {filteredRows.length.toLocaleString()} of {rows.length.toLocaleString()} GL accounts
                </p>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

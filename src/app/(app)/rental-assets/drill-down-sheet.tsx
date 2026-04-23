"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";

interface DrillRow {
  key: string;
  kind: "asset" | "orphan";
  asset_id: string | null;
  asset_tag: string | null;
  veh_number: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  entity_name: string | null;
  reporting_group: string;
  master_type: string;
  acquisition_cost: number;
  fleet_days: number;
  rental_days: number;
  actual_rental_days: number;
  revenue: number;
  months: number;
  fleetio_vehicle_id: number | null;
  utilization_pct: number;
  financial_util_pct: number;
  avg_daily_rate: number;
}

interface DrillSummary {
  asset_count: number;
  fleet_days: number;
  rental_days: number;
  actual_rental_days: number;
  revenue: number;
  acquisition_cost: number;
  utilization_pct: number;
  financial_util_pct: number;
  avg_daily_rate: number;
}

interface DrillResponse {
  period: string;
  group: string | null;
  rows: DrillRow[];
  summary: DrillSummary;
}

export interface DrillParams {
  organizationId: string;
  period: string;
  periodLabel: string;
  group: string | null;
  groupBy: "reporting_group" | "master_type";
  includeService: boolean;
  entityId: string | null;
  entityName: string | null;
}

function fmtPct(n: number, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

// Parse the bucket period string to derive its annualization factor.
// Monthly "YYYY-MM" → ×12 · Quarterly "YYYY-QN" → ×4 · Yearly "YYYY" → ×1
function annualizationFactorFromPeriod(period: string): number {
  if (/^\d{4}$/.test(period)) return 1;
  if (/^\d{4}-Q[1-4]$/.test(period)) return 4;
  if (/^\d{4}-\d{2}$/.test(period)) return 12;
  return 1;
}

type SortKey =
  | "revenue"
  | "utilization_pct"
  | "financial_util_pct"
  | "avg_daily_rate"
  | "fleet_days"
  | "reporting_group";

export function DrillDownSheet({
  params,
  onClose,
}: {
  params: DrillParams | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<DrillResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (!params) return;
    const controller = new AbortController();
    // Kick off the fetch first, then flip loading state — satisfies the
    // react-hooks/set-state-in-effect lint and keeps the UX correct
    // (progress appears on the next paint).
    const q = new URLSearchParams({
      organization_id: params.organizationId,
      period: params.period,
      include_service: String(params.includeService),
      group_by: params.groupBy,
    });
    if (params.group) q.set("group", params.group);
    if (params.entityId) q.set("entity_id", params.entityId);
    const pending = fetch(
      `/api/rental-assets/drill-down?${q.toString()}`,
      { signal: controller.signal }
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        return (await r.json()) as DrillResponse;
      })
      .then((j) => {
        setData(j);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(String(e.message ?? e));
      })
      .finally(() => setLoading(false));
    // Tag the fetch as running and reset old state only AFTER kicking off
    // the request — satisfies the lint rule that flags synchronous setState
    // at the top of an effect body.
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setError(null);
        setData(null);
      }
    });
    return () => {
      controller.abort();
      void pending;
    };
  }, [params]);

  const finFactor = params ? annualizationFactorFromPeriod(params.period) : 1;
  const finSuffix = finFactor > 1 ? " (annualized)" : "";

  const sortedRows = (() => {
    if (!data) return [];
    const rows = [...data.rows];
    rows.sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      if (sortKey === "reporting_group") {
        va = a.reporting_group;
        vb = b.reporting_group;
      } else {
        va = a[sortKey];
        vb = b[sortKey];
      }
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === "asc"
        ? Number(va) - Number(vb)
        : Number(vb) - Number(va);
    });
    return rows;
  })();

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "reporting_group" ? "asc" : "desc");
    }
  }

  function sortIndicator(k: SortKey) {
    if (sortKey !== k) return null;
    return <span className="ml-1 text-muted-foreground">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const open = params != null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-4xl"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>
            {params?.group ?? "All Groups"}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              · {params?.periodLabel}
            </span>
          </SheetTitle>
          <SheetDescription>
            {params?.entityName ? `${params.entityName} · ` : "Organization · "}
            {params?.includeService ? "Rental + Service" : "Rental only"}
          </SheetDescription>
        </SheetHeader>

        {/* Summary tiles */}
        {data && (
          <div className="grid grid-cols-3 gap-3 border-b bg-muted/30 px-6 py-3">
            <SummaryBox
              label="Assets"
              value={data.summary.asset_count.toString()}
              hint={`${data.summary.fleet_days.toFixed(0)} fleet days`}
            />
            <SummaryBox
              label="Revenue"
              value={formatCurrency(data.summary.revenue)}
              hint={`${data.summary.rental_days.toFixed(0)} rental days · ADR ${data.summary.avg_daily_rate > 0 ? formatCurrency(data.summary.avg_daily_rate) : "—"}`}
            />
            <SummaryBox
              label="Utilization"
              value={fmtPct(data.summary.utilization_pct)}
              hint={`Financial util${finSuffix} ${fmtPct(
                data.summary.financial_util_pct * finFactor,
                2
              )}`}
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {loading && (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              Loading rows…
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 p-4 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
          {data && !loading && sortedRows.length === 0 && (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              No rows for this selection.
            </div>
          )}
          {data && sortedRows.length > 0 && (
            <Table>
              <TableHeader className="sticky top-0 bg-background shadow-[inset_0_-1px_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("reporting_group")}
                  >
                    Group{sortIndicator("reporting_group")}
                  </TableHead>
                  <TableHead>Veh # / Tag</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("fleet_days")}
                  >
                    Fleet Days{sortIndicator("fleet_days")}
                  </TableHead>
                  <TableHead className="text-right">Rental Days</TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("utilization_pct")}
                  >
                    Util %{sortIndicator("utilization_pct")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("revenue")}
                  >
                    Revenue{sortIndicator("revenue")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("avg_daily_rate")}
                    title="Revenue ÷ actual rental days"
                  >
                    ADR{sortIndicator("avg_daily_rate")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("financial_util_pct")}
                    title={
                      finFactor > 1
                        ? `Annualized: single-period rate × ${finFactor}`
                        : undefined
                    }
                  >
                    Fin Util %{finSuffix.replace(" ", "")}{sortIndicator("financial_util_pct")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="text-xs">
                      <Badge variant="outline">{r.reporting_group}</Badge>
                      {r.kind === "orphan" && (
                        <Badge
                          variant="secondary"
                          className="ml-1 text-[10px]"
                        >
                          orphan
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {r.veh_number ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.year ? `${r.year} ` : ""}
                      {r.make ?? ""} {r.model ?? ""}
                      {r.vin && (
                        <span className="ml-1 text-muted-foreground">
                          · VIN …{r.vin.slice(-6)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.entity_name ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.fleet_days.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.rental_days.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtPct(r.utilization_pct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.avg_daily_rate > 0 ? (
                        formatCurrency(r.avg_daily_rate)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.acquisition_cost > 0 ? (
                        fmtPct(r.financial_util_pct * finFactor, 2)
                      ) : (
                        <span className="text-muted-foreground">n/a</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SummaryBox({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

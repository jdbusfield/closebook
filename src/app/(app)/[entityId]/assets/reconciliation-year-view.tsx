"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Minus,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import {
  RECON_GROUPS,
  FLEET_ACCUM_DEPR_GROUP,
  getEffectiveReconGroups,
  type ReconGroup,
} from "@/lib/utils/asset-gl-groups";
import {
  getEffectiveMasterType,
  getReportingGroup,
  customRowsToClassifications,
  type VehicleClassification,
  type CustomVehicleClassRow,
} from "@/lib/utils/vehicle-classification";
import {
  generateDepreciationSchedule,
  buildOpeningBalance,
  type AssetForDepreciation,
} from "@/lib/utils/depreciation";
import type { DepreciationRule } from "./depreciation-rules-settings";

type CellStatus =
  | "reconciled"
  | "variance"
  | "ready"
  | "no_accounts"
  | "no_data";

interface CellState {
  status: CellStatus;
  variance: number;
  glBalance: number;
  subledgerBalance: number;
  hasActivity: boolean;
}

interface AssetRow {
  id: string;
  vehicle_class: string | null;
  in_service_date: string | null;
  acquisition_cost: number;
  book_useful_life_months: number;
  book_salvage_value: number;
  book_depreciation_method: string;
  book_accumulated_depreciation: number;
  book_net_value: number;
  status: string;
  disposed_date: string | null;
  disposed_book_gain_loss: number | null;
  cost_account_id: string | null;
  accum_depr_account_id: string | null;
  master_type_override: string | null;
}

interface DeprRow {
  fixed_asset_id: string;
  period_month: number;
  book_accumulated: number;
}

interface GlBalanceRow {
  account_id: string;
  period_month: number;
  ending_balance: number;
}

interface ReconciliationRow {
  gl_account_group: string;
  period_month: number;
  is_reconciled: boolean;
}

interface Props {
  entityId: string;
  year: number;
  onYearChange: (year: number) => void;
  onJumpToMonth: (year: number, month: number) => void;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const VARIANCE_TOLERANCE = 1.0;

export function ReconciliationYearView({
  entityId,
  year,
  onYearChange,
  onJumpToMonth,
}: Props) {
  const supabase = createClient();
  const now = new Date();

  const [loading, setLoading] = useState(true);
  const [cells, setCells] = useState<Record<string, Record<number, CellState>>>(
    {}
  );
  const [hasMappings, setHasMappings] = useState<Record<string, boolean>>({});
  const [effectiveGroups, setEffectiveGroups] =
    useState<ReconGroup[]>(RECON_GROUPS);

  const loadData = useCallback(async () => {
    setLoading(true);

    // Parallel-fetch everything we need for the entity/year
    const [linksRes, classesRes, assetsRes, reconsRes, rulesRes, settingsRes] =
      await Promise.all([
        fetch(`/api/assets/recon-links?entityId=${entityId}`),
        fetch(`/api/assets/classes?entityId=${entityId}`),
        supabase
          .from("fixed_assets")
          .select(
            "id, vehicle_class, in_service_date, acquisition_cost, book_useful_life_months, book_salvage_value, book_depreciation_method, book_accumulated_depreciation, book_net_value, status, disposed_date, disposed_book_gain_loss, cost_account_id, accum_depr_account_id, master_type_override"
          )
          .eq("entity_id", entityId),
        supabase
          .from("asset_reconciliations")
          .select("gl_account_group, period_month, is_reconciled")
          .eq("entity_id", entityId)
          .eq("period_year", year),
        fetch(`/api/assets/depreciation-rules?entityId=${entityId}`),
        fetch(`/api/assets/settings?entityId=${entityId}`),
      ]);

    // Parse settings once: drives both the combine-accum toggle (below) and
    // the opening-balance logic further down. The body can only be read once,
    // so we stash the parsed object in `settings` and reuse it.
    const settings = settingsRes.ok ? await settingsRes.json() : null;
    const combineAccumLocal = Boolean(
      (settings as { combine_fleet_accum_depr?: boolean } | null)
        ?.combine_fleet_accum_depr
    );
    const groups = getEffectiveReconGroups({
      combine_fleet_accum_depr: combineAccumLocal,
    });
    setEffectiveGroups(groups);

    // -- account → recon_group mappings
    const linkRows: Array<{ recon_group: string; account_id: string }> =
      linksRes.ok ? await linksRes.json() : [];
    const accountToGroup: Record<string, string> = {};
    const mappingsByGroup: Record<string, string[]> = {};
    for (const g of groups) mappingsByGroup[g.key] = [];
    for (const m of linkRows) {
      accountToGroup[m.account_id] = m.recon_group;
      if (!mappingsByGroup[m.recon_group]) mappingsByGroup[m.recon_group] = [];
      mappingsByGroup[m.recon_group].push(m.account_id);
    }
    const mapped: Record<string, boolean> = {};
    for (const g of groups) {
      mapped[g.key] = (mappingsByGroup[g.key]?.length ?? 0) > 0;
    }
    setHasMappings(mapped);

    // -- custom vehicle classes
    const classRows: CustomVehicleClassRow[] = classesRes.ok
      ? await classesRes.json()
      : [];
    const customClasses: VehicleClassification[] =
      customRowsToClassifications(classRows);

    const assets: AssetRow[] = (assetsRes.data ?? []) as AssetRow[];
    const allAccountIds = Object.keys(accountToGroup);

    // Rules + opening date — same inputs the Roll-Forward and monthly
    // Reconciliation tabs use. Subledger is ignored; accumulated for each
    // (asset, month) is computed in-memory so the year view can't drift
    // from the monthly view just because the subledger is stale.
    const rules: DepreciationRule[] = rulesRes.ok ? await rulesRes.json() : [];
    const rulesMap = new Map<string, DepreciationRule>();
    for (const r of rules) rulesMap.set(r.reporting_group, r);

    const openingDateIso: string | null =
      (settings as { rental_asset_opening_date?: string } | null)
        ?.rental_asset_opening_date ?? null;
    const [openY, openM] = openingDateIso
      ? openingDateIso.split("-").map(Number)
      : [0, 0];

    // -- pinned opening balance per asset (is_manual_override row at opening)
    const openingMap: Record<string, { book: number; tax: number }> = {};
    if (openingDateIso && assets.length > 0) {
      const assetIds = assets.map((a) => a.id);
      for (let i = 0; i < assetIds.length; i += 500) {
        const batch = assetIds.slice(i, i + 500);
        const { data: opRows } = await supabase
          .from("fixed_asset_depreciation")
          .select("fixed_asset_id, book_accumulated, tax_accumulated")
          .in("fixed_asset_id", batch)
          .eq("period_year", openY)
          .eq("period_month", openM)
          .eq("is_manual_override", true);
        for (const r of (opRows ?? []) as {
          fixed_asset_id: string;
          book_accumulated: number | string;
          tax_accumulated: number | string;
        }[]) {
          openingMap[r.fixed_asset_id] = {
            book: Number(r.book_accumulated) || 0,
            tax: Number(r.tax_accumulated) || 0,
          };
        }
      }
    }

    // -- build per-asset rule-driven schedule through Dec of the target year
    const deprByAssetMonth: Record<string, Record<number, DeprRow>> = {};
    for (const asset of assets) {
      if (!asset.in_service_date) continue;
      const group = getReportingGroup(asset.vehicle_class, customClasses);
      const rule = group ? rulesMap.get(group) : undefined;
      const ruleSalvagePct = rule?.book_salvage_pct ?? null;
      const ruleSalvage =
        ruleSalvagePct != null && ruleSalvagePct >= 0
          ? Math.round(
              asset.acquisition_cost * (Number(ruleSalvagePct) / 100) * 100
            ) / 100
          : null;
      const ul =
        rule?.book_useful_life_months != null && rule.book_useful_life_months > 0
          ? rule.book_useful_life_months
          : asset.book_useful_life_months;
      // Asset-hardcoded salvage (> 0) supersedes the rule's salvage %.
      const assetSalvage = asset.book_salvage_value;
      const salvage =
        assetSalvage > 0 ? assetSalvage : ruleSalvage ?? assetSalvage;
      const method =
        rule?.book_depreciation_method ?? asset.book_depreciation_method;

      const assetForCalc: AssetForDepreciation = {
        acquisition_cost: asset.acquisition_cost,
        in_service_date: asset.in_service_date,
        book_useful_life_months: ul,
        book_salvage_value: salvage,
        book_depreciation_method: method,
        tax_cost_basis: null,
        tax_depreciation_method: "none",
        tax_useful_life_months: null,
        section_179_amount: 0,
        bonus_depreciation_amount: 0,
        disposed_date: asset.disposed_date,
      };

      const op = openingMap[asset.id];
      const opening = openingDateIso
        ? buildOpeningBalance(openingDateIso, op?.book ?? 0, op?.tax ?? 0)
        : undefined;

      const schedule = generateDepreciationSchedule(
        assetForCalc,
        year,
        12,
        opening
      );

      const byMonth: Record<number, DeprRow> = {};
      for (const e of schedule) {
        if (e.period_year === year) {
          byMonth[e.period_month] = {
            fixed_asset_id: asset.id,
            period_month: e.period_month,
            book_accumulated: e.book_accumulated,
          };
        }
      }
      // Opening period isn't emitted by the schedule — seed it from the
      // pinned opening balance so a year view that includes the opening
      // month shows the correct accumulated.
      if (openingDateIso && year === openY && op) {
        byMonth[openM] = {
          fixed_asset_id: asset.id,
          period_month: openM,
          book_accumulated: op.book,
        };
      }
      deprByAssetMonth[asset.id] = byMonth;
    }

    // -- GL balances for mapped accounts, all 12 months
    const glByAccountMonth: Record<string, Record<number, number>> = {};
    if (allAccountIds.length > 0) {
      const { data } = await supabase
        .from("gl_balances")
        .select("account_id, period_month, ending_balance")
        .eq("entity_id", entityId)
        .eq("period_year", year)
        .in("account_id", allAccountIds);
      for (const r of (data ?? []) as GlBalanceRow[]) {
        if (!glByAccountMonth[r.account_id])
          glByAccountMonth[r.account_id] = {};
        glByAccountMonth[r.account_id][r.period_month] = Number(
          r.ending_balance ?? 0
        );
      }
    }

    // -- reconciliation records for this year keyed by (group, month)
    const reconByGroupMonth: Record<string, Record<number, boolean>> = {};
    for (const r of (reconsRes.data ?? []) as ReconciliationRow[]) {
      if (!reconByGroupMonth[r.gl_account_group])
        reconByGroupMonth[r.gl_account_group] = {};
      reconByGroupMonth[r.gl_account_group][r.period_month] = r.is_reconciled;
    }

    // ---- Compute per-(group, month) cell state
    const result: Record<string, Record<number, CellState>> = {};
    for (const g of groups) result[g.key] = {};

    for (let month = 1; month <= 12; month++) {
      const periodLastDay = (() => {
        const d = new Date(year, month, 0); // last day of this month
        return d.toISOString().split("T")[0];
      })();

      // Assets still held at month-end
      const activeAssets = assets.filter((a) => {
        const isd = a.in_service_date?.slice(0, 10) ?? null;
        if (!isd || isd > periodLastDay) return false;
        const dd = a.disposed_date?.slice(0, 10) ?? null;
        if (a.status === "disposed" && dd && dd <= periodLastDay) return false;
        return true;
      });

      // Subledger totals per recon group
      const subTotals: Record<string, number> = {};
      const anyAssetContributing: Record<string, boolean> = {};
      for (const g of groups) {
        subTotals[g.key] = 0;
        anyAssetContributing[g.key] = false;
      }

      for (const asset of activeAssets) {
        const depr = deprByAssetMonth[asset.id]?.[month];
        const cost = Number(asset.acquisition_cost ?? 0);
        const rawAccum = depr
          ? Number(depr.book_accumulated)
          : Number(asset.book_accumulated_depreciation ?? 0);
        const accumDepr = -rawAccum;

        let costKey: string | null =
          (asset.cost_account_id && accountToGroup[asset.cost_account_id]) ||
          null;
        let accumKey: string | null =
          (asset.accum_depr_account_id &&
            accountToGroup[asset.accum_depr_account_id]) ||
          null;

        if (!costKey || !accumKey) {
          const mt = getEffectiveMasterType(
            asset.vehicle_class,
            asset.master_type_override,
            customClasses
          );
          if (mt) {
            if (!costKey) {
              const cg = RECON_GROUPS.find(
                (g) => g.masterType === mt && g.lineType === "cost"
              );
              if (cg) costKey = cg.key;
            }
            if (!accumKey) {
              if (combineAccumLocal) {
                accumKey = FLEET_ACCUM_DEPR_GROUP.key;
              } else {
                const ag = RECON_GROUPS.find(
                  (g) => g.masterType === mt && g.lineType === "accum_depr"
                );
                if (ag) accumKey = ag.key;
              }
            }
          }
        }

        if (costKey && subTotals[costKey] !== undefined) {
          subTotals[costKey] += cost;
          anyAssetContributing[costKey] = true;
        }
        if (accumKey && subTotals[accumKey] !== undefined) {
          subTotals[accumKey] += accumDepr;
          anyAssetContributing[accumKey] = true;
        }
      }

      // Gain on sale (P&L) — YTD through this month for assets disposed in
      // the same calendar year. Sign is negated so gains (credit balance)
      // appear negative, matching `gl_balances.ending_balance`.
      const periodYearStart = `${year}-01-01`;
      for (const asset of assets) {
        if (asset.status !== "disposed") continue;
        const dd = asset.disposed_date?.slice(0, 10) ?? null;
        if (!dd || dd < periodYearStart || dd > periodLastDay) continue;
        const mt = getEffectiveMasterType(
          asset.vehicle_class,
          asset.master_type_override,
          customClasses
        );
        if (!mt) continue;
        const g = RECON_GROUPS.find(
          (rg) => rg.masterType === mt && rg.lineType === "gain_on_sale"
        );
        if (!g) continue;
        if (subTotals[g.key] === undefined) continue;
        const signed = -Number(asset.disposed_book_gain_loss ?? 0);
        subTotals[g.key] += signed;
        if (signed !== 0) anyAssetContributing[g.key] = true;
      }

      // GL totals per recon group
      const glTotals: Record<string, number> = {};
      const anyGlBalance: Record<string, boolean> = {};
      for (const g of groups) {
        let total = 0;
        let hasAny = false;
        for (const acctId of mappingsByGroup[g.key] ?? []) {
          const bal = glByAccountMonth[acctId]?.[month];
          if (bal !== undefined) {
            hasAny = true;
            total += bal;
          }
        }
        glTotals[g.key] = total;
        anyGlBalance[g.key] = hasAny;
      }

      // Derive status per group
      for (const g of groups) {
        const glBal = glTotals[g.key];
        const subBal = subTotals[g.key];
        const variance = glBal - subBal;
        const hasMapping = mapped[g.key];
        const hasActivity =
          anyGlBalance[g.key] || anyAssetContributing[g.key];
        const isReconciled = reconByGroupMonth[g.key]?.[month] === true;

        let status: CellStatus;
        if (!hasMapping) {
          status = "no_accounts";
        } else if (isReconciled) {
          status = "reconciled";
        } else if (!hasActivity) {
          status = "no_data";
        } else if (Math.abs(variance) > VARIANCE_TOLERANCE) {
          status = "variance";
        } else {
          status = "ready";
        }

        result[g.key][month] = {
          status,
          variance,
          glBalance: glBal,
          subledgerBalance: subBal,
          hasActivity,
        };
      }
    }

    setCells(result);
    setLoading(false);
  }, [supabase, entityId, year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  function getGroupSummary(groupKey: string): {
    reconciled: number;
    ready: number;
    variance: number;
  } {
    let reconciled = 0;
    let ready = 0;
    let variance = 0;
    for (let m = 1; m <= 12; m++) {
      const s = cells[groupKey]?.[m]?.status;
      if (s === "reconciled") reconciled++;
      else if (s === "ready") ready++;
      else if (s === "variance") variance++;
    }
    return { reconciled, ready, variance };
  }

  return (
    <div className="space-y-4">
      {/* Year Selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Year:</span>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onYearChange(year - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Select
          value={String(year)}
          onValueChange={(v) => onYearChange(Number(v))}
        >
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onYearChange(year + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          Reconciled
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle className="h-3.5 w-3.5 text-blue-600" />
          Ready to reconcile
        </span>
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
          Variance
        </span>
        <span className="flex items-center gap-1.5">
          <Minus className="h-3.5 w-3.5 text-muted-foreground/50" />
          No data / not mapped
        </span>
        <span className="ml-auto italic">Click any cell to open that month</span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          Computing year reconciliation...
        </p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background z-10 min-w-[240px]">
                  Reconciliation Group
                </TableHead>
                {MONTH_LABELS.map((m, i) => {
                  const isFuture =
                    year > now.getFullYear() ||
                    (year === now.getFullYear() && i + 1 > now.getMonth() + 1);
                  return (
                    <TableHead
                      key={m}
                      className={`text-center px-1 ${isFuture ? "text-muted-foreground/60" : ""}`}
                    >
                      {m}
                    </TableHead>
                  );
                })}
                <TableHead className="text-center min-w-[140px]">
                  Summary
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {effectiveGroups.map((group) => {
                const summary = getGroupSummary(group.key);
                const noMappings = !hasMappings[group.key];
                return (
                  <TableRow key={group.key}>
                    <TableCell className="sticky left-0 bg-background z-10 font-medium">
                      {group.displayName}
                    </TableCell>
                    {MONTH_LABELS.map((_, i) => {
                      const month = i + 1;
                      const cell = cells[group.key]?.[month];
                      const status: CellStatus = cell?.status ?? "no_data";
                      const isFuture =
                        year > now.getFullYear() ||
                        (year === now.getFullYear() &&
                          month > now.getMonth() + 1);
                      const title = cell
                        ? `${group.displayName} — ${MONTH_LABELS[i]} ${year}\n` +
                          `Status: ${statusLabel(status)}\n` +
                          `GL: ${formatCurrency(cell.glBalance)}\n` +
                          `Subledger: ${formatCurrency(cell.subledgerBalance)}\n` +
                          `Variance: ${formatCurrency(cell.variance)}`
                        : `${group.displayName} — ${MONTH_LABELS[i]} ${year}`;
                      return (
                        <TableCell
                          key={month}
                          className="p-0 text-center"
                        >
                          <button
                            type="button"
                            onClick={() => onJumpToMonth(year, month)}
                            title={title}
                            className={`w-full h-10 flex items-center justify-center hover:bg-muted transition-colors ${
                              isFuture ? "opacity-50" : ""
                            }`}
                          >
                            <StatusIcon status={status} />
                          </button>
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center">
                      {noMappings ? (
                        <Badge variant="outline" className="text-xs">
                          No Accounts
                        </Badge>
                      ) : (
                        <span className="text-xs tabular-nums whitespace-nowrap">
                          <span className="text-green-600 font-medium">
                            {summary.reconciled}
                          </span>
                          <span className="text-muted-foreground">/</span>
                          <span className="text-blue-600 font-medium">
                            {summary.ready}
                          </span>
                          {summary.variance > 0 && (
                            <span className="text-red-600 font-medium">
                              /{summary.variance}
                            </span>
                          )}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && <YearTotals cells={cells} />}
    </div>
  );
}

function StatusIcon({ status }: { status: CellStatus }) {
  if (status === "reconciled") {
    return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  }
  if (status === "ready") {
    return <CheckCircle className="h-5 w-5 text-blue-600" />;
  }
  if (status === "variance") {
    return <AlertTriangle className="h-5 w-5 text-red-600" />;
  }
  return <Minus className="h-4 w-4 text-muted-foreground/40" />;
}

function statusLabel(status: CellStatus): string {
  switch (status) {
    case "reconciled":
      return "Reconciled";
    case "ready":
      return "Ready to reconcile (GL matches subledger)";
    case "variance":
      return "Variance (GL differs from subledger)";
    case "no_accounts":
      return "No GL accounts linked";
    case "no_data":
      return "No activity this month";
  }
}

function YearTotals({
  cells,
}: {
  cells: Record<string, Record<number, CellState>>;
}) {
  let reconciledCount = 0;
  let readyCount = 0;
  let varianceCount = 0;
  let totalOpenVariance = 0;

  for (const groupKey of Object.keys(cells)) {
    for (let m = 1; m <= 12; m++) {
      const c = cells[groupKey]?.[m];
      if (!c) continue;
      if (c.status === "reconciled") reconciledCount++;
      else if (c.status === "ready") readyCount++;
      else if (c.status === "variance") {
        varianceCount++;
        totalOpenVariance += Math.abs(c.variance);
      }
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="grid grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Reconciled
          </p>
          <p className="text-lg font-semibold tabular-nums text-green-600">
            {reconciledCount}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Ready
          </p>
          <p className="text-lg font-semibold tabular-nums text-blue-600">
            {readyCount}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Variances
          </p>
          <p
            className={`text-lg font-semibold tabular-nums ${
              varianceCount > 0 ? "text-red-600" : "text-muted-foreground"
            }`}
          >
            {varianceCount}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Total Open Variance
          </p>
          <p
            className={`text-lg font-semibold tabular-nums ${
              totalOpenVariance > 1 ? "text-red-600" : "text-muted-foreground"
            }`}
          >
            {formatCurrency(totalOpenVariance)}
          </p>
        </div>
      </div>
    </div>
  );
}

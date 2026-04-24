"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Plus,
  X,
  Download,
} from "lucide-react";
import { formatCurrency, getPeriodShortLabel } from "@/lib/utils/dates";
import {
  RECON_GROUPS,
  FLEET_ACCUM_DEPR_GROUP,
  UNALLOCATED_KEY,
  getEffectiveReconGroups,
  isFleetReconGroup,
  type ReconGroup,
} from "@/lib/utils/asset-gl-groups";
import { ReconciliationYearView } from "./reconciliation-year-view";
import {
  getEffectiveMasterType,
  getVehicleClassification,
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
import {
  addSheet,
  createWorkbook,
  downloadWorkbook,
  formatLongDate,
  NUMBER_FORMATS,
  parseIsoDate,
} from "@/lib/utils/excel";
import { toast } from "sonner";

interface ReconciliationTabProps {
  entityId: string;
}

interface EntityAccount {
  id: string;
  account_number: string | null;
  name: string;
  classification: string;
  account_type: string;
}

interface AssetRow {
  id: string;
  asset_name: string;
  asset_tag: string | null;
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
  book_depreciation: number;
  book_accumulated: number;
  book_net_value: number;
}

interface SubledgerGroup {
  total: number;
  assets: Array<AssetRow & { periodValue: number }>;
}

interface ReconciliationRecord {
  id: string;
  gl_account_group: string;
  gl_balance: number | null;
  subledger_balance: number | null;
  variance: number | null;
  is_reconciled: boolean;
  reconciled_at: string | null;
  notes: string | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function ReconciliationTab({ entityId }: ReconciliationTabProps) {
  const supabase = createClient();
  const now = new Date();
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [viewMode, setViewMode] = useState<"month" | "year">("month");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});

  const [customClasses, setCustomClasses] = useState<VehicleClassification[]>([]);
  const [entityAccounts, setEntityAccounts] = useState<EntityAccount[]>([]);
  const [mappedAccounts, setMappedAccounts] = useState<
    Record<string, { id: string; account_id: string }[]>
  >({});
  const [glBalances, setGlBalances] = useState<Record<string, number>>({});
  const [subledgerBalances, setSubledgerBalances] = useState<
    Record<string, SubledgerGroup>
  >({});
  const [reconciliations, setReconciliations] = useState<
    Record<string, ReconciliationRecord>
  >({});

  // All assets + depr data for export
  const [allAssets, setAllAssets] = useState<AssetRow[]>([]);
  const [deprMapState, setDeprMapState] = useState<Record<string, DeprRow>>({});

  // Entity-level reconciliation setting. When true, Vehicle + Trailer accumulated
  // depreciation collapse into a single Fleet group — used when QuickBooks has
  // one shared accum depr account so the split-by-master-type subledger can't
  // reconcile to GL. Toggled in the Rental Asset Register Settings dialog.
  const [combineFleetAccumDepr, setCombineFleetAccumDepr] = useState(false);
  const effectiveReconGroups = getEffectiveReconGroups({
    combine_fleet_accum_depr: combineFleetAccumDepr,
  });

  // Account picker state
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [accountSearch, setAccountSearch] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);

    // 0. Load custom classes + entity settings (opening date + combine toggle).
    // Parsed once here and reused downstream — fetch response bodies can only
    // be read once, so we stash the parsed object in `settings`.
    const [ccRes, settingsRes] = await Promise.all([
      fetch(`/api/assets/classes?entityId=${entityId}`),
      fetch(`/api/assets/settings?entityId=${entityId}`),
    ]);
    let cc: VehicleClassification[] = [];
    if (ccRes.ok) {
      const rows: CustomVehicleClassRow[] = await ccRes.json();
      cc = customRowsToClassifications(rows);
      setCustomClasses(cc);
    }
    const settings = settingsRes.ok ? await settingsRes.json() : null;
    const combineAccum = Boolean(
      (settings as { combine_fleet_accum_depr?: boolean } | null)
        ?.combine_fleet_accum_depr
    );
    setCombineFleetAccumDepr(combineAccum);
    const effectiveGroups = getEffectiveReconGroups({
      combine_fleet_accum_depr: combineAccum,
    });

    // 1. Fetch all entity accounts (for the picker)
    const { data: acctData } = await supabase
      .from("accounts")
      .select("id, account_number, name, classification, account_type")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number");

    setEntityAccounts((acctData ?? []) as EntityAccount[]);

    // 2. Fetch configured account mappings for this entity (via API to bypass RLS)
    const linkRes = await fetch(`/api/assets/recon-links?entityId=${entityId}`);
    const mappingData = linkRes.ok ? await linkRes.json() : [];

    const mapped: Record<string, { id: string; account_id: string }[]> = {};
    for (const group of effectiveGroups) {
      mapped[group.key] = [];
    }
    for (const m of (mappingData ?? []) as {
      id: string;
      recon_group: string;
      account_id: string;
    }[]) {
      if (!mapped[m.recon_group]) mapped[m.recon_group] = [];
      mapped[m.recon_group].push({ id: m.id, account_id: m.account_id });
    }
    setMappedAccounts(mapped);

    // 3. Fetch GL balances for all mapped accounts
    const allAccountIds = Object.values(mapped)
      .flat()
      .map((m) => m.account_id);
    const balances: Record<string, number> = {};

    if (allAccountIds.length > 0) {
      const { data: glData } = await supabase
        .from("gl_balances")
        .select("account_id, ending_balance")
        .eq("entity_id", entityId)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth)
        .in("account_id", allAccountIds);

      const glMap: Record<string, number> = {};
      for (const row of (glData ?? []) as {
        account_id: string;
        ending_balance: number;
      }[]) {
        glMap[row.account_id] = Number(row.ending_balance ?? 0);
      }

      for (const group of effectiveGroups) {
        const groupAcctIds =
          mapped[group.key]?.map((m) => m.account_id) ?? [];
        balances[group.key] = groupAcctIds.reduce(
          (sum, id) => sum + (glMap[id] ?? 0),
          0
        );
      }
    }
    setGlBalances(balances);

    // 4. Fetch all assets with accum depr and GL overrides
    const { data: assetsData } = await supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, asset_tag, vehicle_class, in_service_date, acquisition_cost, book_useful_life_months, book_salvage_value, book_depreciation_method, book_accumulated_depreciation, book_net_value, status, disposed_date, disposed_book_gain_loss, cost_account_id, accum_depr_account_id, master_type_override"
      )
      .eq("entity_id", entityId);

    const allAssetsRaw = (assetsData ?? []) as AssetRow[];

    // Reconciliation is an as-of view: only include assets that existed and
    // were still held at the end of the selected period. Filter out assets
    // acquired after the period (future purchases) and assets disposed on or
    // before the period's last day (already sold by the reporting date).
    const periodLastDay = (() => {
      const d = new Date(periodYear, periodMonth, 0); // day 0 = last day of prior
      return d.toISOString().split("T")[0];
    })();
    const assets = allAssetsRaw.filter((a) => {
      const isd = a.in_service_date?.slice(0, 10) ?? null;
      if (!isd || isd > periodLastDay) return false;
      const dd = a.disposed_date?.slice(0, 10) ?? null;
      if (a.status === "disposed" && dd && dd <= periodLastDay) return false;
      return true;
    });

    // Assets disposed year-to-date through the selected period. P&L gain-on-sale
    // accounts accumulate from Jan 1 through the period end (and reset at year
    // close), so the subledger sums every disposal in the same calendar year up
    // to the selected period end.
    const periodYearStart = `${periodYear}-01-01`;
    const disposedYtd = allAssetsRaw.filter((a) => {
      if (a.status !== "disposed") return false;
      const dd = a.disposed_date?.slice(0, 10) ?? null;
      if (!dd) return false;
      return dd >= periodYearStart && dd <= periodLastDay;
    });

    // 5. Build per-asset rule-driven depreciation schedule through the period.
    //    Reads the entity's opening-balance cutoff and each asset's pinned
    //    opening row, then generates in-memory via generateDepreciationSchedule
    //    — same path the Roll-Forward and Depreciation Schedule tabs use, so
    //    reconciliation stays in lockstep regardless of when the subledger
    //    was last regenerated.
    const assetIds = assets.map((a) => a.id);
    const deprMap: Record<string, DeprRow> = {};

    const rulesRes = await fetch(
      `/api/assets/depreciation-rules?entityId=${entityId}`
    );
    const rules: DepreciationRule[] = rulesRes.ok ? await rulesRes.json() : [];
    const rulesMap = new Map<string, DepreciationRule>();
    for (const r of rules) rulesMap.set(r.reporting_group, r);

    const openingDateIso: string | null =
      (settings as { rental_asset_opening_date?: string } | null)
        ?.rental_asset_opening_date ?? null;

    const openingMap: Record<string, { book: number; tax: number }> = {};
    if (openingDateIso && assetIds.length > 0) {
      const [oy, om] = openingDateIso.split("-").map(Number);
      for (let i = 0; i < assetIds.length; i += 500) {
        const batch = assetIds.slice(i, i + 500);
        const { data: opRows } = await supabase
          .from("fixed_asset_depreciation")
          .select("fixed_asset_id, book_accumulated, tax_accumulated")
          .in("fixed_asset_id", batch)
          .eq("period_year", oy)
          .eq("period_month", om)
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

    // Schedule doesn't emit the opening period itself — emitting starts the
    // month after. If the user picks the opening period, seed deprMap from
    // the pinned opening balance directly.
    const atOpeningPeriod =
      openingDateIso != null &&
      (() => {
        const [oy, om] = openingDateIso.split("-").map(Number);
        return periodYear === oy && periodMonth === om;
      })();
    if (atOpeningPeriod) {
      for (const asset of assets) {
        const op = openingMap[asset.id];
        if (!op) continue;
        deprMap[asset.id] = {
          fixed_asset_id: asset.id,
          book_depreciation: 0,
          book_accumulated: op.book,
          book_net_value: asset.acquisition_cost - op.book,
        };
      }
    }

    for (const asset of assets) {
      if (!asset.in_service_date) continue;
      if (atOpeningPeriod) break;
      const group = getReportingGroup(asset.vehicle_class, cc);
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
        periodYear,
        periodMonth,
        opening
      );
      const periodEntry = schedule.find(
        (e) => e.period_year === periodYear && e.period_month === periodMonth
      );
      if (periodEntry) {
        deprMap[asset.id] = {
          fixed_asset_id: asset.id,
          book_depreciation: periodEntry.book_depreciation,
          book_accumulated: periodEntry.book_accumulated,
          book_net_value: periodEntry.book_net_value,
        };
      }
    }

    // Store for export
    setAllAssets(assets);
    setDeprMapState(deprMap);

    // 6. Group assets by recon group and compute totals
    //    If an asset has cost_account_id or accum_depr_account_id set,
    //    place it in whichever recon group has that account linked (GL override).
    //    Otherwise fall back to vehicle_class → master type mapping.
    const grouped: Record<string, SubledgerGroup> = {};
    for (const group of effectiveGroups) {
      grouped[group.key] = { total: 0, assets: [] };
    }
    grouped[UNALLOCATED_KEY] = { total: 0, assets: [] };

    // Build reverse lookup: account_id → recon group key
    const accountToReconGroup: Record<string, string> = {};
    for (const [groupKey, mappings] of Object.entries(mapped)) {
      for (const m of mappings) {
        accountToReconGroup[m.account_id] = groupKey;
      }
    }

    for (const asset of assets) {
      const depr = deprMap[asset.id];
      const cost = asset.acquisition_cost;
      // Accumulated depreciation is a contra-asset. The DB stores normal
      // depreciation as positive and adjustments can be negative. Simply
      // negate to convert to balance-sheet sign:
      //   DB +10000 (normal depr)  → subledger -10000
      //   DB -24.12 (reduce depr)  → subledger +24.12
      const rawAccum = depr
        ? Number(depr.book_accumulated)
        : asset.book_accumulated_depreciation;
      const accumDepr = -rawAccum;

      // Check for GL account override on the asset
      const costOverrideGroup = asset.cost_account_id
        ? accountToReconGroup[asset.cost_account_id]
        : null;
      const accumOverrideGroup = asset.accum_depr_account_id
        ? accountToReconGroup[asset.accum_depr_account_id]
        : null;

      // Determine cost group: override → vehicle class master type fallback
      let costKey: string | null = costOverrideGroup ?? null;
      let accumKey: string | null = accumOverrideGroup ?? null;

      if (!costKey || !accumKey) {
        // Fall back to vehicle class → master type → matching RECON_GROUP.
        // When the entity combines accum depr, any Vehicle/Trailer asset
        // routes to the shared fleet accum group regardless of master type.
        const mt = getEffectiveMasterType(
          asset.vehicle_class,
          asset.master_type_override,
          cc
        );
        if (mt) {
          if (!costKey) {
            const cg = RECON_GROUPS.find(
              (g) => g.masterType === mt && g.lineType === "cost"
            );
            if (cg) costKey = cg.key;
          }
          if (!accumKey) {
            if (combineAccum) {
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

      // If neither override nor class mapping, put in unallocated
      if (!costKey && !accumKey) {
        const nbv = depr ? Number(depr.book_net_value) : asset.book_net_value;
        grouped[UNALLOCATED_KEY].total += nbv;
        grouped[UNALLOCATED_KEY].assets.push({ ...asset, periodValue: nbv });
        continue;
      }

      if (costKey && grouped[costKey]) {
        grouped[costKey].total += cost;
        grouped[costKey].assets.push({ ...asset, periodValue: cost });
      }
      if (accumKey && grouped[accumKey]) {
        grouped[accumKey].total += accumDepr;
        grouped[accumKey].assets.push({ ...asset, periodValue: accumDepr });
      }
    }

    // Gain on sale (P&L). For each YTD-disposed asset, route to the
    // gain_on_sale recon group matching its master type. Sign is negated so
    // a gain (income → credit balance) appears negative in the subledger,
    // matching how `gl_balances.ending_balance` represents credit balances.
    for (const asset of disposedYtd) {
      const rawGainLoss = Number(asset.disposed_book_gain_loss ?? 0);
      const signed = -rawGainLoss;
      const mt = getEffectiveMasterType(
        asset.vehicle_class,
        asset.master_type_override,
        cc
      );
      let key: string | null = null;
      if (mt) {
        const g = RECON_GROUPS.find(
          (rg) => rg.masterType === mt && rg.lineType === "gain_on_sale"
        );
        if (g) key = g.key;
      }
      if (!key) {
        // No master type — bucket under unallocated so users can see it
        grouped[UNALLOCATED_KEY].total += signed;
        grouped[UNALLOCATED_KEY].assets.push({ ...asset, periodValue: signed });
        continue;
      }
      if (grouped[key]) {
        grouped[key].total += signed;
        grouped[key].assets.push({ ...asset, periodValue: signed });
      }
    }
    setSubledgerBalances(grouped);

    // 7. Fetch existing reconciliation records
    const { data: reconData } = await supabase
      .from("asset_reconciliations")
      .select("*")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    const reconMap: Record<string, ReconciliationRecord> = {};
    const notesMap: Record<string, string> = {};
    for (const r of (reconData ?? []) as ReconciliationRecord[]) {
      reconMap[r.gl_account_group] = r;
      notesMap[r.gl_account_group] = r.notes ?? "";
    }
    setReconciliations(reconMap);
    setNotes(notesMap);

    setLoading(false);
  }, [supabase, entityId, periodYear, periodMonth]);

  useEffect(() => {
    if (viewMode === "month") {
      loadData();
    }
  }, [loadData, viewMode]);

  // -- Account linking (same pattern as debt reconciliation) --

  const handleAddAccounts = async (groupKey: string) => {
    if (selectedAccountIds.size === 0) return;
    setSaving(groupKey);

    let linked = 0;
    for (const accountId of selectedAccountIds) {
      const res = await fetch("/api/assets/recon-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          recon_group: groupKey,
          account_id: accountId,
        }),
      });
      if (res.ok) linked++;
    }

    if (linked > 0) {
      toast.success(`${linked} account${linked !== 1 ? "s" : ""} linked`);
      setAddingToGroup(null);
      setSelectedAccountIds(new Set());
      setAccountSearch("");
      loadData();
    } else {
      toast.error("Failed to link accounts");
    }
    setSaving(null);
  };

  const handleRemoveAccount = async (
    mappingId: string,
    groupKey: string
  ) => {
    setSaving(groupKey);
    await fetch(`/api/assets/recon-links?id=${mappingId}`, { method: "DELETE" });
    loadData();
    setSaving(null);
  };

  const handleReconcile = async (groupKey: string) => {
    setSaving(groupKey);
    const glBal = glBalances[groupKey] ?? 0;
    const subBal = subledgerBalances[groupKey]?.total ?? 0;
    const variance = glBal - subBal;

    const { data: userData } = await supabase.auth.getUser();

    const { error } = await supabase.from("asset_reconciliations").upsert(
      {
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        gl_account_group: groupKey,
        gl_balance: glBal,
        subledger_balance: subBal,
        variance,
        is_reconciled: true,
        reconciled_by: userData?.user?.id ?? null,
        reconciled_at: new Date().toISOString(),
        notes: notes[groupKey] || null,
      },
      { onConflict: "entity_id,period_year,period_month,gl_account_group" }
    );

    setSaving(null);
    if (error) {
      toast.error(`Failed to mark reconciled: ${error.message}`);
      return;
    }
    toast.success("Marked reconciled");
    loadData();
  };

  // "Reconcile All" — mark every group that has mapped accounts and a
  // within-tolerance variance as reconciled, in one click. Already-reconciled
  // groups are left alone; groups with no accounts are skipped. Uses the
  // entity's effective recon groups so the Fleet Accumulated Depreciation
  // group is included when the entity has combined accum depr (otherwise the
  // static RECON_GROUPS would skip it and leave that row stranded).
  const reconcileAllStatus = (() => {
    let anyVariance = false;
    let anyReconcilable = false;
    for (const g of effectiveReconGroups) {
      const glBal = glBalances[g.key] ?? 0;
      const subBal = subledgerBalances[g.key]?.total ?? 0;
      const variance = glBal - subBal;
      const hasMappings = (mappedAccounts[g.key]?.length ?? 0) > 0;
      const isReconciled = reconciliations[g.key]?.is_reconciled ?? false;
      if (hasMappings && Math.abs(variance) > 1.0) anyVariance = true;
      if (hasMappings && Math.abs(variance) <= 1.0 && !isReconciled) {
        anyReconcilable = true;
      }
    }
    return { anyVariance, anyReconcilable };
  })();

  const handleReconcileAll = async () => {
    setSaving("__all__");
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id ?? null;
    const nowIso = new Date().toISOString();

    const rows = [];
    for (const g of effectiveReconGroups) {
      const glBal = glBalances[g.key] ?? 0;
      const subBal = subledgerBalances[g.key]?.total ?? 0;
      const variance = glBal - subBal;
      const hasMappings = (mappedAccounts[g.key]?.length ?? 0) > 0;
      const isReconciled = reconciliations[g.key]?.is_reconciled ?? false;
      if (!hasMappings) continue;
      if (Math.abs(variance) > 1.0) continue;
      if (isReconciled) continue;
      rows.push({
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        gl_account_group: g.key,
        gl_balance: glBal,
        subledger_balance: subBal,
        variance,
        is_reconciled: true,
        reconciled_by: userId,
        reconciled_at: nowIso,
        notes: notes[g.key] || null,
      });
    }

    if (rows.length === 0) {
      setSaving(null);
      toast.info("Nothing to reconcile");
      return;
    }

    const { error } = await supabase
      .from("asset_reconciliations")
      .upsert(rows, {
        onConflict: "entity_id,period_year,period_month,gl_account_group",
      });

    setSaving(null);
    if (error) {
      toast.error(`Failed to reconcile all: ${error.message}`);
      return;
    }
    toast.success(`Reconciled ${rows.length} group${rows.length === 1 ? "" : "s"}`);
    loadData();
  };

  const handleUnreconcile = async (groupKey: string) => {
    setSaving(groupKey);
    const recon = reconciliations[groupKey];
    if (recon) {
      const { error } = await supabase
        .from("asset_reconciliations")
        .update({
          is_reconciled: false,
          reconciled_at: null,
          reconciled_by: null,
        })
        .eq("id", recon.id);
      setSaving(null);
      if (error) {
        toast.error(`Failed to unreconcile: ${error.message}`);
        return;
      }
      toast.success("Unreconciled");
    } else {
      setSaving(null);
    }
    loadData();
  };

  async function handleExportExcel() {
    const periodLabel = getPeriodShortLabel(periodYear, periodMonth);
    const isFullYear = periodMonth === 12;
    const titlePeriodLabel = isFullYear
      ? `January 1, ${periodYear} through December 31, ${periodYear}`
      : `Period: ${periodLabel}`;
    const subtitleLabel = isFullYear
      ? `Year Ended December 31, ${periodYear}`
      : `Reconciliation — ${periodLabel}`;
    try {
      const { data: entityRow } = await supabase
        .from("entities")
        .select("name")
        .eq("id", entityId)
        .single();
      const entityName = (entityRow as { name?: string } | null)?.name ?? "";

      const wb = createWorkbook({
        company: entityName,
        title: `Fixed Asset Reconciliation — ${periodLabel}`,
      });

      // Sheet 1 — GL vs Subledger reconciliation summary per recon group.
      interface ReconRow {
        group: string;
        glBalance: number;
        subledgerBalance: number;
        variance: number;
        status: string;
        notes: string;
      }
      const reconRows: ReconRow[] = effectiveReconGroups.map((g) => {
        const glBal = glBalances[g.key] ?? 0;
        const subBal = subledgerBalances[g.key]?.total ?? 0;
        const variance = glBal - subBal;
        const recon = reconciliations[g.key];
        const mappings = mappedAccounts[g.key] ?? [];
        const status = recon?.is_reconciled
          ? "Reconciled"
          : mappings.length === 0
            ? "No Accounts Linked"
            : Math.abs(variance) > 1
              ? "Variance"
              : "Pending";
        return {
          group: g.displayName,
          glBalance: glBal,
          subledgerBalance: subBal,
          variance,
          status,
          notes: notes[g.key] ?? "",
        };
      });

      addSheet<ReconRow>(wb, {
        name: "Reconciliation Summary",
        columns: [
          { header: "Recon Group", width: 42, value: (r) => r.group },
          {
            header: "GL Balance",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.glBalance,
          },
          {
            header: "Subledger Balance",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.subledgerBalance,
          },
          {
            header: "Variance (GL − Sub)",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.variance,
          },
          { header: "Status", width: 18, value: (r) => r.status },
          { header: "Notes", width: 48, value: (r) => r.notes },
        ],
        rows: reconRows,
        title: {
          entityName,
          reportTitle: "Fixed Asset Reconciliation",
          subtitle: "GL vs Subledger by Recon Group",
          period: titlePeriodLabel,
          asOf: `Generated ${formatLongDate(new Date().toISOString().slice(0, 10))}`,
        },
        grandTotal: true,
        footnote:
          "Variance > $1 is flagged. Status reflects the user-confirmed reconciliation state for the period.",
      });

      // Sheet 2 — subledger detail, one row per asset with period depreciation.
      interface DetailRow {
        group: string;
        tag: string;
        name: string;
        classCode: string;
        className: string;
        reportingGroup: string;
        masterType: string;
        status: string;
        inService: Date | string;
        method: string;
        ul: number;
        cost: number;
        salvage: number;
        monthlyDepr: number;
        accumDepr: number;
        nbv: number;
      }
      const detailRows: DetailRow[] = allAssets.map((asset) => {
        const depr = deprMapState[asset.id];
        const classification = getVehicleClassification(
          asset.vehicle_class,
          customClasses
        );
        const mt = getEffectiveMasterType(
          asset.vehicle_class,
          asset.master_type_override,
          customClasses
        );
        let groupLabel = "Unallocated";
        if (mt) {
          const costGroup = RECON_GROUPS.find(
            (g) => g.masterType === mt && g.lineType === "cost"
          );
          groupLabel = costGroup
            ? costGroup.displayName.replace(" — Cost", "")
            : mt;
        }
        return {
          group: groupLabel,
          tag: asset.asset_tag ?? "",
          name: asset.asset_name,
          classCode: classification?.class ?? "",
          className: classification?.className ?? "",
          reportingGroup: classification?.reportingGroup ?? "",
          masterType: mt ?? "",
          status: asset.status,
          inService: parseIsoDate(asset.in_service_date) ?? "",
          method: asset.book_depreciation_method.replace(/_/g, " "),
          ul: asset.book_useful_life_months || 0,
          cost: Number(asset.acquisition_cost) || 0,
          salvage: Number(asset.book_salvage_value) || 0,
          monthlyDepr: depr ? Number(depr.book_depreciation) : 0,
          accumDepr: depr
            ? Number(depr.book_accumulated)
            : Number(asset.book_accumulated_depreciation),
          nbv: depr
            ? Number(depr.book_net_value)
            : Number(asset.book_net_value),
        };
      });

      addSheet<DetailRow>(wb, {
        name: "Subledger Detail",
        columns: [
          { header: "Asset Tag", width: 14, value: (r) => r.tag },
          { header: "Asset Name", width: 28, value: (r) => r.name },
          {
            header: "Class",
            width: 8,
            align: "center",
            value: (r) => r.classCode,
          },
          { header: "Class Description", width: 26, value: (r) => r.className },
          { header: "Reporting Group", width: 18, value: (r) => r.reportingGroup },
          { header: "Status", width: 12, value: (r) => r.status },
          {
            header: "In-Service Date",
            width: 14,
            format: NUMBER_FORMATS.date,
            value: (r) => r.inService,
          },
          { header: "Method", width: 16, value: (r) => r.method },
          {
            header: "UL (mo)",
            width: 10,
            format: NUMBER_FORMATS.integer,
            align: "right",
            value: (r) => r.ul,
          },
          {
            header: "Acquisition Cost",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.cost,
          },
          {
            header: "Salvage",
            width: 14,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.salvage,
          },
          {
            header: `Monthly Depr (${periodLabel})`,
            width: 20,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.monthlyDepr,
          },
          {
            header: `Accum. Depreciation (${periodLabel})`,
            width: 22,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.accumDepr,
          },
          {
            header: `Net Book Value (${periodLabel})`,
            width: 20,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.nbv,
          },
        ],
        rows: detailRows,
        title: {
          entityName,
          reportTitle: "Fixed Asset Subledger Detail",
          subtitle: subtitleLabel,
          asOf: `Generated ${formatLongDate(new Date().toISOString().slice(0, 10))}`,
        },
        groupBy: (r) => r.group,
        sort: (a, b) =>
          a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
        grandTotal: true,
      });

      await downloadWorkbook(
        wb,
        `asset-reconciliation-${periodYear}-${String(periodMonth).padStart(2, "0")}-${entityId.slice(0, 8)}`
      );
      toast.success("Excel export downloaded");
    } catch (err) {
      console.error(err);
      toast.error("Failed to export Excel");
    }
  }

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const accountsById = Object.fromEntries(
    entityAccounts.map((a) => [a.id, a])
  );
  const allMappedAccountIds = new Set(
    Object.values(mappedAccounts).flat().map((m) => m.account_id)
  );

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  // Split effective groups into rendering sections. Fleet groups (combined
  // Vehicles + Trailers) get their own section; per-master-type groups render
  // inside their respective Vehicles / Trailers sections.
  const vehicleGroups = effectiveReconGroups.filter(
    (g) =>
      g.masterType === "Vehicle" &&
      !isFleetReconGroup(g) &&
      g.lineType !== "gain_on_sale"
  );
  const trailerGroups = effectiveReconGroups.filter(
    (g) =>
      g.masterType === "Trailer" &&
      !isFleetReconGroup(g) &&
      g.lineType !== "gain_on_sale"
  );
  const fleetGroups = effectiveReconGroups.filter(isFleetReconGroup);
  const gainOnSaleGroups = effectiveReconGroups.filter(
    (g) => g.lineType === "gain_on_sale"
  );

  function renderReconCard(group: ReconGroup) {
    const glBal = glBalances[group.key] ?? 0;
    const subBal = subledgerBalances[group.key]?.total ?? 0;
    const variance = glBal - subBal;
    const recon = reconciliations[group.key];
    const isReconciled = recon?.is_reconciled ?? false;
    const assetList = subledgerBalances[group.key]?.assets ?? [];
    const isExpanded = expandedGroups.has(group.key);
    const groupMappings = mappedAccounts[group.key] ?? [];
    const isAdding = addingToGroup === group.key;

    return (
      <Card key={group.key}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{group.displayName}</CardTitle>
            {isReconciled ? (
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Reconciled
              </Badge>
            ) : Math.abs(variance) > 1.00 && groupMappings.length > 0 ? (
              <Badge variant="destructive">
                <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                Variance
              </Badge>
            ) : (
              <Badge variant="outline">
                {groupMappings.length === 0 ? "No Accounts" : "Pending"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mapped GL Accounts */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              GL Accounts
            </p>
            {groupMappings.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No GL accounts linked yet
              </p>
            ) : (() => {
              const acctExpanded = expandedGroups.has(`accts_${group.key}`);
              const visible = acctExpanded ? groupMappings : groupMappings.slice(0, 1);
              const hiddenCount = groupMappings.length - 1;
              return (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-2">
                    {visible.map((mapping) => {
                      const acct = accountsById[mapping.account_id];
                      return (
                        <Badge
                          key={mapping.id}
                          variant="secondary"
                          className="text-xs font-mono gap-1"
                        >
                          {acct
                            ? `${acct.account_number ?? ""} ${acct.name}`.trim()
                            : mapping.account_id.slice(0, 8)}
                          <button
                            onClick={() =>
                              handleRemoveAccount(mapping.id, group.key)
                            }
                            className="ml-1 hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                  {hiddenCount > 0 && (
                    <button
                      onClick={() => toggleGroup(`accts_${group.key}`)}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      {acctExpanded ? (
                        <>
                          <ChevronDown className="h-3 w-3" />
                          Show less
                        </>
                      ) : (
                        <>
                          <ChevronRight className="h-3 w-3" />
                          +{hiddenCount} more account{hiddenCount !== 1 ? "s" : ""}
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Add account picker — multi-select */}
            {isAdding ? (
              <div className="space-y-2">
                <Input
                  placeholder="Search accounts..."
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  className="text-sm"
                />
                <div className="max-h-48 overflow-y-auto rounded border p-1 space-y-0.5">
                  {entityAccounts
                    .filter((a) => !allMappedAccountIds.has(a.id))
                    .filter((a) => {
                      if (!accountSearch) return true;
                      const q = accountSearch.toLowerCase();
                      return (
                        (a.account_number ?? "").toLowerCase().includes(q) ||
                        a.name.toLowerCase().includes(q)
                      );
                    })
                    .map((a) => (
                      <label
                        key={a.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm"
                      >
                        <Checkbox
                          checked={selectedAccountIds.has(a.id)}
                          onCheckedChange={(checked) => {
                            setSelectedAccountIds((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(a.id);
                              else next.delete(a.id);
                              return next;
                            });
                          }}
                        />
                        <span className="font-mono text-xs text-muted-foreground w-12 shrink-0">
                          {a.account_number ?? ""}
                        </span>
                        <span className="truncate">{a.name}</span>
                      </label>
                    ))}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {selectedAccountIds.size} selected
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAddingToGroup(null);
                        setSelectedAccountIds(new Set());
                        setAccountSearch("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleAddAccounts(group.key)}
                      disabled={selectedAccountIds.size === 0 || saving === group.key}
                    >
                      {saving === group.key
                        ? "Linking..."
                        : `Link ${selectedAccountIds.size} Account${selectedAccountIds.size !== 1 ? "s" : ""}`}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAddingToGroup(group.key);
                  setSelectedAccountIds(new Set());
                  setAccountSearch("");
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Link Account
              </Button>
            )}
          </div>

          {/* Summary - only show if accounts are mapped */}
          {groupMappings.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  GL Balance
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatCurrency(glBal)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  Subledger
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatCurrency(subBal)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  Variance
                </p>
                <p
                  className={`text-lg font-semibold tabular-nums ${
                    Math.abs(variance) > 1.00
                      ? "text-red-600"
                      : "text-green-600"
                  }`}
                >
                  {formatCurrency(variance)}
                </p>
              </div>
            </div>
          )}

          {/* Asset detail */}
          {assetList.length > 0 && (
            <Collapsible
              open={isExpanded}
              onOpenChange={() => toggleGroup(group.key)}
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                >
                  {isExpanded ? (
                    <ChevronDown className="mr-2 h-4 w-4" />
                  ) : (
                    <ChevronRight className="mr-2 h-4 w-4" />
                  )}
                  {assetList.length} asset{assetList.length !== 1 ? "s" : ""}{" "}
                  in group
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 max-h-60 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead className="text-right">
                          {group.lineType === "cost"
                            ? "Cost"
                            : group.lineType === "accum_depr"
                              ? "Accum Depr"
                              : "Gain / (Loss)"}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assetList.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-sm">
                            {a.asset_name}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {formatCurrency(a.periodValue)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Notes */}
          <Textarea
            placeholder="Reconciliation notes..."
            value={notes[group.key] ?? ""}
            onChange={(e) =>
              setNotes((prev) => ({ ...prev, [group.key]: e.target.value }))
            }
            className="text-sm"
            rows={2}
          />

          {/* Actions */}
          <div className="flex items-center justify-between">
            {recon?.reconciled_at && (
              <p className="text-xs text-muted-foreground">
                Reconciled{" "}
                {new Date(recon.reconciled_at).toLocaleDateString()}
              </p>
            )}
            <div className="ml-auto flex gap-2">
              {isReconciled ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleUnreconcile(group.key)}
                  disabled={saving === group.key}
                >
                  {saving === group.key ? "Saving..." : "Unreconcile"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => handleReconcile(group.key)}
                  disabled={
                    saving === group.key || groupMappings.length === 0
                  }
                >
                  {saving === group.key ? "Saving..." : "Mark Reconciled"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* View Toggle */}
      <div className="inline-flex items-center rounded-lg border p-1 bg-muted/30">
        <button
          type="button"
          onClick={() => setViewMode("month")}
          className={`px-3 py-1 text-sm rounded-md transition-colors ${
            viewMode === "month"
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Month View
        </button>
        <button
          type="button"
          onClick={() => setViewMode("year")}
          className={`px-3 py-1 text-sm rounded-md transition-colors ${
            viewMode === "year"
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Year View
        </button>
      </div>

      {viewMode === "year" ? (
        <ReconciliationYearView
          entityId={entityId}
          year={periodYear}
          onYearChange={setPeriodYear}
          onJumpToMonth={(y, m) => {
            setPeriodYear(y);
            setPeriodMonth(m);
            setViewMode("month");
          }}
        />
      ) : (
        <>
      {/* Period Selector */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Period:</span>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => {
              if (periodMonth === 1) {
                setPeriodMonth(12);
                setPeriodYear(periodYear - 1);
              } else {
                setPeriodMonth(periodMonth - 1);
              }
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Select
            value={String(periodMonth)}
            onValueChange={(v) => setPeriodMonth(Number(v))}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(periodYear)}
            onValueChange={(v) => setPeriodYear(Number(v))}
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
            onClick={() => {
              if (periodMonth === 12) {
                setPeriodMonth(1);
                setPeriodYear(periodYear + 1);
              } else {
                setPeriodMonth(periodMonth + 1);
              }
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleReconcileAll}
            disabled={
              loading ||
              saving === "__all__" ||
              reconcileAllStatus.anyVariance ||
              !reconcileAllStatus.anyReconcilable
            }
            title={
              reconcileAllStatus.anyVariance
                ? "Can't reconcile all while any group has a variance"
                : !reconcileAllStatus.anyReconcilable
                  ? "All eligible groups are already reconciled"
                  : "Mark every group with a within-tolerance variance as reconciled"
            }
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {saving === "__all__" ? "Reconciling..." : "Reconcile All"}
          </Button>
          <Button
            variant="outline"
            onClick={handleExportExcel}
            disabled={loading || allAssets.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Export Excel
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          Loading reconciliation data...
        </p>
      ) : (
        <div className="space-y-8">
          {/* Vehicles section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Vehicles
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {vehicleGroups.map(renderReconCard)}
            </div>
            {/* Net summary — only shown when both cost and accum cards are in
                this section (i.e. accum isn't being combined under Fleet). */}
            {!combineFleetAccumDepr &&
              (() => {
                const costBal = glBalances["vehicles_cost"] ?? 0;
                const accumBal = glBalances["vehicles_accum_depr"] ?? 0;
                const glNet = costBal + accumBal;
                const subCost =
                  subledgerBalances["vehicles_cost"]?.total ?? 0;
                const subAccum =
                  subledgerBalances["vehicles_accum_depr"]?.total ?? 0;
                const subNet = subCost + subAccum;
                const netVariance = glNet - subNet;
                return (
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          GL Net (Vehicles)
                        </p>
                        <p className="text-lg font-semibold tabular-nums">
                          {formatCurrency(glNet)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          Subledger Net
                        </p>
                        <p className="text-lg font-semibold tabular-nums">
                          {formatCurrency(subNet)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          Net Variance
                        </p>
                        <p
                          className={`text-lg font-semibold tabular-nums ${
                            Math.abs(netVariance) > 1.00
                              ? "text-red-600"
                              : "text-green-600"
                          }`}
                        >
                          {formatCurrency(netVariance)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}
          </div>

          {/* Trailers section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Trailers
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {trailerGroups.map(renderReconCard)}
            </div>
            {!combineFleetAccumDepr &&
              (() => {
                const costBal = glBalances["trailers_cost"] ?? 0;
                const accumBal = glBalances["trailers_accum_depr"] ?? 0;
                const glNet = costBal + accumBal;
                const subCost =
                  subledgerBalances["trailers_cost"]?.total ?? 0;
                const subAccum =
                  subledgerBalances["trailers_accum_depr"]?.total ?? 0;
                const subNet = subCost + subAccum;
                const netVariance = glNet - subNet;
                return (
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          GL Net (Trailers)
                        </p>
                        <p className="text-lg font-semibold tabular-nums">
                          {formatCurrency(glNet)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          Subledger Net
                        </p>
                        <p className="text-lg font-semibold tabular-nums">
                          {formatCurrency(subNet)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          Net Variance
                        </p>
                        <p
                          className={`text-lg font-semibold tabular-nums ${
                            Math.abs(netVariance) > 1.00
                              ? "text-red-600"
                              : "text-green-600"
                          }`}
                        >
                          {formatCurrency(netVariance)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}
          </div>

          {/* Fleet section — only rendered when the entity combines accum depr.
              Houses the shared Fleet — Accumulated Depreciation card and a
              cross-section net summary (Vehicle Cost + Trailer Cost + Fleet
              Accum) so reviewers can see the overall fleet balance. */}
          {fleetGroups.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Fleet (Combined)
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {fleetGroups.map(renderReconCard)}
              </div>
              {(() => {
                const vehCost = glBalances["vehicles_cost"] ?? 0;
                const trlCost = glBalances["trailers_cost"] ?? 0;
                const fleetAccum = glBalances["fleet_accum_depr"] ?? 0;
                const glNet = vehCost + trlCost + fleetAccum;
                const subVehCost =
                  subledgerBalances["vehicles_cost"]?.total ?? 0;
                const subTrlCost =
                  subledgerBalances["trailers_cost"]?.total ?? 0;
                const subFleetAccum =
                  subledgerBalances["fleet_accum_depr"]?.total ?? 0;
                const subNet = subVehCost + subTrlCost + subFleetAccum;
                const netVariance = glNet - subNet;
                return (
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          GL Net (Fleet)
                        </p>
                        <p className="text-lg font-semibold tabular-nums">
                          {formatCurrency(glNet)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          Subledger Net
                        </p>
                        <p className="text-lg font-semibold tabular-nums">
                          {formatCurrency(subNet)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          Net Variance
                        </p>
                        <p
                          className={`text-lg font-semibold tabular-nums ${
                            Math.abs(netVariance) > 1.0
                              ? "text-red-600"
                              : "text-green-600"
                          }`}
                        >
                          {formatCurrency(netVariance)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Gain on Sale section — P&L reconciliation for assets disposed
              year-to-date through the selected period. Values are signed so
              that gains (income) appear negative, matching credit-balance
              representation in `gl_balances.ending_balance`. */}
          {gainOnSaleGroups.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Gain on Sale (YTD)
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {gainOnSaleGroups.map(renderReconCard)}
              </div>
            </div>
          )}

          {/* Unallocated Assets */}
          {(() => {
            const unallocated = subledgerBalances[UNALLOCATED_KEY];
            if (!unallocated || unallocated.assets.length === 0) return null;
            const isExpanded = expandedGroups.has(UNALLOCATED_KEY);

            return (
              <Card className="border-amber-300 bg-amber-50/40">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                      Unallocated Assets
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className="border-amber-500 text-amber-700 bg-amber-100"
                    >
                      <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                      Needs Classification
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    These assets have no vehicle class or an unrecognized
                    class. Assign a vehicle class to each asset so it maps to
                    the correct GL account group.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        Total Cost
                      </p>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatCurrency(
                          unallocated.assets.reduce(
                            (s, a) => s + a.acquisition_cost,
                            0
                          )
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        Total NBV
                      </p>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatCurrency(unallocated.total)}
                      </p>
                    </div>
                  </div>

                  <Collapsible
                    open={isExpanded}
                    onOpenChange={() => toggleGroup(UNALLOCATED_KEY)}
                  >
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                      >
                        {isExpanded ? (
                          <ChevronDown className="mr-2 h-4 w-4" />
                        ) : (
                          <ChevronRight className="mr-2 h-4 w-4" />
                        )}
                        {unallocated.assets.length} unallocated asset
                        {unallocated.assets.length !== 1 ? "s" : ""}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 max-h-80 overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Asset</TableHead>
                              <TableHead>Class</TableHead>
                              <TableHead className="text-right">
                                Cost
                              </TableHead>
                              <TableHead className="text-right">
                                NBV
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {unallocated.assets.map((a) => (
                              <TableRow key={a.id}>
                                <TableCell className="text-sm">
                                  {a.asset_name}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {a.vehicle_class ?? "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm">
                                  {formatCurrency(a.acquisition_cost)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm">
                                  {formatCurrency(a.periodValue)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      )}
        </>
      )}
    </div>
  );
}

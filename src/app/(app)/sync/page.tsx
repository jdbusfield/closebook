"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Minus,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Building2,
  CalendarRange,
  BookOpen,
} from "lucide-react";
import {
  formatCurrency,
  getCurrentPeriod,
  getPeriodLabel,
  getPeriodShortLabel,
} from "@/lib/utils/dates";
import Link from "next/link";
import type { AccountClassification } from "@/lib/types/database";

interface EntityInfo {
  id: string;
  name: string;
  code: string;
}

interface QboConnection {
  entity_id: string;
  company_name: string | null;
  last_sync_at: string | null;
  sync_status: string;
}

interface SyncResult {
  entityId: string;
  entityName: string;
  entityCode: string;
  success: boolean;
  recordsSynced: number;
  error?: string;
}

interface EntityPeriodSummary {
  entityId: string;
  entityName: string;
  entityCode: string;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  hasData: boolean;
}

interface MonthColumn {
  year: number;
  month: number;
  label: string;
}

interface GLSyncEntityResult {
  entityId: string;
  entityName: string;
  entityCode: string;
  success: boolean;
  accountsBefore: number;
  accountsAfter: number;
  newAccounts: {
    name: string;
    accountNumber: string | null;
    classification: string;
    accountType: string;
  }[];
  syncedMonths: number[]; // encoded as year*100+month
  error?: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function SyncManagementPage() {
  const supabase = createClient();
  const currentPeriod = getCurrentPeriod();

  const [entities, setEntities] = useState<EntityInfo[]>([]);
  const [connections, setConnections] = useState<QboConnection[]>([]);
  const [syncYear, setSyncYear] = useState(String(currentPeriod.year));
  const [syncMonth, setSyncMonth] = useState(String(currentPeriod.month));
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Month-by-month financials state
  const [financialYear, setFinancialYear] = useState(String(currentPeriod.year));
  const [entitySummaries, setEntitySummaries] = useState<
    Record<string, EntityPeriodSummary[]>
  >({});
  const [loadingFinancials, setLoadingFinancials] = useState(false);

  // Per-entity synced months (for the batch sync year)
  const [syncedMonthsByEntity, setSyncedMonthsByEntity] = useState<
    Record<string, Set<number>>
  >({});
  // Per-entity per-month change tracking: entityId -> month -> { synced_at, data_changed_at }
  const [periodMetaByEntity, setPeriodMetaByEntity] = useState<
    Record<string, Record<number, { synced_at: string | null; data_changed_at: string | null }>>
  >({});
  const [loadingSyncedMonths, setLoadingSyncedMonths] = useState(false);

  // Selected periods for targeted sync
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(
    new Set()
  ); // "entityId:month" keys
  const [syncingSelected, setSyncingSelected] = useState(false);
  const [selectedSyncProgress, setSelectedSyncProgress] = useState(0);
  const [selectedSyncCurrent, setSelectedSyncCurrent] = useState("");

  // Full-year sync state
  const [yearSyncEntityId, setYearSyncEntityId] = useState<string>("");
  const [yearSyncYear, setYearSyncYear] = useState(String(currentPeriod.year));
  const [yearSyncing, setYearSyncing] = useState(false);
  const [yearSyncProgress, setYearSyncProgress] = useState(0);
  const [yearSyncCurrentMonth, setYearSyncCurrentMonth] = useState(0);
  const [yearSyncMonthStatuses, setYearSyncMonthStatuses] = useState<
    Record<number, { success: boolean; recordsSynced: number; error?: string }>
  >({});

  // GL account sync state
  const [syncingAccounts, setSyncingAccounts] = useState(false);
  const [glSyncResults, setGlSyncResults] = useState<GLSyncEntityResult[] | null>(null);
  const [showNewAccountsDialog, setShowNewAccountsDialog] = useState(false);
  const [resyncingMonths, setResyncingMonths] = useState(false);
  const [resyncProgress, setResyncProgress] = useState(0);
  const [resyncCurrent, setResyncCurrent] = useState("");

  const loadEntities = useCallback(async () => {
    setLoading(true);

    // Get user's organization
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (!membership) return;

    // Get all entities
    const { data: entityData } = await supabase
      .from("entities")
      .select("id, name, code")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("name");

    const ents = (entityData ?? []) as EntityInfo[];
    setEntities(ents);

    // Get QBO connections
    if (ents.length > 0) {
      const { data: connData } = await supabase
        .from("qbo_connections")
        .select("entity_id, company_name, last_sync_at, sync_status")
        .in(
          "entity_id",
          ents.map((e) => e.id)
        );

      setConnections((connData as QboConnection[]) ?? []);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  // Load month-by-month financials
  const loadFinancials = useCallback(async () => {
    if (entities.length === 0) return;

    setLoadingFinancials(true);
    const year = parseInt(financialYear);
    const summariesByMonth: Record<string, EntityPeriodSummary[]> = {};

    // Load all 12 months for all entities
    for (let month = 1; month <= 12; month++) {
      const monthKey = `${year}-${month}`;
      const monthSummaries: EntityPeriodSummary[] = [];

      for (const entity of entities) {
        const { data: balances } = await supabase
          .from("gl_balances")
          .select(
            "ending_balance, accounts(classification)"
          )
          .eq("entity_id", entity.id)
          .eq("period_year", year)
          .eq("period_month", month);

        if (!balances || balances.length === 0) {
          monthSummaries.push({
            entityId: entity.id,
            entityName: entity.name,
            entityCode: entity.code,
            totalAssets: 0,
            totalLiabilities: 0,
            totalEquity: 0,
            totalRevenue: 0,
            totalExpenses: 0,
            netIncome: 0,
            hasData: false,
          });
          continue;
        }

        let totalAssets = 0;
        let totalLiabilities = 0;
        let totalEquity = 0;
        let totalRevenue = 0;
        let totalExpenses = 0;

        for (const row of balances) {
          const acct = row.accounts as unknown as {
            classification: AccountClassification;
          } | null;
          const balance = row.ending_balance ?? 0;

          switch (acct?.classification) {
            case "Asset":
              totalAssets += balance;
              break;
            case "Liability":
              totalLiabilities += balance;
              break;
            case "Equity":
              totalEquity += balance;
              break;
            case "Revenue":
              totalRevenue += balance;
              break;
            case "Expense":
              totalExpenses += balance;
              break;
          }
        }

        monthSummaries.push({
          entityId: entity.id,
          entityName: entity.name,
          entityCode: entity.code,
          totalAssets,
          totalLiabilities,
          totalEquity,
          totalRevenue: Math.abs(totalRevenue),
          totalExpenses: Math.abs(totalExpenses),
          netIncome: Math.abs(totalRevenue) - Math.abs(totalExpenses),
          hasData: true,
        });
      }

      summariesByMonth[monthKey] = monthSummaries;
    }

    setEntitySummaries(summariesByMonth);
    setLoadingFinancials(false);
  }, [supabase, entities, financialYear]);

  useEffect(() => {
    if (entities.length > 0) {
      loadFinancials();
    }
  }, [entities, loadFinancials]);

  // Load which months have been synced per entity for the batch sync year.
  // Uses head-only count queries (1 per month per entity) to avoid
  // Supabase's default 1000-row limit truncating results when an entity
  // has many accounts (e.g. 150 accounts × 12 months = 1800 rows).
  const loadSyncedMonths = useCallback(async () => {
    if (entities.length === 0) return;

    setLoadingSyncedMonths(true);
    const year = parseInt(syncYear);
    const result: Record<string, Set<number>> = {};
    const metaResult: Record<string, Record<number, { synced_at: string | null; data_changed_at: string | null }>> = {};

    for (const entity of entities) {
      const months = new Set<number>();
      metaResult[entity.id] = {};

      // Fire all 12 month checks in parallel for speed
      const checks = Array.from({ length: 12 }, (_, i) => {
        const month = i + 1;
        return supabase
          .from("gl_balances")
          .select("id", { count: "exact", head: true })
          .eq("entity_id", entity.id)
          .eq("period_year", year)
          .eq("period_month", month)
          .then(({ count }) => {
            if (count && count > 0) months.add(month);
          });
      });

      // Also fetch trial_balances metadata for change tracking
      const metaQuery = supabase
        .from("trial_balances")
        .select("period_month, synced_at, data_changed_at")
        .eq("entity_id", entity.id)
        .eq("period_year", year)
        .eq("status", "draft");

      const [, metaResponse] = await Promise.all([
        Promise.all(checks),
        metaQuery,
      ]);

      if (metaResponse.data) {
        for (const row of metaResponse.data) {
          metaResult[entity.id][row.period_month] = {
            synced_at: row.synced_at,
            data_changed_at: row.data_changed_at,
          };
        }
      }

      result[entity.id] = months;
    }

    setSyncedMonthsByEntity(result);
    setPeriodMetaByEntity(metaResult);
    setLoadingSyncedMonths(false);
  }, [supabase, entities, syncYear]);

  useEffect(() => {
    if (entities.length > 0) {
      loadSyncedMonths();
    }
  }, [entities, loadSyncedMonths]);

  async function handleSyncAll() {
    setSyncing(true);
    setSyncResults(null);

    try {
      const response = await fetch("/api/qbo/sync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodYear: parseInt(syncYear),
          periodMonth: parseInt(syncMonth),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSyncResults(data.results ?? []);
        toast.success(
          `Synced ${data.entitiesSynced}/${data.entitiesTotal} entities for ${getPeriodLabel(
            parseInt(syncYear),
            parseInt(syncMonth)
          )} — ${data.totalRecordsSynced} records`
        );
        // Refresh connection data, synced months, and financials
        loadEntities();
        loadSyncedMonths();
        loadFinancials();
      } else {
        toast.error(data.error || "Batch sync failed");
      }
    } catch {
      toast.error("Batch sync failed — network error");
    }

    setSyncing(false);
  }

  function togglePeriod(entityId: string, month: number) {
    const key = `${entityId}:${month}`;
    setSelectedPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function selectAllUnsyncedForEntity(entityId: string) {
    const synced = syncedMonthsByEntity[entityId] ?? new Set();
    setSelectedPeriods((prev) => {
      const next = new Set(prev);
      for (let m = 1; m <= 12; m++) {
        const key = `${entityId}:${m}`;
        if (!synced.has(m)) {
          next.add(key);
        }
      }
      return next;
    });
  }

  function deselectAllForEntity(entityId: string) {
    setSelectedPeriods((prev) => {
      const next = new Set(prev);
      for (let m = 1; m <= 12; m++) {
        next.delete(`${entityId}:${m}`);
      }
      return next;
    });
  }

  async function handleSyncSelected() {
    if (selectedPeriods.size === 0) return;

    setSyncingSelected(true);
    setSelectedSyncProgress(0);
    setSelectedSyncCurrent("");

    // Group selections by entity for sequential processing
    const periodsArray = Array.from(selectedPeriods).map((key) => {
      const [entityId, monthStr] = key.split(":");
      return { entityId, month: parseInt(monthStr) };
    });
    // Sort by entity then month for predictable order
    periodsArray.sort((a, b) =>
      a.entityId === b.entityId ? a.month - b.month : a.entityId.localeCompare(b.entityId)
    );

    let completed = 0;
    let successCount = 0;
    let totalRecords = 0;
    const year = parseInt(syncYear);

    for (const { entityId, month } of periodsArray) {
      const entity = entities.find((e) => e.id === entityId);
      setSelectedSyncCurrent(
        `${entity?.code ?? "?"} — ${MONTH_NAMES[month - 1]}`
      );
      setSelectedSyncProgress(
        Math.round((completed / periodsArray.length) * 100)
      );

      try {
        const syncResponse = await fetch("/api/qbo/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityId,
            syncType: "trial_balance",
            periodYear: year,
            periodMonth: month,
          }),
        });

        // Read SSE stream for the final result
        let lastEvent: Record<string, unknown> = {};
        if (syncResponse.body) {
          const reader = syncResponse.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  lastEvent = JSON.parse(line.slice(6));
                } catch {
                  /* skip */
                }
              }
            }
          }
        }

        if (!lastEvent.error) {
          successCount++;
          totalRecords += (lastEvent.recordsSynced as number) ?? 0;
        }
      } catch {
        // Individual period failed, continue
      }

      completed++;
    }

    setSelectedSyncProgress(100);
    setSelectedSyncCurrent("");
    toast.success(
      `Synced ${successCount}/${periodsArray.length} periods — ${totalRecords} records`
    );
    setSelectedPeriods(new Set());
    setSyncingSelected(false);
    loadEntities();
    loadSyncedMonths();
    loadFinancials();
  }

  async function handleSyncYear() {
    if (!yearSyncEntityId) {
      toast.error("Select an entity first");
      return;
    }

    setYearSyncing(true);
    setYearSyncProgress(0);
    setYearSyncCurrentMonth(0);
    setYearSyncMonthStatuses({});

    try {
      const response = await fetch("/api/qbo/sync-year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: yearSyncEntityId,
          year: parseInt(yearSyncYear),
        }),
      });

      if (!response.body) {
        toast.error("No response from server");
        setYearSyncing(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.progress != null) {
              setYearSyncProgress(event.progress);
            }
            if (event.month != null) {
              setYearSyncCurrentMonth(event.month);
            }

            if (event.step === "month_complete") {
              setYearSyncMonthStatuses((prev) => ({
                ...prev,
                [event.month]: {
                  success: true,
                  recordsSynced: event.recordsSynced ?? 0,
                },
              }));
            } else if (event.step === "month_error") {
              setYearSyncMonthStatuses((prev) => ({
                ...prev,
                [event.month]: {
                  success: false,
                  recordsSynced: 0,
                  error: event.detail,
                },
              }));
            } else if (event.step === "complete") {
              const entityName =
                entities.find((e) => e.id === yearSyncEntityId)?.name ?? "Entity";
              toast.success(
                `${entityName}: Full year sync complete — ${event.monthsSynced}/12 months, ${event.totalRecordsSynced} records`
              );
              loadEntities();
              loadSyncedMonths();
              loadFinancials();
            }
          } catch {
            /* skip unparseable lines */
          }
        }
      }
    } catch {
      toast.error("Full year sync failed — network error");
    }

    setYearSyncing(false);
  }

  async function handleSyncAccounts() {
    setSyncingAccounts(true);
    setGlSyncResults(null);

    try {
      const response = await fetch("/api/qbo/sync-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (response.ok) {
        const results = (data.results ?? []) as GLSyncEntityResult[];
        setGlSyncResults(results);

        const hasNewAccounts = results.some((r) => r.newAccounts.length > 0);
        if (hasNewAccounts) {
          setShowNewAccountsDialog(true);
        } else {
          toast.success(
            `GL accounts synced for ${data.entitiesSynced} entities — no new accounts found`
          );
        }
      } else {
        toast.error(data.error || "GL account sync failed");
      }
    } catch {
      toast.error("GL account sync failed — network error");
    }

    setSyncingAccounts(false);
  }

  async function handleResyncAffectedMonths() {
    if (!glSyncResults) return;

    const affectedEntities = glSyncResults.filter(
      (r) => r.newAccounts.length > 0 && r.syncedMonths.length > 0
    );
    if (affectedEntities.length === 0) {
      setShowNewAccountsDialog(false);
      return;
    }

    // Build list of all entity/month combos to re-sync
    const periodsToSync: { entityId: string; entityCode: string; year: number; month: number }[] = [];
    for (const entity of affectedEntities) {
      for (const encoded of entity.syncedMonths) {
        const year = Math.floor(encoded / 100);
        const month = encoded % 100;
        periodsToSync.push({
          entityId: entity.entityId,
          entityCode: entity.entityCode,
          year,
          month,
        });
      }
    }

    setResyncingMonths(true);
    setResyncProgress(0);
    setResyncCurrent("");

    let completed = 0;
    let successCount = 0;

    for (const { entityId, entityCode, year, month } of periodsToSync) {
      setResyncCurrent(
        `${entityCode} — ${MONTH_NAMES[month - 1]} ${year}`
      );
      setResyncProgress(
        Math.round((completed / periodsToSync.length) * 100)
      );

      try {
        const syncResponse = await fetch("/api/qbo/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityId,
            syncType: "trial_balance",
            periodYear: year,
            periodMonth: month,
          }),
        });

        // Read SSE stream to completion
        if (syncResponse.body) {
          const reader = syncResponse.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let lastEvent: Record<string, unknown> = {};
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  lastEvent = JSON.parse(line.slice(6));
                } catch {
                  /* skip */
                }
              }
            }
          }
          if (!lastEvent.error) successCount++;
        }
      } catch {
        // Continue on individual failures
      }

      completed++;
    }

    setResyncProgress(100);
    setResyncCurrent("");
    setResyncingMonths(false);
    setShowNewAccountsDialog(false);
    toast.success(
      `Re-synced ${successCount}/${periodsToSync.length} periods across ${affectedEntities.length} entities`
    );
    loadEntities();
    loadSyncedMonths();
    loadFinancials();
  }

  const connByEntity = new Map(
    connections.map((c) => [c.entity_id, c])
  );
  const connectedCount = connections.length;

  // Generate columns for the financial year view
  const monthColumns: MonthColumn[] = Array.from({ length: 12 }, (_, i) => ({
    year: parseInt(financialYear),
    month: i + 1,
    label: getPeriodShortLabel(parseInt(financialYear), i + 1),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          QBO Sync Manager
        </h1>
        <p className="text-muted-foreground">
          Sync QuickBooks trial balances across all entities and view
          month-by-month financials
        </p>
      </div>

      {/* Batch Sync Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Batch Sync — All Entities</CardTitle>
          <CardDescription>
            Pull trial balance data from QuickBooks for all connected entities
            for the selected period. {connectedCount} of {entities.length}{" "}
            entities have active QBO connections.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Select value={syncMonth} onValueChange={setSyncMonth}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={syncYear} onValueChange={setSyncYear}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(
                  { length: currentPeriod.year + 1 - 2017 + 1 },
                  (_, i) => currentPeriod.year + 1 - i,
                ).map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleSyncAll}
              disabled={syncing || syncingAccounts || connectedCount === 0}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`}
              />
              {syncing
                ? "Syncing All..."
                : `Sync All Entities (${connectedCount})`}
            </Button>
            <Button
              variant="outline"
              onClick={handleSyncAccounts}
              disabled={syncingAccounts || syncing || connectedCount === 0}
            >
              <BookOpen
                className={`mr-2 h-4 w-4 ${syncingAccounts ? "animate-spin" : ""}`}
              />
              {syncingAccounts
                ? "Syncing GL Accounts..."
                : "Sync GL Accounts"}
            </Button>
          </div>

          {/* Entity Sync Status with Month Grid */}
          {!loading && (
            <div className="mt-4 space-y-4">
              <TooltipProvider delayDuration={200}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">Entity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="min-w-[420px]">
                        Synced Months ({syncYear})
                      </TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.map((entity) => {
                      const conn = connByEntity.get(entity.id);
                      const synced = syncedMonthsByEntity[entity.id] ?? new Set<number>();
                      const result = syncResults?.find(
                        (r) => r.entityId === entity.id
                      );
                      const entitySelectedCount = Array.from({ length: 12 }, (_, i) => i + 1)
                        .filter((m) => selectedPeriods.has(`${entity.id}:${m}`)).length;
                      const entityUnsyncedCount = 12 - synced.size;

                      return (
                        <TableRow key={entity.id}>
                          <TableCell>
                            <Link
                              href={`/${entity.id}/settings`}
                              className="hover:underline font-medium"
                            >
                              <Badge variant="outline" className="mr-2 text-xs">
                                {entity.code}
                              </Badge>
                              {entity.name}
                            </Link>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {conn?.company_name ?? "No QBO connection"}
                            </div>
                          </TableCell>
                          <TableCell>
                            {conn ? (
                              <div className="space-y-1">
                                <Badge variant="default" className="gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Connected
                                </Badge>
                                {result && (
                                  <div>
                                    {result.success ? (
                                      <Badge variant="default" className="gap-1 text-xs">
                                        <CheckCircle2 className="h-3 w-3" />
                                        {result.recordsSynced} records
                                      </Badge>
                                    ) : (
                                      <Badge variant="destructive" className="gap-1 text-xs">
                                        <XCircle className="h-3 w-3" />
                                        {result.error ?? "Failed"}
                                      </Badge>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <Badge variant="outline" className="gap-1">
                                <Minus className="h-3 w-3" />
                                Not Connected
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {conn ? (
                              loadingSyncedMonths ? (
                                <span className="text-xs text-muted-foreground">Loading...</span>
                              ) : (
                                <div className="flex gap-1">
                                  {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                                    const isSynced = synced.has(month);
                                    const isSelected = selectedPeriods.has(`${entity.id}:${month}`);
                                    const periodMeta = periodMetaByEntity[entity.id]?.[month];

                                    return (
                                      <Tooltip key={month}>
                                        <TooltipTrigger asChild>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (!isSynced) togglePeriod(entity.id, month);
                                            }}
                                            disabled={syncingSelected || syncing}
                                            className={`
                                              relative flex flex-col items-center justify-center
                                              w-8 h-9 rounded border text-[10px] font-medium
                                              transition-colors
                                              ${
                                                isSynced
                                                  ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
                                                  : isSelected
                                                  ? "border-blue-400 bg-blue-100 text-blue-800 dark:border-blue-600 dark:bg-blue-950 dark:text-blue-300 ring-1 ring-blue-400"
                                                  : "border-muted-foreground/25 bg-muted/30 text-muted-foreground hover:border-blue-300 hover:bg-blue-50 dark:hover:border-blue-700 dark:hover:bg-blue-950/50 cursor-pointer"
                                              }
                                              ${isSynced ? "cursor-default" : ""}
                                            `}
                                          >
                                            <span>{MONTH_NAMES[month - 1].slice(0, 3)}</span>
                                            {isSynced && (
                                              <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                                            )}
                                            {!isSynced && isSelected && (
                                              <Checkbox
                                                checked
                                                className="h-3 w-3 pointer-events-none"
                                                tabIndex={-1}
                                              />
                                            )}
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" className="text-xs max-w-[220px]">
                                          {isSynced ? (
                                            <div>
                                              <div className="font-medium">{MONTH_NAMES[month - 1]} {syncYear} — Synced</div>
                                              {periodMeta?.synced_at && (
                                                <div className="text-muted-foreground mt-0.5">
                                                  Last synced: {new Date(periodMeta.synced_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                                </div>
                                              )}
                                              {periodMeta?.data_changed_at && (
                                                <div className="text-muted-foreground">
                                                  Last modified: {new Date(periodMeta.data_changed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                                </div>
                                              )}
                                            </div>
                                          ) : isSelected
                                            ? `${MONTH_NAMES[month - 1]} ${syncYear} — Selected for sync`
                                            : `${MONTH_NAMES[month - 1]} ${syncYear} — Click to select`}
                                        </TooltipContent>
                                      </Tooltip>
                                    );
                                  })}
                                </div>
                              )
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                Connect to QBO first
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {conn && entityUnsyncedCount > 0 && (
                              <div className="flex justify-end gap-1">
                                {entitySelectedCount > 0 ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs h-7"
                                    onClick={() => deselectAllForEntity(entity.id)}
                                    disabled={syncingSelected}
                                  >
                                    Deselect
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs h-7"
                                    onClick={() => selectAllUnsyncedForEntity(entity.id)}
                                    disabled={syncingSelected}
                                  >
                                    Select All Unsynced
                                  </Button>
                                )}
                              </div>
                            )}
                            {conn && entityUnsyncedCount === 0 && (
                              <Badge variant="outline" className="text-xs gap-1">
                                <CheckCircle2 className="h-3 w-3 text-green-600" />
                                All months synced
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TooltipProvider>

              {/* Sync Selected Periods action bar */}
              {selectedPeriods.size > 0 && (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
                  <span className="text-sm font-medium">
                    {selectedPeriods.size} period{selectedPeriods.size !== 1 ? "s" : ""} selected
                  </span>
                  <Button
                    size="sm"
                    onClick={handleSyncSelected}
                    disabled={syncingSelected || syncing}
                  >
                    <RefreshCw
                      className={`mr-2 h-3.5 w-3.5 ${syncingSelected ? "animate-spin" : ""}`}
                    />
                    {syncingSelected
                      ? `Syncing ${selectedSyncCurrent}...`
                      : `Sync ${selectedPeriods.size} Selected Period${selectedPeriods.size !== 1 ? "s" : ""}`}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedPeriods(new Set())}
                    disabled={syncingSelected}
                  >
                    Clear Selection
                  </Button>
                  {syncingSelected && (
                    <div className="flex-1">
                      <Progress value={selectedSyncProgress} className="h-1.5" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full Year Sync — Single Entity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5" />
            Full Year Sync — Single Entity
          </CardTitle>
          <CardDescription>
            Sync all 12 months of a year for one entity at once. Each month is
            synced sequentially.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={yearSyncEntityId} onValueChange={setYearSyncEntityId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select entity" />
              </SelectTrigger>
              <SelectContent>
                {entities
                  .filter((e) => connByEntity.has(e.id))
                  .map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.code} — {e.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={yearSyncYear} onValueChange={setYearSyncYear}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(
                  { length: currentPeriod.year + 1 - 2017 + 1 },
                  (_, i) => currentPeriod.year + 1 - i,
                ).map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleSyncYear}
              disabled={yearSyncing || !yearSyncEntityId}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${yearSyncing ? "animate-spin" : ""}`}
              />
              {yearSyncing
                ? `Syncing month ${yearSyncCurrentMonth}/12...`
                : "Sync Full Year"}
            </Button>
          </div>

          {yearSyncing && (
            <div className="space-y-2">
              <Progress value={yearSyncProgress} className="h-2" />
              <p className="text-sm text-muted-foreground">
                Syncing month {yearSyncCurrentMonth} of 12...
              </p>
            </div>
          )}

          {Object.keys(yearSyncMonthStatuses).length > 0 && (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-2">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                const status = yearSyncMonthStatuses[month];
                const isCurrentlySyncing =
                  yearSyncing && yearSyncCurrentMonth === month && !status;

                return (
                  <div
                    key={month}
                    className={`text-center rounded-md border px-2 py-1.5 text-xs ${
                      status?.success
                        ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
                        : status && !status.success
                        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400"
                        : isCurrentlySyncing
                        ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400"
                        : "border-muted text-muted-foreground"
                    }`}
                  >
                    <div className="font-medium">
                      {MONTH_NAMES[month - 1].slice(0, 3)}
                    </div>
                    {status?.success && (
                      <div className="flex items-center justify-center mt-0.5">
                        <CheckCircle2 className="h-3 w-3" />
                      </div>
                    )}
                    {status && !status.success && (
                      <div className="flex items-center justify-center mt-0.5">
                        <XCircle className="h-3 w-3" />
                      </div>
                    )}
                    {isCurrentlySyncing && (
                      <div className="flex items-center justify-center mt-0.5">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Month-by-Month Financials */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Month-by-Month Financials</CardTitle>
              <CardDescription>
                Net income for each entity by month — synced from QuickBooks
                trial balances
              </CardDescription>
            </div>
            <Select value={financialYear} onValueChange={setFinancialYear}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  currentPeriod.year - 2,
                  currentPeriod.year - 1,
                  currentPeriod.year,
                  currentPeriod.year + 1,
                ].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loadingFinancials ? (
            <p className="text-sm text-muted-foreground">
              Loading financial data...
            </p>
          ) : entities.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No entities found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background z-10 min-w-[160px]">
                      Entity
                    </TableHead>
                    {monthColumns.map((col) => (
                      <TableHead
                        key={`${col.year}-${col.month}`}
                        className="text-right min-w-[100px]"
                      >
                        {col.label}
                      </TableHead>
                    ))}
                    <TableHead className="text-right min-w-[120px] font-semibold">
                      YTD Total
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entities.map((entity) => {
                    let ytdTotal = 0;
                    return (
                      <TableRow key={entity.id}>
                        <TableCell className="sticky left-0 bg-background z-10 font-medium">
                          <Link
                            href={`/${entity.id}/reports/financial-statements`}
                            className="hover:underline flex items-center gap-2"
                          >
                            <Badge variant="outline" className="text-xs">
                              {entity.code}
                            </Badge>
                            {entity.name}
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          </Link>
                        </TableCell>
                        {monthColumns.map((col) => {
                          const key = `${col.year}-${col.month}`;
                          const summaries = entitySummaries[key];
                          const summary = summaries?.find(
                            (s) => s.entityId === entity.id
                          );
                          const netIncome = summary?.netIncome ?? 0;
                          const hasData = summary?.hasData ?? false;

                          if (hasData) {
                            ytdTotal += netIncome;
                          }

                          return (
                            <TableCell
                              key={key}
                              className={`text-right tabular-nums ${
                                !hasData
                                  ? "text-muted-foreground"
                                  : netIncome >= 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }`}
                            >
                              {hasData ? formatCurrency(netIncome) : "---"}
                            </TableCell>
                          );
                        })}
                        <TableCell
                          className={`text-right tabular-nums font-semibold ${
                            ytdTotal >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {formatCurrency(ytdTotal)}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {/* Organization totals row */}
                  {entities.length > 1 && (
                    <TableRow className="font-semibold border-t-2">
                      <TableCell className="sticky left-0 bg-background z-10">
                        Organization Total
                      </TableCell>
                      {(() => {
                        let orgYtd = 0;
                        return (
                          <>
                            {monthColumns.map((col) => {
                              const key = `${col.year}-${col.month}`;
                              const summaries = entitySummaries[key];
                              const monthTotal =
                                summaries
                                  ?.filter((s) => s.hasData)
                                  .reduce(
                                    (sum, s) => sum + s.netIncome,
                                    0
                                  ) ?? 0;
                              const hasAnyData =
                                summaries?.some((s) => s.hasData) ?? false;

                              if (hasAnyData) {
                                orgYtd += monthTotal;
                              }

                              return (
                                <TableCell
                                  key={key}
                                  className={`text-right tabular-nums ${
                                    !hasAnyData
                                      ? "text-muted-foreground"
                                      : monthTotal >= 0
                                      ? "text-green-600"
                                      : "text-red-600"
                                  }`}
                                >
                                  {hasAnyData
                                    ? formatCurrency(monthTotal)
                                    : "---"}
                                </TableCell>
                              );
                            })}
                            <TableCell
                              className={`text-right tabular-nums ${
                                orgYtd >= 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }`}
                            >
                              {formatCurrency(orgYtd)}
                            </TableCell>
                          </>
                        );
                      })()}
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue & Expense Breakdown */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Revenue by Entity by Month */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Revenue by Entity
            </CardTitle>
            <CardDescription>
              Monthly revenue for {financialYear}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingFinancials ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[120px]">Entity</TableHead>
                      {monthColumns.map((col) => (
                        <TableHead
                          key={`rev-${col.year}-${col.month}`}
                          className="text-right min-w-[90px]"
                        >
                          {MONTH_NAMES[col.month - 1].slice(0, 3)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.map((entity) => (
                      <TableRow key={entity.id}>
                        <TableCell className="font-medium">
                          {entity.code}
                        </TableCell>
                        {monthColumns.map((col) => {
                          const key = `${col.year}-${col.month}`;
                          const summary = entitySummaries[key]?.find(
                            (s) => s.entityId === entity.id
                          );
                          return (
                            <TableCell
                              key={key}
                              className="text-right tabular-nums text-sm"
                            >
                              {summary?.hasData
                                ? formatCurrency(summary.totalRevenue)
                                : "---"}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expenses by Entity by Month */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-600" />
              Expenses by Entity
            </CardTitle>
            <CardDescription>
              Monthly expenses for {financialYear}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingFinancials ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[120px]">Entity</TableHead>
                      {monthColumns.map((col) => (
                        <TableHead
                          key={`exp-${col.year}-${col.month}`}
                          className="text-right min-w-[90px]"
                        >
                          {MONTH_NAMES[col.month - 1].slice(0, 3)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.map((entity) => (
                      <TableRow key={entity.id}>
                        <TableCell className="font-medium">
                          {entity.code}
                        </TableCell>
                        {monthColumns.map((col) => {
                          const key = `${col.year}-${col.month}`;
                          const summary = entitySummaries[key]?.find(
                            (s) => s.entityId === entity.id
                          );
                          return (
                            <TableCell
                              key={key}
                              className="text-right tabular-nums text-sm"
                            >
                              {summary?.hasData
                                ? formatCurrency(summary.totalExpenses)
                                : "---"}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* New GL Accounts Dialog */}
      <Dialog open={showNewAccountsDialog} onOpenChange={setShowNewAccountsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New GL Accounts Detected</DialogTitle>
            <DialogDescription>
              The following new accounts were found in QuickBooks. Previously synced months may need to be re-synced to pick up balances for these accounts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {glSyncResults
              ?.filter((r) => r.newAccounts.length > 0)
              .map((entity) => {
                const totalSyncedPeriods = entity.syncedMonths.length;
                return (
                  <div key={entity.entityId} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm">
                        <Badge variant="outline" className="mr-2 text-xs">
                          {entity.entityCode}
                        </Badge>
                        {entity.entityName}
                      </h4>
                      <span className="text-xs text-muted-foreground">
                        {entity.accountsBefore} → {entity.accountsAfter} accounts
                      </span>
                    </div>

                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Account</TableHead>
                            <TableHead className="text-xs">Number</TableHead>
                            <TableHead className="text-xs">Classification</TableHead>
                            <TableHead className="text-xs">Type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {entity.newAccounts.map((acct, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs font-medium">
                                {acct.name}
                              </TableCell>
                              <TableCell className="text-xs">
                                {acct.accountNumber ?? "—"}
                              </TableCell>
                              <TableCell className="text-xs">
                                {acct.classification}
                              </TableCell>
                              <TableCell className="text-xs">
                                {acct.accountType}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {totalSyncedPeriods > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {totalSyncedPeriods} previously synced{" "}
                        {totalSyncedPeriods === 1 ? "period" : "periods"} will be re-synced
                      </p>
                    )}
                  </div>
                );
              })}
          </div>

          {resyncingMonths && (
            <div className="space-y-2 pt-2">
              <Progress value={resyncProgress} className="h-2" />
              <p className="text-sm text-muted-foreground">
                Re-syncing {resyncCurrent}...
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {(() => {
              const affectedEntities = glSyncResults?.filter(
                (r) => r.newAccounts.length > 0 && r.syncedMonths.length > 0
              ) ?? [];
              const totalPeriods = affectedEntities.reduce(
                (sum, r) => sum + r.syncedMonths.length,
                0
              );

              return (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowNewAccountsDialog(false);
                      toast.success(
                        `GL accounts synced — ${glSyncResults?.reduce((s, r) => s + r.newAccounts.length, 0) ?? 0} new accounts added`
                      );
                    }}
                    disabled={resyncingMonths}
                  >
                    {totalPeriods > 0 ? "Skip Re-sync" : "Done"}
                  </Button>
                  {totalPeriods > 0 && (
                    <Button
                      onClick={handleResyncAffectedMonths}
                      disabled={resyncingMonths}
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${resyncingMonths ? "animate-spin" : ""}`}
                      />
                      {resyncingMonths
                        ? "Re-syncing..."
                        : `Re-sync ${totalPeriods} Period${totalPeriods !== 1 ? "s" : ""}`}
                    </Button>
                  )}
                </>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

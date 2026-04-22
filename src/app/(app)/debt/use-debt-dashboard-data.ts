"use client";

/**
 * Loader + memoized derived data for the org-level debt dashboard.
 *
 * One hook so the page component stays presentational. It reads:
 *   - Current user's organization
 *   - Entities in the org (for the scope selector and for labeling rows)
 *   - Reporting entities (named groupings of entities)
 *   - All debt_instruments for the in-scope entities
 *   - All debt_transactions for those instruments (full history — needed to
 *     compute beginning balance at an arbitrary window start)
 *   - Reconciliation snapshots for the as-of period (for the badge on rows)
 *
 * Then runs the pure `computeDebtRollForward` + `computeMonthlyBalanceSeries`
 * helpers so every presentational section reads from the same derived object.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  computeDebtRollForward,
  computeMonthlyBalanceSeries,
  type DebtInstrumentInput,
  type DebtTransactionInput,
  type EntityRef,
  type GroupedRollForward,
  type MonthlyBalancePoint,
  type ReconciliationStatusInput,
} from "@/lib/utils/debt-rollforward";

export type Scope = "organization" | "reporting_entity" | "entity";

export interface ReportingEntity {
  id: string;
  name: string;
  code: string;
  members: Array<{ entityId: string; entityName: string; entityCode: string }>;
}

export interface DebtDashboardParams {
  scope: Scope;
  entityId?: string | null;
  reportingEntityId?: string | null;
  /** ISO yyyy-mm-dd — drives the snapshot section. */
  asOfIso: string;
  /** Inclusive window for the activity / roll-forward sections. */
  startIso: string;
  endIso: string;
}

export interface DebtDashboardData {
  loading: boolean;
  error: string | null;
  organizationId: string | null;
  organizationName: string;
  entities: EntityRef[];
  reportingEntities: ReportingEntity[];
  /** Scoped subset of entities used for this query. */
  scopedEntities: EntityRef[];
  /** Name shown in report titles — "Organization", "Reporting Entity Name", or entity name. */
  scopeLabel: string;
  instruments: DebtInstrumentInput[];
  transactions: DebtTransactionInput[];
  rollForward: GroupedRollForward | null;
  trend: MonthlyBalancePoint[];
  reload: () => void;
}

/**
 * Paginated Supabase select so we can safely pull thousands of transactions
 * across all instruments without bumping into the default 1000-row cap.
 *
 * Supabase's PostgrestFilterBuilder is PromiseLike (has .then) but not a real
 * Promise; accept PromiseLike so TS threads the types through awaits.
 */
async function fetchAllPaginated<T>(
  queryFn: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await queryFn(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) return out;
    out.push(...data);
    if (data.length < pageSize) return out;
    from += pageSize;
  }
}

export function useDebtDashboardData(
  params: DebtDashboardParams
): DebtDashboardData {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [entities, setEntities] = useState<EntityRef[]>([]);
  const [reportingEntities, setReportingEntities] = useState<ReportingEntity[]>([]);
  const [instruments, setInstruments] = useState<DebtInstrumentInput[]>([]);
  const [transactions, setTransactions] = useState<DebtTransactionInput[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationStatusInput[]>([]);
  const [reloadCounter, setReloadCounter] = useState(0);

  const reload = useCallback(() => setReloadCounter((c) => c + 1), []);

  // Step 1 — figure out which entities we need to query based on scope.
  // If the user hasn't explicitly selected a target yet, fall back to the
  // first available option so the dashboard always has something to show.
  const scopedEntities = useMemo<EntityRef[]>(() => {
    if (params.scope === "entity") {
      const targetId = params.entityId ?? entities[0]?.id ?? null;
      const e = entities.find((x) => x.id === targetId);
      return e ? [e] : [];
    }
    if (params.scope === "reporting_entity") {
      const targetId =
        params.reportingEntityId ?? reportingEntities[0]?.id ?? null;
      const re = reportingEntities.find((x) => x.id === targetId);
      if (!re) return [];
      const memberIds = new Set(re.members.map((m) => m.entityId));
      return entities.filter((e) => memberIds.has(e.id));
    }
    return entities;
  }, [params.scope, params.entityId, params.reportingEntityId, entities, reportingEntities]);

  const scopeLabel = useMemo(() => {
    if (params.scope === "entity") {
      const e = entities.find((x) => x.id === params.entityId);
      return e?.name ?? "Entity";
    }
    if (params.scope === "reporting_entity") {
      const re = reportingEntities.find((x) => x.id === params.reportingEntityId);
      return re?.name ?? "Reporting Entity";
    }
    return organizationName || "Organization";
  }, [params.scope, params.entityId, params.reportingEntityId, entities, reportingEntities, organizationName]);

  // Step 2 — load org + entities + reporting entities (once per session / reload).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const { data: membership, error: memErr } = await supabase
          .from("organization_members")
          .select("organization_id")
          .eq("user_id", user.id)
          .single();
        if (memErr) throw memErr;
        if (!membership) throw new Error("No organization membership");

        if (cancelled) return;
        setOrganizationId(membership.organization_id);

        const { data: org } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", membership.organization_id)
          .single();
        if (cancelled) return;
        setOrganizationName((org as { name?: string } | null)?.name ?? "");

        const { data: ents, error: entErr } = await supabase
          .from("entities")
          .select("id, name, code")
          .eq("organization_id", membership.organization_id)
          .eq("is_active", true)
          .order("name");
        if (entErr) throw entErr;
        if (cancelled) return;
        setEntities((ents ?? []) as EntityRef[]);

        const reRes = await fetch(
          `/api/reporting-entities?organizationId=${membership.organization_id}`
        );
        if (reRes.ok) {
          const reData = await reRes.json();
          if (!cancelled) {
            setReportingEntities(
              (reData.reportingEntities ?? []) as ReportingEntity[]
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load org");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, reloadCounter]);

  // Step 3 — load instruments + transactions scoped by the selected entities.
  useEffect(() => {
    let cancelled = false;
    if (!organizationId || scopedEntities.length === 0) {
      if (organizationId) {
        // Org loaded but no entities in scope — nothing to load, clear and stop.
        setInstruments([]);
        setTransactions([]);
        setReconciliation([]);
        setLoading(false);
      }
      return;
    }
    (async () => {
      try {
        const entityIds = scopedEntities.map((e) => e.id);

        // Debt instruments in scope.
        const instrRows = await fetchAllPaginated<DebtInstrumentInput>(
          (from, to) =>
            supabase
              .from("debt_instruments")
              .select(
                "id, entity_id, instrument_name, lender_name, debt_type, original_amount, interest_rate, credit_limit, current_draw, payment_amount, payment_frequency, start_date, maturity_date, status"
              )
              .in("entity_id", entityIds)
              .range(from, to)
        );
        if (cancelled) return;

        const instrumentIds = instrRows.map((i) => i.id);
        if (instrumentIds.length === 0) {
          setInstruments([]);
          setTransactions([]);
          setReconciliation([]);
          setLoading(false);
          return;
        }

        // Transactions — full history so beginning-balance computation is
        // correct at any window start. Supabase caps .in() to ~1000 ids on
        // the client; split into batches to be safe on large orgs.
        const BATCH = 200;
        const allTxns: DebtTransactionInput[] = [];
        for (let i = 0; i < instrumentIds.length; i += BATCH) {
          const batch = instrumentIds.slice(i, i + BATCH);
          const rows = await fetchAllPaginated<DebtTransactionInput>(
            (from, to) =>
              supabase
                .from("debt_transactions")
                .select(
                  "id, debt_instrument_id, transaction_date, effective_date, transaction_type, amount, to_principal, to_interest, to_fees, reference_number, description, is_reconciled"
                )
                .in("debt_instrument_id", batch)
                .order("effective_date", { ascending: true })
                .range(from, to)
          );
          allTxns.push(...rows);
          if (cancelled) return;
        }

        // The `debt_reconciliations` table reconciles at the GL-account-group
        // level (vehicles_cost / trailers_accum_depr / etc.), not per
        // instrument. Per-instrument reconciliation status would need a new
        // table or a join strategy; skip the per-row badge for now so the
        // dashboard still works without touching schema.

        if (cancelled) return;
        setInstruments(instrRows);
        setTransactions(allTxns);
        setReconciliation([]);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load debt");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, scopedEntities, params.asOfIso, reloadCounter]);

  // Step 4 — derive the rolled-up report + trend series.
  const rollForward = useMemo<GroupedRollForward | null>(() => {
    if (instruments.length === 0) return null;
    return computeDebtRollForward({
      instruments,
      transactions,
      entities: scopedEntities,
      startIso: params.startIso,
      endIso: params.endIso,
      reconciliation,
    });
  }, [instruments, transactions, scopedEntities, params.startIso, params.endIso, reconciliation]);

  const trend = useMemo<MonthlyBalancePoint[]>(() => {
    if (instruments.length === 0) return [];
    return computeMonthlyBalanceSeries(
      instruments,
      transactions,
      params.startIso,
      params.endIso
    );
  }, [instruments, transactions, params.startIso, params.endIso]);

  return {
    loading,
    error,
    organizationId,
    organizationName,
    entities,
    reportingEntities,
    scopedEntities,
    scopeLabel,
    instruments,
    transactions,
    rollForward,
    trend,
    reload,
  };
}

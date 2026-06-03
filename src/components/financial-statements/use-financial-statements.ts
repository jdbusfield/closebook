"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type {
  FinancialStatementsResponse,
  FinancialModelConfig,
} from "./types";

interface UseFinancialStatementsReturn {
  data: FinancialStatementsResponse | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  generate: () => void;
}

function useFetchStatements(
  config: FinancialModelConfig,
  trigger: number,
  enabled: boolean
) {
  const [data, setData] = useState<FinancialStatementsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || trigger === 0) return;

    const controller = new AbortController();
    const { signal } = controller;

    const params = new URLSearchParams({
      scope: config.scope,
      startYear: String(config.startYear),
      startMonth: String(config.startMonth),
      endYear: String(config.endYear),
      endMonth: String(config.endMonth),
      granularity: config.granularity,
      includeBudget: String(config.includeBudget),
      includeYoY: String(config.includeYoY),
      includeProForma: String(config.includeProForma),
      includeAllocations: String(config.includeAllocations),
      includeFixedAssetSchedule: String(config.includeFixedAssetSchedule ?? true),
      includeTotal: String(config.includeTotal),
    });

    if (config.entityId) params.set("entityId", config.entityId);
    if (config.organizationId)
      params.set("organizationId", config.organizationId);
    if (config.reportingEntityId)
      params.set("reportingEntityId", config.reportingEntityId);
    if (config.chartId) params.set("chartId", config.chartId);

    setLoading(true);
    setError(null);

    fetch(`/api/financial-statements?${params.toString()}`, { signal })
      .then(async (response) => {
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(
            errBody.error ?? `HTTP ${response.status}: ${response.statusText}`
          );
        }
        return response.json();
      })
      .then((result: FinancialStatementsResponse) => {
        if (!signal.aborted) {
          setData(result);
        }
      })
      .catch((err) => {
        if (!signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Failed to load data"
          );
        }
      })
      .finally(() => {
        if (!signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [enabled, trigger, config.scope, config.entityId, config.organizationId, config.reportingEntityId, config.chartId, config.startYear, config.startMonth, config.endYear, config.endMonth, config.granularity, config.includeBudget, config.includeYoY, config.includeProForma, config.includeAllocations, config.includeFixedAssetSchedule, config.includeTotal]);

  return { data, loading, error };
}

/**
 * @param config - Financial model configuration
 * @param enabled - Whether fetching is allowed (e.g. required IDs are present)
 * @param manual - If true, only fetches when generate() is called (no auto-fetch on config change)
 */
export function useFinancialStatements(
  config: FinancialModelConfig,
  enabled: boolean = true,
  manual: boolean = false
): UseFinancialStatementsReturn {
  const [fetchCount, setFetchCount] = useState(0);
  const configRef = useRef(config);
  configRef.current = config;

  // In manual mode, we snapshot the config at generate() time so the
  // effect only fires on fetchCount change, not on every config change.
  const [snapshotConfig, setSnapshotConfig] = useState(config);

  const activeConfig = manual ? snapshotConfig : config;
  const trigger = manual ? fetchCount : fetchCount + 1; // auto mode: always > 0

  const { data, loading, error } = useFetchStatements(activeConfig, trigger, enabled);

  // In manual mode, detect when the live config has diverged from the
  // last-generated snapshot so the page can hide stale results.
  const configKey = useMemo(() => JSON.stringify(config), [config]);
  const snapshotKey = useMemo(() => JSON.stringify(snapshotConfig), [snapshotConfig]);
  const stale = manual && fetchCount > 0 && configKey !== snapshotKey;

  const generate = useCallback(() => {
    setSnapshotConfig(configRef.current);
    setFetchCount((c) => c + 1);
  }, []);

  return { data, loading, error, stale, generate };
}

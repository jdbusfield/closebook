"use client";

import { useState, useEffect, useCallback } from "react";
import type { EntityBreakdownResponse } from "./types";

interface UseEntityBreakdownConfig {
  organizationId?: string;
  reportingEntityId?: string;
  chartId?: string;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: string;
  includeProForma: boolean;
  includeAllocations?: boolean;
}

interface UseEntityBreakdownReturn {
  data: EntityBreakdownResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useEntityBreakdown(
  config: UseEntityBreakdownConfig,
  enabled: boolean = true
): UseEntityBreakdownReturn {
  const [data, setData] = useState<EntityBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled || !config.organizationId) return;

    const controller = new AbortController();
    const { signal } = controller;

    const params = new URLSearchParams({
      organizationId: config.organizationId,
      startYear: String(config.startYear),
      startMonth: String(config.startMonth),
      endYear: String(config.endYear),
      endMonth: String(config.endMonth),
      granularity: config.granularity,
      includeProForma: String(config.includeProForma),
      includeAllocations: String(config.includeAllocations ?? false),
    });

    if (config.reportingEntityId)
      params.set("reportingEntityId", config.reportingEntityId);
    if (config.chartId) params.set("chartId", config.chartId);

    setLoading(true);
    setError(null);

    fetch(`/api/financial-statements/entity-breakdown?${params.toString()}`, { signal })
      .then(async (response) => {
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(
            errBody.error ?? `HTTP ${response.status}: ${response.statusText}`
          );
        }
        return response.json();
      })
      .then((result: EntityBreakdownResponse) => {
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
  }, [
    enabled,
    config.organizationId,
    config.reportingEntityId,
    config.chartId,
    config.startYear,
    config.startMonth,
    config.endYear,
    config.endMonth,
    config.granularity,
    config.includeProForma,
    config.includeAllocations,
    fetchCount,
  ]);

  const refetch = useCallback(() => {
    setFetchCount((c) => c + 1);
  }, []);

  return { data, loading, error, refetch };
}

"use client";

import { useState, useCallback } from "react";
import type {
  LineItem,
  DrillDownResponse,
  FinancialModelConfig,
} from "./types";

export interface DrillDownCellInfo {
  lineLabel: string;
  periodLabel: string;
  columnType: "actual" | "budget";
  amount: number;
  statementId: string;
}

export interface UseDrillDownReturn {
  isOpen: boolean;
  loading: boolean;
  data: DrillDownResponse | null;
  error: string | null;
  cellInfo: DrillDownCellInfo | null;
  openDrillDown: (
    lineItem: LineItem,
    periodKey: string,
    periodLabel: string,
    columnType: "actual" | "budget",
    amount: number,
    statementId: string
  ) => void;
  closeDrillDown: () => void;
}

export function useDrillDown(config: FinancialModelConfig): UseDrillDownReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DrillDownResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cellInfo, setCellInfo] = useState<DrillDownCellInfo | null>(null);

  const openDrillDown = useCallback(
    async (
      lineItem: LineItem,
      periodKey: string,
      periodLabel: string,
      columnType: "actual" | "budget",
      amount: number,
      statementId: string
    ) => {
      // Don't drill into non-drillable lines
      const meta = lineItem.drillDownMeta;
      if (!meta || meta.type === "percentage" || meta.type === "none") return;

      setCellInfo({
        lineLabel: lineItem.label,
        periodLabel,
        columnType,
        amount,
        statementId,
      });
      setIsOpen(true);
      setLoading(true);
      setError(null);
      setData(null);

      const params = new URLSearchParams({
        scope: config.scope,
        startYear: String(config.startYear),
        startMonth: String(config.startMonth),
        endYear: String(config.endYear),
        endMonth: String(config.endMonth),
        granularity: config.granularity,
        lineId: lineItem.id,
        statementId,
        periodKey,
        columnType,
        includeProForma: String(config.includeProForma),
        includeAllocations: String(config.includeAllocations),
      });

      if (config.entityId) params.set("entityId", config.entityId);
      if (config.organizationId)
        params.set("organizationId", config.organizationId);
      if (config.reportingEntityId)
        params.set("reportingEntityId", config.reportingEntityId);
      if (config.chartId) params.set("chartId", config.chartId);

      try {
        const response = await fetch(
          `/api/financial-statements/drill-down?${params.toString()}`
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        const json: DrillDownResponse = await response.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load drill-down data");
      } finally {
        setLoading(false);
      }
    },
    [config]
  );

  const closeDrillDown = useCallback(() => {
    setIsOpen(false);
    setData(null);
    setError(null);
    setCellInfo(null);
  }, []);

  return {
    isOpen,
    loading,
    data,
    error,
    cellInfo,
    openDrillDown,
    closeDrillDown,
  };
}

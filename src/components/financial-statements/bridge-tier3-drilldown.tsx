"use client";

import { useEffect, useState } from "react";
import { formatStatementAmount } from "./format-utils";
import type { BridgeTier3Row, BridgeStatement } from "@/lib/financial-statements/bridge-types";
import type { Period } from "./types";

interface BridgeTier3DrilldownProps {
  organizationId: string;
  masterAccountId: string;
  statement: BridgeStatement;
  periods: Period[];
  /** Subset of period keys currently visible in the bridge table (sum across these). */
  visiblePeriodKeys: string[];
}

/**
 * Tier 3 drilldown — lazy-loaded list of GL accounts that map to a master
 * account, with each entity-level account's contribution to the master's
 * amount for the visible period range.
 */
export function BridgeTier3Drilldown({
  organizationId,
  masterAccountId,
  statement,
  periods,
  visiblePeriodKeys,
}: BridgeTier3DrilldownProps) {
  const [rows, setRows] = useState<BridgeTier3Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const startBucket = periods[0];
    const endBucket = periods[periods.length - 1];

    fetch("/api/financial-statements/bridge/tier3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        masterAccountId,
        statement,
        startYear: startBucket.year,
        startMonth: startBucket.startMonth,
        endYear: endBucket.endYear,
        endMonth: endBucket.endMonth,
        // Always monthly for tier 3 — period bucketing is preserved by the
        // engine through the period keys we send.
        granularity: "monthly",
        periodKeys: periods.map((p) => ({
          key: p.key,
          year: p.year,
          startMonth: p.startMonth,
          endYear: p.endYear,
          endMonth: p.endMonth,
        })),
      }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text();
          throw new Error(text || `HTTP ${r.status}`);
        }
        const json = (await r.json()) as { rows: BridgeTier3Row[] };
        if (cancelled) return;
        setRows(json.rows);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId, masterAccountId, statement, periods]);

  if (loading) {
    return <div className="text-[10px] text-muted-foreground py-1">Loading GL accounts…</div>;
  }
  if (error) {
    return <div className="text-[10px] text-destructive py-1">{error}</div>;
  }
  if (!rows || rows.length === 0) {
    return <div className="text-[10px] text-muted-foreground py-1">No GL accounts mapped.</div>;
  }

  function sumOver(amounts: Record<string, number>): number {
    let s = 0;
    for (const k of visiblePeriodKeys) s += amounts[k] ?? 0;
    return s;
  }

  return (
    <table className="text-[10px] w-full">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left py-0.5 font-normal">Entity</th>
          <th className="text-left py-0.5 pl-2 font-normal">GL Account</th>
          <th className="text-right py-0.5 px-2 font-normal">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const amount = sumOver(r.amounts);
          return (
            <tr key={r.id}>
              <td className="py-0.5">{r.entityCode || r.entityName}</td>
              <td className="py-0.5 pl-2">
                {r.accountNumber ? `${r.accountNumber} — ` : ""}
                {r.accountName}
              </td>
              <td className="py-0.5 px-2 text-right tabular-nums">
                {Math.abs(amount) < 0.5 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatStatementAmount(amount, false)
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

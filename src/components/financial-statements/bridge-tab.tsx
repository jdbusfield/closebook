"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, FileText, Wallet } from "lucide-react";
import { StatementCard } from "./statement-card";
import { BridgeTable } from "./bridge-table";
import type {
  BridgeRequest,
  BridgeResponse,
  BridgeStatement,
  BridgeDirection,
} from "@/lib/financial-statements/bridge-types";
import type { Granularity } from "./types";

interface BridgeTabProps {
  organizationId: string | null;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  companyName: string;
}

export function BridgeTab({
  organizationId,
  startYear,
  startMonth,
  endYear,
  endMonth,
  granularity,
  companyName,
}: BridgeTabProps) {
  const [statement, setStatement] = useState<BridgeStatement>("BS");
  const [direction, setDirection] = useState<BridgeDirection>("acc-to-mgt");
  const [data, setData] = useState<BridgeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const body: BridgeRequest = {
        organizationId,
        statement,
        direction,
        startYear,
        startMonth,
        endYear,
        endMonth,
        granularity,
      };
      const res = await fetch("/api/financial-statements/bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as BridgeResponse;
      setData(json);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [
    organizationId, statement, direction,
    startYear, startMonth, endYear, endMonth, granularity,
  ]);

  // Auto-generate on first load and on toggle changes
  useEffect(() => {
    generate();
  }, [generate]);

  const swapDirection = () => {
    setDirection((d) => (d === "acc-to-mgt" ? "mgt-to-acc" : "acc-to-mgt"));
  };

  const fromTitle =
    statement === "BS" ? "Balance Sheet" : "Income Statement";

  return (
    <div className="space-y-4">
      <Card className="stmt-no-print">
        <CardContent className="py-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Statement</Label>
            <Select
              value={statement}
              onValueChange={(v) => setStatement(v as BridgeStatement)}
            >
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BS">
                  <span className="inline-flex items-center gap-2">
                    <Wallet className="h-3.5 w-3.5" /> Balance Sheet
                  </span>
                </SelectItem>
                <SelectItem value="PL">
                  <span className="inline-flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" /> Income Statement
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Direction</Label>
            <div className="flex items-center gap-2">
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v as BridgeDirection)}
              >
                <SelectTrigger className="w-[280px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="acc-to-mgt">
                    Accountant-prepared → Company-prepared
                  </SelectItem>
                  <SelectItem value="mgt-to-acc">
                    Company-prepared → Accountant-prepared
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={swapDirection}
                title="Swap direction"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="ml-auto">
            <Button onClick={generate} disabled={loading || !organizationId} size="sm">
              {loading ? "Generating..." : "Refresh"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-destructive">Bridge failed: {error}</p>
          </CardContent>
        </Card>
      )}

      {!data && loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">Building bridge...</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <BridgeTable data={data} />

          {/* Side-by-side statements for context */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 px-1">
                {data.fromChartName} (from)
              </p>
              <StatementCard
                companyName={companyName}
                statementTitle={fromTitle}
                statementData={data.fromStatement}
                periods={data.periods}
                showBudget={false}
                showYoY={false}
                startYear={startYear}
                startMonth={startMonth}
                endYear={endYear}
                endMonth={endMonth}
                granularity={granularity}
                compactLabels={direction === "mgt-to-acc" ? false : true}
              />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 px-1">
                {data.toChartName} (to)
              </p>
              <StatementCard
                companyName={companyName}
                statementTitle={fromTitle}
                statementData={data.toStatement}
                periods={data.periods}
                showBudget={false}
                showYoY={false}
                startYear={startYear}
                startMonth={startMonth}
                endYear={endYear}
                endMonth={endMonth}
                granularity={granularity}
                compactLabels={direction === "acc-to-mgt" ? false : true}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

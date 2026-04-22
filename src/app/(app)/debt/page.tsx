"use client";

/**
 * Org-level Debt Dashboard.
 *
 * Layout hierarchy (top → bottom):
 *   1. Header strip — title + scope/period pills + export
 *   2. Hero summary — dominant outstanding metric + 4 supporting metrics
 *   3. Composition — by-entity stacked bars + by-debt-type donut
 *   4. Detail tabs — Roll-Forward / Activity / Trends
 *
 * The visual rhythm favors "at a glance" at the top (one giant number
 * tells the whole debt story) and drills progressively deeper. Tabs chunk
 * the long detail sections so the page never feels like an endless scroll.
 */

import { useCallback, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebtDashboardData, type Scope } from "./use-debt-dashboard-data";
import { ControlBar, type PeriodPreset } from "./control-bar";
import { HeroSummary } from "./hero-summary";
import { CompositionPanels } from "./composition-panels";
import { MethodologyTiles } from "./methodology-tiles";
import { RollForwardTable } from "./roll-forward-table";
import { TrendChart } from "./trend-chart";
import { ActivityFeed } from "./activity-feed";
import { ExportDialog } from "./export-dialog";
import type { MethodologyBucket } from "@/lib/utils/debt-rollforward";

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfYear(iso: string): string {
  return `${iso.slice(0, 4)}-01-01`;
}
function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DebtDashboardPage() {
  const today = isoToday();

  const [scope, setScope] = useState<Scope>("organization");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [reportingEntityId, setReportingEntityId] = useState<string | null>(null);

  const [asOfIso, setAsOfIso] = useState(today);
  const [startIso, setStartIso] = useState(startOfYear(today));
  const [endIso, setEndIso] = useState(today);
  const [preset, setPreset] = useState<PeriodPreset>("YTD");

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<MethodologyBucket | null>(null);

  const [exportOpen, setExportOpen] = useState(false);

  // Scope / target changes reset the drill-down filters in one step so we
  // don't rely on post-render effects (keeps the page reactive-clean).
  const handleScopeChange = useCallback((s: Scope) => {
    setScope(s);
    setSelectedType(null);
    setSelectedEntityId(null);
    setSelectedBucket(null);
  }, []);
  const handleEntityIdChange = useCallback((id: string | null) => {
    setEntityId(id);
    setSelectedType(null);
    setSelectedEntityId(null);
    setSelectedBucket(null);
  }, []);
  const handleReportingEntityIdChange = useCallback((id: string | null) => {
    setReportingEntityId(id);
    setSelectedType(null);
    setSelectedEntityId(null);
    setSelectedBucket(null);
  }, []);

  const data = useDebtDashboardData({
    scope,
    entityId,
    reportingEntityId,
    asOfIso,
    startIso,
    endIso,
  });

  const effectiveEntityId =
    scope === "entity" ? (entityId ?? data.entities[0]?.id ?? null) : entityId;
  const effectiveReportingEntityId =
    scope === "reporting_entity"
      ? (reportingEntityId ?? data.reportingEntities[0]?.id ?? null)
      : reportingEntityId;

  const subtitle = useMemo(() => {
    const scopePart = data.scopeLabel || "Organization";
    const periodPart = `Activity ${shortDate(startIso)} – ${shortDate(endIso)}`;
    return `${scopePart} · As of ${longDate(asOfIso)} · ${periodPart}`;
  }, [data.scopeLabel, asOfIso, startIso, endIso]);

  return (
    <div className="mx-auto max-w-[1800px] space-y-5 p-4 md:p-6">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-0.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              Debt Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <ControlBar
          scope={scope}
          onScopeChange={handleScopeChange}
          entityId={effectiveEntityId}
          onEntityIdChange={handleEntityIdChange}
          reportingEntityId={effectiveReportingEntityId}
          onReportingEntityIdChange={handleReportingEntityIdChange}
          entities={data.entities}
          reportingEntities={data.reportingEntities}
          asOfIso={asOfIso}
          onAsOfIsoChange={setAsOfIso}
          startIso={startIso}
          endIso={endIso}
          onStartIsoChange={setStartIso}
          onEndIsoChange={setEndIso}
          preset={preset}
          onPresetChange={setPreset}
          onExportClick={() => setExportOpen(true)}
          disableExport={!data.rollForward}
        />
      </div>

      {/* ── Loading / error shell ─────────────────────────────────────── */}
      {data.loading && (
        <div className="flex items-center gap-2 rounded-md border bg-card p-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading debt data…
        </div>
      )}
      {data.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {data.error}
        </div>
      )}

      {/* ── Hero: dominant outstanding metric + supporting tiles ──────── */}
      <HeroSummary rollForward={data.rollForward} trend={data.trend} />

      {/* ── Composition: by entity (left) + by debt type (right) ──────── */}
      <CompositionPanels
        rollForward={data.rollForward}
        selectedType={selectedType}
        selectedEntityId={selectedEntityId}
        onSelectType={setSelectedType}
        onSelectEntity={setSelectedEntityId}
      />

      {/* ── Tabs: Roll-Forward / Activity / Trends ────────────────────── */}
      <Tabs defaultValue="rollforward" className="space-y-3">
        <TabsList className="h-auto w-full justify-start bg-transparent p-0">
          <TabsTrigger
            value="rollforward"
            className="data-[state=active]:border-primary relative border-b-2 border-transparent px-4 pb-2.5 pt-1 text-sm font-medium data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Roll-Forward
          </TabsTrigger>
          <TabsTrigger
            value="activity"
            className="data-[state=active]:border-primary relative border-b-2 border-transparent px-4 pb-2.5 pt-1 text-sm font-medium data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Activity
          </TabsTrigger>
          <TabsTrigger
            value="trends"
            className="data-[state=active]:border-primary relative border-b-2 border-transparent px-4 pb-2.5 pt-1 text-sm font-medium data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Trends
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rollforward" className="m-0 space-y-3">
          <RollForwardTable
            rollForward={data.rollForward}
            filterType={selectedType}
            filterEntityId={selectedEntityId}
          />
        </TabsContent>

        <TabsContent value="activity" className="m-0 space-y-3">
          <MethodologyTiles
            rollForward={data.rollForward}
            transactions={data.transactions}
            startIso={startIso}
            endIso={endIso}
            selectedBucket={selectedBucket}
            onSelectBucket={setSelectedBucket}
          />
          <ActivityFeed
            transactions={data.transactions}
            instruments={data.instruments}
            entities={data.scopedEntities}
            startIso={startIso}
            endIso={endIso}
            bucketFilter={selectedBucket}
            limit={30}
          />
        </TabsContent>

        <TabsContent value="trends" className="m-0 space-y-3">
          <TrendChart trend={data.trend} />
        </TabsContent>
      </Tabs>

      {/* ── Export dialog ─────────────────────────────────────────────── */}
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        organizationName={data.organizationName}
        scopeLabel={data.scopeLabel}
        startIso={startIso}
        endIso={endIso}
        asOfIso={asOfIso}
        instruments={data.instruments}
        transactions={data.transactions}
        entities={data.scopedEntities}
        trend={data.trend}
        currentRollForward={data.rollForward}
      />
    </div>
  );
}

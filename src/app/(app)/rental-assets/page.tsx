"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Car,
  TrendingUp,
  Wrench,
  DollarSign,
  AlertCircle,
  RefreshCw,
  Plus,
  Minus,
  Link2Off,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  TableFooter,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { formatCurrency, getCurrentPeriod } from "@/lib/utils/dates";
import { useRentalAssetData } from "./use-rental-asset-data";
import { TrendsTab } from "./trends-tab";

const MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function fmtPct(n: number, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

const MONTH_SHORT = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export default function RentalAssetsPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Controls
  const [period, setPeriod] = useState<{ year: number; month: number }>(() => {
    // Default to January 2026 (most recent KPI data), fallback to current period
    const now = getCurrentPeriod();
    return { year: now.year, month: now.month };
  });
  const [includeService, setIncludeService] = useState(false);
  const [scopeEntityId, setScopeEntityId] = useState<string | "all">("all");
  const [groupFilter, setGroupFilter] = useState<string[] | null>(null);
  const [syncing, setSyncing] = useState<null | "vehicles" | "maintenance">(
    null
  );

  // Load org membership
  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setProfileChecked(true);
        return;
      }
      const { data: memberships } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", user.id)
        .limit(1);
      if (memberships && memberships[0]) {
        setOrganizationId(memberships[0].organization_id);
        setIsAdmin(["admin", "controller"].includes(memberships[0].role));
      }
      setProfileChecked(true);
    })();
  }, []);

  const {
    loading,
    error,
    entities,
    availablePeriods,
    syncState,
    computed,
    maintenance,
    reload,
  } = useRentalAssetData({
    organizationId,
    periodYear: period.year,
    periodMonth: period.month,
    includeService,
    scope:
      scopeEntityId === "all"
        ? { type: "organization" }
        : { type: "entity", entityId: scopeEntityId },
    reportingGroupFilter: groupFilter,
  });

  // default to most recent available period once we know what's loaded
  useEffect(() => {
    if (
      availablePeriods.length > 0 &&
      !availablePeriods.some(
        (p) => p.year === period.year && p.month === period.month
      )
    ) {
      setPeriod({
        year: availablePeriods[0].year,
        month: availablePeriods[0].month,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availablePeriods.length]);

  const allGroups = useMemo(
    () => computed.groups.map((g) => g.group).sort(),
    [computed.groups]
  );

  const syncStateByResource = useMemo(() => {
    const m = new Map<string, (typeof syncState)[number]>();
    for (const s of syncState) m.set(s.resource, s);
    return m;
  }, [syncState]);

  const lastVehicleSync =
    syncStateByResource.get("vehicles")?.last_incremental_sync_at ??
    syncStateByResource.get("vehicles")?.last_full_sync_at;
  const lastMaintSync =
    syncStateByResource.get("service_entries")?.last_incremental_sync_at;

  async function runSync(kind: "vehicles" | "maintenance") {
    if (!organizationId) return;
    setSyncing(kind);
    try {
      const url =
        kind === "vehicles"
          ? "/api/fleetio/sync/vehicles"
          : "/api/fleetio/sync/maintenance";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          incremental: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      toast.success(
        kind === "vehicles"
          ? `Synced ${data.synced} vehicles — linked ${data.linked}, not in register ${data.not_in_register}`
          : `Maintenance sync complete`
      );
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(null);
    }
  }

  // ──────────── render ────────────

  if (!profileChecked) {
    return (
      <div className="p-6">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Rental Assets</CardTitle>
            <CardDescription>
              You are not a member of any organization. Contact an administrator.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { totals } = computed;
  const netFleetChange = totals.additions - totals.dispositions;

  return (
    <div className="space-y-6">
      {/* ────────── Header / Control bar ────────── */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Rental Asset Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Organization · {MONTH_NAMES[period.month]} {period.year} ·{" "}
            {scopeEntityId === "all"
              ? "All entities"
              : entities.find((e) => e.id === scopeEntityId)?.name ?? "Entity"}
            {" · "}
            {includeService ? "Rental + Service" : "Rental only"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker
            period={period}
            available={availablePeriods.length > 0 ? availablePeriods : [period]}
            onChange={setPeriod}
          />

          <Select
            value={scopeEntityId}
            onValueChange={(v) => setScopeEntityId(v)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities (organization)</SelectItem>
              {entities.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
            <Label
              htmlFor="include-service"
              className="text-xs font-medium text-muted-foreground"
            >
              Include service
            </Label>
            <Switch
              id="include-service"
              checked={includeService}
              onCheckedChange={setIncludeService}
            />
          </div>

          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runSync("vehicles")}
                disabled={syncing !== null}
              >
                <RefreshCw
                  className={`mr-1.5 h-3.5 w-3.5 ${
                    syncing === "vehicles" ? "animate-spin" : ""
                  }`}
                />
                Sync Fleetio
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runSync("maintenance")}
                disabled={syncing !== null}
              >
                <Wrench
                  className={`mr-1.5 h-3.5 w-3.5 ${
                    syncing === "maintenance" ? "animate-spin" : ""
                  }`}
                />
                Sync Maintenance
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium">Could not load dashboard</p>
              <p className="text-sm text-muted-foreground">{error}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                If this is your first visit, the migration at{" "}
                <code>supabase/migrations/20260422_rental_asset_dashboard.sql</code>{" "}
                must be applied, and the backfill + KPI ingest scripts run. See{" "}
                <code>docs/rental-asset-dashboard-plan.md</code>.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ────────── Hero tiles ────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <HeroTile
          icon={<Car className="h-4 w-4" />}
          label="Fleet Size (EOP)"
          value={totals.fleetSize.toString()}
          hint={`${totals.bopFleet} at start · ${netFleetChange >= 0 ? "+" : ""}${netFleetChange} MoM`}
          loading={loading}
        />
        <HeroTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Weighted DBR Utilization"
          value={fmtPct(totals.weightedDbrUtil)}
          hint={`${totals.rentalDays.toFixed(0)} / ${totals.fleetDays.toFixed(0)} fleet days`}
          loading={loading}
        />
        <HeroTile
          icon={<DollarSign className="h-4 w-4" />}
          label="Total Rental Revenue"
          value={formatCurrency(totals.revenue)}
          hint={`Financial util (annualized): ${fmtPct(totals.finUtilPct * 12, 1)} · ${formatCurrency(totals.financialCost)} cost base`}
          loading={loading}
        />
        <HeroTile
          icon={<Wrench className="h-4 w-4" />}
          label="Maintenance Spend"
          value={formatCurrency(totals.maintenance)}
          hint={
            lastMaintSync
              ? `Last sync ${new Date(lastMaintSync).toLocaleDateString()}`
              : "Not yet synced"
          }
          loading={loading}
        />
        <HeroTile
          icon={<Link2Off className="h-4 w-4" />}
          label="Fleetio Coverage"
          value={`${totals.fleetLinked} / ${totals.fleetSize}`}
          hint={
            lastVehicleSync
              ? `Last sync ${new Date(lastVehicleSync).toLocaleDateString()}`
              : "Never synced"
          }
          loading={loading}
        />
      </div>

      {/* ────────── Tabs ────────── */}
      <Tabs defaultValue="by-group">
        <TabsList>
          <TabsTrigger value="by-group">By Reporting Group</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="activity">Fleet Activity</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="orphans">
            Orphans
            {computed.orphanKpis.length > 0 && (
              <Badge variant="secondary" className="ml-1.5">
                {computed.orphanKpis.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─── By Group ─── */}
        <TabsContent value="by-group">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Reporting Group Breakdown</CardTitle>
                  <CardDescription>
                    Fleet size, utilization, revenue and maintenance by reporting group for{" "}
                    {MONTH_NAMES[period.month]} {period.year}.
                  </CardDescription>
                </div>
                {allGroups.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant={groupFilter === null ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGroupFilter(null)}
                    >
                      All
                    </Button>
                    {allGroups.map((g) => {
                      const active = groupFilter?.includes(g) ?? false;
                      return (
                        <Button
                          key={g}
                          variant={active ? "default" : "outline"}
                          size="sm"
                          onClick={() =>
                            setGroupFilter((prev) => {
                              if (prev === null) return [g];
                              if (prev.includes(g))
                                return prev.filter((x) => x !== g).length === 0
                                  ? null
                                  : prev.filter((x) => x !== g);
                              return [...prev, g];
                            })
                          }
                        >
                          {g}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reporting Group</TableHead>
                    <TableHead className="text-right">Fleet EOP</TableHead>
                    <TableHead className="text-right">Adds</TableHead>
                    <TableHead className="text-right">Disposals</TableHead>
                    <TableHead className="text-right">Rental Days</TableHead>
                    <TableHead className="text-right">Fleet Days</TableHead>
                    <TableHead className="text-right">DBR Util</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Maintenance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && computed.groups.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No KPI data for this period. Upload a DBR utilization
                        spreadsheet with{" "}
                        <code>node scripts/ingest-kpis.mjs &lt;file.xlsx&gt;</code>.
                      </TableCell>
                    </TableRow>
                  )}
                  {computed.groups.map((g) => (
                    <TableRow key={g.group}>
                      <TableCell className="font-medium">{g.group}</TableCell>
                      <TableCell className="text-right">{g.fleetSize}</TableCell>
                      <TableCell className="text-right text-emerald-600">
                        {g.additions > 0 ? `+${g.additions}` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-rose-600">
                        {g.dispositions > 0 ? `-${g.dispositions}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {g.rentalDays.toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {g.fleetDays.toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPct(g.utilDbr)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(g.revenue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {g.maintenance > 0 ? formatCurrency(g.maintenance) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {computed.groups.length > 0 && (
                  <TableFooter>
                    <TableRow className="font-medium">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">
                        {totals.fleetSize}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600">
                        +{totals.additions}
                      </TableCell>
                      <TableCell className="text-right text-rose-600">
                        -{totals.dispositions}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {totals.rentalDays.toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {totals.fleetDays.toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPct(totals.weightedDbrUtil)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(totals.revenue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(totals.maintenance)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Trends ─── */}
        <TabsContent value="trends">
          <TrendsTab
            organizationId={organizationId}
            includeService={includeService}
            availablePeriods={availablePeriods}
            entityId={scopeEntityId === "all" ? null : scopeEntityId}
            entityName={
              scopeEntityId === "all"
                ? null
                : entities.find((e) => e.id === scopeEntityId)?.name ?? null
            }
          />
        </TabsContent>

        {/* ─── Activity ─── */}
        <TabsContent value="activity">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-4 w-4 text-emerald-600" />
                  Fleet Additions ({computed.additions.length})
                </CardTitle>
                <CardDescription>
                  In-service date within period.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ActivityList assets={computed.additions} showDate="in_service_date" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Minus className="h-4 w-4 text-rose-600" />
                  Dispositions ({computed.dispositions.length})
                </CardTitle>
                <CardDescription>Disposed during the period.</CardDescription>
              </CardHeader>
              <CardContent>
                <ActivityList
                  assets={computed.dispositions}
                  showDate="disposed_date"
                  showPrice
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Maintenance ─── */}
        <TabsContent value="maintenance">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Maintenance Feed</CardTitle>
                  <CardDescription>
                    Service entries + work orders completed in{" "}
                    {MONTH_NAMES[period.month]} {period.year} (from Fleetio).
                  </CardDescription>
                </div>
                <div className="text-sm text-muted-foreground">
                  {lastMaintSync ? (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      Last synced{" "}
                      {new Date(lastMaintSync).toLocaleString()}
                    </span>
                  ) : (
                    <span>Never synced — press the Sync Maintenance button above</span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <MaintenanceFeed
                items={maintenance.map((m) => ({
                  ...m,
                  asset: m.fixed_asset_id
                    ? computed.assetById.get(m.fixed_asset_id) ?? null
                    : null,
                }))}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Orphans ─── */}
        <TabsContent value="orphans">
          <Card>
            <CardHeader>
              <CardTitle>Unregistered Assets on the DBR</CardTitle>
              <CardDescription>
                These vehicles generate rental revenue but are not in the
                closebook fixed-asset register. Add them to the register (or
                map to an existing asset) to complete the chain.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {computed.orphanKpis.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  No orphans for this period. 🎉
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Veh Number</TableHead>
                      <TableHead>Bridge VIN</TableHead>
                      <TableHead className="text-right">
                        Rental Days
                      </TableHead>
                      <TableHead className="text-right">
                        Fleet Days
                      </TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">DBR Util</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {computed.orphanKpis.map((k) => (
                      <TableRow key={k.id}>
                        <TableCell className="font-medium">
                          {k.orphan_veh_number}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {k.orphan_bridge_vin}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {k.rental_dbr_days?.toFixed(1) ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {k.fleet_days?.toFixed(1) ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(k.total_revenue ?? 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtPct(k.dbr_util_pct ?? 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ──────────── pieces ────────────

function PeriodPicker({
  period,
  available,
  onChange,
}: {
  period: { year: number; month: number };
  available: { year: number; month: number }[];
  onChange: (p: { year: number; month: number }) => void;
}) {
  // Build year → set of available months. `available` is expected to be
  // deduped already but we rebuild defensively.
  const byYear = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const p of available) {
      if (!m.has(p.year)) m.set(p.year, new Set());
      m.get(p.year)!.add(p.month);
    }
    return m;
  }, [available]);
  const years = useMemo(
    () => [...byYear.keys()].sort((a, b) => b - a),
    [byYear]
  );
  const monthsForYear = byYear.get(period.year) ?? new Set<number>();

  // Prev / next period navigation across the full available list.
  const sortedAsc = useMemo(
    () =>
      [...available].sort((a, b) =>
        a.year !== b.year ? a.year - b.year : a.month - b.month
      ),
    [available]
  );
  const currentIdx = sortedAsc.findIndex(
    (p) => p.year === period.year && p.month === period.month
  );
  const prev = currentIdx > 0 ? sortedAsc[currentIdx - 1] : null;
  const next =
    currentIdx >= 0 && currentIdx < sortedAsc.length - 1
      ? sortedAsc[currentIdx + 1]
      : null;

  return (
    <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        disabled={!prev}
        onClick={() => prev && onChange(prev)}
        aria-label="Previous month"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <Select
        value={String(period.year)}
        onValueChange={(v) => {
          const y = Number(v);
          const monthsSet = byYear.get(y) ?? new Set<number>();
          // Prefer same month in that year; otherwise pick the most recent
          // available month in the year.
          const target = monthsSet.has(period.month)
            ? period.month
            : Math.max(...monthsSet);
          onChange({ year: y, month: target });
        }}
      >
        <SelectTrigger className="h-8 w-[90px] border-0">
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

      <Select
        value={String(period.month)}
        onValueChange={(v) => onChange({ year: period.year, month: Number(v) })}
      >
        <SelectTrigger className="h-8 w-[110px] border-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const avail = monthsForYear.has(m);
            return (
              <SelectItem key={m} value={String(m)} disabled={!avail}>
                <span className={avail ? "" : "text-muted-foreground"}>
                  {MONTH_SHORT[m]}
                  {!avail ? " —" : ""}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        disabled={!next}
        onClick={() => next && onChange(next)}
        aria-label="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function HeroTile({
  icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          {icon}
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">
          {loading ? "—" : value}
        </div>
        {hint && (
          <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityList({
  assets,
  showDate,
  showPrice,
}: {
  assets: Array<{
    id: string;
    asset_tag: string | null;
    vehicle_year: number | null;
    vehicle_make: string | null;
    vehicle_model: string | null;
    in_service_date: string;
    disposed_date: string | null;
    acquisition_cost: number;
    disposed_sale_price: number | null;
  }>;
  showDate: "in_service_date" | "disposed_date";
  showPrice?: boolean;
}) {
  if (assets.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        None during this period.
      </p>
    );
  }
  return (
    <div className="divide-y text-sm">
      {assets.map((a) => {
        const date =
          showDate === "in_service_date" ? a.in_service_date : a.disposed_date;
        return (
          <div key={a.id} className="flex items-center justify-between py-2">
            <div>
              <div className="font-medium">
                {a.asset_tag ?? "—"} — {a.vehicle_year ?? "?"}{" "}
                {a.vehicle_make ?? ""} {a.vehicle_model ?? ""}
              </div>
              <div className="text-xs text-muted-foreground">
                {date ? new Date(date).toLocaleDateString() : "—"}
              </div>
            </div>
            <div className="text-right">
              {showPrice ? (
                <>
                  <div className="tabular-nums">
                    {formatCurrency(a.disposed_sale_price ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    cost {formatCurrency(a.acquisition_cost)}
                  </div>
                </>
              ) : (
                <div className="tabular-nums">
                  {formatCurrency(a.acquisition_cost)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface MaintenanceItem {
  id: string;
  source: string;
  status: string | null;
  completed_at: string | null;
  reference: string | null;
  vendor_name: string | null;
  total_amount: number | null;
  fleetio_vehicle_id: number;
  asset: {
    asset_tag: string | null;
    vehicle_year: number | null;
    vehicle_make: string | null;
    vehicle_model: string | null;
  } | null;
}

function MaintenanceFeed({ items }: { items: MaintenanceItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        No maintenance records loaded for this period. Run{" "}
        <span className="font-mono">Sync Maintenance</span> after the Fleetio
        integration has been configured in settings.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Completed</TableHead>
          <TableHead>Asset</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Vendor</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((m) => (
          <TableRow key={m.id}>
            <TableCell className="tabular-nums">
              {m.completed_at
                ? new Date(m.completed_at).toLocaleDateString()
                : "—"}
            </TableCell>
            <TableCell>
              {m.asset ? (
                <span className="text-sm">
                  <span className="font-medium">{m.asset.asset_tag ?? "—"}</span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {m.asset.vehicle_year ?? ""} {m.asset.vehicle_make ?? ""}{" "}
                    {m.asset.vehicle_model ?? ""}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Fleetio {m.fleetio_vehicle_id} (unlinked)
                </span>
              )}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{m.source}</Badge>
            </TableCell>
            <TableCell className="text-xs font-mono">
              {m.reference ?? "—"}
            </TableCell>
            <TableCell className="text-xs">{m.status ?? "—"}</TableCell>
            <TableCell className="text-xs">{m.vendor_name ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">
              {m.total_amount != null ? formatCurrency(m.total_amount) : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

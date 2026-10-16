"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, fmtPoints, rewardsCall } from "@/components/rewards/api";
import type { RewardsOverview } from "@/components/rewards/types";
import { MembersTab } from "@/components/rewards/members-tab";
import { TiersTab } from "@/components/rewards/tiers-tab";
import { PerksTab } from "@/components/rewards/perks-tab";
import { CatalogTab, PreviewTab, SettingsTab, TierChangesTab } from "@/components/rewards/ops-tabs";

export default function RewardsPage() {
  const { entityId } = useParams<{ entityId: string }>();
  const [data, setData] = useState<RewardsOverview | null>(null);
  const [version, setVersion] = useState(0);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await rewardsCall<RewardsOverview>("get_overview", { entityId }));
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    }
  }, [entityId]);

  useEffect(() => {
    load();
  }, [load]);

  const recalculate = async () => {
    setRunning(true);
    try {
      const { summary } = await rewardsCall<{ summary: { invoices: number; members: number; newMembers: number; tierChanges: number } }>("recalculate", { entityId });
      toast.success(
        `${summary.invoices.toLocaleString()} invoices, ${summary.members.toLocaleString()} members` +
          (summary.newMembers ? `, ${summary.newMembers} newly enrolled` : "") +
          (summary.tierChanges ? `, ${summary.tierChanges} tier changes` : ""),
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Recalculation failed");
    } finally {
      setRunning(false);
    }
  };

  if (!data) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading rewards
      </div>
    );
  }

  const { program, tiers, members } = data;
  const live = members.filter((m) => m.status !== "opted_out");
  const active = live.filter((m) => m.status === "active").length;
  const available = live.reduce((s, m) => s + m.points_available, 0);
  const pending = live.reduce((s, m) => s + m.points_pending, 0);
  const openChanges = data.tierChanges.filter((c) => !c.done_at).length;
  const openRedemptions = data.redemptions.filter((r) => r.status === "requested" || r.status === "approved").length;
  const programYear = Number((data.today >= program.program_start_date ? data.today : program.program_start_date).slice(0, 4));
  const lastRun = program.last_run_at ? new Date(program.last_run_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{program.name}</h1>
          <p className="text-muted-foreground">
            Points start counting {fmtDate(program.program_start_date)}.
            {lastRun ? ` Last calculated ${lastRun}.` : " Not calculated yet."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={recalculate} disabled={running}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Recalculate
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Members</CardDescription>
            <CardTitle className="text-2xl">{live.length.toLocaleString()}</CardTitle>
            <CardDescription>{active} activated</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Spendable points outstanding</CardDescription>
            <CardTitle className="text-2xl">{fmtPoints(available)}</CardTitle>
            <CardDescription>{fmtPoints(pending)} pending payment</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tier mix ({programYear})</CardDescription>
            <CardTitle className="text-base font-medium leading-7">
              {tiers.map((t) => `${t.name} ${live.filter((m) => m.current_tier_key === t.key).length}`).join(" · ")}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>To do</CardDescription>
            <CardTitle className="text-base font-medium leading-7">
              {openRedemptions} redemptions · {openChanges} tier changes
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="tiers">Tiers and earning</TabsTrigger>
          <TabsTrigger value="perks">Perks</TabsTrigger>
          <TabsTrigger value="catalog">Redemptions</TabsTrigger>
          <TabsTrigger value="changes">Tier changes{openChanges ? ` (${openChanges})` : ""}</TabsTrigger>
          <TabsTrigger value="preview">2026 preview</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTab entityId={entityId} members={members} tiers={tiers} programYear={programYear} />
        </TabsContent>
        <TabsContent value="tiers">
          <TiersTab key={`t${version}`} entityId={entityId} tiers={tiers} program={program} onChanged={load} />
        </TabsContent>
        <TabsContent value="perks">
          <PerksTab key={`p${version}`} entityId={entityId} tiers={tiers} perks={data.perks} tierPerks={data.tierPerks} onChanged={load} />
        </TabsContent>
        <TabsContent value="catalog">
          <CatalogTab key={`c${version}`} entityId={entityId} catalog={data.catalog} redemptions={data.redemptions} onChanged={load} />
        </TabsContent>
        <TabsContent value="changes">
          <TierChangesTab entityId={entityId} changes={data.tierChanges} tiers={tiers} onChanged={load} />
        </TabsContent>
        <TabsContent value="preview">
          <PreviewTab key={`v${version}`} entityId={entityId} members={members} tiers={tiers} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab key={`s${version}`} entityId={entityId} program={program} onChanged={load} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

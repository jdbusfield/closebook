"use client";

/**
 * Tiers and earn rates. Every number here is a setting: change it, save the
 * row, and the next recalculation re-earns every invoice at the new rates.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { rewardsCall } from "./api";
import type { RewardsProgram, RewardsTier } from "./types";

type Draft = {
  id?: string;
  key: string;
  name: string;
  min_annual_spend: string;
  points_per_dollar: string;
  weekend_points_per_dollar: string;
  bathroom_bonus_points: string;
  rollover_cap: string;
};

const toDraft = (t: RewardsTier): Draft => ({
  id: t.id,
  key: t.key,
  name: t.name,
  min_annual_spend: String(t.min_annual_spend ?? 0),
  points_per_dollar: String(t.points_per_dollar ?? 0),
  weekend_points_per_dollar: t.weekend_points_per_dollar == null ? "" : String(t.weekend_points_per_dollar),
  bathroom_bonus_points: t.bathroom_bonus_points == null ? "" : String(t.bathroom_bonus_points),
  rollover_cap: t.rollover_cap == null ? "" : String(t.rollover_cap),
});

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function TiersTab({
  entityId,
  tiers,
  program,
  onChanged,
}: {
  entityId: string;
  tiers: RewardsTier[];
  program: RewardsProgram;
  onChanged: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => tiers.map(toDraft));
  const [saving, setSaving] = useState<number | null>(null);

  const set = (i: number, field: keyof Draft, value: string) =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, [field]: value } : d)));

  const save = async (i: number) => {
    const d = drafts[i];
    if (!d.name.trim()) return toast.error("Give the tier a name");
    setSaving(i);
    try {
      const fields = {
        name: d.name.trim(),
        min_annual_spend: num(d.min_annual_spend) ?? 0,
        points_per_dollar: num(d.points_per_dollar) ?? 0,
        weekend_points_per_dollar: num(d.weekend_points_per_dollar),
        bathroom_bonus_points: num(d.bathroom_bonus_points),
        rollover_cap: num(d.rollover_cap),
        sort_order: i + 1,
        ...(d.id ? {} : { key: d.key.trim() || d.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") }),
      };
      await rewardsCall("upsert_tier", { entityId, tierId: d.id, fields });
      toast.success(`${d.name} saved. Recalculate to re-earn at the new rates.`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  };

  const remove = async (i: number) => {
    const d = drafts[i];
    if (!d.id) return setDrafts((prev) => prev.filter((_, j) => j !== i));
    if (!confirm(`Delete the ${d.name} tier? Members on it drop to the tier below at the next recalculation.`)) return;
    try {
      await rewardsCall("delete_tier", { entityId, tierId: d.id });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tiers and earn rates</CardTitle>
        <CardDescription>
          A tier is reached on eligible spend in a calendar year and lasts through the end of the next year.
          Points per $1 apply to eligible spend: rental lines, after discounts, before tax.
          {program.weekend_bonus_enabled
            ? " The weekend rate is on."
            : " The weekend rate is stored but switched off (Settings)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tier</TableHead>
              <TableHead className="text-right">Qualifies at ($ / year)</TableHead>
              <TableHead className="text-right">Points per $1</TableHead>
              <TableHead className="text-right">Weekend points per $1</TableHead>
              <TableHead className="text-right">Bathroom bonus (per trailer)</TableHead>
              <TableHead className="text-right">Roll-over cap</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts.map((d, i) => (
              <TableRow key={d.id ?? `new-${i}`}>
                <TableCell>
                  <Input value={d.name} onChange={(e) => set(i, "name", e.target.value)} className="h-8 w-36" />
                </TableCell>
                <TableCell>
                  <Input type="number" min={0} step={1000} value={d.min_annual_spend} onChange={(e) => set(i, "min_annual_spend", e.target.value)} className="ml-auto h-8 w-32 text-right" />
                </TableCell>
                <TableCell>
                  <Input type="number" min={0} step={0.05} value={d.points_per_dollar} onChange={(e) => set(i, "points_per_dollar", e.target.value)} className="ml-auto h-8 w-24 text-right" />
                </TableCell>
                <TableCell>
                  <Input type="number" min={0} step={0.05} placeholder="none" value={d.weekend_points_per_dollar} onChange={(e) => set(i, "weekend_points_per_dollar", e.target.value)} className="ml-auto h-8 w-24 text-right" />
                </TableCell>
                <TableCell>
                  <Input type="number" min={0} step={100} placeholder="none" value={d.bathroom_bonus_points} onChange={(e) => set(i, "bathroom_bonus_points", e.target.value)} className="ml-auto h-8 w-24 text-right" />
                </TableCell>
                <TableCell>
                  <Input type="number" min={0} step={1000} placeholder="none" value={d.rollover_cap} onChange={(e) => set(i, "rollover_cap", e.target.value)} className="ml-auto h-8 w-28 text-right" />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <Button size="sm" variant="outline" onClick={() => save(i)} disabled={saving === i}>
                    {saving === i ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(i)} className="ml-1">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setDrafts((prev) => [
                ...prev,
                { key: "", name: "", min_annual_spend: "", points_per_dollar: "1", weekend_points_per_dollar: "", bathroom_bonus_points: "", rollover_cap: "" },
              ])
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Add tier
          </Button>
          <p className="text-xs text-muted-foreground">
            Bathroom bonus needs bathroom I-codes in Settings. Roll-over cap is stored, not yet applied.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

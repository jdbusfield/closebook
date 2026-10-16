"use client";

/**
 * Perk allocation: every perk (rows) by tier (columns). Each cell is switched
 * off until the perk is decided; the workbook's idea shows underneath as a
 * hint. Saving a cell takes effect immediately on member pages.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { rewardsCall } from "./api";
import type { PerkCategory, PerkValueKind, RewardsPerk, RewardsTier, RewardsTierPerk } from "./types";

const CATEGORY_LABEL: Record<PerkCategory, string> = {
  rental: "Rental perks",
  other: "Other",
  partner: "Partner perks",
  pa: "PA rewards",
};
const KIND_LABEL: Record<PerkValueKind, string> = {
  included: "Yes / no",
  percent: "Percent",
  allowance: "Uses per period",
  text: "Text",
};
const PERIODS = ["order", "week", "month", "quarter", "year"] as const;

function PerkCell({
  entityId,
  perk,
  tierPerk,
  tierId,
  onSaved,
}: {
  entityId: string;
  perk: RewardsPerk;
  tierPerk: RewardsTierPerk | undefined;
  tierId: string;
  onSaved: (tp: Partial<RewardsTierPerk>) => void;
}) {
  const [num, setNum] = useState(tierPerk?.value_number == null ? "" : String(tierPerk.value_number));
  const [text, setText] = useState(tierPerk?.value_text ?? "");
  const [allowance, setAllowance] = useState(tierPerk?.allowance == null ? "" : String(tierPerk.allowance));
  const enabled = tierPerk?.enabled ?? false;

  const save = async (fields: Partial<RewardsTierPerk>) => {
    try {
      await rewardsCall("set_tier_perk", { entityId, tierId, perkId: perk.id, fields });
      onSaved(fields);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={(v) => save({ enabled: v })} />
        {perk.value_kind === "percent" && (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              step={1}
              value={num}
              onChange={(e) => setNum(e.target.value)}
              onBlur={() => save({ value_number: num === "" ? null : Number(num) })}
              className="h-7 w-16 text-right"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        )}
        {perk.value_kind === "allowance" && (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              step={1}
              value={allowance}
              onChange={(e) => setAllowance(e.target.value)}
              onBlur={() => save({ allowance: allowance === "" ? null : Math.trunc(Number(allowance)) })}
              className="h-7 w-14 text-right"
            />
            <Select value={tierPerk?.allowance_period ?? ""} onValueChange={(v) => save({ allowance_period: v })}>
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue placeholder="per..." />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p} value={p}>
                    per {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {perk.value_kind === "text" && (
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => save({ value_text: text || null })}
            className="h-7 w-32"
          />
        )}
      </div>
      {tierPerk?.proposed_value && <p className="text-xs text-muted-foreground">Workbook: {tierPerk.proposed_value}</p>}
    </div>
  );
}

export function PerksTab({
  entityId,
  tiers,
  perks,
  tierPerks,
  onChanged,
}: {
  entityId: string;
  tiers: RewardsTier[];
  perks: RewardsPerk[];
  tierPerks: RewardsTierPerk[];
  onChanged: () => void;
}) {
  const [cells, setCells] = useState(tierPerks);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", category: "rental" as PerkCategory, value_kind: "included" as PerkValueKind, description: "" });

  const cellFor = (tierId: string, perkId: string) => cells.find((c) => c.tier_id === tierId && c.perk_id === perkId);
  const patchCell = (tierId: string, perkId: string, fields: Partial<RewardsTierPerk>) =>
    setCells((prev) => {
      const i = prev.findIndex((c) => c.tier_id === tierId && c.perk_id === perkId);
      if (i < 0) return [...prev, { id: "", tier_id: tierId, perk_id: perkId, enabled: false, value_number: null, value_text: null, allowance: null, allowance_period: null, proposed_value: null, ...fields }];
      return prev.map((c, j) => (j === i ? { ...c, ...fields } : c));
    });

  const addPerk = async () => {
    if (!form.name.trim()) return toast.error("Give the perk a name");
    try {
      await rewardsCall("upsert_perk", { entityId, fields: { ...form, name: form.name.trim(), sort_order: perks.length + 1 } });
      setAdding(false);
      setForm({ name: "", category: "rental", value_kind: "included", description: "" });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add failed");
    }
  };

  const toggleActive = async (perk: RewardsPerk) => {
    try {
      await rewardsCall("upsert_perk", { entityId, perkId: perk.id, fields: { is_active: !perk.is_active } });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const enabledCount = cells.filter((c) => c.enabled).length;
  const categories = (Object.keys(CATEGORY_LABEL) as PerkCategory[]).filter((c) => perks.some((p) => p.category === c));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Perks by tier</CardTitle>
          <CardDescription>
            Every perk starts switched off. Turn one on for a tier, and set its value, once it is decided.
            {enabledCount === 0 ? " No perks are on yet." : ` ${enabledCount} switched on.`}
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add perk
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-64">Perk</TableHead>
              {tiers.map((t) => (
                <TableHead key={t.id}>{t.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((cat) => [
              <TableRow key={`h-${cat}`} className="bg-muted/40 hover:bg-muted/40">
                <TableCell colSpan={tiers.length + 1} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABEL[cat]}
                </TableCell>
              </TableRow>,
              ...perks
                .filter((p) => p.category === cat)
                .map((p) => (
                  <TableRow key={p.id} className={p.is_active ? "" : "opacity-50"}>
                    <TableCell className="align-top">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {KIND_LABEL[p.value_kind]}
                        {p.description ? ` · ${p.description}` : ""}
                      </div>
                      <button className="mt-1 text-xs text-muted-foreground underline" onClick={() => toggleActive(p)}>
                        {p.is_active ? "Retire perk" : "Bring back"}
                      </button>
                    </TableCell>
                    {tiers.map((t) => (
                      <TableCell key={t.id} className="align-top">
                        <PerkCell
                          entityId={entityId}
                          perk={p}
                          tierId={t.id}
                          tierPerk={cellFor(t.id, p.id)}
                          onSaved={(fields) => patchCell(t.id, p.id, fields)}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                )),
            ])}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a perk</DialogTitle>
            <DialogDescription>It is added to every tier, switched off.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Group</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as PerkCategory })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CATEGORY_LABEL) as PerkCategory[]).map((c) => (
                      <SelectItem key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Value</Label>
                <Select value={form.value_kind} onValueChange={(v) => setForm({ ...form, value_kind: v as PerkValueKind })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KIND_LABEL) as PerkValueKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button onClick={addPerk}>Add perk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

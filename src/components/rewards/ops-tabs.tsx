"use client";

/**
 * Smaller Rewards tabs: catalog + redemptions, tier-change tasks, the
 * internal 2026 preview and program settings.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, Loader2, Plus, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, fmtMoney, fmtPoints, rewardsCall } from "./api";
import type { CatalogItem, Redemption, RewardsMember, RewardsProgram, RewardsTier, TierChange } from "./types";

// ── Catalog and redemptions ─────────────────────────────────────────────

const KIND_LABEL: Record<CatalogItem["kind"], string> = {
  swag: "Swag",
  gift_card: "Gift card",
  order_credit: "Order credit",
  other: "Other",
};

function CatalogRow({ entityId, item, onSaved }: { entityId: string; item: CatalogItem | null; onSaved: () => void }) {
  const [d, setD] = useState({
    name: item?.name ?? "",
    points_cost: item ? String(item.points_cost) : "",
    kind: item?.kind ?? "swag",
    cash_value: item?.cash_value == null ? "" : String(item.cash_value),
    cost_to_company: item?.cost_to_company == null ? "" : String(item.cost_to_company),
    is_active: item?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await rewardsCall("upsert_catalog_item", {
        entityId,
        itemId: item?.id,
        fields: {
          name: d.name.trim(),
          points_cost: Math.trunc(Number(d.points_cost)),
          kind: d.kind,
          cash_value: d.cash_value === "" ? null : Number(d.cash_value),
          cost_to_company: d.cost_to_company === "" ? null : Number(d.cost_to_company),
          is_active: d.is_active,
        },
      });
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <TableRow className={d.is_active ? "" : "opacity-50"}>
      <TableCell>
        <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className="h-8" placeholder="New item" />
      </TableCell>
      <TableCell>
        <Input type="number" min={1} value={d.points_cost} onChange={(e) => setD({ ...d, points_cost: e.target.value })} className="ml-auto h-8 w-28 text-right" />
      </TableCell>
      <TableCell>
        <Select value={d.kind} onValueChange={(v) => setD({ ...d, kind: v as CatalogItem["kind"] })}>
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABEL) as CatalogItem["kind"][]).map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input type="number" min={0} value={d.cash_value} onChange={(e) => setD({ ...d, cash_value: e.target.value })} className="ml-auto h-8 w-24 text-right" />
      </TableCell>
      <TableCell>
        <Input type="number" min={0} value={d.cost_to_company} onChange={(e) => setD({ ...d, cost_to_company: e.target.value })} className="ml-auto h-8 w-24 text-right" />
      </TableCell>
      <TableCell>
        <Switch checked={d.is_active} onCheckedChange={(v) => setD({ ...d, is_active: v })} />
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="outline" onClick={save} disabled={saving || !d.name.trim() || !d.points_cost}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </Button>
      </TableCell>
    </TableRow>
  );
}

const RED_BADGE: Record<Redemption["status"], "default" | "secondary" | "destructive" | "outline"> = {
  requested: "secondary",
  approved: "outline",
  fulfilled: "default",
  cancelled: "destructive",
};

export function RedemptionActions({ entityId, r, onChanged }: { entityId: string; r: Redemption; onChanged: () => void }) {
  const move = async (status: string) => {
    if (status === "cancelled" && !confirm(`Cancel "${r.description}" and give back ${fmtPoints(r.points)} points?`)) return;
    try {
      await rewardsCall("update_redemption", { entityId, redemptionId: r.id, status });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };
  if (r.status === "cancelled" || r.status === "fulfilled") return null;
  return (
    <div className="flex justify-end gap-1">
      {r.status === "requested" && (
        <Button size="sm" variant="outline" onClick={() => move("approved")}>
          Approve
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => move("fulfilled")}>
        Fulfilled
      </Button>
      <Button size="sm" variant="ghost" onClick={() => move("cancelled")}>
        Cancel
      </Button>
    </div>
  );
}

export function CatalogTab({
  entityId,
  catalog,
  redemptions,
  onChanged,
}: {
  entityId: string;
  catalog: CatalogItem[];
  redemptions: Redemption[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Redemptions</CardTitle>
          <CardDescription>Requested on a member&apos;s page. Points come off when requested and go back if cancelled.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="text-right">Cost to us</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {redemptions.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{fmtDate(r.requested_at)}</TableCell>
                  <TableCell>
                    <Link href={`/${entityId}/rewards/${r.member_id}`} className="hover:underline">
                      {r.rewards_members?.name}
                    </Link>
                  </TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell className="text-right">{fmtPoints(r.points)}</TableCell>
                  <TableCell className="text-right">{r.cost_to_company == null ? "" : fmtMoney(r.cost_to_company)}</TableCell>
                  <TableCell>
                    <Badge variant={RED_BADGE[r.status]}>{r.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <RedemptionActions entityId={entityId} r={r} onChanged={onChanged} />
                  </TableCell>
                </TableRow>
              ))}
              {redemptions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    No redemptions yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Redemption catalog</CardTitle>
            <CardDescription>From the workbook. Add cost to us so redemptions report their real cost.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add item
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Face value ($)</TableHead>
                <TableHead className="text-right">Cost to us ($)</TableHead>
                <TableHead>Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalog.map((c) => (
                <CatalogRow key={c.id} entityId={entityId} item={c} onSaved={onChanged} />
              ))}
              {adding && (
                <CatalogRow
                  entityId={entityId}
                  item={null}
                  onSaved={() => {
                    setAdding(false);
                    onChanged();
                  }}
                />
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tier changes ────────────────────────────────────────────────────────

export function TierChangesTab({
  entityId,
  changes,
  tiers,
  onChanged,
}: {
  entityId: string;
  changes: TierChange[];
  tiers: RewardsTier[];
  onChanged: () => void;
}) {
  const tierName = new Map(tiers.map((t) => [t.key, t.name]));
  const mark = async (c: TierChange, undo: boolean) => {
    try {
      await rewardsCall("complete_tier_change", { entityId, changeId: c.id, undo });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };
  const open = changes.filter((c) => !c.done_at);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tier changes</CardTitle>
        <CardDescription>
          Closebook can&apos;t change RentalWorks. When a member moves tier, update their discount and notes in RentalWorks, then mark it done.
          {open.length ? ` ${open.length} to do.` : " Nothing to do."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Why</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {changes.map((c) => (
              <TableRow key={c.id} className={c.done_at ? "text-muted-foreground" : ""}>
                <TableCell>{fmtDate(c.effective_on)}</TableCell>
                <TableCell>
                  <Link href={`/${entityId}/rewards/${c.member_id}`} className="hover:underline">
                    {c.rewards_members?.name}
                  </Link>
                </TableCell>
                <TableCell>
                  {tierName.get(c.from_tier_key ?? "") ?? "None"} to {tierName.get(c.to_tier_key ?? "") ?? "None"}
                </TableCell>
                <TableCell>{c.reason}</TableCell>
                <TableCell className="text-right">
                  {c.done_at ? (
                    <Button size="sm" variant="ghost" onClick={() => mark(c, true)}>
                      <Undo2 className="mr-1 h-4 w-4" />
                      Done {fmtDate(c.done_at)}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => mark(c, false)}>
                      <Check className="mr-1 h-4 w-4" />
                      Updated in RW
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {changes.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  Tier changes start with the live program.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── 2026 preview (internal) ─────────────────────────────────────────────

export function PreviewTab({ entityId, members, tiers }: { entityId: string; members: RewardsMember[]; tiers: RewardsTier[] }) {
  const [months, setMonths] = useState<{ month: string; spend: number; points: number }[] | null>(null);
  useEffect(() => {
    rewardsCall<{ months: { month: string; spend: number; points: number }[] }>("preview_report", { entityId })
      .then((d) => setMonths(d.months))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Load failed"));
  }, [entityId]);

  const withSpend = members.filter((m) => m.preview_spend > 0).sort((a, b) => b.preview_spend - a.preview_spend);
  const mix = tiers.map((t) => ({ tier: t, count: withSpend.filter((m) => m.preview_tier_key === t.key).length }));
  const totalSpend = withSpend.reduce((s, m) => s + m.preview_spend, 0);
  const totalPoints = withSpend.reduce((s, m) => s + m.preview_points, 0);

  return (
    <div className="space-y-6">
      <Card className="border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
        <CardContent className="pt-6 text-sm">
          Internal only. This is what 2026 invoices would have earned under today&apos;s rules. These points are never
          spendable, never shown to customers, and don&apos;t set anyone&apos;s 2027 tier.
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Eligible spend</CardDescription>
            <CardTitle className="text-2xl">{fmtMoney(totalSpend)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Points that would have been earned</CardDescription>
            <CardTitle className="text-2xl">{fmtPoints(totalPoints)}</CardTitle>
          </CardHeader>
        </Card>
        {mix.slice(1).map(({ tier, count }) => (
          <Card key={tier.key}>
            <CardHeader className="pb-2">
              <CardDescription>Would have reached {tier.name}</CardDescription>
              <CardTitle className="text-2xl">{count}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>By member</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Tier reached</TableHead>
                  <TableHead className="text-right">Eligible spend</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withSpend.slice(0, 100).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Link href={`/${entityId}/rewards/${m.id}`} className="hover:underline">
                        {m.name}
                      </Link>
                    </TableCell>
                    <TableCell>{tiers.find((t) => t.key === m.preview_tier_key)?.name}</TableCell>
                    <TableCell className="text-right">{fmtMoney(m.preview_spend)}</TableCell>
                    <TableCell className="text-right">{fmtPoints(m.preview_points)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {withSpend.length > 100 && <p className="pt-2 text-xs text-muted-foreground">Top 100 of {withSpend.length}.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By month</CardTitle>
          </CardHeader>
          <CardContent>
            {months === null ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {months.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell>{m.month}</TableCell>
                      <TableCell className="text-right">{fmtMoney(m.spend)}</TableCell>
                      <TableCell className="text-right">{fmtPoints(m.points)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Program settings ─────────────────────────────────────────────────────

const list = (a: string[] | null | undefined) => (a ?? []).join(", ");
const parseList = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

export function SettingsTab({ entityId, program, onChanged }: { entityId: string; program: RewardsProgram; onChanged: () => void }) {
  const [d, setD] = useState({
    program_start_date: program.program_start_date,
    preview_start_date: program.preview_start_date ?? "",
    invoice_prefixes: list(program.invoice_prefixes),
    counted_statuses: list(program.counted_statuses),
    paid_statuses: list(program.paid_statuses),
    eligible_rec_types: list(program.eligible_rec_types),
    excluded_icodes: list(program.excluded_icodes),
    bathroom_icodes: list(program.bathroom_icodes),
    use_rebate_exclusions: program.use_rebate_exclusions,
    weekend_bonus_enabled: program.weekend_bonus_enabled,
    auto_enroll: program.auto_enroll,
    statements_enabled: program.statements_enabled,
    points_expire_months: String(program.points_expire_months),
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await rewardsCall("update_program", {
        entityId,
        fields: {
          program_start_date: d.program_start_date,
          preview_start_date: d.preview_start_date || null,
          invoice_prefixes: parseList(d.invoice_prefixes),
          counted_statuses: parseList(d.counted_statuses),
          paid_statuses: parseList(d.paid_statuses),
          eligible_rec_types: parseList(d.eligible_rec_types),
          excluded_icodes: parseList(d.excluded_icodes),
          bathroom_icodes: parseList(d.bathroom_icodes),
          use_rebate_exclusions: d.use_rebate_exclusions,
          weekend_bonus_enabled: d.weekend_bonus_enabled,
          auto_enroll: d.auto_enroll,
          statements_enabled: d.statements_enabled,
          points_expire_months: Math.trunc(Number(d.points_expire_months)),
        },
      });
      toast.success("Settings saved. Recalculate to apply them.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof d, label: string, hint: string, type = "text") => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type={type} value={String(d[key])} onChange={(e) => setD({ ...d, [key]: e.target.value })} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  const toggle = (key: "use_rebate_exclusions" | "weekend_bonus_enabled" | "auto_enroll" | "statements_enabled", label: string, hint: string) => (
    <div className="flex items-start gap-3">
      <Switch checked={d[key]} onCheckedChange={(v) => setD({ ...d, [key]: v })} />
      <div>
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Program settings</CardTitle>
        <CardDescription>What counts, when points become spendable, and when they expire.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {field("program_start_date", "Program start", "Points that count start on this date.", "date")}
          {field("preview_start_date", "Preview from", "Earlier invoices back to this date show internally only. Blank = no preview.", "date")}
          {field("points_expire_months", "Points expire after (months)", "Counted from the invoice date.", "number")}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {field("invoice_prefixes", "Invoice number prefixes", "Which invoices are Versatile's. V = Versatile.")}
          {field("counted_statuses", "Invoice statuses that earn", "VOID never counts.")}
          {field("paid_statuses", "Statuses that make points spendable", "Until then points show as pending.")}
          {field("eligible_rec_types", "Line types that earn", "R = rental. S sales, M misc, F, L.")}
          {field("excluded_icodes", "Excluded I-codes", "Comma separated. Lines with these codes earn nothing.")}
          {field("bathroom_icodes", "Bathroom trailer I-codes", "Blank = no bathroom bonus.")}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {toggle("use_rebate_exclusions", "Use the rebate tracker's exclusions", "Its global excluded I-codes also earn nothing here.")}
          {toggle("weekend_bonus_enabled", "Weekend rate", "Orders billed over a Saturday or Sunday earn the tier's weekend rate on the whole order.")}
          {toggle("auto_enroll", "Enroll customers automatically", "Every Versatile customer with a counted invoice becomes a member.")}
          {toggle("statements_enabled", "Statement emails", "On the 5th, active members' contacts get last month's statement. Off until you switch it on; never before launch.")}
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save settings
        </Button>
      </CardContent>
    </Card>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Link2, Loader2, Plus, Search, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { STATUS_LABEL, fmtDate, fmtMoney, fmtPoints, rewardsCall } from "@/components/rewards/api";
import { RedemptionActions } from "@/components/rewards/ops-tabs";
import type { CatalogItem, LedgerRow, Redemption, RewardsMember, RewardsPerk, RewardsTierPerk, TierChange } from "@/components/rewards/types";

interface MemberPerk extends RewardsTierPerk {
  rewards_perks: RewardsPerk;
  state: { allowance: number; used: number; remaining: number; periodStart: string | null } | null;
}

interface MemberDetail {
  member: RewardsMember;
  tiers: { key: string; name: string; min_annual_spend: number }[];
  catalog: CatalogItem[];
  customers: { id: string; rw_customer_id: string; customer_name: string | null; customer_number: string | null }[];
  contacts: { id: string; name: string | null; email: string; title: string | null }[];
  ledger: LedgerRow[];
  perkUses: { id: string; perk_id: string; used_on: string; quantity: number; order_number: string | null; note: string | null }[];
  redemptions: Redemption[];
  tierChanges: TierChange[];
  perks: MemberPerk[];
  today: string;
}

interface CustomerHit {
  rwCustomerId: string;
  customerName: string;
  revenue: number;
  invoices: number;
  lastInvoice: string | null;
  memberId: string | null;
  memberName: string | null;
}

const ENTRY_LABEL: Record<LedgerRow["entry_type"], string> = {
  earn: "Earned",
  adjustment: "Adjustment",
  redeem: "Redeemed",
  redeem_reversal: "Redemption cancelled",
  redeem_refund: "Points back",
};

function perkValue(p: MemberPerk): string {
  const kind = p.rewards_perks.value_kind;
  if (kind === "percent") return p.value_number == null ? "" : `${p.value_number}%`;
  if (kind === "text") return p.value_text ?? "";
  if (kind === "allowance") return p.allowance == null ? "" : `${p.allowance} per ${p.allowance_period ?? "period"}`;
  return "Included";
}

export default function RewardsMemberPage() {
  const { entityId, memberId } = useParams<{ entityId: string; memberId: string }>();
  const [d, setD] = useState<MemberDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [dialog, setDialog] = useState<null | "link" | "redeem" | "adjust" | "perk" | "contact" | "rename">(null);

  const load = useCallback(async () => {
    try {
      setD(await rewardsCall<MemberDetail>("get_member", { memberId }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    }
  }, [memberId]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: string, payload: Record<string, unknown>, done?: string) => {
    setBusy(true);
    try {
      await rewardsCall(action, { memberId, ...payload });
      if (done) toast.success(done);
      setDialog(null);
      await load();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!d) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading member
      </div>
    );
  }

  const { member } = d;
  const tierName = (k: string | null) => d.tiers.find((t) => t.key === k)?.name ?? "";
  const ledger = d.ledger.filter((r) => showPreview || !r.is_preview);
  const perkName = (id: string) => d.perks.find((p) => p.perk_id === id)?.rewards_perks.name ?? "Perk";

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/${entityId}/rewards`} className="mb-1 inline-flex items-center text-sm text-muted-foreground hover:underline">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Rewards
          </Link>
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            {member.name}
            <Badge variant={member.status === "active" ? "default" : member.status === "opted_out" ? "destructive" : "secondary"}>
              {STATUS_LABEL[member.status]}
            </Badge>
          </h1>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setDialog("rename")}>
            Rename
          </Button>
          {member.status !== "active" && (
            <Button size="sm" onClick={() => act("update_member", { status: "active" }, "Activated")} disabled={busy}>
              Activate
            </Button>
          )}
          {member.status !== "opted_out" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => confirm(`Leave ${member.name} out of the program? They stop earning.`) && act("update_member", { status: "opted_out" }, "Opted out")}
              disabled={busy}
            >
              Opt out
            </Button>
          )}
          {member.status !== "shadow" && (
            <Button size="sm" variant="ghost" onClick={() => act("update_member", { status: "shadow" }, "Set to not activated")} disabled={busy}>
              Set to not activated
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tier</CardDescription>
            <CardTitle className="text-2xl">{tierName(member.current_tier_key)}</CardTitle>
            <CardDescription>
              {member.tier_expires_on ? `Through ${fmtDate(member.tier_expires_on)}. ` : ""}
              {fmtMoney(member.qualifying_spend)} eligible spend in {member.qualifying_year}.
              {member.next_tier_key ? ` ${fmtMoney(member.spend_to_next_tier)} more reaches ${tierName(member.next_tier_key)}.` : ""}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Spendable points</CardDescription>
            <CardTitle className="text-2xl">{fmtPoints(member.points_available)}</CardTitle>
            <CardDescription>
              {fmtPoints(member.points_pending)} pending payment · {fmtPoints(member.points_expiring_soon)} expiring within 60 days ·{" "}
              {fmtPoints(member.points_lifetime)} earned to date
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>2026 preview (internal only)</CardDescription>
            <CardTitle className="text-2xl">{fmtPoints(member.preview_points)} points</CardTitle>
            <CardDescription>
              {fmtMoney(member.preview_spend)} eligible spend{member.preview_tier_key ? `, would have reached ${tierName(member.preview_tier_key)}` : ""}.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Perks</CardTitle>
              <CardDescription>What {tierName(member.current_tier_key)} gets today. Log each use of a limited perk.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setDialog("perk")} disabled={d.perks.length === 0}>
              <Plus className="mr-2 h-4 w-4" />
              Log a use
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {d.perks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No perks are switched on for this tier yet.</p>
            ) : (
              <Table>
                <TableBody>
                  {d.perks.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.rewards_perks.name}</TableCell>
                      <TableCell>{perkValue(p)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {p.state && p.state.periodStart ? `${p.state.remaining} of ${p.state.allowance} left` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {d.perkUses.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Used</TableHead>
                    <TableHead>Perk</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.perkUses.slice(0, 20).map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{fmtDate(u.used_on)}</TableCell>
                      <TableCell>
                        {perkName(u.perk_id)}
                        {u.quantity > 1 ? ` ×${u.quantity}` : ""}
                        {u.note ? <span className="text-muted-foreground"> · {u.note}</span> : null}
                      </TableCell>
                      <TableCell>{u.order_number}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => act("delete_perk_use", { useId: u.id })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Redemptions</CardTitle>
              <CardDescription>{member.status === "active" ? "Points come off when requested." : "Activate the member to redeem."}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setDialog("adjust")}>
                Adjust points
              </Button>
              <Button size="sm" onClick={() => setDialog("redeem")} disabled={member.status !== "active"}>
                Redeem
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {d.redemptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No redemptions yet.</p>
            ) : (
              <Table>
                <TableBody>
                  {d.redemptions.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{fmtDate(r.requested_at)}</TableCell>
                      <TableCell>{r.description}</TableCell>
                      <TableCell className="text-right">{fmtPoints(r.points)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <RedemptionActions entityId={entityId} r={r} onChanged={load} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>RentalWorks accounts</CardTitle>
              <CardDescription>Invoices from every linked account earn points for this member.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setDialog("link")}>
              <Link2 className="mr-2 h-4 w-4" />
              Link account
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {d.customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.customer_name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.customer_number}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          confirm(`Unlink ${c.customer_name}? It becomes its own member and takes its points with it.`) &&
                          act("unlink_customer", { rwCustomerId: c.rw_customer_id }, "Unlinked")
                        }
                      >
                        <Unlink className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {d.customers.length === 0 && (
                  <TableRow>
                    <TableCell className="text-muted-foreground">No RentalWorks account linked.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Contacts</CardTitle>
              <CardDescription>Who gets statements. A member needs one to be activated.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setDialog("contact")}>
              <Plus className="mr-2 h-4 w-4" />
              Add contact
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {d.contacts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.email}</TableCell>
                    <TableCell className="text-muted-foreground">{c.title}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => act("delete_contact", { contactId: c.id })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {d.contacts.length === 0 && (
                  <TableRow>
                    <TableCell className="text-muted-foreground">No contacts yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Points ledger</CardTitle>
            <CardDescription>Every point earned, spent or adjusted, newest first.</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch checked={showPreview} onCheckedChange={setShowPreview} />
            Show 2026 preview
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead className="text-right">Eligible spend</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.slice(0, 300).map((r) => (
                <TableRow key={r.id} className={r.is_preview ? "text-muted-foreground" : ""}>
                  <TableCell>{fmtDate(r.earned_on)}</TableCell>
                  <TableCell>
                    {ENTRY_LABEL[r.entry_type]}
                    {r.reason ? <span className="text-muted-foreground"> · {r.reason}</span> : null}
                  </TableCell>
                  <TableCell>{r.invoice_number}</TableCell>
                  <TableCell className="text-right">{r.entry_type === "earn" ? fmtMoney(r.eligible_spend) : ""}</TableCell>
                  <TableCell className="text-right">
                    {r.points_per_dollar != null ? `${Number(r.points_per_dollar)}x ${tierName(r.tier_key)}${r.weekend_applied ? " weekend" : ""}` : ""}
                  </TableCell>
                  <TableCell className={`text-right ${r.points < 0 ? "text-red-600" : ""}`}>{fmtPoints(r.points)}</TableCell>
                  <TableCell>{r.is_preview ? "Preview" : r.is_available ? "Spendable" : "Pending payment"}</TableCell>
                  <TableCell>{r.points > 0 ? fmtDate(r.expires_on) : ""}</TableCell>
                </TableRow>
              ))}
              {ledger.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                    No points yet{showPreview ? "" : ". Turn on the 2026 preview to see what last year would have earned"}.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <LinkDialog open={dialog === "link"} onClose={() => setDialog(null)} entityId={entityId} memberId={memberId} busy={busy} onLink={(c) => act("link_customer", { rwCustomerId: c.rwCustomerId, customerName: c.customerName }, `Linked ${c.customerName}`)} />
      <RedeemDialog open={dialog === "redeem"} onClose={() => setDialog(null)} catalog={d.catalog} available={member.points_available} busy={busy} onRedeem={(p) => act("request_redemption", p, "Redemption requested")} />
      <AdjustDialog open={dialog === "adjust"} onClose={() => setDialog(null)} busy={busy} onSave={(p) => act("add_adjustment", p, "Adjustment added")} />
      <PerkUseDialog open={dialog === "perk"} onClose={() => setDialog(null)} perks={d.perks} today={d.today} busy={busy} onSave={(p) => act("log_perk_use", p, "Logged")} />
      <ContactDialog open={dialog === "contact"} onClose={() => setDialog(null)} busy={busy} onSave={(p) => act("add_contact", p, "Contact added")} />
      <RenameDialog open={dialog === "rename"} onClose={() => setDialog(null)} name={member.name} busy={busy} onSave={(name) => act("update_member", { name }, "Renamed")} />
    </div>
  );
}

// ── Dialogs ───────────────────────────────────────────────────────────────

function LinkDialog({
  open,
  onClose,
  entityId,
  memberId,
  busy,
  onLink,
}: {
  open: boolean;
  onClose: () => void;
  entityId: string;
  memberId: string;
  busy: boolean;
  onLink: (c: CustomerHit) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { customers } = await rewardsCall<{ customers: CustomerHit[] }>("search_customers", { entityId, query: q });
        if (mine === seq.current) setHits(customers);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, entityId]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link a RentalWorks account</DialogTitle>
          <DialogDescription>Moving an account here moves the points it earned too.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input autoFocus placeholder="Customer name" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {searching && <Loader2 className="m-2 h-4 w-4 animate-spin" />}
          <Table>
            <TableBody>
              {hits.map((h) => (
                <TableRow key={h.rwCustomerId}>
                  <TableCell>
                    <div className="font-medium">{h.customerName}</div>
                    <div className="text-xs text-muted-foreground">
                      {h.memberId === memberId ? "Already linked here" : h.memberName ? `Now under ${h.memberName}` : "Not linked"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {fmtMoney(h.revenue)}
                    <div className="text-xs text-muted-foreground">
                      {h.invoices} invoices{h.lastInvoice ? `, last ${fmtDate(h.lastInvoice)}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" disabled={busy || h.memberId === memberId} onClick={() => onLink(h)}>
                      Link
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RedeemDialog({
  open,
  onClose,
  catalog,
  available,
  busy,
  onRedeem,
}: {
  open: boolean;
  onClose: () => void;
  catalog: CatalogItem[];
  available: number;
  busy: boolean;
  onRedeem: (p: Record<string, unknown>) => void;
}) {
  const [itemId, setItemId] = useState("");
  const [custom, setCustom] = useState({ description: "", points: "" });
  const [note, setNote] = useState("");
  const item = catalog.find((c) => c.id === itemId);
  const cost = item ? item.points_cost : Math.trunc(Number(custom.points) || 0);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redeem points</DialogTitle>
          <DialogDescription>{fmtPoints(available)} points spendable.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Catalog item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick an item, or leave blank for a custom redemption" />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={c.points_cost > available}>
                    {c.name} · {fmtPoints(c.points_cost)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!item && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1">
                <Label>Custom description</Label>
                <Input value={custom.description} onChange={(e) => setCustom({ ...custom, description: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Points</Label>
                <Input type="number" min={1} value={custom.points} onChange={(e) => setCustom({ ...custom, points: e.target.value })} />
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || cost <= 0 || cost > available}
            onClick={() => onRedeem(item ? { catalogItemId: item.id, note } : { description: custom.description, points: cost, note })}
          >
            Redeem {cost > 0 ? fmtPoints(cost) : ""} points
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ open, onClose, busy, onSave }: { open: boolean; onClose: () => void; busy: boolean; onSave: (p: Record<string, unknown>) => void }) {
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust points</DialogTitle>
          <DialogDescription>Positive adds points (they expire like earned points); negative takes them away.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label>Points</Label>
            <Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !Number(points) || !reason.trim()} onClick={() => onSave({ points: Number(points), reason })}>
            Save adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PerkUseDialog({
  open,
  onClose,
  perks,
  today,
  busy,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  perks: MemberPerk[];
  today: string;
  busy: boolean;
  onSave: (p: Record<string, unknown>) => void;
}) {
  const [perkId, setPerkId] = useState("");
  const [usedOn, setUsedOn] = useState(today);
  const [orderNumber, setOrderNumber] = useState("");
  const [note, setNote] = useState("");
  const picked = perks.find((p) => p.perk_id === perkId);
  const out = picked?.state && picked.state.periodStart && picked.state.remaining <= 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a perk use</DialogTitle>
          <DialogDescription>Counts against the member&apos;s allowance for the period.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={perkId} onValueChange={setPerkId}>
            <SelectTrigger>
              <SelectValue placeholder="Perk" />
            </SelectTrigger>
            <SelectContent>
              {perks.map((p) => (
                <SelectItem key={p.perk_id} value={p.perk_id}>
                  {p.rewards_perks.name}
                  {p.state?.periodStart ? ` (${p.state.remaining} left)` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {out && <p className="text-sm text-amber-600">This member has used this period&apos;s allowance. Logging it records an extra use.</p>}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={usedOn} onChange={(e) => setUsedOn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>RW order number</Label>
              <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !perkId} onClick={() => onSave({ perkId, usedOn, orderNumber, note })}>
            Log use
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({ open, onClose, busy, onSave }: { open: boolean; onClose: () => void; busy: boolean; onSave: (p: Record<string, unknown>) => void }) {
  const [c, setC] = useState({ name: "", email: "", title: "" });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Email</Label>
            <Input type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Title</Label>
              <Input placeholder="Producer, PM, coordinator" value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !c.email.trim()} onClick={() => onSave(c)}>
            Add contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ open, onClose, name, busy, onSave }: { open: boolean; onClose: () => void; name: string; busy: boolean; onSave: (name: string) => void }) {
  const [v, setV] = useState(name);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename member</DialogTitle>
          <DialogDescription>The company name on statements. RentalWorks names don&apos;t change.</DialogDescription>
        </DialogHeader>
        <Input value={v} onChange={(e) => setV(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !v.trim()} onClick={() => onSave(v.trim())}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

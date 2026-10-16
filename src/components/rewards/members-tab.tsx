"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { STATUS_LABEL, fmtMoney, fmtPoints, rewardsCall } from "./api";
import type { RewardsMember, RewardsTier } from "./types";

const PAGE_SIZE = 50;

export function MembersTab({
  entityId,
  members,
  tiers,
  programYear,
}: {
  entityId: string;
  members: RewardsMember[];
  tiers: RewardsTier[];
  programYear: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [tier, setTier] = useState("all");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const tierName = useMemo(() => new Map(tiers.map((t) => [t.key, t.name])), [tiers]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => status === "all" || m.status === status)
      .filter((m) => tier === "all" || m.current_tier_key === tier)
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          (m.rewards_member_customers ?? []).some((c) => (c.customer_name ?? "").toLowerCase().includes(q) || (c.customer_number ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => b.qualifying_spend - a.qualifying_spend || b.preview_spend - a.preview_spend || a.name.localeCompare(b.name));
  }, [members, query, status, tier]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const { id } = await rewardsCall<{ id: string }>("create_member", { entityId, name: newName.trim() });
      router.push(`/${entityId}/rewards/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search members or RW customers"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              className="h-9 w-72 pl-8"
            />
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="shadow">Not activated</SelectItem>
              <SelectItem value="opted_out">Opted out</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tier} onValueChange={(v) => { setTier(v); setPage(0); }}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              {tiers.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{rows.length.toLocaleString()} members</span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAdding(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add member
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead className="text-right">{programYear} spend</TableHead>
              <TableHead className="text-right">To next tier</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead className="text-right">Expiring (60 days)</TableHead>
              <TableHead className="text-right">2026 preview spend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <Link href={`/${entityId}/rewards/${m.id}`} className="font-medium hover:underline">
                    {m.name}
                  </Link>
                  {(m.rewards_member_customers?.length ?? 0) > 1 && (
                    <span className="ml-2 text-xs text-muted-foreground">{m.rewards_member_customers!.length} RW accounts</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={m.status === "active" ? "default" : m.status === "opted_out" ? "destructive" : "secondary"}>
                    {STATUS_LABEL[m.status]}
                  </Badge>
                </TableCell>
                <TableCell>{tierName.get(m.current_tier_key ?? "") ?? ""}</TableCell>
                <TableCell className="text-right">{fmtMoney(m.qualifying_spend)}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {m.next_tier_key ? `${fmtMoney(m.spend_to_next_tier)} to ${tierName.get(m.next_tier_key)}` : ""}
                </TableCell>
                <TableCell className="text-right">{fmtPoints(m.points_available)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{m.points_pending ? fmtPoints(m.points_pending) : ""}</TableCell>
                <TableCell className="text-right text-muted-foreground">{m.points_expiring_soon ? fmtPoints(m.points_expiring_soon) : ""}</TableCell>
                <TableCell className="text-right text-muted-foreground">{m.preview_spend ? fmtMoney(m.preview_spend) : ""}</TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  No members yet. Recalculate to enroll every Versatile customer with invoices.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            Page {page + 1} of {pages}
            <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a member</DialogTitle>
            <DialogDescription>
              Every Versatile customer with invoices is enrolled automatically. Add one by hand to group several RW accounts
              under one company name, then link the accounts on its page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Company name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button onClick={create}>Add member</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

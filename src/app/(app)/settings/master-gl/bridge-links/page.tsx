"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Link as LinkIcon, ExternalLink } from "lucide-react";
import Link from "next/link";

interface MasterAccount {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
  parent_account_id: string | null;
  chart_id: string;
  chart_kind: "management" | "accountant";
}

interface BridgeLink {
  id: string;
  organization_id: string;
  accountant_master_id: string;
  management_master_id: string;
  notes: string | null;
  created_at: string;
}

export default function BridgeLinksPage() {
  const supabase = createClient();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [accountantMasters, setAccountantMasters] = useState<MasterAccount[]>([]);
  const [managementMasters, setManagementMasters] = useState<MasterAccount[]>([]);
  const [links, setLinks] = useState<BridgeLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accId, setAccId] = useState<string>("");
  const [mgtId, setMgtId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .single();
      if (!membership) throw new Error("No organization membership");

      setOrganizationId(membership.organization_id);

      // Load both charts' master accounts
      const { data: charts } = await supabase
        .from("master_charts")
        .select("id, kind")
        .eq("organization_id", membership.organization_id);

      const accChart = charts?.find((c) => c.kind === "accountant");
      const mgtChart = charts?.find((c) => c.kind === "management");
      if (!accChart || !mgtChart) {
        throw new Error("Both accountant and management charts must exist");
      }

      // Pull only ROOT masters (parent_account_id IS NULL) — those are
      // what the bridge UI shows as line items.
      const [accRes, mgtRes] = await Promise.all([
        supabase
          .from("master_accounts")
          .select("id, name, account_number, classification, parent_account_id, chart_id")
          .eq("organization_id", membership.organization_id)
          .eq("chart_id", accChart.id)
          .eq("is_active", true)
          .is("parent_account_id", null)
          .order("classification")
          .order("account_number"),
        supabase
          .from("master_accounts")
          .select("id, name, account_number, classification, parent_account_id, chart_id")
          .eq("organization_id", membership.organization_id)
          .eq("chart_id", mgtChart.id)
          .eq("is_active", true)
          .is("parent_account_id", null)
          .order("classification")
          .order("account_number"),
      ]);

      setAccountantMasters(
        (accRes.data ?? []).map((m) => ({ ...m, chart_kind: "accountant" as const })),
      );
      setManagementMasters(
        (mgtRes.data ?? []).map((m) => ({ ...m, chart_kind: "management" as const })),
      );

      // Load existing links
      const linksRes = await fetch(
        `/api/master-charts/bridge-links?organizationId=${membership.organization_id}`,
      );
      if (linksRes.ok) {
        const json = (await linksRes.json()) as { links: BridgeLink[] };
        setLinks(json.links);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function addLink() {
    if (!organizationId || !accId || !mgtId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/master-charts/bridge-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          accountantMasterId: accId,
          managementMasterId: mgtId,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      setAccId("");
      setMgtId("");
      setNotes("");
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeLink(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/master-charts/bridge-links?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const accById = new Map(accountantMasters.map((m) => [m.id, m]));
  const mgtById = new Map(managementMasters.map((m) => [m.id, m]));

  // Already-linked masters get filtered out of the picker so we don't
  // double-link.
  const linkedAccIds = new Set(links.map((l) => l.accountant_master_id));
  const linkedMgtIds = new Set(links.map((l) => l.management_master_id));

  const availableAcc = accountantMasters.filter((m) => !linkedAccIds.has(m.id));
  const availableMgt = managementMasters.filter((m) => !linkedMgtIds.has(m.id));

  function masterLabel(m: MasterAccount): string {
    return `${m.account_number ? m.account_number + " — " : ""}${m.name} [${m.classification}]`;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Bridge Links</h1>
            <p className="text-muted-foreground text-sm">
              Explicit cross-chart pairings used by the financial statement bridge.
              Links override the heuristic name matcher.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/master-gl">
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Master GL settings
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="py-3">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Accountant-prepared line</Label>
              <Select value={accId} onValueChange={setAccId} disabled={loading}>
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="Pick an accountant master..." />
                </SelectTrigger>
                <SelectContent>
                  {availableAcc.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {masterLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Company-prepared line</Label>
              <Select value={mgtId} onValueChange={setMgtId} disabled={loading}>
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="Pick a management master..." />
                </SelectTrigger>
                <SelectContent>
                  {availableMgt.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {masterLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why these are linked..."
              className="text-xs h-9"
            />
          </div>
          <Button
            onClick={addLink}
            disabled={!accId || !mgtId || saving}
            size="sm"
          >
            <LinkIcon className="h-3.5 w-3.5 mr-1" />
            {saving ? "Linking..." : "Link"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Existing links ({links.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <p className="text-sm text-muted-foreground py-3">Loading...</p>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">
              No explicit links yet. The bridge will use heuristic name matching.
            </p>
          ) : (
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 font-medium">Accountant line</th>
                  <th className="text-left py-2 px-2 font-medium">Company line</th>
                  <th className="text-left py-2 px-2 font-medium">Notes</th>
                  <th className="text-right py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {links.map((l) => {
                  const acc = accById.get(l.accountant_master_id);
                  const mgt = mgtById.get(l.management_master_id);
                  return (
                    <tr key={l.id} className="border-b last:border-b-0">
                      <td className="py-1.5">{acc ? masterLabel(acc) : `(missing ${l.accountant_master_id})`}</td>
                      <td className="py-1.5 px-2">{mgt ? masterLabel(mgt) : `(missing ${l.management_master_id})`}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{l.notes || ""}</td>
                      <td className="py-1.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLink(l.id)}
                          title="Remove link"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

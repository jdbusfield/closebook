"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Plus, Trash2, BookOpen } from "lucide-react";
import Link from "next/link";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your organization and entities
        </p>
      </div>

      <div className="grid gap-6">
        <WikiPointerCard />
        <CreateOrganizationCard />
        <Separator />
        <CreateEntityCard />
      </div>
    </div>
  );
}

function WikiPointerCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Wiki
        </CardTitle>
        <CardDescription>
          Closebook&rsquo;s living documentation. Includes getting started,
          core concepts, feature reference, configuration, troubleshooting,
          and a changelog of every PR-driven change.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/wiki">Open Wiki</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function CreateOrganizationCard() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const router = useRouter();
  const supabase = createClient();

  const loadOrgs = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: memberships } = await supabase
      .from("organization_members")
      .select("organization_id, organizations(id, name)")
      .eq("user_id", user.id);

    if (memberships) {
      const orgList = memberships
        .map((m: Record<string, unknown>) => m.organizations as { id: string; name: string } | null)
        .filter((o): o is { id: string; name: string } => o !== null);
      setOrgs(orgList);
    }
  }, [supabase]);

  useEffect(() => {
    loadOrgs();
  }, [loadOrgs]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Failed to create organization");
        setLoading(false);
        return;
      }

      toast.success("Organization created");
      setName("");
      setLoading(false);
      await loadOrgs();
      router.refresh();
    } catch {
      toast.error("Failed to create organization");
      setLoading(false);
    }
  }

  async function handleDelete(orgId: string, orgName: string) {
    if (!confirm(`Are you sure you want to delete "${orgName}"? This will also delete all entities, close periods, tasks, and data within it. This cannot be undone.`)) {
      return;
    }

    setDeleting(orgId);

    try {
      const response = await fetch("/api/organizations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Failed to delete organization");
        setDeleting(null);
        return;
      }

      toast.success("Organization deleted");
      setDeleting(null);
      await loadOrgs();
      router.refresh();
    } catch {
      toast.error("Failed to delete organization");
      setDeleting(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>
          Create or manage your organization. An organization groups related
          entities together.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {orgs.length > 0 && (
          <div className="space-y-2">
            <Label>Your Organizations</Label>
            <div className="space-y-2">
              {orgs.map((org) => (
                <div
                  key={org.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <span className="font-medium">{org.name}</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(org.id, org.name)}
                    disabled={deleting === org.id}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {deleting === org.id ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <Separator />

        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orgName">Organization Name</Label>
            <Input
              id="orgName"
              placeholder="e.g., Acme Holdings"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Organization"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CreateEntityCard() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [fiscalYearEnd, setFiscalYearEnd] = useState("12");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("Not authenticated");
      setLoading(false);
      return;
    }

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      toast.error("Please create an organization first");
      setLoading(false);
      return;
    }

    const { error } = await supabase.from("entities").insert({
      organization_id: membership.organization_id,
      name,
      code: code.toUpperCase(),
      currency,
      fiscal_year_end_month: parseInt(fiscalYearEnd),
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    toast.success("Entity created");
    setName("");
    setCode("");
    setLoading(false);
    router.refresh();
  }

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Entity</CardTitle>
        <CardDescription>
          Create a new entity (company/subsidiary) to track its month-end
          close process.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleCreate}>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="entityName">Entity Name</Label>
              <Input
                id="entityName"
                placeholder="e.g., Acme Corp US"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entityCode">Code</Label>
              <Input
                id="entityCode"
                placeholder="e.g., ACME-US"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={20}
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD - US Dollar</SelectItem>
                  <SelectItem value="EUR">EUR - Euro</SelectItem>
                  <SelectItem value="GBP">GBP - British Pound</SelectItem>
                  <SelectItem value="CAD">CAD - Canadian Dollar</SelectItem>
                  <SelectItem value="AUD">AUD - Australian Dollar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fiscalYear">Fiscal Year End</Label>
              <Select value={fiscalYearEnd} onValueChange={setFiscalYearEnd}>
                <SelectTrigger id="fiscalYear">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>
                      {month}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={loading}>
            <Plus className="mr-2 h-4 w-4" />
            {loading ? "Creating..." : "Create Entity"}
          </Button>
        </CardContent>
      </form>
    </Card>
  );
}

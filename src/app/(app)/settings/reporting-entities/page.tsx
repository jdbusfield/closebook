"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";

interface Entity {
  id: string;
  name: string;
  code: string;
}

interface ReportingEntity {
  id: string;
  name: string;
  code: string;
  excludeFromBreakdown: boolean;
  members: Array<{
    entityId: string;
    entityName: string;
    entityCode: string;
  }>;
}

export default function ReportingEntitiesPage() {
  const supabase = createClient();

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [reportingEntities, setReportingEntities] = useState<ReportingEntity[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  // Create form state
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(
    new Set()
  );
  const [excludeFromBreakdown, setExcludeFromBreakdown] = useState(false);
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editEntityIds, setEditEntityIds] = useState<Set<string>>(new Set());
  const [editExcludeFromBreakdown, setEditExcludeFromBreakdown] =
    useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (!membership) return;

    setOrganizationId(membership.organization_id);

    // Load entities
    const { data: ents } = await supabase
      .from("entities")
      .select("id, name, code")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("name");

    setEntities(ents ?? []);

    // Load reporting entities
    const res = await fetch(
      `/api/reporting-entities?organizationId=${membership.organization_id}`
    );
    if (res.ok) {
      const data = await res.json();
      setReportingEntities(data.reportingEntities ?? []);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !name.trim() || !code.trim()) return;
    if (selectedEntityIds.size === 0) {
      toast.error("Select at least one entity");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/reporting-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          name: name.trim(),
          code: code.trim(),
          memberEntityIds: Array.from(selectedEntityIds),
          excludeFromBreakdown,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to create");
      }

      toast.success("Reporting entity created");
      setName("");
      setCode("");
      setSelectedEntityIds(new Set());
      setExcludeFromBreakdown(false);
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create reporting entity"
      );
    } finally {
      setCreating(false);
    }
  }

  function startEdit(re: ReportingEntity) {
    setEditingId(re.id);
    setEditName(re.name);
    setEditCode(re.code);
    setEditEntityIds(new Set(re.members.map((m) => m.entityId)));
    setEditExcludeFromBreakdown(re.excludeFromBreakdown);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditCode("");
    setEditEntityIds(new Set());
    setEditExcludeFromBreakdown(false);
  }

  async function handleSave() {
    if (!editingId || !editName.trim() || !editCode.trim()) return;
    if (editEntityIds.size === 0) {
      toast.error("Select at least one entity");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/reporting-entities", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportingEntityId: editingId,
          name: editName.trim(),
          code: editCode.trim(),
          memberEntityIds: Array.from(editEntityIds),
          excludeFromBreakdown: editExcludeFromBreakdown,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to update");
      }

      toast.success("Reporting entity updated");
      cancelEdit();
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update reporting entity"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, reName: string) {
    if (!confirm(`Delete reporting entity "${reName}"? This cannot be undone.`))
      return;

    try {
      const res = await fetch(
        `/api/reporting-entities?reportingEntityId=${id}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to delete");
      }

      toast.success("Reporting entity deleted");
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete reporting entity"
      );
    }
  }

  function toggleEntity(
    entityId: string,
    set: Set<string>,
    setter: (s: Set<string>) => void
  ) {
    const next = new Set(set);
    if (next.has(entityId)) {
      next.delete(entityId);
    } else {
      next.add(entityId);
    }
    setter(next);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Reporting Entities
          </h1>
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Reporting Entities
        </h1>
        <p className="text-muted-foreground text-sm">
          Group entities into reporting entities for sub-consolidated financial
          reporting
        </p>
      </div>

      {/* Existing reporting entities */}
      {reportingEntities.length > 0 && (
        <div className="space-y-3">
          {reportingEntities.map((re) => (
            <Card key={re.id}>
              <CardContent className="py-4">
                {editingId === re.id ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Name</Label>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="w-32 space-y-1">
                        <Label className="text-xs">Code</Label>
                        <Input
                          value={editCode}
                          onChange={(e) => setEditCode(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Member Entities</Label>
                      <div className="flex flex-wrap gap-2">
                        {entities.map((ent) => (
                          <label
                            key={ent.id}
                            className="flex items-center gap-1.5 text-xs cursor-pointer"
                          >
                            <Checkbox
                              checked={editEntityIds.has(ent.id)}
                              onCheckedChange={() =>
                                toggleEntity(
                                  ent.id,
                                  editEntityIds,
                                  setEditEntityIds
                                )
                              }
                            />
                            {ent.code} — {ent.name}
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Checkbox
                        checked={editExcludeFromBreakdown}
                        onCheckedChange={(v) =>
                          setEditExcludeFromBreakdown(v === true)
                        }
                      />
                      Exclude from financial model breakdown
                    </label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={handleSave}
                        disabled={saving}
                      >
                        <Check className="w-3.5 h-3.5 mr-1" />
                        {saving ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={cancelEdit}
                        disabled={saving}
                      >
                        <X className="w-3.5 h-3.5 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{re.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {re.code}
                        </Badge>
                        {re.excludeFromBreakdown && (
                          <Badge variant="secondary" className="text-xs">
                            Excluded from breakdown
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {re.members.map((m) => (
                          <Badge
                            key={m.entityId}
                            variant="secondary"
                            className="text-xs font-normal"
                          >
                            {m.entityCode} — {m.entityName}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => startEdit(re)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={() => handleDelete(re.id, re.name)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create new reporting entity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Create Reporting Entity
          </CardTitle>
          <CardDescription>
            Group multiple entities together for consolidated sub-reporting
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="re-name" className="text-xs">
                  Name
                </Label>
                <Input
                  id="re-name"
                  placeholder="e.g. Avon"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 text-sm"
                  required
                />
              </div>
              <div className="w-32 space-y-1">
                <Label htmlFor="re-code" className="text-xs">
                  Code
                </Label>
                <Input
                  id="re-code"
                  placeholder="e.g. AVON"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="h-8 text-sm"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Member Entities</Label>
              {entities.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No entities available. Create entities first.
                </p>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {entities.map((ent) => (
                    <label
                      key={ent.id}
                      className="flex items-center gap-1.5 text-xs cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedEntityIds.has(ent.id)}
                        onCheckedChange={() =>
                          toggleEntity(
                            ent.id,
                            selectedEntityIds,
                            setSelectedEntityIds
                          )
                        }
                      />
                      {ent.code} — {ent.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox
                checked={excludeFromBreakdown}
                onCheckedChange={(v) => setExcludeFromBreakdown(v === true)}
              />
              Exclude from financial model breakdown
            </label>

            <Button type="submit" size="sm" disabled={creating}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              {creating ? "Creating..." : "Create Reporting Entity"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

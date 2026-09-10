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
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Search,
} from "lucide-react";
import { format } from "date-fns";
import {
  ACTION_LABELS,
  RESOURCE_TYPE_LABELS,
  describeAuditEvent,
  resourceTypeLabel,
} from "@/lib/utils/audit-labels";
import type { UserRole } from "@/lib/types/database";

interface AuditEntry {
  id: string;
  organization_id: string;
  entity_id: string | null;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_key: string | null;
  resource_label: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  profiles: { full_name: string } | null;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

interface Member {
  user_id: string;
  profiles: { full_name: string } | null;
}

interface Entity {
  id: string;
  name: string;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 50,
    totalCount: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [filterUser, setFilterUser] = useState("");
  const [filterResourceType, setFilterResourceType] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterQuery, setFilterQuery] = useState("");

  // Filter options
  const [members, setMembers] = useState<Member[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);

  const supabase = createClient();
  const resourceTypeOptions = Object.entries(RESOURCE_TYPE_LABELS).sort((a, b) =>
    a[1].localeCompare(b[1])
  );

  // Load filter options
  useEffect(() => {
    async function loadOptions() {
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

      const [membersRes, entitiesRes] = await Promise.all([
        supabase
          .from("organization_members")
          .select("user_id, profiles(full_name)")
          .eq("organization_id", membership.organization_id),
        supabase
          .from("entities")
          .select("id, name")
          .eq("organization_id", membership.organization_id)
          .eq("is_active", true)
          .order("name"),
      ]);

      setMembers((membersRes.data as unknown as Member[]) ?? []);
      setEntities((entitiesRes.data as Entity[]) ?? []);
    }
    loadOptions();
  }, [supabase]);

  const fetchLogs = useCallback(
    async (page = 1) => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      const chosen = (value: string) => value && value !== "all";
      if (chosen(filterUser)) params.set("userId", filterUser);
      if (chosen(filterResourceType)) params.set("resourceType", filterResourceType);
      if (chosen(filterAction)) params.set("action", filterAction);
      if (chosen(filterEntity)) params.set("entityId", filterEntity);
      if (filterStartDate) params.set("startDate", filterStartDate);
      if (filterEndDate) params.set("endDate", filterEndDate);
      if (filterQuery.trim()) params.set("q", filterQuery.trim());

      const res = await fetch(`/api/audit-log?${params}`);
      if (res.ok) {
        const json = await res.json();
        setEntries(json.data);
        setPagination(json.pagination);
      }
      setLoading(false);
    },
    [filterUser, filterResourceType, filterAction, filterEntity, filterStartDate, filterEndDate, filterQuery]
  );

  useEffect(() => {
    fetchLogs(1);
  }, [fetchLogs]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    fetchLogs(1);
  }

  function getActionBadgeVariant(action: string) {
    switch (action) {
      case "create":
        return "default" as const;
      case "delete":
        return "destructive" as const;
      case "transition":
        return "secondary" as const;
      default:
        return "outline" as const;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground">
          Every record added, edited, or deleted, with who did it and when
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <form onSubmit={handleSearch}>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="space-y-2">
                <Label>User</Label>
                <Select value={filterUser} onValueChange={setFilterUser}>
                  <SelectTrigger>
                    <SelectValue placeholder="All users" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All users</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.profiles?.full_name ?? "Unknown"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Resource Type</Label>
                <Select
                  value={filterResourceType}
                  onValueChange={setFilterResourceType}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {resourceTypeOptions.map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Action</Label>
                <Select value={filterAction} onValueChange={setFilterAction}>
                  <SelectTrigger>
                    <SelectValue placeholder="All actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    {Object.entries(ACTION_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Entity</Label>
                <Select value={filterEntity} onValueChange={setFilterEntity}>
                  <SelectTrigger>
                    <SelectValue placeholder="All entities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All entities</SelectItem>
                    {entities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-2 col-span-2 md:col-span-3 lg:col-span-6">
                <Label>Search</Label>
                <Input
                  placeholder="Name, number, or id of the record"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="submit" size="sm">
                <Search className="mr-2 h-4 w-4" />
                Search
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilterUser("");
                  setFilterResourceType("");
                  setFilterAction("");
                  setFilterEntity("");
                  setFilterStartDate("");
                  setFilterEndDate("");
                  setFilterQuery("");
                }}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Activity
              </CardTitle>
              <CardDescription>
                {pagination.totalCount} event{pagination.totalCount !== 1 ? "s" : ""}
              </CardDescription>
            </div>
            {pagination.totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={pagination.page <= 1}
                  onClick={() => fetchLogs(pagination.page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  {pagination.page} / {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => fetchLogs(pagination.page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">No audit log entries found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Timestamp</TableHead>
                  <TableHead className="w-[150px]">User</TableHead>
                  <TableHead className="w-[100px]">Action</TableHead>
                  <TableHead className="w-[150px]">Resource</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <Collapsible
                    key={entry.id}
                    open={expandedId === entry.id}
                    onOpenChange={(open) =>
                      setExpandedId(open ? entry.id : null)
                    }
                    asChild
                  >
                    <>
                      <CollapsibleTrigger asChild>
                        <TableRow className="cursor-pointer hover:bg-muted/50">
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(entry.created_at), "MMM d, yyyy h:mm:ss a")}
                          </TableCell>
                          <TableCell className="text-sm">
                            {entry.profiles?.full_name ?? "System"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getActionBadgeVariant(entry.action)}>
                              {ACTION_LABELS[entry.action] ?? entry.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {resourceTypeLabel(entry.resource_type)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {describeAuditEvent(
                              entry.action,
                              entry.resource_type,
                              entry.new_values,
                              entry.old_values,
                              entry.resource_label
                            )}
                          </TableCell>
                          <TableCell>
                            {(entry.old_values || entry.new_values) && (
                              <ChevronDown
                                className={`h-4 w-4 text-muted-foreground transition-transform ${
                                  expandedId === entry.id ? "rotate-180" : ""
                                }`}
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      </CollapsibleTrigger>
                      <CollapsibleContent asChild>
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/30 p-4">
                            <DiffViewer
                              action={entry.action}
                              oldValues={entry.old_values}
                              newValues={entry.new_values}
                            />
                          </TableCell>
                        </TableRow>
                      </CollapsibleContent>
                    </>
                  </Collapsible>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DiffViewer({
  action,
  oldValues,
  newValues,
}: {
  action: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}) {
  if (!oldValues && !newValues) return null;

  if (action === "create" && newValues) {
    return (
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">New Values</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {Object.entries(newValues).map(([key, val]) => (
            <div key={key} className="flex gap-2 text-sm">
              <span className="text-muted-foreground">{key}:</span>
              <span className="font-mono">{formatValue(val)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (action === "delete" && oldValues) {
    return (
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Deleted Values</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {Object.entries(oldValues).map(([key, val]) => (
            <div key={key} className="flex gap-2 text-sm">
              <span className="text-muted-foreground">{key}:</span>
              <span className="font-mono">{formatValue(val)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Update / transition: show side-by-side diff
  const allKeys = new Set([
    ...Object.keys(oldValues ?? {}),
    ...Object.keys(newValues ?? {}),
  ]);

  const changedKeys = [...allKeys].filter((key) => {
    const oldVal = JSON.stringify(oldValues?.[key] ?? null);
    const newVal = JSON.stringify(newValues?.[key] ?? null);
    return oldVal !== newVal;
  });

  if (changedKeys.length === 0) {
    return <p className="text-sm text-muted-foreground">No field changes recorded.</p>;
  }

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-x-4 gap-y-1 text-sm">
        <p className="text-xs font-medium text-muted-foreground">Old Value</p>
        <span />
        <p className="text-xs font-medium text-muted-foreground">New Value</p>
        {changedKeys.map((key) => (
          <div key={key} className="contents">
            <div className="flex gap-2">
              <span className="text-muted-foreground">{key}:</span>
              <span className="font-mono text-red-600 dark:text-red-400">
                {formatValue(oldValues?.[key])}
              </span>
            </div>
            <span className="text-muted-foreground">&rarr;</span>
            <div>
              <span className="font-mono text-green-600 dark:text-green-400">
                {formatValue(newValues?.[key])}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "object") return JSON.stringify(val, null, 2);
  return String(val);
}

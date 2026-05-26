"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2, Check, Circle, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { CrmTaskRow, TaskEntityType } from "@/lib/db/queries/crm-tasks";
import type { CrmOrgMember } from "@/lib/db/queries/crm-owners";

interface Props {
  entityType: TaskEntityType;
  entityId: string;
  tasks: CrmTaskRow[];
  members: CrmOrgMember[];
  currentUserId: string;
}

function fmtDue(d: string | null): { label: string; overdue: boolean } | null {
  if (!d) return null;
  const today = new Date().toISOString().slice(0, 10);
  return { label: new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }), overdue: d < today };
}

export function TasksTab({ entityType, entityId, tasks, members, currentUserId }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(currentUserId);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() { startTransition(() => router.refresh()); }

  async function create() {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    const res = await fetch("/api/crm/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        assignee_id: assigneeId || null,
        [`${entityType}_id`]: entityId,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to create task");
      setCreating(false);
      return;
    }
    setTitle(""); setDescription(""); setDueDate("");
    setCreating(false);
    refresh();
  }

  async function toggleDone(t: CrmTaskRow) {
    const next = t.status === "done" ? "open" : "done";
    await fetch(`/api/crm/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    refresh();
  }

  async function remove(t: CrmTaskRow) {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    await fetch(`/api/crm/tasks/${t.id}`, { method: "DELETE" });
    refresh();
  }

  const openTasks = tasks.filter(t => t.status !== "done" && t.status !== "cancelled");
  const doneTasks = tasks.filter(t => t.status === "done");

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="rounded-md border bg-muted/30 p-3">
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Add a task…"
            onKeyDown={e => { if (e.key === "Enter" && title.trim()) create(); }}
            className="mb-2"
          />
          {title.trim() && (
            <div className="space-y-2">
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} />
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1">
                  Due
                  <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-7 w-auto" />
                </label>
                <label className="flex items-center gap-1">
                  Assign
                  <select
                    value={assigneeId}
                    onChange={e => setAssigneeId(e.target.value)}
                    className="h-7 rounded border bg-background px-2 text-xs"
                  >
                    <option value="">(unassigned)</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.full_name}</option>
                    ))}
                  </select>
                </label>
                <Button size="sm" onClick={create} disabled={creating}>
                  {creating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
                  Add task
                </Button>
              </div>
            </div>
          )}
          {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        </div>

        {openTasks.length === 0 && doneTasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <>
            {openTasks.map(t => {
              const due = fmtDue(t.due_date);
              return (
                <div key={t.id} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                  <button onClick={() => toggleDone(t)} className="mt-0.5" aria-label="Mark done">
                    <Circle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.title}</p>
                    {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {due && (
                        <Badge variant="outline" className={due.overdue ? "border-rose-300 bg-rose-50 text-rose-700" : ""}>
                          {due.overdue && <AlertTriangle className="mr-1 h-3 w-3" />}
                          Due {due.label}
                        </Badge>
                      )}
                      {t.assignee_name && <span>· {t.assignee_name}</span>}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => remove(t)} aria-label="Delete"><Trash2 className="h-3 w-3" /></Button>
                </div>
              );
            })}

            {doneTasks.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground">Done ({doneTasks.length})</summary>
                <div className="mt-2 space-y-2">
                  {doneTasks.map(t => (
                    <div key={t.id} className="flex items-start gap-2 rounded-md border bg-muted/20 p-3 text-sm">
                      <button onClick={() => toggleDone(t)} className="mt-0.5" aria-label="Reopen">
                        <Check className="h-4 w-4 text-emerald-600" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="line-through text-muted-foreground">{t.title}</p>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => remove(t)} aria-label="Delete"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface MyTaskListProps {
  tasks: Array<CrmTaskRow & { production_name: string | null; is_overdue: boolean }>;
}

export function MyTaskList({ tasks }: MyTaskListProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());

  async function toggleDone(id: string) {
    await fetch(`/api/crm/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    refresh();
  }

  if (tasks.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No open tasks. 🎉</p>;
  }
  return (
    <div className="space-y-2">
      {tasks.map(t => (
        <div key={t.id} className={`flex items-start gap-3 rounded-md border p-3 text-sm ${t.is_overdue ? "border-rose-300 bg-rose-50/40" : ""}`}>
          <button onClick={() => toggleDone(t.id)} aria-label="Mark done" className="mt-0.5">
            <Circle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t.title}</p>
            {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {t.due_date && (
                <Badge variant="outline" className={t.is_overdue ? "border-rose-300 bg-rose-100 text-rose-700" : ""}>
                  {t.is_overdue && <AlertTriangle className="mr-1 h-3 w-3" />}
                  Due {new Date(t.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                </Badge>
              )}
              {t.production_name && t.production_id && (
                <Link href={`/crm/productions/${t.production_id}`} className="text-xs text-muted-foreground hover:underline">
                  on {t.production_name}
                </Link>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

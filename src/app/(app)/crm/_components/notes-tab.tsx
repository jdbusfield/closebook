"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Edit2, Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CrmNoteRow, NoteEntityType } from "@/lib/db/queries/crm-notes";

interface Props {
  entityType: NoteEntityType;
  entityId: string;
  notes: CrmNoteRow[];
}

function fmt(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function NotesTab({ entityType, entityId, notes }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const refresh = () => startTransition(() => router.refresh());

  async function post() {
    if (!body.trim()) return;
    setPosting(true);
    const res = await fetch("/api/crm/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: body.trim(), [`${entityType}_id`]: entityId }),
    });
    setPosting(false);
    if (res.ok) {
      setBody("");
      refresh();
    }
  }

  async function saveEdit(id: string) {
    await fetch(`/api/crm/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editBody.trim() }),
    });
    setEditingId(null);
    refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this note?")) return;
    await fetch(`/api/crm/notes/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="rounded-md border bg-muted/30 p-3">
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write a note…"
            rows={3}
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={post} disabled={posting || !body.trim()}>
              {posting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Post note
            </Button>
          </div>
        </div>

        {notes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          notes.map(n => (
            <div key={n.id} className="rounded-md border p-3 text-sm">
              {editingId === n.id ? (
                <>
                  <Textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={3} />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}><X className="h-3 w-3" /></Button>
                    <Button size="sm" onClick={() => saveEdit(n.id)}><Check className="mr-1 h-3 w-3" /> Save</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className="whitespace-pre-wrap flex-1">{n.body}</p>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditingId(n.id); setEditBody(n.body); }} aria-label="Edit"><Edit2 className="h-3 w-3" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(n.id)} aria-label="Delete"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {n.author_name ?? "Someone"} · {fmt(n.created_at)}
                    {n.updated_at && ` · edited ${fmt(n.updated_at)}`}
                  </p>
                </>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

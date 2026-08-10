"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Flag, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DiligenceItemRow } from "@/lib/db/queries/diligence";
import { DILIGENCE_CATEGORIES } from "@/lib/diligence/template";
import {
  ITEM_STATUS_ORDER,
  ITEM_STATUS_LABEL,
  ITEM_STATUS_CLASS,
  PriorityBadge,
  formatDate,
} from "./diligence-shared";

async function patchItem(id: string, body: Record<string, unknown>) {
  await fetch(`/api/diligence/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function StatusSelect({ item, onChanged }: { item: DiligenceItemRow; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <select
      className={`h-7 rounded-md border-0 px-2 text-xs font-medium ${ITEM_STATUS_CLASS[item.status] ?? "bg-slate-100"}`}
      value={item.status}
      disabled={saving}
      onChange={async e => {
        setSaving(true);
        await patchItem(item.id, { status: e.target.value });
        setSaving(false);
        onChanged();
      }}
    >
      {ITEM_STATUS_ORDER.map(s => (
        <option key={s} value={s}>{ITEM_STATUS_LABEL[s]}</option>
      ))}
    </select>
  );
}

function ItemEditor({ item, onChanged }: { item: DiligenceItemRow; onChanged: () => void }) {
  const [internalOwner, setInternalOwner] = useState(item.internal_owner ?? "");
  const [counterpartyOwner, setCounterpartyOwner] = useState(item.counterparty_owner ?? "");
  const [dueDate, setDueDate] = useState(item.due_date ?? "");
  const [docUrl, setDocUrl] = useState(item.doc_url ?? "");
  const [finding, setFinding] = useState(item.finding ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await patchItem(item.id, {
      internal_owner: internalOwner,
      counterparty_owner: counterpartyOwner,
      due_date: dueDate || null,
      doc_url: docUrl,
      finding,
    });
    setSaving(false);
    onChanged();
  }

  async function remove() {
    await fetch(`/api/diligence/items/${item.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="space-y-3 bg-muted/20 px-4 py-3">
      {item.details && <p className="text-xs text-muted-foreground">{item.details}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Our owner</label>
          <Input className="h-8 text-sm" value={internalOwner} onChange={e => setInternalOwner(e.target.value)} placeholder="e.g. JD" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Their owner</label>
          <Input className="h-8 text-sm" value={counterpartyOwner} onChange={e => setCounterpartyOwner(e.target.value)} placeholder="e.g. Bart" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Due date</label>
          <Input className="h-8 text-sm" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Doc link</label>
          <Input className="h-8 text-sm" value={docUrl} onChange={e => setDocUrl(e.target.value)} placeholder="Drive / data room URL" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Findings / notes</label>
        <textarea
          className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
          rows={2}
          value={finding}
          onChange={e => setFinding(e.target.value)}
          placeholder="What we learned, open questions, issues…"
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={item.red_flag ? "destructive" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={async () => {
              await patchItem(item.id, { red_flag: !item.red_flag });
              onChanged();
            }}
          >
            <Flag className="mr-1 h-3 w-3" />
            {item.red_flag ? "Red-flagged" : "Flag as issue"}
          </Button>
          {item.requested_date && (
            <span className="text-xs text-muted-foreground">Requested {formatDate(item.requested_date)}</span>
          )}
          {item.received_date && (
            <span className="text-xs text-muted-foreground">· Received {formatDate(item.received_date)}</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-600" onClick={remove}>
            <Trash2 className="mr-1 h-3 w-3" /> Delete
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddItemRow({ dealId, category, onChanged }: { dealId: string; category: string; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  if (!adding) {
    return (
      <button
        className="flex w-full items-center gap-1 px-4 py-2 text-left text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
        onClick={() => setAdding(true)}
      >
        <Plus className="h-3 w-3" /> Add item
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <Input
        autoFocus
        className="h-8 text-sm"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Request item…"
        onKeyDown={async e => {
          if (e.key === "Enter" && title.trim() && !saving) {
            setSaving(true);
            await fetch("/api/diligence/items", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ deal_id: dealId, category, title }),
            });
            setSaving(false);
            setTitle("");
            setAdding(false);
            onChanged();
          }
          if (e.key === "Escape") setAdding(false);
        }}
      />
      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setAdding(false)}>Cancel</Button>
    </div>
  );
}

export function Checklist({ dealId, items }: { dealId: string; items: DiligenceItemRow[] }) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const refresh = () => router.refresh();

  // Standard categories first (in canonical order), then any custom ones.
  const categories = [
    ...DILIGENCE_CATEGORIES.filter(c => items.some(i => i.category === c)),
    ...Array.from(new Set(items.map(i => i.category))).filter(
      c => !(DILIGENCE_CATEGORIES as readonly string[]).includes(c)
    ),
  ];
  const displayCategories = categories.length > 0 ? categories : [...DILIGENCE_CATEGORIES];

  return (
    <div className="space-y-4">
      {displayCategories.map(category => {
        const catItems = items.filter(i => i.category === category);
        const done = catItems.filter(i => ["complete", "not_applicable"].includes(i.status)).length;
        return (
          <Card key={category}>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center justify-between text-sm font-semibold">
                <span>{category}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {done}/{catItems.length} complete
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {catItems.map(item => {
                const expanded = expandedId === item.id;
                return (
                  <div key={item.id} className="border-t">
                    <div
                      className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-muted/30"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex-1 text-sm">
                        {item.red_flag && <Flag className="mr-1.5 inline h-3.5 w-3.5 text-rose-600" />}
                        {item.title}
                      </span>
                      {item.internal_owner && (
                        <span className="hidden text-xs text-muted-foreground sm:inline">{item.internal_owner}</span>
                      )}
                      <PriorityBadge priority={item.priority} />
                      <div onClick={e => e.stopPropagation()}>
                        <StatusSelect item={item} onChanged={refresh} />
                      </div>
                    </div>
                    {expanded && <ItemEditor item={item} onChanged={refresh} />}
                  </div>
                );
              })}
              <div className="border-t">
                <AddItemRow dealId={dealId} category={category} onChanged={refresh} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

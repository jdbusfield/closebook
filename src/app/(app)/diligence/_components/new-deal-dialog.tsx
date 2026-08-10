"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const DEAL_TYPES = [
  { value: "acquisition", label: "Acquisition" },
  { value: "asset_purchase", label: "Asset Purchase" },
  { value: "managed_services", label: "Managed Services" },
  { value: "merger", label: "Merger" },
  { value: "investment", label: "Investment" },
  { value: "other", label: "Other" },
];

export function NewDealDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [dealType, setDealType] = useState("acquisition");
  const [targetClose, setTargetClose] = useState("");
  const [seedTemplate, setSeedTemplate] = useState(true);

  async function handleCreate() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/diligence/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        counterparty,
        deal_type: dealType,
        target_close_date: targetClose || null,
        seed_template: seedTemplate,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Failed to create deal");
      return;
    }
    const { id } = (await res.json()) as { id: string };
    setOpen(false);
    router.push(`/diligence/${id}`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> New Deal
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Diligence Deal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Deal name</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. CES Studio Services" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Counterparty</label>
            <Input value={counterparty} onChange={e => setCounterparty(e.target.value)} placeholder="Company / principal" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Deal type</label>
              <select
                className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={dealType}
                onChange={e => setDealType(e.target.value)}
              >
                {DEAL_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Target close</label>
              <Input type="date" value={targetClose} onChange={e => setTargetClose(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={seedTemplate}
              onChange={e => setSeedTemplate(e.target.checked)}
              className="h-4 w-4"
            />
            Start from the standard M&amp;A request list
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={!name.trim() || saving}>
              {saving ? "Creating…" : "Create Deal"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

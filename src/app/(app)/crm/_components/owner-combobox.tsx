"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, UserCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { CrmOrgMember } from "@/lib/db/queries/crm-owners";

export type OwnerEntityType = "production" | "company" | "opportunity";

interface Props {
  entityType: OwnerEntityType;
  entityId: string;
  currentOwnerId: string | null;
  currentOwnerName: string | null;
  members: CrmOrgMember[];
}

export function OwnerCombobox({ entityType, entityId, currentOwnerId, currentOwnerName, members }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function setOwner(ownerId: string | null) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/crm/owner/${entityType}/${entityId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner_id: ownerId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to update owner");
      setSaving(false);
      return;
    }
    setSaving(false);
    setOpen(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">Owner</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 px-2">
            <UserCircle2 className="mr-1 h-3 w-3" />
            {currentOwnerName ?? "Unassigned"}
            {saving && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search teammates…" />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__unassigned"
                  onSelect={() => setOwner(null)}
                  disabled={saving}
                >
                  <div className="flex items-center gap-2">
                    {currentOwnerId === null && <Check className="h-3 w-3" />}
                    <span className="text-muted-foreground">Unassigned</span>
                  </div>
                </CommandItem>
                {members.map(m => (
                  <CommandItem
                    key={m.id}
                    value={m.full_name}
                    onSelect={() => setOwner(m.id)}
                    disabled={saving}
                  >
                    <div className="flex items-center gap-2">
                      {currentOwnerId === m.id && <Check className="h-3 w-3" />}
                      <span>{m.full_name}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          {error && <p className="border-t px-3 py-2 text-xs text-rose-600">{error}</p>}
        </PopoverContent>
      </Popover>
    </div>
  );
}

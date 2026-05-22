"use client";

import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { ActiveProductionCandidate } from "@/lib/crm/import-types";

const STATUS_COLORS: Record<string, string> = {
  "pre-prepping": "bg-purple-100 text-purple-700",
  prepping: "bg-sky-100 text-sky-700",
  shooting: "bg-emerald-100 text-emerald-700",
  reshoots: "bg-cyan-100 text-cyan-700",
  wrapping: "bg-amber-100 text-amber-700",
};

interface Props {
  candidates: ActiveProductionCandidate[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** PDF row name — used to seed the filter so close matches surface first */
  pdfRowName?: string;
}

export function ProductionMatchCombobox({ candidates, selectedId, onSelect, pdfRowName }: Props) {
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const order = ["prepping", "pre-prepping", "shooting", "reshoots", "wrapping"];
    const buckets: Record<string, ActiveProductionCandidate[]> = {};
    for (const c of candidates) {
      (buckets[c.status] ||= []).push(c);
    }
    return order
      .filter(s => buckets[s]?.length)
      .map(status => ({ status, items: buckets[status] }));
  }, [candidates]);

  const selected = candidates.find(c => c.id === selectedId);

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            className="h-8 w-full justify-between font-normal"
          >
            {selected ? (
              <span className="truncate">
                <Badge
                  variant="secondary"
                  className={cn("mr-2 text-[10px]", STATUS_COLORS[selected.status])}
                >
                  {selected.status}
                </Badge>
                {selected.name}
              </span>
            ) : (
              <span className="text-muted-foreground">Match to existing production…</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[420px] p-0" align="start">
          <Command
            // Match on name + aliases by including them in the searchable value
            filter={(value, search) => {
              if (!search) return 1;
              return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
            }}
          >
            <CommandInput
              placeholder="Type to search active productions…"
              defaultValue={pdfRowName ?? ""}
            />
            <CommandList className="max-h-72">
              <CommandEmpty>No active production matches.</CommandEmpty>
              {grouped.map(({ status, items }) => (
                <CommandGroup
                  key={status}
                  heading={
                    <span className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={cn("text-[10px]", STATUS_COLORS[status])}
                      >
                        {status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{items.length}</span>
                    </span>
                  }
                >
                  {items.map(item => {
                    const searchableValue = [item.name, ...item.aliases, item.company_name ?? ""].join(" ");
                    return (
                      <CommandItem
                        key={item.id}
                        value={searchableValue}
                        onSelect={() => {
                          onSelect(item.id);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedId === item.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{item.name}</p>
                          {(item.company_name || item.aliases.length > 0) && (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {item.company_name ?? ""}
                              {item.company_name && item.aliases.length > 0 ? " · " : ""}
                              {item.aliases.length > 0 && `aka ${item.aliases.join(", ")}`}
                            </p>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={() => onSelect(null)}
          title="Clear match"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

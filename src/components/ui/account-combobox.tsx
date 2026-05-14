"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

export interface AccountOption {
  id: string;
  account_number?: string | null;
  name: string;
  account_type?: string;
  secondary?: string;
}

type BaseProps = {
  accounts: AccountOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
};

type SingleProps = BaseProps & {
  multiple?: false;
  value: string;
  onValueChange: (value: string) => void;
};

type MultiProps = BaseProps & {
  multiple: true;
  values: string[];
  onValuesChange: (values: string[]) => void;
};

export type AccountComboboxProps = SingleProps | MultiProps;

export function AccountCombobox(props: AccountComboboxProps) {
  const {
    accounts,
    placeholder = "Select account...",
    searchPlaceholder = "Search accounts...",
    emptyMessage = "No account found.",
    className,
    disabled,
  } = props;
  const [open, setOpen] = React.useState(false);

  const isMulti = props.multiple === true;
  const selectedIds = isMulti
    ? props.values
    : props.value
      ? [props.value]
      : [];
  const selectedSet = React.useMemo(
    () => new Set(selectedIds),
    [selectedIds]
  );

  let displayLabel: React.ReactNode = placeholder;
  if (isMulti) {
    if (selectedIds.length === 1) {
      const a = accounts.find((x) => x.id === selectedIds[0]);
      if (a) {
        displayLabel = `${a.account_number ? `${a.account_number} — ` : ""}${a.name}`;
      }
    } else if (selectedIds.length > 1) {
      displayLabel = `${selectedIds.length} accounts selected`;
    }
  } else {
    const a = accounts.find((x) => x.id === props.value);
    if (a) {
      displayLabel = `${a.account_number ? `${a.account_number} — ` : ""}${a.name}`;
    }
  }

  function handleSelect(id: string) {
    if (isMulti) {
      const next = selectedSet.has(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id];
      props.onValuesChange(next);
      // Keep popover open so the user can pick more without losing search.
    } else {
      props.onValueChange(id);
      setOpen(false);
    }
  }

  const hasSelection = selectedIds.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full min-w-0 justify-between text-sm font-normal overflow-hidden",
            !hasSelection && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {accounts.map((a) => {
                const isSelected = selectedSet.has(a.id);
                return (
                  <CommandItem
                    key={a.id}
                    value={`${a.account_number ?? ""} ${a.name} ${a.account_type ?? ""} ${a.secondary ?? ""}`}
                    onSelect={() => handleSelect(a.id)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        isSelected ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">
                      {a.account_number ? `${a.account_number} — ` : ""}
                      {a.name}
                      {a.account_type && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          ({a.account_type})
                        </span>
                      )}
                      {a.secondary && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          {a.secondary}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

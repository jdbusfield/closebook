"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowRight,
  ArrowLeftRight,
  ChevronsUpDown,
  Check,
  Repeat,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatStatementAmount } from "./format-utils";
import type { Scope, AllocationAdjustment } from "./types";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028];

function formatPeriod(year: number, month: number): string {
  return `${MONTHS[month - 1]?.slice(0, 3)} ${year}`;
}

function formatPeriodRange(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): string {
  return `${formatPeriod(startYear, startMonth)} – ${formatPeriod(endYear, endMonth)}`;
}

/** Count months in a range (inclusive) */
function countMonthsInRange(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): number {
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
}

interface MasterAccountOption {
  id: string;
  account_number: string;
  name: string;
  classification: string;
  account_type: string;
}

// ---------------------------------------------------------------------------
// Searchable Combobox component for entities and accounts
// ---------------------------------------------------------------------------

interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
}

function SearchableCombobox({
  options,
  value,
  onValueChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
  className,
}: {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-8 w-full justify-between text-xs font-normal",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder={searchPlaceholder}
            className="h-8 text-xs"
          />
          <CommandList>
            <CommandEmpty className="text-xs py-4 text-center">
              {emptyMessage}
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.sublabel ?? ""}`}
                  onSelect={() => {
                    onValueChange(option.value === value ? "" : option.value);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5 shrink-0",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                  {option.badge && (
                    <Badge
                      variant="outline"
                      className="ml-auto text-[10px] py-0 shrink-0"
                    >
                      {option.badge}
                    </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// AllocationTab Component
// ---------------------------------------------------------------------------

interface AllocationTabProps {
  organizationId: string | null;
  entities: Array<{ id: string; name: string; code: string }>;
  scope: Scope;
  selectedEntityId: string | null;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  onAllocationActivated?: () => void;
}

export function AllocationTab({
  organizationId,
  entities,
  scope,
  selectedEntityId,
  startYear,
  startMonth,
  endYear,
  endMonth,
  onAllocationActivated,
}: AllocationTabProps) {
  const supabase = createClient();

  // Data state
  const [allocations, setAllocations] = useState<AllocationAdjustment[]>([]);
  const [masterAccounts, setMasterAccounts] = useState<MasterAccountOption[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formSourceEntityId, setFormSourceEntityId] = useState<string>("");
  const [formDestEntityId, setFormDestEntityId] = useState<string>("");
  const [formMasterAccountId, setFormMasterAccountId] = useState<string>("");
  const [formDestMasterAccountId, setFormDestMasterAccountId] =
    useState<string>("");
  const [formAmount, setFormAmount] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formScheduleType, setFormScheduleType] = useState<
    "single_month" | "monthly_spread" | "per_month_bulk"
  >("single_month");
  // Single month fields
  const [formYear, setFormYear] = useState(endYear);
  const [formMonth, setFormMonth] = useState(endMonth);
  // Monthly spread fields
  const [formStartYear, setFormStartYear] = useState(startYear);
  const [formStartMonth, setFormStartMonth] = useState(startMonth);
  const [formEndYear, setFormEndYear] = useState(endYear);
  const [formEndMonth, setFormEndMonth] = useState(endMonth);
  // Repeating fields
  const [formIsRepeating, setFormIsRepeating] = useState(false);
  const [formRepeatEndYear, setFormRepeatEndYear] = useState(endYear);
  const [formRepeatEndMonth, setFormRepeatEndMonth] = useState(endMonth);

  // Memoize entity options for combobox
  const entityOptions: ComboboxOption[] = useMemo(
    () =>
      entities.map((e) => ({
        value: e.id,
        label: `${e.code} — ${e.name}`,
      })),
    [entities]
  );

  // Whether this is a reclass (same entity, different accounts)
  const isReclass =
    formSourceEntityId !== "" && formSourceEntityId === formDestEntityId;

  // Destination master account options (exclude the source master account)
  const destMasterAccountOptions: ComboboxOption[] = useMemo(
    () =>
      masterAccounts
        .filter((ma) => ma.id !== formMasterAccountId)
        .map((ma) => ({
          value: ma.id,
          label: `${ma.account_number} — ${ma.name}`,
          sublabel: ma.classification,
          badge: ma.classification,
        })),
    [masterAccounts, formMasterAccountId]
  );

  // Memoize master account options for combobox
  const masterAccountOptions: ComboboxOption[] = useMemo(
    () =>
      masterAccounts.map((ma) => ({
        value: ma.id,
        label: `${ma.account_number} — ${ma.name}`,
        sublabel: ma.classification,
        badge: ma.classification,
      })),
    [masterAccounts]
  );

  // Load allocations
  const loadAllocations = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[];
    try {
      data = await fetchAllPaginated<any>((offset, limit) => {
        let q = (supabase as any)
          .from("allocation_adjustments")
          .select(
            `
            *,
            source:entities!allocation_adjustments_source_entity_id_fkey(name, code),
            destination:entities!allocation_adjustments_destination_entity_id_fkey(name, code),
            master_accounts!allocation_adjustments_master_account_id_fkey!inner(name, account_number),
            dest_master:master_accounts!allocation_adjustments_destination_master_account_id_fkey(name, account_number)
          `
          )
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false });

        if (scope === "entity" && selectedEntityId) {
          q = q.or(
            `source_entity_id.eq.${selectedEntityId},destination_entity_id.eq.${selectedEntityId}`
          );
        }

        return q.range(offset, offset + limit - 1);
      });
    } catch {
      toast.error("Failed to load allocations");
      setLoading(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = data.map((row: any) => ({
      ...row,
      source_entity_name: row.source?.name,
      source_entity_code: row.source?.code,
      destination_entity_name: row.destination?.name,
      destination_entity_code: row.destination?.code,
      master_account_name: row.master_accounts?.name,
      master_account_number: row.master_accounts?.account_number,
      destination_master_account_name: row.dest_master?.name,
      destination_master_account_number: row.dest_master?.account_number,
    }));

    setAllocations(mapped);
    setLoading(false);
  }, [supabase, organizationId, scope, selectedEntityId]);

  // Load master accounts for dropdown
  const loadMasterAccounts = useCallback(async () => {
    if (!organizationId) return;

    // Allocations are management-only, so scope the dropdown to the
    // management chart.
    const { data: mgmtChart } = await supabase
      .from("master_charts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("kind", "management")
      .single();

    if (!mgmtChart) {
      setMasterAccounts([]);
      return;
    }

    const { data } = await supabase
      .from("master_accounts")
      .select("id, account_number, name, classification, account_type")
      .eq("organization_id", organizationId)
      .eq("chart_id", mgmtChart.id)
      .eq("is_active", true)
      .order("display_order")
      .order("account_number");

    setMasterAccounts((data as MasterAccountOption[]) ?? []);
  }, [supabase, organizationId]);

  useEffect(() => {
    loadAllocations();
    loadMasterAccounts();
  }, [loadAllocations, loadMasterAccounts]);

  // Reset form
  function resetForm() {
    setEditingId(null);
    setFormSourceEntityId("");
    setFormDestEntityId("");
    setFormMasterAccountId("");
    setFormDestMasterAccountId("");
    setFormAmount("");
    setFormDescription("");
    setFormNotes("");
    setFormScheduleType("single_month");
    setFormYear(endYear);
    setFormMonth(endMonth);
    setFormStartYear(startYear);
    setFormStartMonth(startMonth);
    setFormEndYear(endYear);
    setFormEndMonth(endMonth);
    setFormIsRepeating(false);
    setFormRepeatEndYear(endYear);
    setFormRepeatEndMonth(endMonth);
  }

  // Open add dialog
  function handleAdd() {
    resetForm();
    setShowDialog(true);
  }

  // Open edit dialog
  function handleEdit(alloc: AllocationAdjustment) {
    setEditingId(alloc.id);
    setFormSourceEntityId(alloc.source_entity_id);
    setFormDestEntityId(alloc.destination_entity_id);
    setFormMasterAccountId(alloc.master_account_id);
    setFormDestMasterAccountId(alloc.destination_master_account_id ?? "");
    setFormAmount(String(alloc.amount));
    setFormDescription(alloc.description);
    setFormNotes(alloc.notes ?? "");
    setFormScheduleType(alloc.schedule_type);
    if (alloc.schedule_type === "single_month") {
      setFormYear(alloc.period_year ?? endYear);
      setFormMonth(alloc.period_month ?? endMonth);
    } else {
      setFormStartYear(alloc.start_year ?? startYear);
      setFormStartMonth(alloc.start_month ?? startMonth);
      setFormEndYear(alloc.end_year ?? endYear);
      setFormEndMonth(alloc.end_month ?? endMonth);
    }
    setFormIsRepeating(alloc.is_repeating ?? false);
    setFormRepeatEndYear(alloc.repeat_end_year ?? endYear);
    setFormRepeatEndMonth(alloc.repeat_end_month ?? endMonth);
    setShowDialog(true);
  }

  // Save (create or update)
  async function handleSave() {
    if (
      !formSourceEntityId ||
      !formDestEntityId ||
      !formMasterAccountId ||
      !formDescription.trim()
    ) {
      toast.error(
        "Source entity, destination entity, master account, and description are required"
      );
      return;
    }

    // Reclass: same entity requires a destination master account
    const reclassMode =
      formSourceEntityId === formDestEntityId;
    if (reclassMode && !formDestMasterAccountId) {
      toast.error(
        "Same-entity reclass requires a destination account to move the amount to"
      );
      return;
    }
    if (reclassMode && formMasterAccountId === formDestMasterAccountId) {
      toast.error("Source and destination accounts must be different");
      return;
    }

    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount === 0) {
      toast.error("Amount must be a non-zero number");
      return;
    }

    if (
      formScheduleType === "monthly_spread" ||
      formScheduleType === "per_month_bulk"
    ) {
      const months = countMonthsInRange(
        formStartYear,
        formStartMonth,
        formEndYear,
        formEndMonth
      );
      if (months < 1) {
        toast.error("End period must be on or after start period");
        return;
      }
    }

    // Validate repeating end date
    if (formIsRepeating && formScheduleType === "single_month") {
      const repeatMonths = countMonthsInRange(
        formYear,
        formMonth,
        formRepeatEndYear,
        formRepeatEndMonth
      );
      if (repeatMonths < 2) {
        toast.error(
          "Repeat-through date must be at least one month after the start period"
        );
        return;
      }
    }

    setSaving(true);

    // Per-month bulk: create N single_month rows in one insert
    if (formScheduleType === "per_month_bulk") {
      const rows: Record<string, unknown>[] = [];
      let y = formStartYear;
      let m = formStartMonth;
      while (
        y < formEndYear ||
        (y === formEndYear && m <= formEndMonth)
      ) {
        rows.push({
          organization_id: organizationId,
          source_entity_id: formSourceEntityId,
          destination_entity_id: formDestEntityId,
          master_account_id: formMasterAccountId,
          destination_master_account_id: reclassMode
            ? formDestMasterAccountId
            : null,
          amount,
          description: formDescription.trim(),
          notes: formNotes.trim() || null,
          schedule_type: "single_month",
          period_year: y,
          period_month: m,
          start_year: null,
          start_month: null,
          end_year: null,
          end_month: null,
          is_repeating: false,
          repeat_end_year: null,
          repeat_end_month: null,
        });
        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("allocation_adjustments")
        .insert(rows);

      if (error) {
        toast.error(error.message);
      } else {
        toast.success(`Created ${rows.length} allocations`);
        setShowDialog(false);
        loadAllocations();
        onAllocationActivated?.();
      }
      setSaving(false);
      return;
    }

    const payload: Record<string, unknown> = {
      organization_id: organizationId,
      source_entity_id: formSourceEntityId,
      destination_entity_id: formDestEntityId,
      master_account_id: formMasterAccountId,
      destination_master_account_id: reclassMode
        ? formDestMasterAccountId
        : null,
      amount,
      description: formDescription.trim(),
      notes: formNotes.trim() || null,
      schedule_type: formScheduleType,
    };

    if (formScheduleType === "single_month") {
      payload.period_year = formYear;
      payload.period_month = formMonth;
      payload.start_year = null;
      payload.start_month = null;
      payload.end_year = null;
      payload.end_month = null;
      payload.is_repeating = formIsRepeating;
      payload.repeat_end_year = formIsRepeating ? formRepeatEndYear : null;
      payload.repeat_end_month = formIsRepeating ? formRepeatEndMonth : null;
    } else {
      payload.period_year = null;
      payload.period_month = null;
      payload.start_year = formStartYear;
      payload.start_month = formStartMonth;
      payload.end_year = formEndYear;
      payload.end_month = formEndMonth;
      payload.is_repeating = false;
      payload.repeat_end_year = null;
      payload.repeat_end_month = null;
    }

    if (editingId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("allocation_adjustments")
        .update(payload)
        .eq("id", editingId);

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Allocation updated");
        setShowDialog(false);
        loadAllocations();
        onAllocationActivated?.();
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("allocation_adjustments")
        .insert(payload);

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Allocation created");
        setShowDialog(false);
        loadAllocations();
        onAllocationActivated?.();
      }
    }

    setSaving(false);
  }

  // Delete
  async function handleDelete(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("allocation_adjustments")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Allocation deleted");
      setAllocations((prev) => prev.filter((a) => a.id !== id));
    }
  }

  // Toggle exclude
  async function handleToggleExclude(id: string, currentValue: boolean) {
    // Optimistic update
    setAllocations((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, is_excluded: !currentValue } : a
      )
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("allocation_adjustments")
      .update({ is_excluded: !currentValue })
      .eq("id", id);

    if (error) {
      // Revert on error
      setAllocations((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, is_excluded: currentValue } : a
        )
      );
      toast.error("Failed to update");
    } else if (currentValue) {
      // Was excluded, now re-included
      onAllocationActivated?.();
    }
  }

  const activeCount = allocations.filter((a) => !a.is_excluded).length;

  // Compute monthly amount for display
  function getMonthlyAmount(alloc: AllocationAdjustment): number | null {
    if (alloc.schedule_type !== "monthly_spread") return null;
    if (
      !alloc.start_year ||
      !alloc.start_month ||
      !alloc.end_year ||
      !alloc.end_month
    )
      return null;
    const months = countMonthsInRange(
      alloc.start_year,
      alloc.start_month,
      alloc.end_year,
      alloc.end_month
    );
    if (months < 1) return null;
    return alloc.amount / months;
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <h3 className="text-lg font-semibold">Allocation Adjustments</h3>
            <p className="text-sm text-muted-foreground">
              {allocations.length} allocation{allocations.length !== 1 && "s"}
              {allocations.length > 0 && ` (${activeCount} active)`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Move amounts between entities or between accounts within the same
              entity (reclass).
            </p>
          </div>
          <Button size="sm" onClick={handleAdd} disabled={!organizationId}>
            <Plus className="h-4 w-4 mr-1" />
            Add Allocation
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Loading allocations...
            </p>
          ) : allocations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No allocation adjustments.{" "}
              {scope === "entity" && !selectedEntityId
                ? "Select an entity to get started."
                : 'Click "Add Allocation" to create one.'}
            </p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">
                      Source → Destination
                    </TableHead>
                    <TableHead className="w-[200px]">Master Account</TableHead>
                    <TableHead className="w-[160px]">Period</TableHead>
                    <TableHead className="w-[120px] text-right">
                      Amount
                    </TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[80px] text-center">
                      Excluded
                    </TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocations.map((alloc) => {
                    const monthlyAmt = getMonthlyAmount(alloc);
                    return (
                      <TableRow
                        key={alloc.id}
                        className={alloc.is_excluded ? "opacity-50" : ""}
                      >
                        <TableCell className="text-xs">
                          {alloc.destination_master_account_id ? (
                            <>
                              <div className="flex items-center gap-1">
                                <span className="font-medium">
                                  {alloc.source_entity_code}
                                </span>
                                <Badge
                                  variant="secondary"
                                  className="text-[9px] py-0"
                                >
                                  reclass
                                </Badge>
                              </div>
                              <span className="text-muted-foreground text-[11px]">
                                {alloc.source_entity_name}
                              </span>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center gap-1">
                                <span className="font-medium">
                                  {alloc.source_entity_code}
                                </span>
                                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                <span className="font-medium">
                                  {alloc.destination_entity_code}
                                </span>
                              </div>
                              <span className="text-muted-foreground text-[11px]">
                                {alloc.source_entity_name} →{" "}
                                {alloc.destination_entity_name}
                              </span>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {alloc.destination_master_account_id ? (
                            <div>
                              <div className="flex items-center gap-1">
                                <span className="font-medium">
                                  {alloc.master_account_number}
                                </span>
                                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                <span className="font-medium">
                                  {alloc.destination_master_account_number}
                                </span>
                              </div>
                              <span className="text-muted-foreground text-[11px]">
                                {alloc.master_account_name} →{" "}
                                {alloc.destination_master_account_name}
                              </span>
                            </div>
                          ) : (
                            <>
                              <span className="font-medium">
                                {alloc.master_account_number}
                              </span>{" "}
                              — {alloc.master_account_name}
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {alloc.schedule_type === "single_month" ? (
                            <div>
                              <span>
                                {formatPeriod(
                                  alloc.period_year!,
                                  alloc.period_month!
                                )}
                              </span>
                              {alloc.is_repeating &&
                                alloc.repeat_end_year &&
                                alloc.repeat_end_month && (
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <Repeat className="h-3 w-3 text-blue-500" />
                                    <span className="text-[11px] text-muted-foreground">
                                      through{" "}
                                      {formatPeriod(
                                        alloc.repeat_end_year,
                                        alloc.repeat_end_month
                                      )}
                                    </span>
                                  </div>
                                )}
                            </div>
                          ) : (
                            <div>
                              <span>
                                {formatPeriodRange(
                                  alloc.start_year!,
                                  alloc.start_month!,
                                  alloc.end_year!,
                                  alloc.end_month!
                                )}
                              </span>
                              <Badge
                                variant="secondary"
                                className="ml-1 text-[9px] py-0"
                              >
                                spread
                              </Badge>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-medium">
                          <div>
                            {formatStatementAmount(alloc.amount, true)}
                          </div>
                          {monthlyAmt !== null && (
                            <div className="text-[10px] text-muted-foreground">
                              {formatStatementAmount(monthlyAmt, true)}/mo
                            </div>
                          )}
                          {alloc.is_repeating && (
                            <div className="text-[10px] text-blue-500">
                              {formatStatementAmount(alloc.amount, true)}/mo
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs max-w-[300px]">
                          <span className="line-clamp-2">
                            {alloc.description}
                          </span>
                          {alloc.notes && (
                            <span className="text-muted-foreground block text-[11px] line-clamp-1 mt-0.5">
                              {alloc.notes}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={alloc.is_excluded}
                            onCheckedChange={() =>
                              handleToggleExclude(alloc.id, alloc.is_excluded)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => handleEdit(alloc)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(alloc.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Allocation" : "Add Allocation Adjustment"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the details of this allocation."
                : "Move amounts between entities, or between accounts within the same entity (reclass). Select the same entity for both source and destination to create a reclass."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Source Entity - Searchable Combobox */}
            <div className="space-y-1.5">
              <Label className="text-xs">
                {isReclass ? "Entity" : "Source Entity (costs move from)"}
              </Label>
              <SearchableCombobox
                options={entityOptions}
                value={formSourceEntityId}
                onValueChange={(val) => {
                  setFormSourceEntityId(val);
                  // If destination was set to the old source, keep it synced
                  // (only for reclass mode continuity)
                }}
                placeholder="Search and select entity..."
                searchPlaceholder="Search entities..."
                emptyMessage="No entities found."
              />
            </div>

            {/* Destination Entity - Searchable Combobox */}
            <div className="space-y-1.5">
              <Label className="text-xs">
                Destination Entity{" "}
                {isReclass ? "(same = reclass)" : "(costs move to)"}
              </Label>
              <SearchableCombobox
                options={entityOptions}
                value={formDestEntityId}
                onValueChange={(val) => {
                  setFormDestEntityId(val);
                  // Clear dest master account if switching to inter-entity
                  if (val !== formSourceEntityId) {
                    setFormDestMasterAccountId("");
                  }
                }}
                placeholder="Search and select destination entity..."
                searchPlaceholder="Search entities..."
                emptyMessage="No entities found."
              />
              {isReclass && (
                <p className="text-[11px] text-blue-600">
                  Same entity selected — this is a reclass between accounts.
                </p>
              )}
            </div>

            {/* Master Account - Searchable Combobox */}
            <div className="space-y-1.5">
              <Label className="text-xs">
                {isReclass ? "From Account (reduce)" : "Master Account"}
              </Label>
              <SearchableCombobox
                options={masterAccountOptions}
                value={formMasterAccountId}
                onValueChange={(val) => {
                  setFormMasterAccountId(val);
                  // Clear dest master account if it matches the new source
                  if (val && val === formDestMasterAccountId) {
                    setFormDestMasterAccountId("");
                  }
                }}
                placeholder="Search and select master account..."
                searchPlaceholder="Search by name or number..."
                emptyMessage="No accounts found."
              />
            </div>

            {/* Destination Master Account (reclass only) */}
            {isReclass && (
              <div className="space-y-1.5">
                <Label className="text-xs">To Account (increase)</Label>
                <SearchableCombobox
                  options={destMasterAccountOptions}
                  value={formDestMasterAccountId}
                  onValueChange={setFormDestMasterAccountId}
                  placeholder="Search and select destination account..."
                  searchPlaceholder="Search by name or number..."
                  emptyMessage="No accounts found."
                />
              </div>
            )}

            {/* Schedule Type */}
            <div className="space-y-1.5">
              <Label className="text-xs">Schedule</Label>
              <Select
                value={formScheduleType}
                onValueChange={(v) => {
                  const newType = v as
                    | "single_month"
                    | "monthly_spread"
                    | "per_month_bulk";
                  setFormScheduleType(newType);
                  // Repeating only applies to single_month
                  if (newType !== "single_month") {
                    setFormIsRepeating(false);
                  }
                }}
                disabled={!!editingId}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_month">Single Month</SelectItem>
                  <SelectItem value="monthly_spread">
                    Monthly Spread (divide across months)
                  </SelectItem>
                  {!editingId && (
                    <SelectItem value="per_month_bulk">
                      Per-Month Entries (separate row per month)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Period fields */}
            {formScheduleType === "single_month" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Month</Label>
                    <Select
                      value={String(formMonth)}
                      onValueChange={(v) => setFormMonth(parseInt(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Year</Label>
                    <Select
                      value={String(formYear)}
                      onValueChange={(v) => setFormYear(parseInt(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {YEARS.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Repeating checkbox */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={formIsRepeating}
                      onCheckedChange={(checked) =>
                        setFormIsRepeating(checked === true)
                      }
                    />
                    <Repeat className="h-3.5 w-3.5 text-blue-500" />
                    Repeating (full amount each month)
                  </label>

                  {formIsRepeating && (
                    <div className="ml-6 space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Repeat through
                      </Label>
                      <div className="grid grid-cols-2 gap-3">
                        <Select
                          value={String(formRepeatEndMonth)}
                          onValueChange={(v) =>
                            setFormRepeatEndMonth(parseInt(v))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MONTHS.map((m, i) => (
                              <SelectItem key={i + 1} value={String(i + 1)}>
                                {m}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={String(formRepeatEndYear)}
                          onValueChange={(v) =>
                            setFormRepeatEndYear(parseInt(v))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {YEARS.map((y) => (
                              <SelectItem key={y} value={String(y)}>
                                {y}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        The full amount of{" "}
                        {formAmount && !isNaN(parseFloat(formAmount))
                          ? formatStatementAmount(
                              parseFloat(formAmount),
                              true
                            )
                          : "$0"}{" "}
                        will be applied every month from{" "}
                        {formatPeriod(formYear, formMonth)} through{" "}
                        {formatPeriod(formRepeatEndYear, formRepeatEndMonth)} (
                        {countMonthsInRange(
                          formYear,
                          formMonth,
                          formRepeatEndYear,
                          formRepeatEndMonth
                        )}{" "}
                        months).
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Start Month</Label>
                    <Select
                      value={String(formStartMonth)}
                      onValueChange={(v) => setFormStartMonth(parseInt(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Start Year</Label>
                    <Select
                      value={String(formStartYear)}
                      onValueChange={(v) => setFormStartYear(parseInt(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {YEARS.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">End Month</Label>
                    <Select
                      value={String(formEndMonth)}
                      onValueChange={(v) => setFormEndMonth(parseInt(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">End Year</Label>
                    <Select
                      value={String(formEndYear)}
                      onValueChange={(v) => setFormEndYear(parseInt(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {YEARS.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {formScheduleType === "monthly_spread" && (
                  <p className="text-[11px] text-muted-foreground">
                    Total amount will be divided equally across{" "}
                    {countMonthsInRange(
                      formStartYear,
                      formStartMonth,
                      formEndYear,
                      formEndMonth
                    )}{" "}
                    month(s).
                    {formAmount &&
                      !isNaN(parseFloat(formAmount)) &&
                      countMonthsInRange(
                        formStartYear,
                        formStartMonth,
                        formEndYear,
                        formEndMonth
                      ) > 0 &&
                      ` (${formatStatementAmount(parseFloat(formAmount) / countMonthsInRange(formStartYear, formStartMonth, formEndYear, formEndMonth), true)}/mo)`}
                  </p>
                )}
                {formScheduleType === "per_month_bulk" && (
                  <p className="text-[11px] text-blue-600">
                    Will create{" "}
                    {countMonthsInRange(
                      formStartYear,
                      formStartMonth,
                      formEndYear,
                      formEndMonth
                    )}{" "}
                    separate single-month allocation row(s), one per month, each
                    with the amount below. Each row can be edited or deleted
                    independently afterwards.
                  </p>
                )}
              </div>
            )}

            {/* Amount */}
            <div className="space-y-1.5">
              <Label className="text-xs">
                {formScheduleType === "per_month_bulk"
                  ? "Amount (per month)"
                  : "Amount"}
              </Label>
              <Input
                type="number"
                step="0.01"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="e.g. 5000"
                className="h-8 text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                {formScheduleType === "per_month_bulk"
                  ? isReclass
                    ? "This amount will be moved from the source account to the destination account each month, for every month in the range."
                    : "This amount will be removed from the source entity and added to the destination entity each month, for every month in the range."
                  : isReclass
                    ? "This amount will be moved from the source account to the destination account within the same entity."
                    : "This amount will be removed from the source entity and added to the destination entity for the selected account."}
              </p>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Describe the nature of this allocation..."
                className="text-xs min-h-[60px] max-h-[120px]"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Additional details..."
                className="text-xs min-h-[40px] max-h-[80px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDialog(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving
                ? "Saving..."
                : editingId
                  ? "Update"
                  : formScheduleType === "per_month_bulk"
                    ? `Add ${countMonthsInRange(formStartYear, formStartMonth, formEndYear, formEndMonth)} Allocations`
                    : "Add Allocation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

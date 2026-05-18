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
  ChevronsUpDown,
  Check,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatStatementAmount } from "./format-utils";
import type { Scope, ProFormaAdjustment } from "./types";

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

interface ProFormaTabProps {
  organizationId: string | null;
  entities: Array<{ id: string; name: string; code: string }>;
  scope: Scope;
  selectedEntityId: string | null;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  /** Called when an adjustment is created, updated, or un-excluded so the
   *  parent can auto-enable the includeProForma toggle. */
  onAdjustmentActivated?: () => void;
}

export function ProFormaTab({
  organizationId,
  entities,
  scope,
  selectedEntityId,
  startYear,
  startMonth,
  endYear,
  endMonth,
  onAdjustmentActivated,
}: ProFormaTabProps) {
  const supabase = createClient();

  // Data state
  const [adjustments, setAdjustments] = useState<ProFormaAdjustment[]>([]);
  const [masterAccounts, setMasterAccounts] = useState<MasterAccountOption[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  // Search + sort
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState<"company" | "account" | "month">(
    "month"
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formEntityId, setFormEntityId] = useState<string>("");
  const [formMasterAccountId, setFormMasterAccountId] = useState<string>("");
  const [formOffsetMasterAccountId, setFormOffsetMasterAccountId] = useState<string>("");
  const [formPeriods, setFormPeriods] = useState<
    Array<{ year: number; month: number; amount: string }>
  >([{ year: endYear, month: endMonth, amount: "" }]);
  const [formDescription, setFormDescription] = useState("");
  const [formNotes, setFormNotes] = useState("");

  // Load adjustments
  const loadAdjustments = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[];
    try {
      data = await fetchAllPaginated<any>((offset, limit) => {
        let q = (supabase as any)
          .from("pro_forma_adjustments")
          .select(
            `
            *,
            entities!inner(name, code),
            master_accounts!master_account_id!inner(name, account_number),
            offset_account:master_accounts!offset_master_account_id(name, account_number)
          `
          )
          .eq("organization_id", organizationId)
          .order("period_year", { ascending: true })
          .order("period_month", { ascending: true });

        if (scope === "entity" && selectedEntityId) {
          q = q.eq("entity_id", selectedEntityId);
        }

        return q.range(offset, offset + limit - 1);
      });
    } catch {
      toast.error("Failed to load adjustments");
      setLoading(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = data.map((row: any) => ({
      ...row,
      entity_name: row.entities?.name,
      entity_code: row.entities?.code,
      master_account_name: row.master_accounts?.name,
      master_account_number: row.master_accounts?.account_number,
      offset_master_account_name: row.offset_account?.name ?? null,
      offset_master_account_number: row.offset_account?.account_number ?? null,
    }));

    setAdjustments(mapped);
    setLoading(false);
  }, [supabase, organizationId, scope, selectedEntityId]);

  // Load master accounts for dropdown
  const loadMasterAccounts = useCallback(async () => {
    if (!organizationId) return;

    // Pro forma is a management-prepared adjustment, so the dropdown is
    // scoped to the management chart only.
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
    loadAdjustments();
    loadMasterAccounts();
  }, [loadAdjustments, loadMasterAccounts]);

  // Searchable option arrays
  const entityOptions: ComboboxOption[] = useMemo(
    () =>
      entities.map((e) => ({
        value: e.id,
        label: `${e.code} — ${e.name}`,
      })),
    [entities]
  );

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

  const offsetAccountOptions: ComboboxOption[] = useMemo(
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

  // Reset form
  function resetForm() {
    setEditingId(null);
    setFormEntityId(
      scope === "entity" && selectedEntityId ? selectedEntityId : ""
    );
    setFormMasterAccountId("");
    setFormOffsetMasterAccountId("");
    setFormPeriods([{ year: endYear, month: endMonth, amount: "" }]);
    setFormDescription("");
    setFormNotes("");
  }

  function updatePeriod(
    index: number,
    patch: Partial<{ year: number; month: number; amount: string }>
  ) {
    setFormPeriods((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...patch } : p))
    );
  }

  function addPeriod() {
    setFormPeriods((prev) => {
      const last = prev[prev.length - 1];
      const baseYear = last?.year ?? endYear;
      const baseMonth = last?.month ?? endMonth;
      // Auto-advance to the next month
      const nextMonth = baseMonth === 12 ? 1 : baseMonth + 1;
      const nextYear = baseMonth === 12 ? baseYear + 1 : baseYear;
      return [...prev, { year: nextYear, month: nextMonth, amount: "" }];
    });
  }

  function removePeriod(index: number) {
    setFormPeriods((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== index)
    );
  }

  // Open add dialog
  function handleAdd() {
    resetForm();
    setShowDialog(true);
  }

  // Open edit dialog
  function handleEdit(adj: ProFormaAdjustment) {
    setEditingId(adj.id);
    setFormEntityId(adj.entity_id);
    setFormMasterAccountId(adj.master_account_id);
    setFormOffsetMasterAccountId(adj.offset_master_account_id ?? "");
    setFormPeriods([
      {
        year: adj.period_year,
        month: adj.period_month,
        amount: String(adj.amount),
      },
    ]);
    setFormDescription(adj.description);
    setFormNotes(adj.notes ?? "");
    setShowDialog(true);
  }

  // Save (create or update)
  async function handleSave() {
    if (!formEntityId || !formMasterAccountId || !formDescription.trim()) {
      toast.error("Entity, master account, and description are required");
      return;
    }

    if (!formOffsetMasterAccountId && !editingId) {
      toast.error("Offset account is required for new adjustments");
      return;
    }

    if (formPeriods.length === 0) {
      toast.error("Add at least one period");
      return;
    }

    const parsedPeriods: Array<{ year: number; month: number; amount: number }> = [];
    for (let i = 0; i < formPeriods.length; i++) {
      const p = formPeriods[i];
      const amount = parseFloat(p.amount);
      if (isNaN(amount)) {
        toast.error(`Row ${i + 1}: amount must be a valid number`);
        return;
      }
      parsedPeriods.push({ year: p.year, month: p.month, amount });
    }

    // Check for duplicate (year, month) pairs in this submission
    const seen = new Set<string>();
    for (const p of parsedPeriods) {
      const key = `${p.year}-${p.month}`;
      if (seen.has(key)) {
        toast.error(
          `Duplicate period ${MONTHS[p.month - 1]} ${p.year} — combine into one row`
        );
        return;
      }
      seen.add(key);
    }

    setSaving(true);

    const sharedPayload = {
      organization_id: organizationId,
      entity_id: formEntityId,
      master_account_id: formMasterAccountId,
      offset_master_account_id: formOffsetMasterAccountId || null,
      description: formDescription.trim(),
      notes: formNotes.trim() || null,
    };

    if (editingId) {
      // Edit affects a single existing row only.
      const p = parsedPeriods[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("pro_forma_adjustments")
        .update({
          ...sharedPayload,
          period_year: p.year,
          period_month: p.month,
          amount: p.amount,
        })
        .eq("id", editingId);

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Adjustment updated");
        setShowDialog(false);
        loadAdjustments();
        onAdjustmentActivated?.();
      }
    } else {
      const rows = parsedPeriods.map((p) => ({
        ...sharedPayload,
        period_year: p.year,
        period_month: p.month,
        amount: p.amount,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("pro_forma_adjustments")
        .insert(rows);

      if (error) {
        toast.error(error.message);
      } else {
        toast.success(
          rows.length === 1
            ? "Adjustment created"
            : `${rows.length} adjustments created`
        );
        setShowDialog(false);
        loadAdjustments();
        onAdjustmentActivated?.();
      }
    }

    setSaving(false);
  }

  // Delete
  async function handleDelete(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("pro_forma_adjustments")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Adjustment deleted");
      setAdjustments((prev) => prev.filter((a) => a.id !== id));
    }
  }

  // Toggle exclude
  async function handleToggleExclude(id: string, currentValue: boolean) {
    // Optimistic update
    setAdjustments((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, is_excluded: !currentValue } : a
      )
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("pro_forma_adjustments")
      .update({ is_excluded: !currentValue })
      .eq("id", id);

    if (error) {
      // Revert on error
      setAdjustments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, is_excluded: currentValue } : a
        )
      );
      toast.error("Failed to update");
    } else if (currentValue) {
      // Was excluded, now re-included — notify parent to enable pro forma
      onAdjustmentActivated?.();
    }
  }

  const activeCount = adjustments.filter((a) => !a.is_excluded).length;
  const showEntityColumn = scope === "organization";

  // Filtered + sorted view of the adjustments
  const visibleAdjustments = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    let rows = adjustments;
    if (q) {
      rows = rows.filter((a) =>
        [
          a.entity_code,
          a.entity_name,
          a.master_account_number,
          a.master_account_name,
          a.offset_master_account_number,
          a.offset_master_account_name,
          a.description,
          a.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "company") {
        cmp = (a.entity_code ?? "").localeCompare(b.entity_code ?? "");
      } else if (sortBy === "account") {
        cmp = (a.master_account_number ?? "").localeCompare(
          b.master_account_number ?? "",
          undefined,
          { numeric: true }
        );
      } else {
        cmp =
          a.period_year - b.period_year ||
          a.period_month - b.period_month;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [adjustments, searchText, sortBy, sortDir]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <h3 className="text-lg font-semibold">Pro Forma Adjustments</h3>
            <p className="text-sm text-muted-foreground">
              {searchText.trim()
                ? `${visibleAdjustments.length} of ${adjustments.length} adjustment${adjustments.length !== 1 ? "s" : ""}`
                : `${adjustments.length} adjustment${adjustments.length !== 1 ? "s" : ""}`}
              {adjustments.length > 0 && ` (${activeCount} active)`}
            </p>
          </div>
          <Button size="sm" onClick={handleAdd} disabled={!organizationId}>
            <Plus className="h-4 w-4 mr-1" />
            Add Adjustment
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Loading adjustments...
            </p>
          ) : adjustments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No pro forma adjustments.{" "}
              {scope === "entity" && !selectedEntityId
                ? "Select an entity to get started."
                : 'Click "Add Adjustment" to create one.'}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center mb-3">
                <Input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search company, account, or description..."
                  className="h-8 text-xs sm:max-w-xs"
                />
                <div className="flex items-center gap-2">
                  <Select
                    value={sortBy}
                    onValueChange={(v) =>
                      setSortBy(v as "company" | "account" | "month")
                    }
                  >
                    <SelectTrigger className="h-8 w-[150px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company">Sort: Company</SelectItem>
                      <SelectItem value="account">Sort: GL Account</SelectItem>
                      <SelectItem value="month">Sort: Month</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() =>
                      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                    }
                    aria-label="Toggle sort direction"
                  >
                    {sortDir === "asc" ? (
                      <ArrowUp className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDown className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
              {visibleAdjustments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No adjustments match your search.
                </p>
              ) : (
                <div className="rounded-md border overflow-auto">
                  <Table>
                <TableHeader>
                  <TableRow>
                    {showEntityColumn && (
                      <TableHead className="w-[140px]">Entity</TableHead>
                    )}
                    <TableHead className="w-[200px]">Master Account</TableHead>
                    <TableHead className="w-[200px]">Offset Account</TableHead>
                    <TableHead className="w-[100px]">Period</TableHead>
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
                  {visibleAdjustments.map((adj) => (
                    <TableRow
                      key={adj.id}
                      className={adj.is_excluded ? "opacity-50" : ""}
                    >
                      {showEntityColumn && (
                        <TableCell className="text-xs">
                          <span className="font-medium">
                            {adj.entity_code}
                          </span>{" "}
                          — {adj.entity_name}
                        </TableCell>
                      )}
                      <TableCell className="text-xs">
                        <span className="font-medium">
                          {adj.master_account_number}
                        </span>{" "}
                        — {adj.master_account_name}
                      </TableCell>
                      <TableCell className="text-xs">
                        {adj.offset_master_account_number ? (
                          <>
                            <span className="font-medium">
                              {adj.offset_master_account_number}
                            </span>{" "}
                            — {adj.offset_master_account_name}
                          </>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                            Single-entry
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatPeriod(adj.period_year, adj.period_month)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs font-medium">
                        {formatStatementAmount(adj.amount, true)}
                      </TableCell>
                      <TableCell className="text-xs max-w-[300px]">
                        <span className="line-clamp-2">{adj.description}</span>
                        {adj.notes && (
                          <span className="text-muted-foreground block text-[11px] line-clamp-1 mt-0.5">
                            {adj.notes}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={adj.is_excluded}
                          onCheckedChange={() =>
                            handleToggleExclude(adj.id, adj.is_excluded)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleEdit(adj)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(adj.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Adjustment" : "Add Pro Forma Adjustment"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the details of this adjustment."
                : "Create a new pro forma adjustment tied to a master account."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Entity */}
            <div className="space-y-1.5">
              <Label className="text-xs">Entity</Label>
              <SearchableCombobox
                options={entityOptions}
                value={formEntityId}
                onValueChange={setFormEntityId}
                placeholder="Search and select entity..."
                searchPlaceholder="Search by name or code..."
                emptyMessage="No entities found."
              />
            </div>

            {/* Master Account */}
            <div className="space-y-1.5">
              <Label className="text-xs">Master Account</Label>
              <SearchableCombobox
                options={masterAccountOptions}
                value={formMasterAccountId}
                onValueChange={(val) => {
                  setFormMasterAccountId(val);
                  // Clear offset if it matches the new master account
                  if (val && val === formOffsetMasterAccountId) {
                    setFormOffsetMasterAccountId("");
                  }
                }}
                placeholder="Search and select master account..."
                searchPlaceholder="Search by name or number..."
                emptyMessage="No accounts found."
              />
            </div>

            {/* Offset Account */}
            <div className="space-y-1.5">
              <Label className="text-xs">
                Offset Account
                {!editingId && <span className="text-destructive ml-0.5">*</span>}
              </Label>
              <SearchableCombobox
                options={offsetAccountOptions}
                value={formOffsetMasterAccountId}
                onValueChange={setFormOffsetMasterAccountId}
                placeholder="Search and select offset account..."
                searchPlaceholder="Search by name or number..."
                emptyMessage="No accounts found."
              />
              <p className="text-[11px] text-muted-foreground">
                The balancing entry. Receives the opposite sign (-amount). E.g.,
                if debiting an expense, credit a liability or cash account.
              </p>
            </div>

            {/* Periods + Amounts (multi-row in create mode, single row in edit) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  {editingId ? "Period & Amount" : "Periods & Amounts"}
                </Label>
                {!editingId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={addPeriod}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add month
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {formPeriods.map((p, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_90px_1fr_auto] gap-2 items-center"
                  >
                    <Select
                      value={String(p.month)}
                      onValueChange={(v) =>
                        updatePeriod(i, { month: parseInt(v) })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, mi) => (
                          <SelectItem key={mi + 1} value={String(mi + 1)}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(p.year)}
                      onValueChange={(v) =>
                        updatePeriod(i, { year: parseInt(v) })
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
                    <Input
                      type="number"
                      step="0.01"
                      value={p.amount}
                      onChange={(e) =>
                        updatePeriod(i, { amount: e.target.value })
                      }
                      placeholder="e.g. 5000 or -5000"
                      className="h-8 text-xs"
                    />
                    {!editingId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => removePeriod(i)}
                        disabled={formPeriods.length === 1}
                        aria-label="Remove period"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <span className="w-8" />
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Positive increases debits (expenses, assets). Negative increases
                credits (revenue, liabilities).
                {!editingId &&
                  " Each row becomes its own adjustment sharing the description and notes below."}
              </p>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Describe the nature of this adjustment..."
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
                  : formPeriods.length > 1
                    ? `Add ${formPeriods.length} Adjustments`
                    : "Add Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

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
import { Plus, Pencil, Trash2, ChevronsUpDown, Check } from "lucide-react";
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

  // Dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formEntityId, setFormEntityId] = useState<string>("");
  const [formMasterAccountId, setFormMasterAccountId] = useState<string>("");
  const [formOffsetMasterAccountId, setFormOffsetMasterAccountId] = useState<string>("");
  const [formYear, setFormYear] = useState(endYear);
  const [formMonth, setFormMonth] = useState(endMonth);
  const [formAmount, setFormAmount] = useState("");
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
    setFormYear(endYear);
    setFormMonth(endMonth);
    setFormAmount("");
    setFormDescription("");
    setFormNotes("");
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
    setFormYear(adj.period_year);
    setFormMonth(adj.period_month);
    setFormAmount(String(adj.amount));
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

    const amount = parseFloat(formAmount);
    if (isNaN(amount)) {
      toast.error("Amount must be a valid number");
      return;
    }

    setSaving(true);

    const payload = {
      organization_id: organizationId,
      entity_id: formEntityId,
      master_account_id: formMasterAccountId,
      offset_master_account_id: formOffsetMasterAccountId || null,
      period_year: formYear,
      period_month: formMonth,
      amount,
      description: formDescription.trim(),
      notes: formNotes.trim() || null,
    };

    if (editingId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("pro_forma_adjustments")
        .update(payload)
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("pro_forma_adjustments")
        .insert(payload);

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Adjustment created");
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

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <h3 className="text-lg font-semibold">Pro Forma Adjustments</h3>
            <p className="text-sm text-muted-foreground">
              {adjustments.length} adjustment{adjustments.length !== 1 && "s"}
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
                  {adjustments.map((adj) => (
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

            {/* Period */}
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

            {/* Amount */}
            <div className="space-y-1.5">
              <Label className="text-xs">Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="e.g. 5000 or -5000"
                className="h-8 text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Positive increases debits (expenses, assets). Negative increases
                credits (revenue, liabilities).
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
                  : "Add Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

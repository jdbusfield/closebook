"use client";

/**
 * Export dialog for the debt dashboard. User picks:
 *   - Format: Excel, PDF, or both
 *   - Period range (defaults to the current dashboard window)
 *   - Which instruments (lines of credit / loans) to include
 *   - Which sheets to include in the Excel (summary always on)
 *
 * The instrument filter applies to both outputs: we re-run the
 * rollforward math on the filtered instrument list before handing it off,
 * so the PDF and Excel only show the selected loans with their own
 * subtotals and grand total.
 *
 * The PDF is the polished investor/bank one-pager; the Excel is the
 * audit-quality package with source transactions. Either is safe to
 * attach to a board or bank email directly.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import type {
  DebtInstrumentInput,
  DebtTransactionInput,
  EntityRef,
  GroupedRollForward,
  MonthlyBalancePoint,
} from "@/lib/utils/debt-rollforward";
import { computeDebtRollForward } from "@/lib/utils/debt-rollforward";
import { exportDebtPdf } from "./debt-pdf";
import { exportDebtWorkbook, type ExportOptions } from "./debt-excel";

type Format = "excel" | "pdf" | "both";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizationName: string;
  scopeLabel: string;
  startIso: string;
  endIso: string;
  asOfIso: string;
  instruments: DebtInstrumentInput[];
  transactions: DebtTransactionInput[];
  entities: EntityRef[];
  trend: MonthlyBalancePoint[];
  // Live rollforward for the *current* window — if the user changes the
  // export window below we recompute on-the-fly before building output.
  currentRollForward: GroupedRollForward | null;
}

export function ExportDialog({
  open,
  onOpenChange,
  organizationName,
  scopeLabel,
  startIso,
  endIso,
  asOfIso,
  instruments,
  transactions,
  entities,
  trend,
  currentRollForward,
}: Props) {
  const [format, setFormat] = useState<Format>("both");
  const [start, setStart] = useState(startIso);
  const [end, setEnd] = useState(endIso);

  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeByEntity, setIncludeByEntity] = useState(true);
  const [includeByInstrument, setIncludeByInstrument] = useState(true);
  const [includeMonthlyDetail, setIncludeMonthlyDetail] = useState(true);
  const [includeTransactions, setIncludeTransactions] = useState(true);

  // Instrument selection — defaults to everything currently in scope.
  // Tracked as a Set so include/exclude is O(1).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(instruments.map((i) => i.id))
  );

  const [exporting, setExporting] = useState(false);

  // Re-sync the dialog's date inputs and instrument selection when the
  // dashboard's scope or window changes while the dialog is closed.
  useEffect(() => {
    if (!open) return;
    setStart(startIso);
    setEnd(endIso);
    setSelectedIds(new Set(instruments.map((i) => i.id)));
  }, [open, startIso, endIso, instruments]);

  const rangeInvalid = !start || !end || start > end;

  // Resolve entity names for the instrument picker. Entities pulled from
  // the dashboard scope are the authoritative list here.
  const entityNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) map.set(e.id, e.name);
    return map;
  }, [entities]);

  // Group instruments by entity so the picker reads as a hierarchy.
  const instrumentsByEntity = useMemo(() => {
    const groups = new Map<
      string,
      { entityName: string; items: DebtInstrumentInput[] }
    >();
    for (const inst of instruments) {
      const bucket = groups.get(inst.entity_id) ?? {
        entityName: entityNameById.get(inst.entity_id) ?? "Unassigned",
        items: [],
      };
      bucket.items.push(inst);
      groups.set(inst.entity_id, bucket);
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.entityName.localeCompare(b.entityName)
    );
  }, [instruments, entityNameById]);

  function toggleInstrument(id: string, checked: boolean): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleEntity(entityId: string, checked: boolean): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const inst of instruments) {
        if (inst.entity_id !== entityId) continue;
        if (checked) next.add(inst.id);
        else next.delete(inst.id);
      }
      return next;
    });
  }
  function selectAllInstruments(): void {
    setSelectedIds(new Set(instruments.map((i) => i.id)));
  }
  function clearAllInstruments(): void {
    setSelectedIds(new Set());
  }

  async function handleExport() {
    if (rangeInvalid) {
      toast.error("Ending period must be on or after starting period");
      return;
    }
    if (selectedIds.size === 0) {
      toast.error("Select at least one instrument to export");
      return;
    }
    if (format === "excel" || format === "both") {
      const noSheet =
        !includeSummary &&
        !includeByEntity &&
        !includeByInstrument &&
        !includeMonthlyDetail &&
        !includeTransactions;
      if (noSheet) {
        toast.error("Select at least one Excel sheet");
        return;
      }
    }
    setExporting(true);
    try {
      // Filter instruments by the picker, and filter transactions to match
      // so downstream Excel sheets (e.g., Transactions tab) stay in sync.
      const filteredInstruments = instruments.filter((i) =>
        selectedIds.has(i.id)
      );
      const filteredTransactions = transactions.filter((txn) =>
        selectedIds.has(txn.debt_instrument_id)
      );

      // If the user narrowed the instrument list or shifted the range
      // inside the dialog, recompute. Otherwise the dashboard's cached rf
      // is already correct.
      const allInstrumentsSelected =
        filteredInstruments.length === instruments.length;
      const unchangedWindow = start === startIso && end === endIso;
      const rf =
        allInstrumentsSelected && unchangedWindow
          ? currentRollForward
          : computeDebtRollForward({
              instruments: filteredInstruments,
              transactions: filteredTransactions,
              entities,
              startIso: start,
              endIso: end,
            });

      if (!rf) {
        toast.error("No data to export for this range");
        setExporting(false);
        return;
      }

      const options: ExportOptions = {
        organizationName,
        scopeLabel,
        startIso: start,
        endIso: end,
        asOfIso,
        includeSummary,
        includeByEntity,
        includeByInstrument,
        includeMonthlyDetail,
        includeTransactions,
      };

      if (format === "excel" || format === "both") {
        await exportDebtWorkbook({
          rollForward: rf,
          trend,
          instruments: filteredInstruments,
          transactions: filteredTransactions,
          entities,
          options,
        });
      }
      if (format === "pdf" || format === "both") {
        await exportDebtPdf(rf, {
          organizationName,
          scopeLabel,
          startIso: start,
          endIso: end,
          asOfIso,
        });
      }
      toast.success("Export complete");
      onOpenChange(false);
    } catch (err) {
      console.error("Debt export failed:", err);
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export Debt Roll-Forward</DialogTitle>
          <DialogDescription>
            Produces the supplemental package for investors and the bank.
            Excel for the full audit trail; PDF for the one-pager.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Format
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <FormatTile
                selected={format === "excel"}
                onClick={() => setFormat("excel")}
                icon={<FileSpreadsheet className="size-5" />}
                label="Excel"
                sub="Multi-sheet"
              />
              <FormatTile
                selected={format === "pdf"}
                onClick={() => setFormat("pdf")}
                icon={<FileText className="size-5" />}
                label="PDF"
                sub="1-pager"
              />
              <FormatTile
                selected={format === "both"}
                onClick={() => setFormat("both")}
                icon={<Download className="size-5" />}
                label="Both"
                sub="Full pack"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Starting Period</Label>
              <Input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ending Period</Label>
              <Input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Instruments ({selectedIds.size} of {instruments.length})
              </Label>
              <div className="flex gap-3 text-xs">
                <button
                  type="button"
                  onClick={selectAllInstruments}
                  className="text-primary hover:underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={clearAllInstruments}
                  className="text-muted-foreground hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
              {instrumentsByEntity.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No instruments in scope.
                </p>
              )}
              {instrumentsByEntity.map((group) => {
                const selectedInGroup = group.items.filter((i) =>
                  selectedIds.has(i.id)
                ).length;
                const allSelected = selectedInGroup === group.items.length;
                const noneSelected = selectedInGroup === 0;
                const entityId = group.items[0]?.entity_id ?? "";
                return (
                  <div key={entityId} className="space-y-1">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Checkbox
                        checked={
                          allSelected
                            ? true
                            : noneSelected
                              ? false
                              : "indeterminate"
                        }
                        onCheckedChange={(c) =>
                          toggleEntity(entityId, c === true)
                        }
                      />
                      <span className="uppercase tracking-wide">
                        {group.entityName}
                      </span>
                      <span className="text-[10px] normal-case text-muted-foreground/70">
                        {selectedInGroup}/{group.items.length}
                      </span>
                    </label>
                    <div className="ml-5 space-y-1">
                      {group.items.map((inst) => (
                        <label
                          key={inst.id}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={selectedIds.has(inst.id)}
                            onCheckedChange={(c) =>
                              toggleInstrument(inst.id, c === true)
                            }
                          />
                          <span className="flex-1 truncate">
                            {inst.instrument_name}
                          </span>
                          {inst.lender_name && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {inst.lender_name}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {(format === "excel" || format === "both") && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Excel Sheets
              </Label>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <SheetCheckbox
                  label="Summary (by type)"
                  checked={includeSummary}
                  onChange={setIncludeSummary}
                />
                <SheetCheckbox
                  label="By Entity"
                  checked={includeByEntity}
                  onChange={setIncludeByEntity}
                />
                <SheetCheckbox
                  label="By Instrument"
                  checked={includeByInstrument}
                  onChange={setIncludeByInstrument}
                />
                <SheetCheckbox
                  label="Monthly Detail (24mo)"
                  checked={includeMonthlyDetail}
                  onChange={setIncludeMonthlyDetail}
                />
                <SheetCheckbox
                  label="Transactions (audit)"
                  checked={includeTransactions}
                  onChange={setIncludeTransactions}
                />
              </div>
            </div>
          )}

          {rangeInvalid && (
            <p className="text-xs text-destructive">
              Ending period must be on or after starting period.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={exporting || rangeInvalid}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Generating…" : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormatTile({
  selected,
  onClick,
  icon,
  label,
  sub,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/5 ring-2 ring-primary/30"
          : "hover:bg-muted/50"
      }`}
    >
      {icon}
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </button>
  );
}

function SheetCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <span>{label}</span>
    </label>
  );
}

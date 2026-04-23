"use client";

// Amortization export wizard — one dialog, one workbook with a single,
// formatted Amortization sheet. Mirrors the on-screen column set exactly
// (period, balances, interest, principal, unpaid int, rate) so the export
// ties to what the user sees, and leans on the shared excel.ts helpers so
// the output matches the rest of the application.

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { Download } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  addSheet,
  createWorkbook,
  downloadWorkbook,
  NUMBER_FORMATS,
  type ColumnDef,
} from "@/lib/utils/excel";

export interface AmortExportRow {
  period_year: number;
  period_month: number;
  beginning_balance: number;
  interest_accrued: number;
  unpaid_interest_beg: number;
  payment: number;
  to_interest: number;
  to_principal: number;
  ending_balance: number;
  unpaid_interest_end: number;
  interest_rate: number;
  is_actual: boolean;
  is_current: boolean;
}

export interface AmortExportInstrument {
  instrument_name?: string | null;
  lender_name?: string | null;
  loan_number?: string | null;
  day_count_convention?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  instrument: AmortExportInstrument | null;
  rows: AmortExportRow[];
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const periodKey = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, "0")}`;
const periodLabel = (y: number, m: number) =>
  `${MONTH_SHORT[m - 1]} ${y}`;

export function AmortizationExportDialog({
  open,
  onOpenChange,
  entityId,
  instrument,
  rows,
}: Props) {
  const supabase = createClient();
  const [startKey, setStartKey] = useState("");
  const [endKey, setEndKey] = useState("");
  const [exporting, setExporting] = useState(false);

  // Default the range to the full schedule each time the dialog opens.
  useEffect(() => {
    if (!open || rows.length === 0) return;
    const first = rows[0];
    const last = rows[rows.length - 1];
    setStartKey(periodKey(first.period_year, first.period_month));
    setEndKey(periodKey(last.period_year, last.period_month));
  }, [open, rows]);

  const options = useMemo(
    () =>
      rows.map((r) => ({
        key: periodKey(r.period_year, r.period_month),
        label: periodLabel(r.period_year, r.period_month),
      })),
    [rows]
  );

  const filteredRows = useMemo(() => {
    if (!startKey || !endKey || startKey > endKey) return [];
    return rows.filter((r) => {
      const k = periodKey(r.period_year, r.period_month);
      return k >= startKey && k <= endKey;
    });
  }, [rows, startKey, endKey]);

  const rangeInvalid = Boolean(startKey && endKey && startKey > endKey);

  const firstPeriod = rows[0];
  const lastPeriod = rows[rows.length - 1];
  const isFullRange =
    firstPeriod != null &&
    lastPeriod != null &&
    startKey === periodKey(firstPeriod.period_year, firstPeriod.period_month) &&
    endKey === periodKey(lastPeriod.period_year, lastPeriod.period_month);

  async function handleExport() {
    if (filteredRows.length === 0) {
      toast.error("Select a valid period range");
      return;
    }
    setExporting(true);
    try {
      // Pull the entity name so the title block reads like the rest of
      // the finance package exports.
      const { data: ent } = await supabase
        .from("entities")
        .select("name")
        .eq("id", entityId)
        .single();
      const entityName = (ent as { name?: string } | null)?.name ?? "";

      const instrumentName =
        instrument?.instrument_name?.trim() || "Debt Instrument";
      const lenderName = instrument?.lender_name?.trim() || null;
      const loanNumber = instrument?.loan_number?.trim() || null;
      const convention = instrument?.day_count_convention ?? "30/360";

      const first = filteredRows[0];
      const last = filteredRows[filteredRows.length - 1];
      const startLabel = periodLabel(first.period_year, first.period_month);
      const endLabel = periodLabel(last.period_year, last.period_month);

      // Show unpaid-interest column when any row in the selected slice
      // actually has accrued-but-unpaid interest. Matches the on-screen
      // rule (hides the column when it's all zeros).
      const showUnpaid = filteredRows.some(
        (r) => r.unpaid_interest_end > 0.005 || r.unpaid_interest_beg > 0.005
      );

      const cols: ColumnDef<AmortExportRow>[] = [
        {
          header: "Period",
          width: 14,
          format: NUMBER_FORMATS.month,
          value: (r) => new Date(r.period_year, r.period_month - 1, 1),
        },
        {
          header: "Status",
          width: 11,
          align: "center",
          value: (r) =>
            r.is_current ? "Current" : r.is_actual ? "Actual" : "Projected",
        },
        {
          header: "Beginning Balance",
          width: 20,
          format: NUMBER_FORMATS.currency,
          value: (r) => r.beginning_balance,
        },
        {
          header: "Interest Accrued",
          width: 18,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => r.interest_accrued,
        },
        {
          header: "Payment",
          width: 16,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => r.payment,
        },
        {
          header: "To Interest",
          width: 16,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => r.to_interest,
        },
        {
          header: "To Principal",
          width: 16,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => r.to_principal,
        },
        {
          header: "Ending Balance",
          width: 18,
          format: NUMBER_FORMATS.currency,
          value: (r) => r.ending_balance,
        },
      ];
      if (showUnpaid) {
        cols.push({
          header: "Unpaid Interest",
          width: 16,
          format: NUMBER_FORMATS.currency,
          value: (r) => r.unpaid_interest_end,
        });
      }
      cols.push({
        header: "Rate",
        width: 10,
        format: NUMBER_FORMATS.percent,
        value: (r) => r.interest_rate,
      });

      const subtitleBits: string[] = [instrumentName];
      if (lenderName) subtitleBits.push(lenderName);
      if (loanNumber) subtitleBits.push(`Loan #${loanNumber}`);

      const wb = createWorkbook({
        company: entityName,
        title: `${instrumentName} — Amortization Schedule`,
      });
      addSheet(wb, {
        name: "Amortization",
        columns: cols,
        rows: filteredRows,
        title: {
          entityName,
          reportTitle: "Amortization Schedule",
          subtitle: subtitleBits.join(" · "),
          period: `${startLabel} through ${endLabel} — ${filteredRows.length} period${filteredRows.length === 1 ? "" : "s"}`,
        },
        grandTotal: true,
        footnote: `Rates are annualized; interest accrued uses the ${convention} day-count convention. Status column marks each row as Actual (past), Current, or Projected.`,
      });

      const safeInstrument = instrumentName.replace(/[^a-zA-Z0-9_-]/g, "_");
      await downloadWorkbook(
        wb,
        `${safeInstrument}_amortization_${startKey}_to_${endKey}`
      );
      toast.success("Amortization schedule downloaded");
      onOpenChange(false);
    } catch (err) {
      console.error("Amortization export failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Export failed — check console"
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Amortization Schedule</DialogTitle>
          <DialogDescription>
            Download the schedule as a formatted Excel workbook. The full range
            is selected by default — narrow it below if you only need a slice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Starting Period</Label>
              <Select value={startKey} onValueChange={setStartKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {options.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Ending Period</Label>
              <Select value={endKey} onValueChange={setEndKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {options.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {rangeInvalid ? (
            <p className="text-xs text-destructive">
              Ending period must be on or after the starting period.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {isFullRange
                ? `Including all ${rows.length} period${rows.length === 1 ? "" : "s"} (full schedule).`
                : `${filteredRows.length} period${filteredRows.length === 1 ? "" : "s"} selected.`}
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
          <Button
            onClick={handleExport}
            disabled={exporting || filteredRows.length === 0 || rangeInvalid}
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Generating..." : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

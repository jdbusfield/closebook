"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import * as XLSX from "xlsx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

interface AccruedInterestRow {
  instrumentId: string;
  instrumentName: string;
  lenderName: string;
  loanNumber: string;
  debtType: string;
  startDate: string;
  originationDate: string | null;
  annualRate: number;
  dayCountConvention: string;
  dailyRate: number;
  beginningBalance: number;

  // For pro-rata: if start_date is in the report year, accrued from start through 12/31
  accruedDays: number;
  /** Period-only accrual (interest that accrued in December of the report year). */
  accruedInterest: number;
  /** Unpaid interest already on the books at the loan's start_date. */
  openingAccruedInterest: number;
  /** Total unpaid interest to show on the balance sheet: period + opening. */
  totalUnpaidInterest: number;
  status: string;
}

const TYPE_LABELS: Record<string, string> = {
  term_loan: "Term Loan",
  line_of_credit: "Line of Credit",
  revolving_credit: "Revolving Credit",
  investor_loc: "Investor LOC",
  mortgage: "Mortgage",
  equipment_loan: "Equipment Loan",
  balloon_loan: "Balloon Loan",
  bridge_loan: "Bridge Loan",
  sba_loan: "SBA Loan",
  other: "Other",
};

const DAY_COUNT_LABELS: Record<string, string> = {
  "30/360": "30/360",
  "actual/360": "Actual/360",
  "actual/365": "Actual/365",
  "actual/actual": "Actual/Actual",
};

function getDayCountDenominator(convention: string, year: number): number {
  switch (convention) {
    case "30/360":
      return 360;
    case "actual/360":
      return 360;
    case "actual/365":
      return 365;
    case "actual/actual": {
      const isLeap = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
      return isLeap ? 366 : 365;
    }
    default:
      return 365;
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export default function AccruedInterestPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const [year, setYear] = useState(2025);
  const [entityName, setEntityName] = useState("");
  const [rows, setRows] = useState<AccruedInterestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);

    // Fetch entity name
    const { data: entityData } = await supabase
      .from("entities")
      .select("name")
      .eq("id", entityId)
      .single();
    if (entityData) setEntityName(entityData.name);

    // Fetch all debt instruments for this entity
    const { data: instruments } = await supabase
      .from("debt_instruments")
      .select("*")
      .eq("entity_id", entityId)
      .order("instrument_name");

    if (!instruments || instruments.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    const instrIds = instruments.map((i: AnyRow) => i.id);

    // Fetch ALL transactions (through year-end) to replay balances
    const { data: txnData } = await supabase
      .from("debt_transactions")
      .select("debt_instrument_id, transaction_type, amount, to_principal, effective_date")
      .in("debt_instrument_id", instrIds)
      .lte("effective_date", `${year}-12-31`)
      .order("effective_date", { ascending: true })
      .order("created_at", { ascending: true });

    // For each instrument, build:
    // 1. Balance entering December (replay txns through Nov 30)
    // 2. December transaction timeline (for day-by-day interest calc)
    const decStartStr = `${year}-12-01`;
    const balancePreDecMap: Record<string, number> = {};
    const decTxnsMap: Record<string, AnyRow[]> = {};
    const origAmountMap: Record<string, number> = {};

    for (const instr of instruments as AnyRow[]) {
      origAmountMap[instr.id] = Number(instr.original_amount ?? 0);
      balancePreDecMap[instr.id] = Number(instr.original_amount ?? 0);
      decTxnsMap[instr.id] = [];
    }

    if (txnData) {
      for (const txn of txnData as AnyRow[]) {
        const id = txn.debt_instrument_id;
        const isDecember = txn.effective_date >= decStartStr;

        if (isDecember) {
          // Save December transactions for day-by-day processing
          decTxnsMap[id] = decTxnsMap[id] || [];
          decTxnsMap[id].push(txn);
        } else {
          // Replay pre-December transactions to get balance entering December
          if (txn.transaction_type === "advance") {
            balancePreDecMap[id] += Math.abs(txn.amount);
          } else if (txn.transaction_type === "principal_payment" || txn.transaction_type === "vehicle_payoff") {
            balancePreDecMap[id] -= Math.abs(txn.to_principal ?? txn.amount);
          } else if (txn.transaction_type === "payoff") {
            balancePreDecMap[id] = 0;
          }
          balancePreDecMap[id] = Math.max(0, balancePreDecMap[id]);
        }
      }
    }

    // Fetch rate history for variable rate instruments
    const { data: rateHistory } = await supabase
      .from("debt_rate_history")
      .select("debt_instrument_id, effective_date, interest_rate")
      .in("debt_instrument_id", instrIds)
      .lte("effective_date", `${year}-12-31`)
      .order("effective_date", { ascending: false });

    // Build accrued interest rows
    const result: AccruedInterestRow[] = [];
    const decDays = daysInMonth(year, 12); // 31

    for (const instr of instruments as AnyRow[]) {
      const convention = instr.day_count_convention || "30/360";
      const annualRate = Number(instr.interest_rate ?? 0);
      const denominator = getDayCountDenominator(convention, year);
      const dailyRate = annualRate / denominator;

      const startDate = instr.origination_date || instr.start_date;
      const [sY, sM, sD] = startDate.split("T")[0].split("-").map(Number);

      // Determine which day accrual starts in December
      let accrualStartDay: number;
      if (sY > year || (sY === year && sM > 12)) {
        // Note doesn't exist yet — skip
        continue;
      } else if (sY === year && sM === 12) {
        // Note started in December of report year
        accrualStartDay = sD;
      } else {
        // Note existed before December — full month
        accrualStartDay = 1;
      }

      // Balance entering December (before any December transactions)
      // For notes starting in December, this is the original amount
      const balanceEnteringDec = sY === year && sM === 12
        ? Number(instr.original_amount ?? 0)
        : Math.round(balancePreDecMap[instr.id] * 100) / 100;

      // Accrued interest: use beginning-of-period balance for the full accrual
      // period, consistent with the amortization schedule (interest accrues on the
      // opening balance; payments reduce principal but don't change the period's
      // interest calculation)
      const accruedDays = decDays - accrualStartDay + 1;
      const accruedInterest = Math.round(
        balanceEnteringDec * dailyRate * accruedDays * 100
      ) / 100;

      // Carry-forward unpaid interest set on the instrument at start. We
      // surface this on every year's report so the balance-sheet accrued
      // total includes the full amount the borrower owes, not just the
      // current-period accrual. For a refined treatment, a future iteration
      // could net out interest payments made since start_date.
      const openingAccruedInterest = Math.max(
        0,
        Math.round((Number(instr.opening_accrued_interest ?? 0)) * 100) / 100
      );
      const totalUnpaidInterest = Math.round(
        (accruedInterest + openingAccruedInterest) * 100
      ) / 100;

      // Skip instruments with no balance and no accrual
      if (
        balanceEnteringDec <= 0 &&
        accruedInterest <= 0 &&
        openingAccruedInterest <= 0
      )
        continue;

      result.push({
        instrumentId: instr.id,
        instrumentName: instr.instrument_name,
        lenderName: instr.lender_name ?? "",
        loanNumber: instr.loan_number ?? "",
        debtType: instr.debt_type,
        startDate: instr.start_date,
        originationDate: instr.origination_date,
        annualRate,
        dayCountConvention: convention,
        dailyRate,
        beginningBalance: balanceEnteringDec,
        accruedDays,
        accruedInterest,
        openingAccruedInterest,
        totalUnpaidInterest,
        status: instr.status,
      });
    }

    setRows(result);
    setLoading(false);
  }, [entityId, year, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalAccruedInterest = rows.reduce((s, r) => s + r.accruedInterest, 0);
  const totalOpeningAccrued = rows.reduce(
    (s, r) => s + r.openingAccruedInterest,
    0
  );
  const totalUnpaidInterest = rows.reduce(
    (s, r) => s + r.totalUnpaidInterest,
    0
  );
  const totalBalance = rows.reduce((s, r) => s + r.beginningBalance, 0);

  // ── Excel Export ──────────────────────────────────────────────────────
  function exportToExcel() {
    if (rows.length === 0) return;

    const sheetRows = rows.map((r) => ({
      "Instrument": r.instrumentName,
      "Lender": r.lenderName,
      "Loan #": r.loanNumber,
      "Type": TYPE_LABELS[r.debtType] ?? r.debtType,
      "Note Start Date": r.originationDate || r.startDate,
      "Annual Rate": r.annualRate,
      "Day Count": DAY_COUNT_LABELS[r.dayCountConvention] ?? r.dayCountConvention,
      "Daily Rate": r.dailyRate,
      ["Beginning Balance"]: r.beginningBalance,
      "Accrued Days": r.accruedDays,
      [`Period Accrual 12/${year}`]: r.accruedInterest,
      "Opening Accrued": r.openingAccruedInterest,
      [`Total Unpaid Interest 12/31/${year}`]: r.totalUnpaidInterest,
    }));

    // Add totals row
    sheetRows.push({
      "Instrument": "TOTAL",
      "Lender": "",
      "Loan #": "",
      "Type": "",
      "Note Start Date": "",
      "Annual Rate": 0,
      "Day Count": "",
      "Daily Rate": 0,
      ["Beginning Balance"]: totalBalance,
      "Accrued Days": 0,
      [`Period Accrual 12/${year}`]: totalAccruedInterest,
      "Opening Accrued": totalOpeningAccrued,
      [`Total Unpaid Interest 12/31/${year}`]: totalUnpaidInterest,
    });

    const ws = XLSX.utils.json_to_sheet(sheetRows);

    // Format columns
    const colKeys = Object.keys(sheetRows[0]);
    ws["!cols"] = colKeys.map((key) => {
      const maxDataLen = sheetRows.reduce(
        (mx, r) => Math.max(mx, String(r[key as keyof typeof r] ?? "").length),
        0
      );
      return { wch: Math.max(key.length, maxDataLen) + 2 };
    });

    // Format rate columns as percentage and currency columns
    const rowCount = sheetRows.length;
    for (let i = 0; i < rowCount; i++) {
      const rateCell = XLSX.utils.encode_cell({ r: i + 1, c: 5 }); // Annual Rate
      if (ws[rateCell]) ws[rateCell].z = "0.000%";
      const dailyCell = XLSX.utils.encode_cell({ r: i + 1, c: 7 }); // Daily Rate
      if (ws[dailyCell]) ws[dailyCell].z = "0.00000000%";
      const balCell = XLSX.utils.encode_cell({ r: i + 1, c: 8 }); // Balance
      if (ws[balCell]) ws[balCell].z = "$#,##0.00";
      const accCell = XLSX.utils.encode_cell({ r: i + 1, c: 10 }); // Accrued Interest
      if (ws[accCell]) ws[accCell].z = "$#,##0.00";
    }

    const wb = XLSX.utils.book_new();
    const sheetName = `Accrued Interest ${year}`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    const safeName = (entityName || "entity").replace(/[^a-zA-Z0-9_-]/g, "_");
    XLSX.writeFile(wb, `${safeName}_accrued_interest_${year}.xlsx`);
  }

  // ── PDF Export ────────────────────────────────────────────────────────
  async function exportToPdf() {
    if (rows.length === 0) return;

    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;

    // Title
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    const title = entityName
      ? `${entityName} — Accrued Interest Schedule`
      : "Accrued Interest Schedule";
    doc.text(title, margin, 40);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`As of December 31, ${year}`, margin, 56);

    const dateStr = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    doc.setFontSize(8);
    doc.text(`Generated ${dateStr}`, pageWidth - margin, 56, { align: "right" });

    // Table
    const head = [
      [
        "Instrument",
        "Lender",
        "Type",
        "Note Start Date",
        "Annual Rate",
        "Day Count",
        "Daily Rate",
        "Beginning\nBalance",
        "Accrued\nDays",
        `Period Accrual\n12/${year}`,
        "Opening\nAccrued",
        `Total Unpaid\n12/31/${year}`,
      ],
    ];

    const body = rows.map((r) => [
      r.instrumentName,
      r.lenderName,
      TYPE_LABELS[r.debtType] ?? r.debtType,
      formatDate(r.originationDate || r.startDate),
      formatPct(r.annualRate),
      DAY_COUNT_LABELS[r.dayCountConvention] ?? r.dayCountConvention,
      formatDailyRate(r.dailyRate),
      formatCurrency(r.beginningBalance),
      String(r.accruedDays),
      formatCurrency(r.accruedInterest),
      formatCurrency(r.openingAccruedInterest),
      formatCurrency(r.totalUnpaidInterest),
    ]);

    // Totals row
    body.push([
      "TOTAL",
      "",
      "",
      "",
      "",
      "",
      "",
      formatCurrency(totalBalance),
      "",
      formatCurrency(totalAccruedInterest),
      formatCurrency(totalOpeningAccrued),
      formatCurrency(totalUnpaidInterest),
    ]);

    autoTable(doc, {
      startY: 70,
      head,
      body,
      theme: "grid",
      headStyles: { fillColor: [41, 41, 41], fontSize: 7.5, halign: "center" },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 95 },
        1: { cellWidth: 65 },
        2: { cellWidth: 55 },
        3: { cellWidth: 60, halign: "center" },
        4: { cellWidth: 45, halign: "right" },
        5: { cellWidth: 50, halign: "center" },
        6: { cellWidth: 55, halign: "right" },
        7: { cellWidth: 70, halign: "right" },
        8: { cellWidth: 40, halign: "center" },
        9: { cellWidth: 70, halign: "right" },
        10: { cellWidth: 65, halign: "right" },
        11: { cellWidth: 75, halign: "right" },
      },
      margin: { left: margin, right: margin },
      didParseCell: (data: AnyRow) => {
        // Bold the totals row
        if (data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = "bold";
          if (data.column.index === 0) {
            data.cell.styles.halign = "left";
          }
        }
      },
    });

    const safeName = (entityName || "entity").replace(/[^a-zA-Z0-9_-]/g, "_");
    doc.save(`${safeName}_accrued_interest_${year}.pdf`);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/${entityId}/debt`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Accrued Interest Schedule</h1>
            <p className="text-muted-foreground text-sm">
              Interest accrued as of December 31, {year}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={String(year)}
            onValueChange={(v) => setYear(Number(v))}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2023, 2024, 2025, 2026].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={exportToExcel}
            disabled={rows.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Excel
          </Button>
          <Button
            variant="outline"
            onClick={exportToPdf}
            disabled={rows.length === 0}
          >
            <FileText className="mr-2 h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rows.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Beginning Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalBalance)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Unpaid Interest
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalUnpaidInterest)}
            </div>
            {totalOpeningAccrued > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                Period accrual {formatCurrency(totalAccruedInterest)} +
                opening {formatCurrency(totalOpeningAccrued)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              No active debt instruments found for {year}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instrument</TableHead>
                    <TableHead>Lender</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Note Start Date</TableHead>
                    <TableHead className="text-right">Annual Rate</TableHead>
                    <TableHead>Day Count</TableHead>
                    <TableHead className="text-right">Daily Rate</TableHead>
                    <TableHead className="text-right">
                      Beginning Balance
                    </TableHead>
                    <TableHead className="text-center">
                      Accrued Days
                    </TableHead>
                    <TableHead className="text-right">
                      Period Accrual
                    </TableHead>
                    <TableHead className="text-right">
                      Opening Accrued
                    </TableHead>
                    <TableHead className="text-right">
                      Total Unpaid Interest
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.instrumentId}>
                      <TableCell className="font-medium">
                        {r.instrumentName}
                      </TableCell>
                      <TableCell>{r.lenderName}</TableCell>
                      <TableCell>
                        {TYPE_LABELS[r.debtType] ?? r.debtType}
                      </TableCell>
                      <TableCell>
                        {formatDate(r.originationDate || r.startDate)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPct(r.annualRate)}
                      </TableCell>
                      <TableCell>
                        {DAY_COUNT_LABELS[r.dayCountConvention] ??
                          r.dayCountConvention}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatDailyRate(r.dailyRate)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(r.beginningBalance)}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.accruedDays}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(r.accruedInterest)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(r.openingAccruedInterest)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(r.totalUnpaidInterest)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell>TOTAL</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right">
                      {formatCurrency(totalBalance)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right">
                      {formatCurrency(totalAccruedInterest)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(totalOpeningAccrued)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(totalUnpaidInterest)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Formatting helpers ────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  // Parse as local date to avoid UTC timezone shift (e.g. 2025-12-19 → 12/18 in local TZ)
  const [y, m, d] = dateStr.split("T")[0].split("-");
  return `${m}/${d}/${y}`;
}

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(3)}%`;
}

function formatDailyRate(rate: number): string {
  return `${(rate * 100).toFixed(8)}%`;
}

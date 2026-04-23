"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountCombobox } from "@/components/ui/account-combobox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Download, Loader2, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import {
  addSheet,
  createWorkbook,
  downloadWorkbook,
  NUMBER_FORMATS,
  type ColumnDef,
} from "@/lib/utils/excel";
import { createClient } from "@/lib/supabase/client";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface AccountTotal {
  glAccountNo: string;
  glAccountDescription: string;
  glAccountId: string;
  earnedRevenue: number;
  billedAmount: number;
  accrualAmount: number;
  deferralAmount: number;
  lineCount: number;
  qboAccountId: string | null;
  qboQboId: string | null;
  qboAccountName: string | null;
  matchedToQBO: boolean;
}

interface JELine {
  lineNo: number;
  accountNumber: string;
  accountName: string;
  debit: number;
  credit: number;
  memo: string;
  qboQboId: string | null;
}

interface AccrualLine {
  glAccountNo: string;
  glAccountDescription: string;
  glAccountId: string;
  earnedRevenue: number;
  billedAmount: number;
  accrualAmount: number;
  deferralAmount: number;
  daysInPeriod: number;
  totalContractValue: number;
  dailyRate: number;
}

interface InvoiceDetail {
  invoiceNumber: string;
  invoiceDate: string;
  customer: string;
  status: string;
  rentalStart: string;
  rentalEnd: string;
  totalGross: number;
  earnedTotal: number;
  billedInPeriod: number;
  adjustmentAmount: number;
  adjustmentType: "accrual" | "deferral" | "none";
  daysInPeriod: number;
  totalRentalDays: number;
  lines: AccrualLine[];
}

interface UnbilledOrderDetail {
  orderNumber: string;
  customer: string;
  description: string;
  rentalStart: string;
  rentalEnd: string;
  orderTotal: number;
  billedAgainst: number;
  unbilledRemainder: number;
  earnedInMonth: number;
  daysInMonth: number;
  totalRentalDays: number;
  invoiceCount: number;
}

interface UnbilledCatchAllAccount {
  number: string;
  name: string;
  qboId: string | null;
  linked: boolean;
}

interface UnbilledEarned {
  realizationRate: number;
  gross: number;
  discount: number;
  net: number;
  orderCount: number;
  catchAllAccount?: UnbilledCatchAllAccount;
  orders: UnbilledOrderDetail[];
}

interface ApiResponse {
  entityId: string;
  periodYear: number;
  periodMonth: number;
  invoicesFetched: number;
  invoicesOverlapping: number;
  glDistSuccess: number;
  glDistFailed: number;
  fetchErrors: Array<{ invoiceNumber: string; error: string }>;
  totals: AccountTotal[];
  proposedJE: {
    timingAccrual: JELine[];
    unbilledAccrual: JELine[];
    deferral: JELine[];
  };
  invoiceDetails: InvoiceDetail[];
  unbilledEarned?: UnbilledEarned;
  message?: string;
}

interface InvoiceContribution {
  invoiceNumber: string;
  customer: string;
  invoiceDate: string;
  rentalStart: string;
  rentalEnd: string;
  daysInPeriod: number;
  totalRentalDays: number;
  earned: number;
  billed: number;
  diff: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Parse "2026-03-15" / "2026-03-15T..." / "03/15/2026" into a JS Date without
// timezone drift. Returns undefined for blank / unparseable input.
function parseExcelDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  return undefined;
}

function formatDisplayDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function GLAccountAccrualSection({ entityId }: { entityId: string }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [showInvoiceDetail, setShowInvoiceDetail] = useState(false);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());

  // Account-link settings
  const [accountLinks, setAccountLinks] = useState<{
    unbilledReceivablesAccountId: string | null;
    allowanceAccountId: string | null;
    accruedRevenueAccountId: string | null;
    deferredRevenueAccountId: string | null;
    unbilledRevenueAccountId: string | null;
  }>({
    unbilledReceivablesAccountId: null,
    allowanceAccountId: null,
    accruedRevenueAccountId: null,
    deferredRevenueAccountId: null,
    unbilledRevenueAccountId: null,
  });
  const [accountLinksLoaded, setAccountLinksLoaded] = useState(false);
  const [accountLinksAvailable, setAccountLinksAvailable] = useState(true);
  const [entityAccounts, setEntityAccounts] = useState<
    {
      id: string;
      account_number: string | null;
      name: string;
      classification: string;
      account_type: string | null;
      account_sub_type: string | null;
    }[]
  >([]);

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  // Load existing account links + entity's chart of accounts on mount / entity change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfgRes, supabase] = await Promise.all([
          fetch(`/api/accrual/config?entityId=${encodeURIComponent(entityId)}`),
          Promise.resolve(createClient()),
        ]);
        if (!cancelled && cfgRes.ok) {
          const json = await cfgRes.json();
          setAccountLinks({
            unbilledReceivablesAccountId: json.unbilledReceivablesAccountId ?? null,
            allowanceAccountId: json.allowanceAccountId ?? null,
            accruedRevenueAccountId: json.accruedRevenueAccountId ?? null,
            deferredRevenueAccountId: json.deferredRevenueAccountId ?? null,
            unbilledRevenueAccountId: json.unbilledRevenueAccountId ?? null,
          });
          setAccountLinksAvailable(json.accountLinksAvailable !== false);
        }
        const { data: accts } = await supabase
          .from("accounts")
          .select("id, account_number, name, classification, account_type, account_sub_type")
          .eq("entity_id", entityId)
          .eq("is_active", true)
          .order("account_number", { ascending: true })
          .range(0, 9999);
        if (!cancelled && accts) setEntityAccounts(accts);
      } catch (err) {
        console.error("Load account links error:", err);
      } finally {
        if (!cancelled) setAccountLinksLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const saveAccountLink = useCallback(
    async (
      field:
        | "unbilledReceivablesAccountId"
        | "allowanceAccountId"
        | "accruedRevenueAccountId"
        | "deferredRevenueAccountId"
        | "unbilledRevenueAccountId",
      accountId: string | null,
    ) => {
      const nextLinks = { ...accountLinks, [field]: accountId };
      setAccountLinks(nextLinks);
      try {
        // The config endpoint requires realizationRate, so we pull the
        // current value first to avoid overwriting it.
        const cfgRes = await fetch(
          `/api/accrual/config?entityId=${encodeURIComponent(entityId)}`,
        );
        const cfg = cfgRes.ok ? await cfgRes.json() : {};
        const res = await fetch("/api/accrual/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityId,
            realizationRate: cfg.realizationRate ?? 1,
            notes: cfg.notes ?? null,
            ...nextLinks,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Account link saved");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save account link",
        );
      }
    },
    [entityId, accountLinks],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch("/api/qbo/rental-accruals-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          periodYear: year,
          periodMonth: month,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Failed to load GL accrual data");
        return;
      }
      setData(json);
      if (json.message) toast.info(json.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [entityId, year, month]);

  const toggleInvoice = (key: string) => {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExport = useCallback(async () => {
    if (!data) return;
    setExporting(true);
    try {
      // Look up entity name for the title block
      const supabase = createClient();
      const { data: entityRow } = await supabase
        .from("entities")
        .select("name")
        .eq("id", entityId)
        .single();
      const entityName =
        (entityRow as { name?: string } | null)?.name ?? "";

      const periodLabel = `${MONTH_NAMES[data.periodMonth - 1]} ${data.periodYear}`;
      const fileSlug = `${entityName ? entityName.replace(/\s+/g, "_") + "_" : ""}Rental_Accruals_${data.periodYear}_${String(data.periodMonth).padStart(2, "0")}`;
      const generatedOn = `Generated ${formatDisplayDate(new Date().toISOString())}`;

      const wb = createWorkbook({
        company: entityName,
        title: `Rental Revenue Accrual — ${periodLabel}`,
      });

      // 1. Per-GL Summary
      addSheet<AccountTotal>(wb, {
        name: "Per-GL Summary",
        title: {
          entityName,
          reportTitle: "Per-GL-Account Summary",
          subtitle: "Earned vs billed by GL account for the period",
          period: periodLabel,
          asOf: generatedOn,
        },
        columns: [
          { header: "GL #", width: 10, value: (r) => r.glAccountNo },
          { header: "Account (from RW)", width: 32, value: (r) => r.glAccountDescription },
          {
            header: "QBO Match",
            width: 30,
            value: (r) => (r.matchedToQBO ? r.qboAccountName ?? "Matched" : "No QBO match"),
          },
          {
            header: "Earned (this month)",
            width: 20,
            value: (r) => r.earnedRevenue,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
          {
            header: "Billed (this month)",
            width: 20,
            value: (r) => r.billedAmount,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
          {
            header: "Accrual",
            width: 16,
            value: (r) => r.accrualAmount,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
          {
            header: "Deferral",
            width: 16,
            value: (r) => r.deferralAmount,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
          {
            header: "Invoice Lines",
            width: 14,
            value: (r) => r.lineCount,
            format: NUMBER_FORMATS.integer,
            total: "sum",
          },
        ],
        rows: data.totals,
        grandTotal: true,
        footnote:
          "Accrual / Deferral are per-account net. Total Accrual minus Total Deferral equals the entity-wide net revenue impact, not Total Earned minus Total Billed (different accounts can net in opposite directions).",
      });

      // 2. Invoice Detail — flattened invoice × GL
      interface InvoiceLineFlat {
        invoiceNumber: string;
        adjustmentType: string;
        customer: string;
        invoiceDate: Date | undefined;
        rentalStart: Date | undefined;
        rentalEnd: Date | undefined;
        daysInPeriod: number;
        totalRentalDays: number;
        glAccountNo: string;
        glAccountDescription: string;
        lineGross: number;
        dailyRate: number;
        earnedRevenue: number;
        billedAmount: number;
        diff: number;
      }
      const invoiceLines: InvoiceLineFlat[] = [];
      for (const inv of data.invoiceDetails) {
        for (const l of inv.lines) {
          invoiceLines.push({
            invoiceNumber: inv.invoiceNumber,
            adjustmentType:
              inv.adjustmentType === "accrual"
                ? "Accrual"
                : inv.adjustmentType === "deferral"
                  ? "Deferral"
                  : "—",
            customer: inv.customer,
            invoiceDate: parseExcelDate(inv.invoiceDate),
            rentalStart: parseExcelDate(inv.rentalStart),
            rentalEnd: parseExcelDate(inv.rentalEnd),
            daysInPeriod: l.daysInPeriod,
            totalRentalDays: inv.totalRentalDays,
            glAccountNo: l.glAccountNo,
            glAccountDescription: l.glAccountDescription,
            lineGross: l.totalContractValue,
            dailyRate: l.dailyRate,
            earnedRevenue: l.earnedRevenue,
            billedAmount: l.billedAmount,
            diff: round2(l.earnedRevenue - l.billedAmount),
          });
        }
      }
      addSheet<InvoiceLineFlat>(wb, {
        name: "Invoice Detail",
        title: {
          entityName,
          reportTitle: "Invoices Requiring Adjustment — Line Detail",
          subtitle: `One row per invoice × GL account (${invoiceLines.length} lines from ${data.invoiceDetails.length} invoices)`,
          period: periodLabel,
          asOf: generatedOn,
        },
        columns: [
          { header: "Invoice #", width: 14, value: (r) => r.invoiceNumber },
          { header: "Type", width: 10, value: (r) => r.adjustmentType },
          { header: "Customer", width: 30, value: (r) => r.customer },
          {
            header: "Invoice Date",
            width: 14,
            value: (r) => r.invoiceDate ?? null,
            format: NUMBER_FORMATS.date,
          },
          {
            header: "Rental Start",
            width: 14,
            value: (r) => r.rentalStart ?? null,
            format: NUMBER_FORMATS.date,
          },
          {
            header: "Rental End",
            width: 14,
            value: (r) => r.rentalEnd ?? null,
            format: NUMBER_FORMATS.date,
          },
          {
            header: "Days in Month",
            width: 14,
            value: (r) => r.daysInPeriod,
            format: NUMBER_FORMATS.integer,
          },
          {
            header: "Total Days",
            width: 12,
            value: (r) => r.totalRentalDays,
            format: NUMBER_FORMATS.integer,
          },
          { header: "GL #", width: 10, value: (r) => r.glAccountNo },
          {
            header: "Account",
            width: 28,
            value: (r) => r.glAccountDescription,
          },
          {
            header: "Line Gross",
            width: 16,
            value: (r) => r.lineGross,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
          {
            header: "Daily Rate",
            width: 14,
            value: (r) => r.dailyRate,
            format: NUMBER_FORMATS.currency,
          },
          {
            header: "Earned (this month)",
            width: 20,
            value: (r) => r.earnedRevenue,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
          {
            header: "Billed (this month)",
            width: 20,
            value: (r) => r.billedAmount,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
          {
            header: "Δ (Earned − Billed)",
            width: 20,
            value: (r) => r.diff,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
        ],
        rows: invoiceLines,
        groupBy: (r) => `${r.invoiceNumber} — ${r.customer}`,
        sort: (a, b) =>
          a.invoiceNumber.localeCompare(b.invoiceNumber) ||
          a.glAccountNo.localeCompare(b.glAccountNo),
        grandTotal: true,
      });

      // Shared column layout for all three JE sheets
      const jeColumns: ColumnDef<JELine>[] = [
        {
          header: "Line #",
          width: 8,
          value: (r) => r.lineNo,
          format: NUMBER_FORMATS.integer,
        },
        { header: "GL #", width: 12, value: (r) => r.accountNumber || "—" },
        { header: "Account", width: 34, value: (r) => r.accountName },
        {
          header: "QBO Account ID",
          width: 16,
          value: (r) => r.qboQboId ?? "—",
        },
        { header: "Memo", width: 52, value: (r) => r.memo },
        {
          header: "Debit",
          width: 16,
          value: (r) => r.debit,
          format: NUMBER_FORMATS.currency,
          total: "sum",
        },
        {
          header: "Credit",
          width: 16,
          value: (r) => r.credit,
          format: NUMBER_FORMATS.currency,
          total: "sum",
        },
      ];

      // 3a. Revenue Cut-Off Accrual (from invoiced-but-wrong-period invoices)
      if (data.proposedJE.timingAccrual.length > 0) {
        addSheet<JELine>(wb, {
          name: "Revenue Cut-Off Accrual",
          title: {
            entityName,
            reportTitle: `Revenue Cut-Off Accrual — ${periodLabel}`,
            subtitle:
              "From invoices whose invoice date falls outside the period but rental period overlaps. Recognized at 100% of invoice value.",
            period: periodLabel,
            asOf: generatedOn,
          },
          columns: jeColumns,
          rows: data.proposedJE.timingAccrual,
          grandTotal: true,
        });
      }

      // 3b. Estimated Unbilled Revenue Accrual (ASC 606 variable consideration)
      if (
        data.proposedJE.unbilledAccrual.length > 0 &&
        data.unbilledEarned
      ) {
        const ratePct = (
          data.unbilledEarned.realizationRate * 100
        ).toFixed(0);
        addSheet<JELine>(wb, {
          name: "Est. Unbilled Revenue Accrual",
          title: {
            entityName,
            reportTitle: `Estimated Unbilled Revenue Accrual — ${periodLabel}`,
            subtitle: `From active orders not yet invoiced. Revenue recognized at ${ratePct}% realization (ASC 606 variable consideration); remainder credited to Allowance for Discounts.`,
            period: periodLabel,
            asOf: generatedOn,
          },
          columns: jeColumns,
          rows: data.proposedJE.unbilledAccrual,
          grandTotal: true,
        });
      }

      // 4. Proposed Deferral JE
      if (data.proposedJE.deferral.length > 0) {
        addSheet<JELine>(wb, {
          name: "Deferral JE",
          title: {
            entityName,
            reportTitle: `Proposed Deferral JE — ${periodLabel}`,
            subtitle:
              "Debit the revenue GL accounts over-billed in the period; credit Deferred Revenue",
            period: periodLabel,
            asOf: generatedOn,
          },
          columns: jeColumns,
          rows: data.proposedJE.deferral,
          grandTotal: true,
        });
      }

      // 5. Unbilled Earned Orders (active orders with no invoice yet)
      if (data.unbilledEarned && data.unbilledEarned.orders.length > 0) {
        interface UBOrderFlat {
          orderNumber: string;
          customer: string;
          description: string;
          rentalStart: Date | undefined;
          rentalEnd: Date | undefined;
          daysInMonth: number;
          totalRentalDays: number;
          orderTotal: number;
          billedAgainst: number;
          unbilledRemainder: number;
          earnedInMonth: number;
        }
        const ubRows: UBOrderFlat[] = data.unbilledEarned.orders.map((o) => ({
          orderNumber: o.orderNumber,
          customer: o.customer,
          description: o.description,
          rentalStart: parseExcelDate(o.rentalStart),
          rentalEnd: parseExcelDate(o.rentalEnd),
          daysInMonth: o.daysInMonth,
          totalRentalDays: o.totalRentalDays,
          orderTotal: o.orderTotal,
          billedAgainst: o.billedAgainst,
          unbilledRemainder: o.unbilledRemainder,
          earnedInMonth: o.earnedInMonth,
        }));
        const ratePct = Math.round(data.unbilledEarned.realizationRate * 1000) / 10;
        addSheet<UBOrderFlat>(wb, {
          name: "Unbilled Earned",
          title: {
            entityName,
            reportTitle: "Unbilled Earned — Active Orders",
            subtitle: `Rental period overlaps ${periodLabel} but not yet invoiced · realization rate ${ratePct}%`,
            period: periodLabel,
            asOf: generatedOn,
          },
          columns: [
            { header: "Order #", width: 14, value: (r) => r.orderNumber },
            { header: "Customer", width: 28, value: (r) => r.customer },
            { header: "Description", width: 36, value: (r) => r.description },
            {
              header: "Rental Start",
              width: 14,
              value: (r) => r.rentalStart ?? null,
              format: NUMBER_FORMATS.date,
            },
            {
              header: "Rental End",
              width: 14,
              value: (r) => r.rentalEnd ?? null,
              format: NUMBER_FORMATS.date,
            },
            {
              header: "Days in Month",
              width: 14,
              value: (r) => r.daysInMonth,
              format: NUMBER_FORMATS.integer,
            },
            {
              header: "Total Days",
              width: 12,
              value: (r) => r.totalRentalDays,
              format: NUMBER_FORMATS.integer,
            },
            {
              header: "Order Total",
              width: 16,
              value: (r) => r.orderTotal,
              format: NUMBER_FORMATS.currency,
              total: "sum",
            },
            {
              header: "Already Billed",
              width: 16,
              value: (r) => r.billedAgainst,
              format: NUMBER_FORMATS.currency,
              total: "sum",
            },
            {
              header: "Unbilled Remainder",
              width: 18,
              value: (r) => r.unbilledRemainder,
              format: NUMBER_FORMATS.currency,
              total: "sum",
            },
            {
              header: "Earned in Month (Gross)",
              width: 20,
              value: (r) => r.earnedInMonth,
              format: NUMBER_FORMATS.currency,
              total: "sum",
            },
          ],
          rows: ubRows,
          sort: (a, b) => b.earnedInMonth - a.earnedInMonth,
          grandTotal: true,
          footnote: `Net accrual applied to this period: ${formatCurrency(data.unbilledEarned.net)} (gross ${formatCurrency(data.unbilledEarned.gross)} × ${ratePct}%).`,
        });
      }

      await downloadWorkbook(wb, fileSlug);
      toast.success(`Exported ${periodLabel} to Excel`);
    } catch (err) {
      console.error("Export error:", err);
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [data, entityId]);

  const timingAccrualTotals = useMemo(() => {
    if (!data) return { debit: 0, credit: 0 };
    return data.proposedJE.timingAccrual.reduce(
      (acc, l) => ({ debit: acc.debit + l.debit, credit: acc.credit + l.credit }),
      { debit: 0, credit: 0 },
    );
  }, [data]);

  const unbilledAccrualTotals = useMemo(() => {
    if (!data) return { debit: 0, credit: 0 };
    return data.proposedJE.unbilledAccrual.reduce(
      (acc, l) => ({ debit: acc.debit + l.debit, credit: acc.credit + l.credit }),
      { debit: 0, credit: 0 },
    );
  }, [data]);

  const deferralTotals = useMemo(() => {
    if (!data) return { debit: 0, credit: 0 };
    return data.proposedJE.deferral.reduce(
      (acc, l) => ({ debit: acc.debit + l.debit, credit: acc.credit + l.credit }),
      { debit: 0, credit: 0 },
    );
  }, [data]);

  // Index invoice contributions per GL account: for each GL #, list every
  // invoice line that touched it so the user can hover a JE amount and see
  // "which invoices make up this number" with per-invoice earned/billed/diff.
  const contributorsByAccount = useMemo(() => {
    const map = new Map<string, InvoiceContribution[]>();
    if (!data) return map;
    for (const inv of data.invoiceDetails) {
      for (const l of inv.lines) {
        if (!l.glAccountNo) continue;
        if (l.earnedRevenue === 0 && l.billedAmount === 0) continue;
        const existing = map.get(l.glAccountNo) ?? [];
        existing.push({
          invoiceNumber: inv.invoiceNumber,
          customer: inv.customer,
          invoiceDate: inv.invoiceDate,
          rentalStart: inv.rentalStart,
          rentalEnd: inv.rentalEnd,
          daysInPeriod: l.daysInPeriod,
          totalRentalDays: inv.totalRentalDays,
          earned: l.earnedRevenue,
          billed: l.billedAmount,
          diff: round2(l.earnedRevenue - l.billedAmount),
        });
        map.set(l.glAccountNo, existing);
      }
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    }
    return map;
  }, [data]);


  return (
    <>
    <AccrualAccountLinksCard
      accounts={entityAccounts}
      links={accountLinks}
      loaded={accountLinksLoaded}
      available={accountLinksAvailable}
      onChange={saveAccountLink}
    />
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>GL Account Detail (from RentalWorks GL Distribution)</CardTitle>
            <CardDescription>
              Assumes all RentalWorks invoices auto-sync to QuickBooks on InvoiceDate.
              Computes the month-end adjustment = revenue earned by rental dates
              in the period <em>minus</em> revenue already booked to the period via
              InvoiceDate. Invoices where the two already tie (rental fully inside
              this month AND invoiced this month) are excluded — they don&apos;t
              need an adjustment.
            </CardDescription>
          </div>
        </div>
        <div className="flex items-end gap-3 pt-2">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Year</div>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Month</div>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, idx) => (
                  <SelectItem key={idx + 1} value={String(idx + 1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={fetchData} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Generate
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={!data || loading || exporting}
            title={!data ? "Generate the report first, then export" : "Download Excel workbook"}
          >
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export to Excel
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!data && !loading && (
          <p className="text-muted-foreground text-sm">
            Pick a period and click <strong>Generate</strong>. Pulls invoices from RentalWorks
            whose rental period overlaps the selected month and builds the per-account JE.
          </p>
        )}

        {data && (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Invoices Scanned" value={String(data.invoicesFetched)} />
              <StatCard label="In Scope (Rental or Invoice Date)" value={String(data.invoicesOverlapping)} />
              <StatCard
                label="Need Adjustment"
                value={String(data.invoiceDetails.length)}
              />
              <StatCard
                label="QBO Account Matches"
                value={`${data.totals.filter((t) => t.matchedToQBO).length} / ${data.totals.length}`}
              />
            </div>

            {data.glDistFailed > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>{data.glDistFailed} GL distribution fetch(es) failed.</strong>{" "}
                {data.fetchErrors.slice(0, 3).map((e) => e.invoiceNumber).join(", ")}
                {data.fetchErrors.length > 3 && ` and ${data.fetchErrors.length - 3} more`}
              </div>
            )}

            {/* Unbilled earned summary */}
            {data.unbilledEarned && data.unbilledEarned.gross > 0 && (
              <UnbilledEarnedSection ub={data.unbilledEarned} />
            )}

            {/* Per-account aggregate */}
            {data.totals.length > 0 && (() => {
              const perAccountTotals = data.totals.reduce(
                (acc, t) => ({
                  earned: acc.earned + t.earnedRevenue,
                  billed: acc.billed + t.billedAmount,
                  accrual: acc.accrual + t.accrualAmount,
                  deferral: acc.deferral + t.deferralAmount,
                  invoices: acc.invoices + t.lineCount,
                }),
                { earned: 0, billed: 0, accrual: 0, deferral: 0, invoices: 0 },
              );
              return (
                <div>
                  <h4 className="font-semibold mb-2">Per-GL-Account Summary</h4>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>GL #</TableHead>
                          <TableHead>Account (from RW)</TableHead>
                          <TableHead>QBO Match</TableHead>
                          <TableHead className="text-right">Earned (this month)</TableHead>
                          <TableHead className="text-right">Billed in month</TableHead>
                          <TableHead className="text-right">Accrual</TableHead>
                          <TableHead className="text-right">Deferral</TableHead>
                          <TableHead className="text-right">Invoices</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.totals.map((t) => (
                          <TableRow key={t.glAccountNo}>
                            <TableCell className="font-mono text-xs">{t.glAccountNo}</TableCell>
                            <TableCell>{t.glAccountDescription}</TableCell>
                            <TableCell>
                              {t.matchedToQBO ? (
                                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                                  {t.qboAccountName ?? "Matched"}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-amber-700 border-amber-300">
                                  No QBO match
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(t.earnedRevenue)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(t.billedAmount)}</TableCell>
                            <TableCell className="text-right tabular-nums text-teal-700">
                              {t.accrualAmount > 0 ? formatCurrency(t.accrualAmount) : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-amber-700">
                              {t.deferralAmount > 0 ? formatCurrency(t.deferralAmount) : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{t.lineCount}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-gray-50/70 border-t-2 font-semibold">
                          <TableCell colSpan={3} className="font-semibold">Total</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(perAccountTotals.earned)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(perAccountTotals.billed)}</TableCell>
                          <TableCell className="text-right tabular-nums text-teal-700">
                            {perAccountTotals.accrual > 0 ? formatCurrency(perAccountTotals.accrual) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-amber-700">
                            {perAccountTotals.deferral > 0 ? formatCurrency(perAccountTotals.deferral) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{perAccountTotals.invoices}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Note: <strong>Invoices</strong> is the sum of per-GL line counts, so one invoice
                    touching N accounts counts N times. Accrual and Deferral are per-account net
                    (they won&apos;t equal Earned − Billed at the bottom because different accounts
                    can net in opposite directions).
                  </p>
                </div>
              );
            })()}

            {/* Proposed Revenue Cut-Off Accrual (from invoiced-but-wrong-period invoices) */}
            {data.proposedJE.timingAccrual.length > 0 && (
              <div>
                <h4 className="font-semibold mb-1">
                  Revenue Cut-Off Accrual — {MONTH_NAMES[data.periodMonth - 1]}{" "}
                  {data.periodYear}
                </h4>
                <p className="text-xs text-muted-foreground mb-2">
                  Revenue earned this period from invoices whose invoice date
                  falls outside the period. Recognized at <strong>100%</strong>{" "}
                  since the invoice amounts are known. Hover a debit or credit
                  for invoice-level detail.
                </p>
                <TooltipProvider delayDuration={150}>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[50px]">#</TableHead>
                          <TableHead>GL #</TableHead>
                          <TableHead>Account</TableHead>
                          <TableHead>QBO ID</TableHead>
                          <TableHead>Memo</TableHead>
                          <TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.proposedJE.timingAccrual.map((l) => (
                          <TableRow key={l.lineNo}>
                            <TableCell className="text-muted-foreground">{l.lineNo}</TableCell>
                            <TableCell className="font-mono text-xs">{l.accountNumber || "—"}</TableCell>
                            <TableCell>{l.accountName}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{l.qboQboId ?? "—"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{l.memo}</TableCell>
                            <JEAmountCell
                              amount={l.debit}
                              side="accrual"
                              source="invoice"
                              accountNumber={l.accountNumber}
                              proposedAmount={l.debit || l.credit}
                              line={l}
                              contributorsByAccount={contributorsByAccount}
                              unbilledEarned={data.unbilledEarned}
                              proposedJELines={data.proposedJE.timingAccrual}
                              isAggregate={!l.accountNumber}
                            />
                            <JEAmountCell
                              amount={l.credit}
                              side="accrual"
                              source="invoice"
                              accountNumber={l.accountNumber}
                              proposedAmount={l.debit || l.credit}
                              line={l}
                              contributorsByAccount={contributorsByAccount}
                              unbilledEarned={data.unbilledEarned}
                              proposedJELines={data.proposedJE.timingAccrual}
                              isAggregate={!l.accountNumber}
                            />
                          </TableRow>
                        ))}
                        <TableRow className="bg-gray-50/50 border-t-2">
                          <TableCell colSpan={5} className="font-semibold text-right">Totals</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(timingAccrualTotals.debit)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(timingAccrualTotals.credit)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </TooltipProvider>
                {timingAccrualTotals.debit !== timingAccrualTotals.credit && (
                  <p className="text-xs text-rose-600 mt-1">⚠ JE is out of balance by {formatCurrency(Math.abs(timingAccrualTotals.debit - timingAccrualTotals.credit))}</p>
                )}
              </div>
            )}

            {/* Estimated Unbilled Revenue Accrual (ASC 606 variable consideration) */}
            {data.proposedJE.unbilledAccrual.length > 0 && data.unbilledEarned && (
              <div>
                <h4 className="font-semibold mb-1">
                  Estimated Unbilled Revenue Accrual —{" "}
                  {MONTH_NAMES[data.periodMonth - 1]} {data.periodYear}
                </h4>
                <p className="text-xs text-muted-foreground mb-2">
                  Revenue from active orders whose rental period overlaps but
                  which haven&apos;t been invoiced yet. Recognized at{" "}
                  <strong>
                    {(data.unbilledEarned.realizationRate * 100).toFixed(0)}%
                  </strong>{" "}
                  realization rate with the remaining{" "}
                  {(100 - data.unbilledEarned.realizationRate * 100).toFixed(0)}
                  % credited to the Allowance for Discounts contra-revenue
                  account. The revenue credit posts to a single catch-all
                  account — RentalWorks doesn&apos;t expose per-I-code GL data
                  on uninvoiced orders, so we don&apos;t pretend to know
                  which specific revenue accounts each order will hit. The
                  actual GL coding flows through normally next month when the
                  invoice is cut.
                  {data.unbilledEarned.catchAllAccount &&
                    !data.unbilledEarned.catchAllAccount.linked && (
                      <>
                        {" "}
                        <span className="text-amber-700 font-medium">
                          ⚠ Link a catch-all revenue account in the settings
                          card above so the JE carries a real GL number.
                        </span>
                      </>
                    )}
                </p>
                <TooltipProvider delayDuration={150}>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[50px]">#</TableHead>
                          <TableHead>GL #</TableHead>
                          <TableHead>Account</TableHead>
                          <TableHead>QBO ID</TableHead>
                          <TableHead>Memo</TableHead>
                          <TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.proposedJE.unbilledAccrual.map((l) => (
                          <TableRow key={l.lineNo}>
                            <TableCell className="text-muted-foreground">{l.lineNo}</TableCell>
                            <TableCell className="font-mono text-xs">{l.accountNumber || "—"}</TableCell>
                            <TableCell>{l.accountName}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{l.qboQboId ?? "—"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{l.memo}</TableCell>
                            <JEAmountCell
                              amount={l.debit}
                              side="accrual"
                              source="unbilled"
                              accountNumber={l.accountNumber}
                              proposedAmount={l.debit || l.credit}
                              line={l}
                              contributorsByAccount={contributorsByAccount}
                              unbilledEarned={data.unbilledEarned}
                              proposedJELines={data.proposedJE.unbilledAccrual}
                              isAggregate={!l.accountNumber}
                            />
                            <JEAmountCell
                              amount={l.credit}
                              side="accrual"
                              source="unbilled"
                              accountNumber={l.accountNumber}
                              proposedAmount={l.debit || l.credit}
                              line={l}
                              contributorsByAccount={contributorsByAccount}
                              unbilledEarned={data.unbilledEarned}
                              proposedJELines={data.proposedJE.unbilledAccrual}
                              isAggregate={!l.accountNumber}
                            />
                          </TableRow>
                        ))}
                        <TableRow className="bg-gray-50/50 border-t-2">
                          <TableCell colSpan={5} className="font-semibold text-right">Totals</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(unbilledAccrualTotals.debit)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(unbilledAccrualTotals.credit)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </TooltipProvider>
                {unbilledAccrualTotals.debit !== unbilledAccrualTotals.credit && (
                  <p className="text-xs text-rose-600 mt-1">⚠ JE is out of balance by {formatCurrency(Math.abs(unbilledAccrualTotals.debit - unbilledAccrualTotals.credit))}</p>
                )}
              </div>
            )}

            {/* Proposed Deferral JE */}
            {data.proposedJE.deferral.length > 0 && (
              <div>
                <h4 className="font-semibold mb-2">
                  Proposed Deferral JE — {MONTH_NAMES[data.periodMonth - 1]} {data.periodYear}
                </h4>
                <p className="text-xs text-muted-foreground mb-2">
                  Hover a debit or credit to see the invoices contributing to that line.
                </p>
                <TooltipProvider delayDuration={150}>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[50px]">#</TableHead>
                          <TableHead>GL #</TableHead>
                          <TableHead>Account</TableHead>
                          <TableHead>QBO ID</TableHead>
                          <TableHead>Memo</TableHead>
                          <TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.proposedJE.deferral.map((l) => (
                          <TableRow key={l.lineNo}>
                            <TableCell className="text-muted-foreground">{l.lineNo}</TableCell>
                            <TableCell className="font-mono text-xs">{l.accountNumber || "—"}</TableCell>
                            <TableCell>{l.accountName}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{l.qboQboId ?? "—"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{l.memo}</TableCell>
                            <JEAmountCell
                              amount={l.debit}
                              side="deferral"
                              source="invoice"
                              accountNumber={l.accountNumber}
                              proposedAmount={l.debit || l.credit}
                              line={l}
                              contributorsByAccount={contributorsByAccount}
                              unbilledEarned={data.unbilledEarned}
                              proposedJELines={data.proposedJE.deferral}
                              isAggregate={!l.accountNumber}
                            />
                            <JEAmountCell
                              amount={l.credit}
                              side="deferral"
                              source="invoice"
                              accountNumber={l.accountNumber}
                              proposedAmount={l.debit || l.credit}
                              line={l}
                              contributorsByAccount={contributorsByAccount}
                              unbilledEarned={data.unbilledEarned}
                              proposedJELines={data.proposedJE.deferral}
                              isAggregate={!l.accountNumber}
                            />
                          </TableRow>
                        ))}
                        <TableRow className="bg-gray-50/50 border-t-2">
                          <TableCell colSpan={5} className="font-semibold text-right">Totals</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(deferralTotals.debit)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(deferralTotals.credit)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </TooltipProvider>
              </div>
            )}

            {/* Invoice-level detail */}
            {data.invoiceDetails.length > 0 && (
              <div>
                <button
                  onClick={() => setShowInvoiceDetail((v) => !v)}
                  className="flex items-center gap-2 font-semibold text-sm hover:text-blue-600"
                >
                  {showInvoiceDetail ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Invoices Requiring Adjustment ({data.invoiceDetails.length})
                </button>
                {showInvoiceDetail && (
                  <div className="mt-3 overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[30px]" />
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Invoice Date</TableHead>
                          <TableHead>Rental Period</TableHead>
                          <TableHead className="text-right">Days in Month / Total</TableHead>
                          <TableHead className="text-right">Earned (this month)</TableHead>
                          <TableHead className="text-right">Booked in QB</TableHead>
                          <TableHead className="text-right">Adjustment</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.invoiceDetails.map((inv) => {
                          const isOpen = expandedInvoices.has(inv.invoiceNumber);
                          return (
                            <Fragment key={inv.invoiceNumber}>
                              <TableRow
                                className="cursor-pointer hover:bg-gray-50/50"
                                onClick={() => toggleInvoice(inv.invoiceNumber)}
                              >
                                <TableCell>
                                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                                <TableCell>
                                  <Badge
                                    className={
                                      inv.adjustmentType === "accrual"
                                        ? "bg-teal-100 text-teal-800 hover:bg-teal-100"
                                        : "bg-amber-100 text-amber-800 hover:bg-amber-100"
                                    }
                                  >
                                    {inv.adjustmentType === "accrual" ? "Accrual" : "Deferral"}
                                  </Badge>
                                </TableCell>
                                <TableCell>{inv.customer}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{inv.invoiceDate}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {inv.rentalStart} → {inv.rentalEnd}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm">
                                  {inv.daysInPeriod} / {inv.totalRentalDays}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{formatCurrency(inv.earnedTotal)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatCurrency(inv.billedInPeriod)}</TableCell>
                                <TableCell
                                  className={`text-right tabular-nums font-medium ${
                                    inv.adjustmentType === "accrual" ? "text-teal-700" : "text-amber-700"
                                  }`}
                                >
                                  {inv.adjustmentType === "accrual"
                                    ? `+${formatCurrency(inv.adjustmentAmount)}`
                                    : formatCurrency(inv.adjustmentAmount)}
                                </TableCell>
                              </TableRow>
                              {isOpen && (
                                <TableRow>
                                  <TableCell />
                                  <TableCell colSpan={9} className="bg-gray-50/30 py-2">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead className="h-8 text-xs">GL #</TableHead>
                                          <TableHead className="h-8 text-xs">Account</TableHead>
                                          <TableHead className="h-8 text-xs text-right">Gross (from RW)</TableHead>
                                          <TableHead className="h-8 text-xs text-right">Daily Rate</TableHead>
                                          <TableHead className="h-8 text-xs text-right">Earned</TableHead>
                                          <TableHead className="h-8 text-xs text-right">Billed</TableHead>
                                          <TableHead className="h-8 text-xs text-right">Accrual</TableHead>
                                          <TableHead className="h-8 text-xs text-right">Deferral</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {inv.lines.map((l, idx) => (
                                          <TableRow key={idx}>
                                            <TableCell className="font-mono text-xs">{l.glAccountNo}</TableCell>
                                            <TableCell className="text-xs">{l.glAccountDescription}</TableCell>
                                            <TableCell className="text-right tabular-nums text-xs">{formatCurrency(l.totalContractValue)}</TableCell>
                                            <TableCell className="text-right tabular-nums text-xs">{formatCurrency(l.dailyRate)}</TableCell>
                                            <TableCell className="text-right tabular-nums text-xs">{formatCurrency(l.earnedRevenue)}</TableCell>
                                            <TableCell className="text-right tabular-nums text-xs">{formatCurrency(l.billedAmount)}</TableCell>
                                            <TableCell className="text-right tabular-nums text-xs text-teal-700">
                                              {l.accrualAmount > 0 ? formatCurrency(l.accrualAmount) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-xs text-amber-700">
                                              {l.deferralAmount > 0 ? formatCurrency(l.deferralAmount) : "—"}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-gray-50/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function UnbilledEarnedSection({ ub }: { ub: UnbilledEarned }) {
  const [showOrders, setShowOrders] = useState(false);
  const ratePct = Math.round(ub.realizationRate * 1000) / 10;
  const catchAll = ub.catchAllAccount;
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/30 p-4 space-y-3">
      <div>
        <div className="font-semibold text-blue-900">
          Unbilled Earned (active orders, no invoice yet)
        </div>
        <div className="text-xs text-blue-800/80">
          Orders whose rental period overlaps this month but haven&apos;t been
          invoiced. Booked as a single catch-all revenue credit at month-end
          (RentalWorks doesn&apos;t expose per-I-code GL data on uninvoiced
          orders); the actual GL coding flows through next month when the
          invoice is cut. Discounted by the entity&apos;s realization rate
          ({ratePct}%).
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard label="Active Orders" value={String(ub.orderCount)} />
        <StatCard label="Gross Earned" value={formatCurrency(ub.gross)} />
        <StatCard label={`Discount (${(100 - ratePct).toFixed(1)}%)`} value={formatCurrency(ub.discount)} />
        <StatCard label="Net (Accrual)" value={formatCurrency(ub.net)} />
      </div>
      <div className="rounded-md border bg-white p-3 text-xs">
        <div className="font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Catch-all revenue account
        </div>
        {catchAll && catchAll.linked ? (
          <div className="flex items-center gap-2">
            <span className="font-mono">{catchAll.number || "—"}</span>
            <span>{catchAll.name}</span>
            {catchAll.qboId && (
              <span className="text-muted-foreground">QBO #{catchAll.qboId}</span>
            )}
          </div>
        ) : (
          <div className="text-amber-700">
            Not linked. Open the settings card and pick an income account to
            land the unbilled credit on.
          </div>
        )}
      </div>
      <button
        onClick={() => setShowOrders((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-blue-800 hover:text-blue-900"
      >
        {showOrders ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {showOrders ? "Hide" : "Show"} order-level detail ({ub.orders.length})
      </button>
      {showOrders && (
        <div className="overflow-x-auto rounded-md border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Rental Period</TableHead>
                <TableHead className="text-right">Days in Month / Total</TableHead>
                <TableHead className="text-right">Order Total</TableHead>
                <TableHead className="text-right">Already Billed</TableHead>
                <TableHead className="text-right">Unbilled Remainder</TableHead>
                <TableHead className="text-right">Earned in Month</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ub.orders.map((o) => (
                <TableRow key={o.orderNumber}>
                  <TableCell className="font-mono text-xs">{o.orderNumber}</TableCell>
                  <TableCell className="text-sm">{o.customer}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                    {o.description}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {o.rentalStart} → {o.rentalEnd}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {o.daysInMonth} / {o.totalRentalDays}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(o.orderTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(o.billedAgainst)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(o.unbilledRemainder)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatCurrency(o.earnedInMonth)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── JE Amount Cell with hover breakdown ────────────────────────────────────
function JEAmountCell({
  amount,
  side,
  source,
  line,
  accountNumber,
  proposedAmount,
  contributorsByAccount,
  unbilledEarned,
  proposedJELines,
  isAggregate,
}: {
  amount: number;
  side: "accrual" | "deferral";
  source: "invoice" | "unbilled";
  line: JELine;
  accountNumber: string;
  proposedAmount: number;
  contributorsByAccount: Map<string, InvoiceContribution[]>;
  unbilledEarned: UnbilledEarned | undefined;
  proposedJELines: JELine[];
  isAggregate: boolean;
}) {
  const colorClass = side === "accrual" ? "text-teal-700" : "text-amber-700";

  if (amount <= 0) {
    return (
      <TableCell className={`text-right tabular-nums font-medium ${colorClass}`}>
        —
      </TableCell>
    );
  }

  const breakdown = buildBreakdown({
    side,
    source,
    line,
    accountNumber,
    isAggregate,
    contributorsByAccount,
    unbilledEarned,
    proposedJELines,
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TableCell
          className={`text-right tabular-nums font-medium cursor-help underline decoration-dotted underline-offset-2 ${colorClass}`}
        >
          {formatCurrency(amount)}
        </TableCell>
      </TooltipTrigger>
      <TooltipContent
        side="left"
        align="start"
        className="bg-white text-gray-900 border border-gray-200 shadow-xl max-w-[720px] p-0 text-left"
      >
        <BreakdownCard
          title={breakdownTitle(line, accountNumber, isAggregate)}
          side={side}
          proposedAmount={proposedAmount}
          breakdown={breakdown}
        />
      </TooltipContent>
    </Tooltip>
  );
}

function breakdownTitle(
  line: JELine,
  accountNumber: string,
  isAggregate: boolean,
): string {
  if (isAggregate) return `${line.accountName} — sources`;
  return `${accountNumber} — ${line.accountName} — sources`;
}

interface BreakdownRow {
  kind: "invoice" | "unbilled" | "account";
  label: string;
  secondary?: string;
  earned: number;
  billed: number;
  diff: number;
}

interface Breakdown {
  rows: BreakdownRow[];
  footerNote?: string;
}

function buildBreakdown({
  side,
  source,
  line,
  accountNumber,
  isAggregate,
  contributorsByAccount,
  unbilledEarned,
  proposedJELines,
}: {
  side: "accrual" | "deferral";
  source: "invoice" | "unbilled";
  line: JELine;
  accountNumber: string;
  isAggregate: boolean;
  contributorsByAccount: Map<string, InvoiceContribution[]>;
  unbilledEarned: UnbilledEarned | undefined;
  proposedJELines: JELine[];
}): Breakdown {
  const rows: BreakdownRow[] = [];

  // ── Unbilled-source JE: 3 lines (DR Unbilled AR / CR catch-all rev / CR
  //    allowance) — all are aggregates over the order list. We disambiguate
  //    by line role and scale each order's earnedInMonth accordingly.
  if (source === "unbilled" && unbilledEarned) {
    const rate = unbilledEarned.realizationRate;
    const nameLower = line.accountName.toLowerCase();
    const isAllowance = nameLower.includes("allowance");
    const isCredit = line.credit > 0;
    let scale: number;
    let typeLabel: string;
    if (isAllowance) {
      scale = 1 - rate;
      typeLabel = `Discount share @ ${((1 - rate) * 100).toFixed(0)}%`;
    } else if (isCredit) {
      scale = rate;
      typeLabel = `Net revenue @ ${(rate * 100).toFixed(0)}% realization`;
    } else {
      scale = 1;
      typeLabel = "Gross earned in month";
    }
    for (const o of unbilledEarned.orders) {
      const contribution = round2(o.earnedInMonth * scale);
      if (contribution <= 0) continue;
      rows.push({
        kind: "unbilled",
        label: o.orderNumber,
        secondary: `${o.customer} · ${o.daysInMonth}/${o.totalRentalDays} days`,
        earned: contribution,
        billed: 0,
        diff: contribution,
      });
    }
    return {
      rows: rows.sort((a, b) => b.diff - a.diff),
      footerNote: typeLabel,
    };
  }

  // ── Invoice-source JE (timing accrual + deferral): ──
  if (isAggregate) {
    // Aggregate line: list per-GL contributions
    for (const je of proposedJELines) {
      if (!je.accountNumber) continue;
      const amt = je.debit > 0 ? je.debit : je.credit;
      if (amt <= 0) continue;
      rows.push({
        kind: "account",
        label: `${je.accountNumber} — ${je.accountName}`,
        earned: 0,
        billed: 0,
        diff: side === "accrual" ? amt : -amt,
      });
    }
    return {
      rows,
      footerNote:
        "Per-GL-account breakdown. Hover an individual GL line to see invoice detail.",
    };
  }

  const contribs = contributorsByAccount.get(accountNumber) ?? [];
  for (const c of contribs) {
    rows.push({
      kind: "invoice",
      label: c.invoiceNumber,
      secondary: `${c.customer}${c.daysInPeriod > 0 ? ` · ${c.daysInPeriod}/${c.totalRentalDays} days` : ""}`,
      earned: c.earned,
      billed: c.billed,
      diff: c.diff,
    });
  }

  return { rows };
}

function BreakdownCard({
  title,
  side,
  proposedAmount,
  breakdown,
}: {
  title: string;
  side: "accrual" | "deferral";
  proposedAmount: number;
  breakdown: Breakdown;
}) {
  const colorClass = side === "accrual" ? "text-teal-700" : "text-amber-700";
  const totalEarned = breakdown.rows.reduce((s, r) => s + r.earned, 0);
  const totalBilled = breakdown.rows.reduce((s, r) => s + r.billed, 0);
  const totalDiff = breakdown.rows.reduce((s, r) => s + r.diff, 0);

  if (breakdown.rows.length === 0) {
    return (
      <div className="p-3 text-sm">
        <div className="font-semibold mb-1">{title}</div>
        <div className="text-xs text-muted-foreground">No source detail available.</div>
      </div>
    );
  }

  return (
    <div className="p-0 text-sm">
      <div className="px-3 pt-2 pb-1 border-b flex items-center justify-between gap-4">
        <div className="font-semibold">{title}</div>
        <div className={`tabular-nums font-semibold ${colorClass}`}>
          {formatCurrency(proposedAmount)}
        </div>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium">Source</th>
              <th className="text-left px-2 py-1.5 font-medium">Customer / Note</th>
              <th className="text-right px-2 py-1.5 font-medium">Earned</th>
              <th className="text-right px-2 py-1.5 font-medium">Billed</th>
              <th className="text-right px-3 py-1.5 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.rows.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-1 font-mono text-[11px]">
                  {r.kind === "unbilled" ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 mr-1">
                      Unbilled
                    </Badge>
                  ) : null}
                  {r.label}
                </td>
                <td className="px-2 py-1 text-muted-foreground truncate max-w-[180px]">
                  {r.secondary ?? "—"}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {r.earned ? formatCurrency(r.earned) : "—"}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {r.billed ? formatCurrency(r.billed) : "—"}
                </td>
                <td
                  className={`px-3 py-1 text-right tabular-nums font-medium ${
                    r.diff > 0 ? "text-teal-700" : r.diff < 0 ? "text-amber-700" : ""
                  }`}
                >
                  {r.diff === 0
                    ? "—"
                    : r.diff > 0
                    ? `+${formatCurrency(r.diff)}`
                    : formatCurrency(r.diff)}
                </td>
              </tr>
            ))}
          </tbody>
          {breakdown.rows.some((r) => r.kind !== "account") && (
            <tfoot className="border-t bg-gray-50">
              <tr>
                <td colSpan={2} className="px-3 py-1.5 font-semibold">
                  Net ({breakdown.rows.length} rows)
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                  {formatCurrency(totalEarned)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                  {formatCurrency(totalBilled)}
                </td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums font-semibold ${
                    totalDiff >= 0 ? "text-teal-700" : "text-amber-700"
                  }`}
                >
                  {totalDiff >= 0
                    ? `+${formatCurrency(totalDiff)}`
                    : formatCurrency(totalDiff)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {breakdown.footerNote && (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-t bg-gray-50">
          {breakdown.footerNote}
        </div>
      )}
    </div>
  );
}

// ─── Account Links Settings Card ────────────────────────────────────────────
// Lets the user map each accrual-JE target account to a row in their QBO
// chart so the proposed JE carries real account numbers / QBO IDs instead of
// placeholder labels.

interface EntityAccount {
  id: string;
  account_number: string | null;
  name: string;
  classification: string;
  account_type: string | null;
  account_sub_type: string | null;
}

type LinksState = {
  unbilledReceivablesAccountId: string | null;
  allowanceAccountId: string | null;
  accruedRevenueAccountId: string | null;
  deferredRevenueAccountId: string | null;
  unbilledRevenueAccountId: string | null;
};

function AccrualAccountLinksCard({
  accounts,
  links,
  loaded,
  available,
  onChange,
}: {
  accounts: EntityAccount[];
  links: LinksState;
  loaded: boolean;
  available: boolean;
  onChange: (field: keyof LinksState, accountId: string | null) => void;
}) {
  // Sort each dropdown so the classification that "usually" fits comes first,
  // but EVERY account is selectable — entities don't always classify things
  // the standard way. A search bar makes it easy to find any account.
  const sortedByClassification = useCallback(
    (preferredClassification: string): EntityAccount[] => {
      return [...accounts].sort((a, b) => {
        const aPref = a.classification === preferredClassification ? 0 : 1;
        const bPref = b.classification === preferredClassification ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;
        const aNum = a.account_number ?? "";
        const bNum = b.account_number ?? "";
        if (aNum && bNum) return aNum.localeCompare(bNum);
        return a.name.localeCompare(b.name);
      });
    },
    [accounts],
  );

  const assetAccounts = useMemo(
    () => sortedByClassification("Asset"),
    [sortedByClassification],
  );
  const liabilityAccounts = useMemo(
    () => sortedByClassification("Liability"),
    [sortedByClassification],
  );
  const revenueAccounts = useMemo(
    () => sortedByClassification("Revenue"),
    [sortedByClassification],
  );

  const renderLink = (
    field: keyof LinksState,
    label: string,
    description: string,
    usage: string,
    candidateList: EntityAccount[],
    preferredClassification: string,
  ) => {
    const currentId = links[field];
    const current = accounts.find((a) => a.id === currentId) ?? null;
    const comboOptions = candidateList.map((a) => ({
      id: a.id,
      account_number: a.account_number,
      name: a.name,
      account_type: a.account_type ?? undefined,
      secondary:
        a.classification && a.classification !== preferredClassification
          ? a.classification
          : a.account_sub_type ?? undefined,
    }));
    return (
      <div key={field} className="rounded-md border p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide">
              {label}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {description}
            </div>
          </div>
          {current ? (
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
              {current.account_number
                ? `${current.account_number} · ${current.name}`
                : current.name}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-700 border-amber-300">
              Not linked
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <AccountCombobox
              accounts={comboOptions}
              value={currentId ?? ""}
              onValueChange={(v) => onChange(field, v || null)}
              placeholder={loaded ? "Select account…" : "Loading…"}
              searchPlaceholder="Search by name, number, or type…"
              emptyMessage="No matching account."
              disabled={!loaded || !available}
            />
          </div>
          {currentId && (
            <button
              type="button"
              onClick={() => onChange(field, null)}
              className="text-[11px] text-muted-foreground hover:text-rose-600 underline"
              disabled={!loaded || !available}
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground italic">{usage}</p>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Accrual JE Account Links</CardTitle>
        <CardDescription>
          Map each balance-sheet / contra-revenue line used by the proposed
          accrual and deferral JEs to a specific account in this entity&apos;s
          chart. Once linked, the JE preview shows the real account number +
          QBO ID so you can post without re-lookup.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!available && loaded && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="font-semibold">Database migration required</div>
            <div className="mt-1 text-xs">
              The account-link columns don&apos;t exist in{" "}
              <code className="font-mono">entity_accrual_config</code> yet.
              Apply migrations{" "}
              <code className="font-mono">
                20260420_accrual_je_account_links.sql
              </code>{" "}
              and{" "}
              <code className="font-mono">
                20260421_unbilled_revenue_catchall_account.sql
              </code>{" "}
              in the Supabase SQL editor, then reload. Linking is disabled
              until then; realization rate still works normally.
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {renderLink(
            "accruedRevenueAccountId",
            "Accrued Revenue (Asset)",
            "Asset account debited for the revenue cut-off accrual.",
            "DR on: Revenue Cut-Off Accrual",
            assetAccounts,
            "Asset",
          )}
          {renderLink(
            "unbilledReceivablesAccountId",
            "Unbilled Receivables (Asset)",
            "Asset account debited for the estimated unbilled revenue accrual (gross).",
            "DR on: Estimated Unbilled Revenue Accrual",
            assetAccounts,
            "Asset",
          )}
          {renderLink(
            "unbilledRevenueAccountId",
            "Unbilled Revenue (Catch-All Income)",
            "Single income account credited for the entire unbilled-earned net amount each month-end.",
            "CR on: Estimated Unbilled Revenue Accrual",
            revenueAccounts,
            "Revenue",
          )}
          {renderLink(
            "allowanceAccountId",
            "Allowance for Discounts (Contra-Revenue)",
            "Contra-revenue account credited for the realization-rate discount.",
            "CR on: Estimated Unbilled Revenue Accrual",
            revenueAccounts,
            "Revenue",
          )}
          {renderLink(
            "deferredRevenueAccountId",
            "Deferred Revenue (Liability)",
            "Liability account credited for billings not yet earned.",
            "CR on: Deferral JE",
            liabilityAccounts,
            "Liability",
          )}
        </div>
      </CardContent>
    </Card>
  );
}

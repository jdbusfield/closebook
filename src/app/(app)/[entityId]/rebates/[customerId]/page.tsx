"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  ArrowLeft,
  RefreshCw,
  Calculator,
  Loader2,
  ChevronDown,
  ChevronRight,
  Ban,
  CheckCircle2,
  ClipboardList,
  Plus,
  Search,
  Trash2,
  Download,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  getEquipmentLabel,
  getCurrentQuarter,
} from "@/lib/utils/rebate-calculations";
import type { EquipmentType } from "@/lib/types/database";

interface RebateInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  billing_end_date: string | null;
  status: string | null;
  deal: string | null;
  order_number: string | null;
  order_description: string | null;
  equipment_type: string;
  list_total: number;
  gross_total: number;
  sub_total: number;
  tax_amount: number;
  discount_amount: number;
  discount_eligible_amount: number | null;
  excluded_total: number | null;
  taxable_sales: number | null;
  before_discount: number | null;
  discount_percent: number | null;
  final_amount: number | null;
  tier_label: string | null;
  rebate_rate: number | null;
  remaining_rebate_pct: number | null;
  net_rebate: number | null;
  cumulative_revenue: number | null;
  cumulative_rebate: number | null;
  quarter: string | null;
  is_manually_excluded: boolean;
  manual_exclusion_reason: string | null;
}

interface InvoiceItem {
  id: string;
  i_code: string | null;
  description: string | null;
  quantity: number | null;
  extended: number | null;
  discount_amount: number | null;
  is_excluded: boolean;
  record_type: string | null;
}

interface ActiveOrder {
  orderId: string;
  orderNumber: string;
  orderDate: string | null;
  estimatedStartDate: string | null;
  estimatedStopDate: string | null;
  status: string;
  deal: string | null;
  description: string | null;
  total: number;
  rentalTotal: number;
  purchaseOrderNumber: string | null;
  equipmentType: string;
}

interface QuarterlySummary {
  id: string;
  quarter: string;
  total_revenue: number | null;
  total_rebate: number | null;
  invoice_count: number | null;
  tier_label: string | null;
  is_paid: boolean;
}

interface CustomerData {
  id: string;
  customer_name: string;
  rw_customer_id: string | null;
  rw_customer_number: string | null;
  agreement_type: string;
  status: string;
  tax_rate: number;
}

interface TierData {
  label: string;
  threshold_min: number;
  threshold_max: number | null;
  sort_order: number;
  rate_pro_supplies: number | null;
  rate_vehicle: number | null;
  rate_grip_lighting: number | null;
  rate_studio: number | null;
  max_disc_pro_supplies: number | null;
  max_disc_vehicle: number | null;
  max_disc_grip_lighting: number | null;
  max_disc_studio: number | null;
}

// Category grouping for invoice line items
const RECORD_TYPE_CATEGORIES = [
  { key: "R", label: "Rental", color: "text-blue-700 dark:text-blue-400" },
  { key: "S", label: "Sales", color: "text-green-700 dark:text-green-400" },
  { key: "F", label: "Loss & Damage", color: "text-orange-700 dark:text-orange-400" },
  { key: "L", label: "Loss & Damage", color: "text-orange-700 dark:text-orange-400" },
  { key: "M", label: "Miscellaneous", color: "text-purple-700 dark:text-purple-400" },
] as const;

function getRecordTypeLabel(rt: string | null): string {
  if (!rt) return "Other";
  const found = RECORD_TYPE_CATEGORIES.find((c) => c.key === rt);
  return found ? found.label : "Other";
}

function groupItemsByCategory(items: InvoiceItem[]) {
  const groups: Record<string, InvoiceItem[]> = {};
  for (const item of items) {
    const key = item.record_type || "O"; // O = Other/unknown
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return "0.00%";
  return `${n.toFixed(2)}%`;
}

export default function CustomerDetailPage({
  entityId: entityIdProp,
  customerId: customerIdProp,
  isEmbed,
  embedKey,
}: {
  entityId?: string;
  customerId?: string;
  isEmbed?: boolean;
  embedKey?: string;
} = {}) {
  const params = useParams();
  const entityId = entityIdProp || (params.entityId as string);
  const customerId = customerIdProp || (params.customerId as string);

  const apiFetch = useCallback(
    (url: string, init: RequestInit = {}) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...((init.headers as Record<string, string>) || {}),
      };
      if (embedKey) headers["x-embed-key"] = embedKey;
      return fetch(url, { ...init, headers });
    },
    [embedKey],
  );

  const backHref = isEmbed
    ? "/embed/versatile/rebates"
    : `/${entityId}/rebates`;

  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [tiers, setTiers] = useState<TierData[]>([]);
  const [invoices, setInvoices] = useState<RebateInvoice[]>([]);
  const [quarterlySummaries, setQuarterlySummaries] = useState<
    QuarterlySummary[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(
    new Set(),
  );
  const [invoiceItems, setInvoiceItems] = useState<
    Record<string, InvoiceItem[]>
  >({});
  const [selectedQuarter, setSelectedQuarter] = useState("all");
  const [excludedICodes, setExcludedICodes] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

  // Add Invoice dialog (freelancer)
  const [addInvoiceOpen, setAddInvoiceOpen] = useState(false);
  const [addInvoiceNumber, setAddInvoiceNumber] = useState("");
  const [addingInvoice, setAddingInvoice] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await apiFetch("/api/rebates", {
        method: "POST",
        body: JSON.stringify({
          action: "get_customer_detail",
          entityId,
          customerId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return;
      }
      setCustomer((data.customer as CustomerData) || null);
      setTiers((data.tiers as TierData[]) || []);
      setInvoices((data.invoices as RebateInvoice[]) || []);
      setQuarterlySummaries((data.quarterlySummaries as QuarterlySummary[]) || []);
      setExcludedICodes(new Set<string>(data.excludedICodes || []));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, entityId, customerId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-load active orders once customer data is available (commercial only)
  useEffect(() => {
    if (!loading && customer && customer.agreement_type !== "freelancer" && !ordersLoaded) {
      loadActiveOrders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, customer]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch("/api/rebates/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync_customer",
          entityId,
          customerId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Synced ${data.synced} invoices, ${data.itemsSynced} items`);
        loadData();
      } else {
        toast.error(data.error || "Sync failed");
      }
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleCalculate = async () => {
    setCalculating(true);
    try {
      const res = await apiFetch("/api/rebates/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "calculate_customer",
          entityId,
          customerId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          `Calculated rebates for ${data.invoiceCount} invoices: ${formatCurrency(data.totalRebate)}`,
        );
        loadData();
      } else {
        toast.error(data.error || "Calculation failed");
      }
    } catch {
      toast.error("Calculation failed");
    } finally {
      setCalculating(false);
    }
  };

  const toggleInvoiceExpand = async (invoiceId: string) => {
    const next = new Set(expandedInvoices);
    if (next.has(invoiceId)) {
      next.delete(invoiceId);
    } else {
      next.add(invoiceId);
      // Load items if not cached
      if (!invoiceItems[invoiceId]) {
        const res = await apiFetch("/api/rebates", {
          method: "POST",
          body: JSON.stringify({
            action: "get_invoice_items",
            invoiceIds: [invoiceId],
          }),
        });
        const data = await res.json();
        setInvoiceItems((prev) => ({
          ...prev,
          [invoiceId]: (data.items as InvoiceItem[]) || [],
        }));
      }
    }
    setExpandedInvoices(next);
  };

  const handleToggleExclusion = async (invoice: RebateInvoice) => {
    try {
      const res = await apiFetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_manual_exclusion",
          invoiceId: invoice.id,
          isExcluded: !invoice.is_manually_excluded,
          reason: !invoice.is_manually_excluded
            ? "Manually excluded"
            : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          invoice.is_manually_excluded
            ? "Invoice included"
            : "Invoice excluded",
        );
        loadData();
      }
    } catch {
      toast.error("Failed to toggle exclusion");
    }
  };

  const handleMarkPaid = async (summary: QuarterlySummary) => {
    try {
      const res = await apiFetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_quarter_paid",
          summaryId: summary.id,
          isPaid: !summary.is_paid,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          summary.is_paid
            ? `${summary.quarter} marked unpaid`
            : `${summary.quarter} marked paid`,
        );
        loadData();
      }
    } catch {
      toast.error("Failed to update payment status");
    }
  };

  const loadActiveOrders = async () => {
    setLoadingOrders(true);
    try {
      const res = await apiFetch("/api/rebates/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fetch_active_orders",
          customerId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveOrders(data.orders || []);
        setOrdersLoaded(true);
      } else {
        toast.error(data.error || "Failed to load active orders");
      }
    } catch {
      toast.error("Failed to load active orders");
    } finally {
      setLoadingOrders(false);
    }
  };

  const toggleOrderExpand = (orderId: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const handleAddInvoice = async () => {
    if (!addInvoiceNumber.trim()) {
      toast.error("Enter an invoice number");
      return;
    }
    setAddingInvoice(true);
    try {
      const res = await apiFetch("/api/rebates/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_invoice",
          entityId,
          customerId,
          invoiceNumber: addInvoiceNumber.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          `Added invoice ${data.invoice.invoice_number} (${data.itemsSynced} items)`,
        );
        setAddInvoiceOpen(false);
        setAddInvoiceNumber("");
        loadData();
      } else {
        toast.error(data.error || "Failed to add invoice");
      }
    } catch {
      toast.error("Failed to add invoice");
    } finally {
      setAddingInvoice(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string, invoiceNumber: string) => {
    if (!confirm(`Remove invoice ${invoiceNumber} from this agreement?`)) return;
    try {
      const res = await apiFetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_invoice",
          invoiceId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Invoice ${invoiceNumber} removed`);
        loadData();
      } else {
        toast.error(data.error || "Failed to delete invoice");
      }
    } catch {
      toast.error("Failed to delete invoice");
    }
  };

  const [exporting, setExporting] = useState(false);

  const loadItemsForExport = async (exportInvoices: RebateInvoice[]) => {
    const missingIds = exportInvoices
      .map((inv) => inv.id)
      .filter((id) => !invoiceItems[id]);
    if (missingIds.length > 0) {
      const res = await apiFetch("/api/rebates", {
        method: "POST",
        body: JSON.stringify({
          action: "get_invoice_items",
          invoiceIds: missingIds,
        }),
      });
      const data = await res.json();
      const items = (data.items as Array<InvoiceItem & { rebate_invoice_id: string }>) || [];
      if (items.length > 0) {
        const grouped: Record<string, InvoiceItem[]> = {};
        for (const item of items) {
          const invId = item.rebate_invoice_id;
          if (!grouped[invId]) grouped[invId] = [];
          grouped[invId].push(item);
        }
        setInvoiceItems((prev) => ({ ...prev, ...grouped }));
        Object.assign(invoiceItems, grouped);
      }
    }
  };

  const getExportInvoices = (quarter: string) => {
    const base = quarter === "all"
      ? invoices
      : invoices.filter((inv) => inv.quarter === quarter);
    return base.filter((inv) => !inv.is_manually_excluded);
  };

  const handleExport = async (quarter: string) => {
    setExporting(true);
    try {
      const XLSX = await import("xlsx");

      const exportInvoices = getExportInvoices(quarter);
      if (exportInvoices.length === 0) {
        toast.error("No invoices to export for this quarter");
        return;
      }

      await loadItemsForExport(exportInvoices);

      const wb = XLSX.utils.book_new();

      // --- Summary sheet ---
      const summaryData: (string | number | null)[][] = [
        ["Rebate Report"],
        [`Customer: ${customer!.customer_name}`],
        [`Agreement Type: ${customer!.agreement_type}`],
        [`Quarter: ${quarter === "all" ? "All Quarters" : quarter}`],
        [`Generated: ${new Date().toLocaleDateString()}`],
        [],
        ["Invoice Summary"],
        ["Invoice #", "Date", "Quarter", "Deal / Order", "Type", "Gross Total", "Excluded", "Before Disc", "Eligible Discount", "Final Amount", "Rebate %", "Net Rebate"],
      ];

      let grandTotalListTotal = 0;
      let grandTotalExcluded = 0;
      let grandTotalBeforeDisc = 0;
      let grandTotalDiscount = 0;
      let grandTotalFinalAmount = 0;
      let grandTotalNetRebate = 0;

      for (const inv of exportInvoices) {
        grandTotalListTotal += inv.gross_total || 0;
        grandTotalExcluded += (inv.gross_total || 0) - (inv.before_discount || 0);
        grandTotalBeforeDisc += (inv.before_discount || 0);
        grandTotalDiscount += inv.discount_eligible_amount ?? inv.discount_amount ?? 0;
        grandTotalFinalAmount += inv.final_amount || 0;
        grandTotalNetRebate += (inv.net_rebate || 0);

        summaryData.push([
          inv.invoice_number,
          inv.billing_end_date || inv.invoice_date || "",
          inv.quarter || "",
          inv.deal || inv.order_description || "",
          getEquipmentLabel(inv.equipment_type as EquipmentType),
          inv.gross_total,
          (inv.gross_total || 0) - (inv.before_discount || 0),
          inv.before_discount,
          inv.discount_eligible_amount ?? inv.discount_amount,
          inv.final_amount,
          inv.remaining_rebate_pct != null ? inv.remaining_rebate_pct / 100 : null,
          inv.net_rebate,
        ]);
      }

      summaryData.push([
        "TOTALS", "", "", "", "",
        grandTotalListTotal,
        grandTotalExcluded,
        grandTotalBeforeDisc,
        grandTotalDiscount,
        grandTotalFinalAmount,
        null,
        grandTotalNetRebate,
      ]);

      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);

      // Column widths
      summarySheet["!cols"] = [
        { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 35 }, { wch: 14 },
        { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 14 },
      ];

      // Format currency columns (F-J,L = cols 5,6,7,8,9,11) and percent (K = col 10)
      const dataStartRow = 9; // 1-indexed, row 9 is first data row (after headers at row 8)
      for (let r = dataStartRow; r <= dataStartRow + exportInvoices.length; r++) {
        for (const col of [5, 6, 7, 8, 9, 11]) {
          const cellRef = XLSX.utils.encode_cell({ r: r - 1, c: col });
          if (summarySheet[cellRef] && typeof summarySheet[cellRef].v === "number") {
            summarySheet[cellRef].z = '$#,##0.00';
          }
        }
        const pctRef = XLSX.utils.encode_cell({ r: r - 1, c: 10 });
        if (summarySheet[pctRef] && typeof summarySheet[pctRef].v === "number") {
          summarySheet[pctRef].z = '0.00%';
        }
      }

      XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

      // --- Individual invoice detail sheets ---
      for (const inv of exportInvoices) {
        const items = invoiceItems[inv.id] || [];
        const grouped = groupItemsByCategory(items);
        const orderedKeys = [
          ...RECORD_TYPE_CATEGORIES.map((c) => c.key).filter((k) => grouped[k]),
          ...Object.keys(grouped).filter(
            (k) => !RECORD_TYPE_CATEGORIES.some((c) => c.key === k),
          ),
        ];

        const detailData: (string | number | null)[][] = [
          [`Invoice: ${inv.invoice_number}`],
          [`Date: ${inv.billing_end_date || inv.invoice_date || "N/A"}`],
          [`Deal / Order: ${inv.deal || inv.order_description || "N/A"}`],
          [`Equipment Type: ${getEquipmentLabel(inv.equipment_type as EquipmentType)}`],
          [`Quarter: ${inv.quarter || "N/A"}`],
          [],
          ["Calculation Breakdown"],
          ["", "Field", "Value"],
          ["", "Gross Invoice Total", inv.gross_total],
          ["", "Excluded", inv.excluded_total || 0],
          ["", "Tax", inv.tax_amount],
          ["", "Taxable Sales", inv.taxable_sales || 0],
          ["", "Before Discount", inv.before_discount || 0],
          ["", "Eligible Discount", inv.discount_eligible_amount ?? inv.discount_amount],
          ["", "Discount %", inv.discount_percent != null ? inv.discount_percent / 100 : 0],
          ["", "Final Amount", inv.final_amount || 0],
          ["", "Remaining Rebate", inv.remaining_rebate_pct != null ? inv.remaining_rebate_pct / 100 : 0],
          ["", "Net Rebate", inv.net_rebate || 0],
          [],
          ["", "Tier", inv.tier_label || "N/A"],
          ["", "Rebate Rate", inv.rebate_rate != null ? inv.rebate_rate / 100 : 0],
          ["", "Cumulative Revenue", inv.cumulative_revenue || 0],
          ["", "Cumulative Rebate", inv.cumulative_rebate || 0],
          [],
          ["Line Items"],
        ];

        for (const catKey of orderedKeys) {
          const catItems = grouped[catKey];
          const catConfig = RECORD_TYPE_CATEGORIES.find((c) => c.key === catKey);
          const label = catConfig?.label || "Other";
          const catRegular = catItems.reduce((s, it) => s + (Number(it.extended) || 0), 0);
          const catNet = catItems.reduce(
            (s, it) =>
              s + ((Number(it.extended) || 0) - (Number(it.discount_amount) || 0)),
            0,
          );

          detailData.push([]);
          detailData.push([
            `${label} (${catItems.length} items)`,
            "",
            "",
            formatCurrency(catRegular),
            "",
            "",
            formatCurrency(catNet),
            "",
          ]);
          detailData.push([
            "I-Code",
            "Description",
            "Qty",
            "Regular",
            "Disc %",
            "Discount",
            "Net",
            "Status",
          ]);

          for (const item of catItems) {
            const isExcludedByICode = item.i_code != null && excludedICodes.has(item.i_code.trim());
            const isLossAndDamage = item.record_type === "F" || item.record_type === "L";
            const isExcluded = item.is_excluded || isExcludedByICode || isLossAndDamage;
            const regular = Number(item.extended) || 0;
            const discount = Number(item.discount_amount) || 0;
            const net = regular - discount;
            const discPct = regular > 0 ? discount / regular : 0;
            detailData.push([
              item.i_code || "",
              item.description || "",
              item.quantity,
              regular,
              discount > 0 ? discPct : "",
              discount > 0 ? discount : "",
              net,
              isExcluded ? (isLossAndDamage ? "Loss & Damage" : "Excluded") : "",
            ]);
          }
        }

        const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
        detailSheet["!cols"] = [
          { wch: 16 }, { wch: 45 }, { wch: 8 },
          { wch: 14 }, { wch: 9 }, { wch: 14 }, { wch: 14 },
          { wch: 16 },
        ];

        // Format currency cells in calculation breakdown (column C, rows 9-18)
        for (const r of [8, 9, 10, 11, 12, 13, 15, 17, 21, 22]) {
          const cellRef = XLSX.utils.encode_cell({ r, c: 2 });
          if (detailSheet[cellRef] && typeof detailSheet[cellRef].v === "number") {
            detailSheet[cellRef].z = '$#,##0.00';
          }
        }
        // Format percent cells
        for (const r of [14, 16, 20]) {
          const cellRef = XLSX.utils.encode_cell({ r, c: 2 });
          if (detailSheet[cellRef] && typeof detailSheet[cellRef].v === "number") {
            detailSheet[cellRef].z = '0.00%';
          }
        }

        // Format the line-item value columns: Regular (3), Disc % (4), Discount (5), Net (6).
        // Body rows live below the calculation breakdown; iterate the whole sheet and
        // format any number cell in those columns.
        const range = XLSX.utils.decode_range(detailSheet["!ref"] || "A1");
        for (let r = 25; r <= range.e.r; r++) {
          for (const c of [3, 5, 6]) {
            const cellRef = XLSX.utils.encode_cell({ r, c });
            if (detailSheet[cellRef] && typeof detailSheet[cellRef].v === "number") {
              detailSheet[cellRef].z = '$#,##0.00';
            }
          }
          const pctCell = XLSX.utils.encode_cell({ r, c: 4 });
          if (detailSheet[pctCell] && typeof detailSheet[pctCell].v === "number") {
            detailSheet[pctCell].z = '0.00%';
          }
        }

        // Sheet name: truncate invoice number to 31 chars (Excel limit)
        const sheetName = inv.invoice_number.slice(0, 31);
        XLSX.utils.book_append_sheet(wb, detailSheet, sheetName);
      }

      const quarterLabel = quarter === "all" ? "All" : quarter.replace(/\s+/g, "-");
      const filename = `Rebate Report - ${customer!.customer_name} - ${quarterLabel}.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Exported ${exportInvoices.length} invoices`);
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async (quarter: string) => {
    setExporting(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const exportInvoices = getExportInvoices(quarter);
      if (exportInvoices.length === 0) {
        toast.error("No invoices to export for this quarter");
        return;
      }

      await loadItemsForExport(exportInvoices);

      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 40;

      // --- Title page / header ---
      doc.setFontSize(18);
      doc.text("Rebate Report", margin, 50);
      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text(`Customer: ${customer!.customer_name}`, margin, 70);
      doc.text(`Agreement Type: ${customer!.agreement_type.charAt(0).toUpperCase() + customer!.agreement_type.slice(1)}`, margin, 85);
      doc.text(`Quarter: ${quarter === "all" ? "All Quarters" : quarter}`, margin, 100);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, 115);
      doc.setTextColor(0);

      // --- Summary table ---
      const summaryHead = [["Invoice #", "Date", "Quarter", "Deal / Order", "Type", "Gross Total", "Excluded", "Before Disc", "Eligible Discount", "Final Amount", "Rebate %", "Net Rebate"]];
      const summaryBody: (string | number)[][] = [];

      let grandTotalList = 0;
      let grandTotalExcl = 0;
      let grandTotalBefore = 0;
      let grandTotalDisc = 0;
      let grandTotalFinal = 0;
      let grandTotalRebate = 0;

      for (const inv of exportInvoices) {
        grandTotalList += inv.gross_total || 0;
        grandTotalExcl += (inv.gross_total || 0) - (inv.before_discount || 0);
        grandTotalBefore += inv.before_discount || 0;
        grandTotalDisc += inv.discount_eligible_amount ?? inv.discount_amount ?? 0;
        grandTotalFinal += inv.final_amount || 0;
        grandTotalRebate += inv.net_rebate || 0;

        summaryBody.push([
          inv.invoice_number,
          inv.billing_end_date || inv.invoice_date || "",
          inv.quarter || "",
          (inv.deal || inv.order_description || "").slice(0, 35),
          getEquipmentLabel(inv.equipment_type as EquipmentType),
          formatCurrency(inv.gross_total),
          formatCurrency((inv.gross_total || 0) - (inv.before_discount || 0)),
          formatCurrency(inv.before_discount),
          formatCurrency(inv.discount_eligible_amount ?? inv.discount_amount),
          formatCurrency(inv.final_amount),
          formatPct(inv.remaining_rebate_pct),
          formatCurrency(inv.net_rebate),
        ]);
      }

      summaryBody.push([
        "TOTALS", "", "", "", "",
        formatCurrency(grandTotalList),
        formatCurrency(grandTotalExcl),
        formatCurrency(grandTotalBefore),
        formatCurrency(grandTotalDisc),
        formatCurrency(grandTotalFinal),
        "",
        formatCurrency(grandTotalRebate),
      ]);

      autoTable(doc, {
        startY: 135,
        head: summaryHead,
        body: summaryBody,
        theme: "grid",
        headStyles: { fillColor: [41, 41, 41], fontSize: 7.5 },
        bodyStyles: { fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 58 },
          3: { cellWidth: 100 },
          5: { halign: "right" },
          6: { halign: "right" },
          7: { halign: "right" },
          8: { halign: "right" },
          9: { halign: "right" },
          10: { halign: "right" },
          11: { halign: "right", fontStyle: "bold" },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        didParseCell: (data: any) => {
          if (data.row.index === summaryBody.length - 1) {
            data.cell.styles.fillColor = [240, 240, 240];
            data.cell.styles.fontStyle = "bold";
          }
        },
        margin: { left: margin, right: margin },
      });

      // --- Tier rate grids ---
      if (tiers.length > 0) {
        let tierY = (doc as any).lastAutoTable.finalY + 25;
        const categories = ["pro_supplies", "vehicle", "grip_lighting", "studio"] as const;
        const catLabels: Record<string, string> = { pro_supplies: "Pro Supplies", vehicle: "Vehicle", grip_lighting: "Grip & Lighting", studio: "Studio" };

        // Rebate Rates grid
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Rebate Rates", margin, tierY);
        doc.setFont("helvetica", "normal");
        tierY += 5;

        const rateHead = [["Tier", "Revenue Range", ...categories.map(c => catLabels[c])]];
        const rateBody = tiers.map(t => [
          t.label,
          t.threshold_max ? `${formatCurrency(t.threshold_min)} – ${formatCurrency(t.threshold_max)}` : `${formatCurrency(t.threshold_min)}+`,
          ...categories.map(c => t[`rate_${c}` as keyof TierData] != null ? formatPct(t[`rate_${c}` as keyof TierData] as number) : "—"),
        ]);

        autoTable(doc, {
          startY: tierY,
          head: rateHead,
          body: rateBody,
          theme: "grid",
          headStyles: { fillColor: [41, 41, 41], fontSize: 7.5 },
          bodyStyles: { fontSize: 7 },
          margin: { left: margin, right: margin + (pageWidth - 2 * margin) / 2 + 10 },
          tableWidth: (pageWidth - 2 * margin) / 2 - 10,
        });

        const rateTableEndY = (doc as any).lastAutoTable.finalY;

        // Max Discount Allowed grid
        const discHead = [["Tier", "Revenue Range", ...categories.map(c => catLabels[c])]];
        const discBody = tiers.map(t => [
          t.label,
          t.threshold_max ? `${formatCurrency(t.threshold_min)} – ${formatCurrency(t.threshold_max)}` : `${formatCurrency(t.threshold_min)}+`,
          ...categories.map(c => t[`max_disc_${c}` as keyof TierData] != null ? formatPct(t[`max_disc_${c}` as keyof TierData] as number) : "—"),
        ]);

        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Max Discount Allowed", margin + (pageWidth - 2 * margin) / 2 + 10, tierY - 5);
        doc.setFont("helvetica", "normal");

        autoTable(doc, {
          startY: tierY,
          head: discHead,
          body: discBody,
          theme: "grid",
          headStyles: { fillColor: [41, 41, 41], fontSize: 7.5 },
          bodyStyles: { fontSize: 7 },
          margin: { left: margin + (pageWidth - 2 * margin) / 2 + 10, right: margin },
          tableWidth: (pageWidth - 2 * margin) / 2 - 10,
        });
      }

      // --- Individual invoice detail pages ---
      for (const inv of exportInvoices) {
        doc.addPage();
        let yPos = 45;

        // Invoice header
        doc.setFontSize(14);
        doc.text(`Invoice: ${inv.invoice_number}`, margin, yPos);
        yPos += 20;

        doc.setFontSize(9);
        doc.setTextColor(100);
        const metaLines = [
          `Date: ${inv.billing_end_date || inv.invoice_date || "N/A"}`,
          `Deal / Order: ${inv.deal || inv.order_description || "N/A"}`,
          `Equipment Type: ${getEquipmentLabel(inv.equipment_type as EquipmentType)}    Quarter: ${inv.quarter || "N/A"}`,
          `Tier: ${inv.tier_label || "N/A"}    Rebate Rate: ${formatPct(inv.rebate_rate)}    Cumulative Revenue: ${formatCurrency(inv.cumulative_revenue)}    Cumulative Rebate: ${formatCurrency(inv.cumulative_rebate)}`,
        ];
        for (const line of metaLines) {
          doc.text(line, margin, yPos);
          yPos += 13;
        }
        doc.setTextColor(0);
        yPos += 5;

        // Calculation breakdown table
        doc.setFontSize(10);
        doc.text("Calculation Breakdown", margin, yPos);
        yPos += 5;

        const breakdownBody = [
          ["Gross Invoice Total", formatCurrency(inv.gross_total)],
          ["Excluded", formatCurrency(inv.excluded_total)],
          ["Tax", formatCurrency(inv.tax_amount)],
          ["Taxable Sales", formatCurrency(inv.taxable_sales)],
          ["Before Discount", formatCurrency(inv.before_discount)],
          ["Eligible Discount", formatCurrency(inv.discount_eligible_amount ?? inv.discount_amount)],
          ["Discount %", formatPct(inv.discount_percent)],
          ["Final Amount", formatCurrency(inv.final_amount)],
          ["Remaining Rebate", formatPct(inv.remaining_rebate_pct)],
          ["Net Rebate", formatCurrency(inv.net_rebate)],
        ];

        autoTable(doc, {
          startY: yPos,
          body: breakdownBody,
          theme: "plain",
          bodyStyles: { fontSize: 8 },
          columnStyles: {
            0: { cellWidth: 120, fontStyle: "bold" },
            1: { cellWidth: 80, halign: "right" },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          didParseCell: (data: any) => {
            if (data.row.index === 1) data.cell.styles.fillColor = [255, 230, 230]; // Excluded - red tint
            if (data.row.index === 4) data.cell.styles.fillColor = [255, 255, 220]; // Before Disc - yellow tint
            if (data.row.index === 9) {
              data.cell.styles.fillColor = [220, 255, 220]; // Net Rebate - green tint
              data.cell.styles.fontStyle = "bold";
            }
          },
          margin: { left: margin, right: margin },
          tableWidth: 200,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        yPos = (doc as any).lastAutoTable.finalY + 15;

        // Line items
        const items = invoiceItems[inv.id] || [];
        if (items.length > 0) {
          const grouped = groupItemsByCategory(items);
          const orderedKeys = [
            ...RECORD_TYPE_CATEGORIES.map((c) => c.key).filter((k) => grouped[k]),
            ...Object.keys(grouped).filter(
              (k) => !RECORD_TYPE_CATEGORIES.some((c) => c.key === k),
            ),
          ];

          doc.setFontSize(10);
          doc.text("Line Items", margin, yPos);
          yPos += 18;

          for (const catKey of orderedKeys) {
            const catItems = grouped[catKey];
            const catConfig = RECORD_TYPE_CATEGORIES.find((c) => c.key === catKey);
            const label = catConfig?.label || "Other";
            const catRegular = catItems.reduce((s, it) => s + (Number(it.extended) || 0), 0);
            const catNet = catItems.reduce(
              (s, it) =>
                s + ((Number(it.extended) || 0) - (Number(it.discount_amount) || 0)),
              0,
            );

            // Check if we need a new page
            if (yPos > doc.internal.pageSize.getHeight() - 80) {
              doc.addPage();
              yPos = 45;
            }

            doc.setFontSize(9);
            doc.setTextColor(80);
            doc.text(
              `${label} (${catItems.length} items) — Regular ${formatCurrency(catRegular)} · Net ${formatCurrency(catNet)}`,
              margin,
              yPos,
            );
            doc.setTextColor(0);
            yPos += 8;

            const itemHead = [["I-Code", "Description", "Qty", "Regular", "Disc %", "Discount", "Net", "Status"]];
            const itemBody: (string | number)[][] = [];

            for (const item of catItems) {
              const isExcludedByICode = item.i_code != null && excludedICodes.has(item.i_code.trim());
              const isLossAndDamage = item.record_type === "F" || item.record_type === "L";
              const isExcluded = item.is_excluded || isExcludedByICode || isLossAndDamage;
              const regular = Number(item.extended) || 0;
              const discount = Number(item.discount_amount) || 0;
              const net = regular - discount;
              const discPct = regular > 0 ? (discount / regular) * 100 : 0;
              itemBody.push([
                item.i_code || "",
                (item.description || "").slice(0, 50),
                item.quantity ?? "",
                formatCurrency(regular),
                discount > 0 ? formatPct(discPct) : "—",
                discount > 0 ? formatCurrency(discount) : "—",
                formatCurrency(net),
                isExcluded ? (isLossAndDamage ? "L&D" : "Excluded") : "",
              ]);
            }

            autoTable(doc, {
              startY: yPos,
              head: itemHead,
              body: itemBody,
              theme: "striped",
              headStyles: { fillColor: [70, 70, 70], fontSize: 7 },
              bodyStyles: { fontSize: 7 },
              columnStyles: {
                0: { cellWidth: 60 },
                1: { cellWidth: 175 },
                2: { cellWidth: 28, halign: "right" },
                3: { cellWidth: 55, halign: "right" },
                4: { cellWidth: 40, halign: "right" },
                5: { cellWidth: 55, halign: "right" },
                6: { cellWidth: 55, halign: "right" },
                7: { cellWidth: 50 },
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              didParseCell: (data: any) => {
                if (data.section === "body") {
                  const status = itemBody[data.row.index]?.[7];
                  if (status) {
                    data.cell.styles.fillColor = [255, 240, 240];
                  }
                }
              },
              margin: { left: margin, right: margin },
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            yPos = (doc as any).lastAutoTable.finalY + 18;
          }
        }
      }

      const quarterLabel = quarter === "all" ? "All" : quarter.replace(/\s+/g, "-");
      const filename = `Rebate Report - ${customer!.customer_name} - ${quarterLabel}.pdf`;
      doc.save(filename);
      toast.success(`Exported ${exportInvoices.length} invoices as PDF`);
    } catch (err) {
      console.error("PDF export error:", err);
      toast.error("PDF export failed");
    } finally {
      setExporting(false);
    }
  };

  // Filter invoices by selected quarter
  const filteredInvoices =
    selectedQuarter === "all"
      ? invoices
      : invoices.filter((inv) => inv.quarter === selectedQuarter);

  // Get unique quarters for tabs
  const quarters = Array.from(
    new Set(invoices.map((inv) => inv.quarter).filter(Boolean)),
  ).sort();

  // Current quarter stats
  const currentQtr = getCurrentQuarter();
  const qtrSummary = quarterlySummaries.find((q) => q.quarter === currentQtr);

  // Cumulative totals.
  // totalRevenue = rebate-applicable revenue (sum of final_amount). Used for
  // tier selection, tier-progress bar, and gap-to-next-tier math.
  // totalListRevenue = all revenue generated (sum of gross_total). Shown on
  // the "Total Revenue" summary card so it matches the rebate tracker summary
  // page and reflects actual customer revenue, not the post-exclusion base.
  const totalRevenue = invoices.reduce(
    (s, inv) => s + (inv.final_amount || 0),
    0,
  );
  const totalListRevenue = invoices.reduce(
    (s, inv) => s + (inv.gross_total || 0),
    0,
  );
  const totalRebate = invoices.reduce(
    (s, inv) => s + (inv.net_rebate || 0),
    0,
  );

  // Tier progress
  const currentTier =
    tiers.find(
      (t) =>
        totalRevenue >= t.threshold_min &&
        (t.threshold_max == null || totalRevenue < t.threshold_max),
    ) || tiers[0];
  const nextTier = tiers.find((t) => t.threshold_min > totalRevenue);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-6">
        <p>Customer not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={backHref}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">
                {customer.customer_name}
              </h1>
              <Badge
                variant={
                  customer.agreement_type === "commercial"
                    ? "default"
                    : "secondary"
                }
              >
                {customer.agreement_type}
              </Badge>
              {customer.rw_customer_number && (
                <Badge variant="outline" className="text-muted-foreground">
                  #{customer.rw_customer_number}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {customer.agreement_type === "freelancer" ? (
            <Button
              size="sm"
              onClick={() => setAddInvoiceOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Invoice
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
            >
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Sync
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCalculate}
            disabled={calculating}
          >
            {calculating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="mr-2 h-4 w-4" />
            )}
            Calculate
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={exporting || invoices.length === 0}>
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Excel (.xlsx)</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleExport("all")}>
                All Quarters
              </DropdownMenuItem>
              {quarters.map((q) => (
                <DropdownMenuItem key={`xlsx-${q}`} onClick={() => handleExport(q!)}>
                  {q}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>PDF</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleExportPdf("all")}>
                All Quarters
              </DropdownMenuItem>
              {quarters.map((q) => (
                <DropdownMenuItem key={`pdf-${q}`} onClick={() => handleExportPdf(q!)}>
                  {q}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Revenue</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(totalListRevenue)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Rebate</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(totalRebate)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current Tier</CardDescription>
            <CardTitle className="text-2xl">
              {currentTier?.label || "N/A"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Invoices</CardDescription>
            <CardTitle className="text-2xl">{invoices.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Tier Progress Bar */}
      {tiers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Tier Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{formatCurrency(totalRevenue)} cumulative revenue</span>
                {nextTier && (
                  <span>
                    {formatCurrency(nextTier.threshold_min - totalRevenue)} to
                    next tier ({nextTier.label})
                  </span>
                )}
              </div>
              <div className="h-3 bg-secondary rounded-full overflow-hidden">
                {tiers.map((tier, idx) => {
                  const max =
                    tier.threshold_max ||
                    Math.max(totalRevenue * 1.2, tier.threshold_min * 1.5);
                  const totalMax =
                    tiers[tiers.length - 1]?.threshold_max ||
                    Math.max(totalRevenue * 1.2, 500000);
                  const width = ((max - tier.threshold_min) / totalMax) * 100;
                  const isCurrent = tier === currentTier;
                  return (
                    <div
                      key={idx}
                      className={`h-full inline-block ${
                        isCurrent
                          ? "bg-primary"
                          : totalRevenue >= tier.threshold_min
                            ? "bg-primary/60"
                            : "bg-secondary"
                      }`}
                      style={{ width: `${Math.min(width, 100)}%` }}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                {tiers.map((tier, idx) => (
                  <span key={idx}>
                    {tier.label}: {formatCurrency(tier.threshold_min)}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tier Rate Structure */}
      {tiers.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Rebate Rates</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Threshold</TableHead>
                    <TableHead className="text-center">Pro Supply</TableHead>
                    <TableHead className="text-center">Vehicle</TableHead>
                    <TableHead className="text-center">G&L</TableHead>
                    <TableHead className="text-center">Studio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiers.map((tier) => {
                    const isCurrent = tier === currentTier;
                    const thresholdLabel = tier.threshold_max
                      ? `${formatCurrency(tier.threshold_min)} - ${formatCurrency(tier.threshold_max)}`
                      : `${formatCurrency(tier.threshold_min)}+`;
                    return (
                      <TableRow
                        key={tier.sort_order}
                        className={isCurrent ? "bg-green-50 dark:bg-green-950/20 font-medium" : ""}
                      >
                        <TableCell className="font-semibold">{thresholdLabel}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.rate_pro_supplies)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.rate_vehicle)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.rate_grip_lighting)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.rate_studio)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Max Discount Allowed</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Threshold</TableHead>
                    <TableHead className="text-center">Pro Supply</TableHead>
                    <TableHead className="text-center">Vehicle</TableHead>
                    <TableHead className="text-center">G&L</TableHead>
                    <TableHead className="text-center">Studio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiers.map((tier) => {
                    const isCurrent = tier === currentTier;
                    const thresholdLabel = tier.threshold_max
                      ? `${formatCurrency(tier.threshold_min)} - ${formatCurrency(tier.threshold_max)}`
                      : `${formatCurrency(tier.threshold_min)}+`;
                    return (
                      <TableRow
                        key={tier.sort_order}
                        className={isCurrent ? "bg-green-50 dark:bg-green-950/20 font-medium" : ""}
                      >
                        <TableCell className="font-semibold">{thresholdLabel}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.max_disc_pro_supplies)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.max_disc_vehicle)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.max_disc_grip_lighting)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.max_disc_studio)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Quarterly Summaries */}
      {quarterlySummaries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Quarterly Summaries</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quarter</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Rebate</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quarterlySummaries.map((qs) => (
                  <TableRow key={qs.id}>
                    <TableCell className="font-medium">{qs.quarter}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(qs.total_revenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(qs.total_rebate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {qs.invoice_count}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{qs.tier_label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={qs.is_paid ? "default" : "secondary"}
                        className={
                          qs.is_paid
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            : ""
                        }
                      >
                        {qs.is_paid ? "Paid" : "Unpaid"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMarkPaid(qs)}
                      >
                        {qs.is_paid ? "Mark Unpaid" : "Mark Paid"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Invoice Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Invoices</CardTitle>
            <Tabs value={selectedQuarter} onValueChange={setSelectedQuarter}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                {quarters.map((q) => (
                  <TabsTrigger key={q} value={q!}>
                    {q}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {filteredInvoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No invoices found.</p>
              <p className="text-sm mt-1">
                {customer.agreement_type === "freelancer"
                  ? 'Click "Add Invoice" to add invoices by invoice number.'
                  : 'Click "Sync" to pull invoices from RentalWorks.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Quarter</TableHead>
                  <TableHead>Deal / Order</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Gross Total</TableHead>
                  <TableHead className="text-right">Excluded</TableHead>
                  <TableHead className="text-right">Before Disc</TableHead>
                  <TableHead className="text-right">Eligible Discount</TableHead>
                  <TableHead className="text-right">Final Amount</TableHead>
                  <TableHead className="text-right">Rebate %</TableHead>
                  <TableHead className="text-right">Net Rebate</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((inv) => (
                  <Collapsible key={inv.id} asChild>
                    <>
                      <CollapsibleTrigger asChild>
                        <TableRow
                          className={`cursor-pointer ${
                            inv.is_manually_excluded
                              ? "opacity-50 line-through"
                              : ""
                          }`}
                          onClick={() => toggleInvoiceExpand(inv.id)}
                        >
                          <TableCell>
                            {expandedInvoices.has(inv.id) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {inv.invoice_number}
                          </TableCell>
                          <TableCell>
                            {inv.billing_end_date || inv.invoice_date || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{inv.quarter}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {inv.deal || inv.order_description || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {getEquipmentLabel(
                                inv.equipment_type as EquipmentType,
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(inv.gross_total)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency((inv.gross_total || 0) - (inv.before_discount || 0))}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(inv.before_discount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(inv.discount_eligible_amount ?? inv.discount_amount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(inv.final_amount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatPct(inv.remaining_rebate_pct)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(inv.net_rebate)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleExclusion(inv);
                                }}
                                title={
                                  inv.is_manually_excluded
                                    ? "Include invoice"
                                    : "Exclude invoice"
                                }
                              >
                                {inv.is_manually_excluded ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                ) : (
                                  <Ban className="h-4 w-4 text-muted-foreground" />
                                )}
                              </Button>
                              {customer.agreement_type === "freelancer" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteInvoice(inv.id, inv.invoice_number);
                                  }}
                                  title="Remove invoice"
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      </CollapsibleTrigger>
                      <CollapsibleContent asChild>
                        {expandedInvoices.has(inv.id) ? (
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={12}>
                              <div className="p-3 space-y-4">
                                {/* Calculation Breakdown + Meta */}
                                <div className="flex gap-6">
                                  {/* Calculation Breakdown Table */}
                                  <div className="w-80 shrink-0">
                                    <h4 className="text-sm font-medium mb-2">Calculation Breakdown</h4>
                                    <div className="border rounded-md overflow-hidden text-sm">
                                      {(() => {
                                        const rows: { label: string; value: string; highlight?: "red" | "yellow" | "green" }[] = [
                                              { label: "Gross Invoice Total", value: formatCurrency(inv.gross_total) },
                                              { label: "Excluded", value: formatCurrency(inv.excluded_total), highlight: "red" },
                                              { label: "Tax", value: formatCurrency(inv.tax_amount) },
                                              { label: "Taxable Sales", value: formatCurrency(inv.taxable_sales) },
                                              { label: "Before Discount", value: formatCurrency(inv.before_discount), highlight: "yellow" },
                                              { label: "Eligible Discount", value: formatCurrency(inv.discount_eligible_amount ?? inv.discount_amount) },
                                              { label: "Discount %", value: formatPct(inv.discount_percent) },
                                              { label: "Final Amount", value: formatCurrency(inv.final_amount) },
                                              { label: "Remaining Rebate", value: formatPct(inv.remaining_rebate_pct) },
                                              { label: "Net Rebate", value: formatCurrency(inv.net_rebate), highlight: "green" },
                                            ];

                                        return rows.map((row, idx) => (
                                          <div
                                            key={idx}
                                            className={`flex items-center justify-between px-3 py-1.5 border-b last:border-b-0 ${
                                              row.highlight === "red"
                                                ? "bg-red-100 dark:bg-red-950/30 text-red-900 dark:text-red-200"
                                                : row.highlight === "yellow"
                                                  ? "bg-yellow-100 dark:bg-yellow-950/30 text-yellow-900 dark:text-yellow-200"
                                                  : row.highlight === "green"
                                                    ? "bg-green-100 dark:bg-green-950/30 text-green-900 dark:text-green-200 font-semibold"
                                                    : ""
                                            }`}
                                          >
                                            <span>{row.label}</span>
                                            <span className="font-mono tabular-nums">{row.value}</span>
                                          </div>
                                        ));
                                      })()}
                                    </div>
                                  </div>

                                  {/* Invoice Meta */}
                                  <div className="flex-1 space-y-3 text-sm">
                                    <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                                      <div>
                                        <span className="text-muted-foreground">Tier: </span>
                                        {inv.tier_label || "N/A"}
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Rebate Rate: </span>
                                        {formatPct(inv.rebate_rate)}
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Cumulative Revenue: </span>
                                        {formatCurrency(inv.cumulative_revenue)}
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Cumulative Rebate: </span>
                                        {formatCurrency(inv.cumulative_rebate)}
                                      </div>
                                    </div>

                                    {/* Line Items by Category */}
                                    {invoiceItems[inv.id] &&
                                      invoiceItems[inv.id].length > 0 && (() => {
                                        const grouped = groupItemsByCategory(invoiceItems[inv.id]);
                                        const orderedKeys = [
                                          ...RECORD_TYPE_CATEGORIES.map((c) => c.key).filter((k) => grouped[k]),
                                          ...Object.keys(grouped).filter(
                                            (k) => !RECORD_TYPE_CATEGORIES.some((c) => c.key === k),
                                          ),
                                        ];

                                        return (
                                          <div className="space-y-1">
                                            <h4 className="text-sm font-medium mb-2">Line Items</h4>
                                            {orderedKeys.map((catKey) => {
                                              const items = grouped[catKey];
                                              const catConfig = RECORD_TYPE_CATEGORIES.find((c) => c.key === catKey);
                                              const label = catConfig?.label || "Other";
                                              const colorClass = catConfig?.color || "text-muted-foreground";
                                              const expandKey = `${inv.id}:${catKey}`;
                                              const isExpanded = expandedCategories.has(expandKey);

                                              const catTotal = items.reduce((s, it) => s + (it.extended || 0), 0);
                                              const excludedItems = items.filter((it) => {
                                                const byICode = it.i_code != null && excludedICodes.has(it.i_code.trim());
                                                const byLossAndDamage = it.record_type === "F" || it.record_type === "L";
                                                return it.is_excluded || byICode || byLossAndDamage;
                                              });
                                              const excludedTotal = excludedItems.reduce(
                                                (s, it) => s + (it.extended || 0),
                                                0,
                                              );

                                              return (
                                                <div key={catKey} className="border rounded-md">
                                                  <button
                                                    type="button"
                                                    className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                                                    onClick={() => {
                                                      setExpandedCategories((prev) => {
                                                        const next = new Set(prev);
                                                        if (next.has(expandKey)) next.delete(expandKey);
                                                        else next.add(expandKey);
                                                        return next;
                                                      });
                                                    }}
                                                  >
                                                    <div className="flex items-center gap-2">
                                                      {isExpanded ? (
                                                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                                      ) : (
                                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                      )}
                                                      <span className={`font-medium ${colorClass}`}>
                                                        {label}
                                                      </span>
                                                      <span className="text-muted-foreground">
                                                        ({items.length} item{items.length !== 1 ? "s" : ""})
                                                      </span>
                                                    </div>
                                                    <div className="flex items-center gap-4 text-xs">
                                                      {excludedTotal > 0 && (
                                                        <span className="text-red-600 dark:text-red-400 font-medium">
                                                          Excluded: {formatCurrency(excludedTotal)}
                                                        </span>
                                                      )}
                                                      <span className="font-medium">
                                                        {formatCurrency(catTotal)}
                                                      </span>
                                                    </div>
                                                  </button>

                                                  {isExpanded && (
                                                    <div className="border-t">
                                                      <Table>
                                                        <TableHeader>
                                                          <TableRow>
                                                            <TableHead>I-Code</TableHead>
                                                            <TableHead>Description</TableHead>
                                                            <TableHead className="text-right">Qty</TableHead>
                                                            <TableHead className="text-right">Regular</TableHead>
                                                            <TableHead className="text-right">Disc %</TableHead>
                                                            <TableHead className="text-right">Discount</TableHead>
                                                            <TableHead className="text-right">Net</TableHead>
                                                            <TableHead>Status</TableHead>
                                                          </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                          {[...excludedItems, ...items.filter((it) => {
                                                            const byICode = it.i_code != null && excludedICodes.has(it.i_code.trim());
                                                            const byLossAndDamage = it.record_type === "F" || it.record_type === "L";
                                                            return !(it.is_excluded || byICode || byLossAndDamage);
                                                          })].map((item) => {
                                                            const isExcludedByICode =
                                                              item.i_code != null &&
                                                              excludedICodes.has(item.i_code.trim());
                                                            const isLossAndDamage = item.record_type === "F" || item.record_type === "L";
                                                            const isExcluded =
                                                              item.is_excluded || isExcludedByICode || isLossAndDamage;
                                                            const regular = Number(item.extended) || 0;
                                                            const discount = Number(item.discount_amount) || 0;
                                                            const net = regular - discount;
                                                            const discountPct = regular > 0 ? (discount / regular) * 100 : 0;
                                                            return (
                                                              <TableRow
                                                                key={item.id}
                                                                className={
                                                                  isExcluded
                                                                    ? "bg-red-50 dark:bg-red-950/20"
                                                                    : ""
                                                                }
                                                              >
                                                                <TableCell className="font-mono text-xs">
                                                                  {item.i_code || "—"}
                                                                </TableCell>
                                                                <TableCell className="text-sm">
                                                                  {item.description || "—"}
                                                                </TableCell>
                                                                <TableCell className="text-right">
                                                                  {item.quantity}
                                                                </TableCell>
                                                                <TableCell className="text-right tabular-nums">
                                                                  {formatCurrency(regular)}
                                                                </TableCell>
                                                                <TableCell className="text-right tabular-nums text-muted-foreground">
                                                                  {discount > 0 ? formatPct(discountPct) : "—"}
                                                                </TableCell>
                                                                <TableCell className="text-right tabular-nums text-muted-foreground">
                                                                  {discount > 0 ? formatCurrency(discount) : "—"}
                                                                </TableCell>
                                                                <TableCell className="text-right tabular-nums font-medium">
                                                                  {formatCurrency(net)}
                                                                </TableCell>
                                                                <TableCell>
                                                                  {isExcluded && (
                                                                    <Badge
                                                                      variant="destructive"
                                                                      className="text-xs"
                                                                    >
                                                                      {isLossAndDamage ? "Loss & Damage" : "Excluded"}
                                                                    </Badge>
                                                                  )}
                                                                </TableCell>
                                                              </TableRow>
                                                            );
                                                          })}
                                                        </TableBody>
                                                      </Table>
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      })()}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </CollapsibleContent>
                    </>
                  </Collapsible>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Active Orders */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Active Orders</CardTitle>
              {ordersLoaded && customer.agreement_type !== "freelancer" && (
                <Badge variant="outline" className="ml-2">
                  {activeOrders.length}
                </Badge>
              )}
            </div>
            {customer.agreement_type !== "freelancer" && (
              <Button
                variant="outline"
                size="sm"
                onClick={loadActiveOrders}
                disabled={loadingOrders}
              >
                {loadingOrders ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {ordersLoaded ? "Refresh" : "Load Orders"}
              </Button>
            )}
          </div>
          <CardDescription>
            {customer.agreement_type === "freelancer"
              ? "Active orders are not available for freelancer agreements"
              : "Current open orders from RentalWorks with estimated rebate potential"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {customer.agreement_type === "freelancer" ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>Active orders are not available for freelancer agreements.</p>
              <p className="text-sm mt-1">
                Freelancer agreements are not linked to a specific RentalWorks customer.
              </p>
            </div>
          ) : loadingOrders && !ordersLoaded ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No active orders found for this customer.</p>
            </div>
          ) : (
            <>
              {/* Active orders summary */}
              <div className="grid gap-4 md:grid-cols-3 mb-4">
                <div className="rounded-lg border p-3">
                  <p className="text-sm text-muted-foreground">Active Orders</p>
                  <p className="text-xl font-semibold">{activeOrders.length}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm text-muted-foreground">Total Order Value</p>
                  <p className="text-xl font-semibold">
                    {formatCurrency(activeOrders.reduce((s, o) => s + o.total, 0))}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm text-muted-foreground">Est. Potential Rebate</p>
                  <p className="text-xl font-semibold text-green-600 dark:text-green-400">
                    {formatCurrency(
                      activeOrders.reduce((s, o) => {
                        if (!currentTier) return s;
                        const rateKey = `rate_${o.equipmentType}` as keyof TierData;
                        const rate = (currentTier[rateKey] as number) || 0;
                        return s + o.total * (rate / 100);
                      }, 0),
                    )}
                  </p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Order #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Deal</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Est. Rebate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeOrders.map((order) => {
                    const rateKey = currentTier
                      ? (`rate_${order.equipmentType}` as keyof TierData)
                      : null;
                    const rate = rateKey && currentTier
                      ? ((currentTier[rateKey] as number) || 0)
                      : 0;
                    const estRebate = order.total * (rate / 100);
                    const isExpanded = expandedOrders.has(order.orderId);
                    return (
                      <Collapsible key={order.orderId} asChild>
                        <>
                          <CollapsibleTrigger asChild>
                            <TableRow
                              className="cursor-pointer"
                              onClick={() => toggleOrderExpand(order.orderId)}
                            >
                              <TableCell>
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {order.orderNumber}
                              </TableCell>
                              <TableCell>
                                {order.estimatedStartDate || order.orderDate || "—"}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">{order.status}</Badge>
                              </TableCell>
                              <TableCell className="max-w-[150px] truncate">
                                {order.deal || "—"}
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate">
                                {order.description || "—"}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {getEquipmentLabel(
                                    order.equipmentType as EquipmentType,
                                  )}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(order.total)}
                              </TableCell>
                              <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                                {rate > 0 ? formatCurrency(estRebate) : "—"}
                              </TableCell>
                            </TableRow>
                          </CollapsibleTrigger>
                          <CollapsibleContent asChild>
                            {isExpanded ? (
                              <TableRow className="bg-muted/30">
                                <TableCell colSpan={9}>
                                  <div className="p-3 space-y-3">
                                    {/* Order meta */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-1 text-sm">
                                      <div>
                                        <span className="text-muted-foreground">PO#: </span>
                                        {order.purchaseOrderNumber || "—"}
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Start: </span>
                                        {order.estimatedStartDate || "—"}
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">End: </span>
                                        {order.estimatedStopDate || "—"}
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Rental Total: </span>
                                        {formatCurrency(order.rentalTotal)}
                                      </div>
                                    </div>

                                    <p className="text-xs text-muted-foreground italic">
                                      Line item detail is not available for orders (RentalWorks API limitation).
                                      Items will be visible once the order is invoiced.
                                    </p>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </CollapsibleContent>
                        </>
                      </Collapsible>
                    );
                  })}
                </TableBody>
              </Table>
              {currentTier && (
                <p className="text-xs text-muted-foreground mt-3">
                  Estimates based on current tier ({currentTier.label}) rates. Actual rebate
                  will depend on final invoice amounts, exclusions, and discounts applied.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Add Invoice Dialog (freelancer) */}
      <Dialog open={addInvoiceOpen} onOpenChange={setAddInvoiceOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Invoice</DialogTitle>
            <DialogDescription>
              Enter a RentalWorks invoice number to add it to this agreement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Invoice Number</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. INV-00123"
                  value={addInvoiceNumber}
                  onChange={(e) => setAddInvoiceNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddInvoice();
                  }}
                  disabled={addingInvoice}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddInvoiceOpen(false);
                setAddInvoiceNumber("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddInvoice}
              disabled={addingInvoice || !addInvoiceNumber.trim()}
            >
              {addingInvoice ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Find & Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

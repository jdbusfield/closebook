"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DollarSign,
  TrendingUp,
  Layers,
  FileText,
  RefreshCw,
  Loader2,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Activity,
  Save,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils/dates";
import {
  EQUIPMENT_TYPE_LABELS,
  processRevenueData,
  getMonthKey,
  getRevenueFilterForEntity,
  type EntityRevenueFilter,
  type RevenueProjectionResponse,
  type ClosedInvoice,
  type MonthlyRevenue,
  type DateMode,
  type RWInvoiceRow,
  type RWOrderRow,
  type RWQuoteRow,
  type UnbilledEarnedLine,
} from "@/lib/utils/revenue-projection";
import { Lock, Unlock, Percent, Download } from "lucide-react";
import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
} from "recharts";
import { GLAccountAccrualSection } from "@/components/revenue-projection/gl-account-accrual-section";
import {
  addSheet,
  createWorkbook,
  downloadWorkbook,
  NUMBER_FORMATS,
} from "@/lib/utils/excel";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

// ─── Snapshot Row Type ──────────────────────────────────────────────────────

interface SnapshotRow {
  id: string;
  entity_id: string;
  period_year: number;
  period_month: number;
  section_id: string;
  projected_amount: number;
  snapshot_date: string;
  source: string;
  created_by: string;
  created_at: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const EQUIP_COLORS: Record<string, string> = {
  vehicle: "#2563eb",
  grip_lighting: "#16a34a",
  studio: "#ea580c",
  pro_supplies: "#9333ea",
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Parse RW date strings ("2026-03-15" / "2026-03-15T..." / "03/15/2026") into
// a local JS Date without timezone drift. Returns undefined for blank input.
function parseInvoiceDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  return undefined;
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

const REVENUE_SERIES: { key: string; label: string; color: string }[] = [
  { key: "closed", label: "Recognized", color: "#2563eb" },
  { key: "pending", label: "Pending", color: "#f59e0b" },
  { key: "pipeline", label: "Pipeline", color: "#94a3b8" },
  { key: "forecast", label: "Forecast", color: "#ea580c" },
];

function AccrualDeferralTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; payload: MonthlyRevenue }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg text-sm whitespace-nowrap" style={{ zIndex: 50 }}>
      <p className="font-semibold text-gray-900 mb-1.5">{label}</p>
      <div className="flex items-center justify-between gap-8">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0 bg-blue-500" />
          <span className="text-gray-500">Billed</span>
        </div>
        <span className="font-medium tabular-nums text-gray-900">{formatCurrency(row.billed)}</span>
      </div>
      <div className="flex items-center justify-between gap-8">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0 bg-emerald-500" />
          <span className="text-gray-500">Earned</span>
        </div>
        <span className="font-medium tabular-nums text-gray-900">{formatCurrency(row.earned)}</span>
      </div>
      {row.accrued > 0 && (
        <div className="flex items-center justify-between gap-8 border-t border-gray-200 mt-1.5 pt-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0 bg-teal-500" />
            <span className="text-gray-500">Accrued Revenue</span>
          </div>
          <span className="font-medium tabular-nums text-teal-700">{formatCurrency(row.accrued)}</span>
        </div>
      )}
      {row.deferred > 0 && (
        <div className="flex items-center justify-between gap-8 border-t border-gray-200 mt-1.5 pt-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0 bg-amber-500" />
            <span className="text-gray-500">Deferred Revenue</span>
          </div>
          <span className="font-medium tabular-nums text-amber-700">{formatCurrency(row.deferred)}</span>
        </div>
      )}
    </div>
  );
}

function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const total = payload
    .filter((p) => p.dataKey !== "forecast")
    .reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg text-sm whitespace-nowrap" style={{ zIndex: 50 }}>
      <p className="font-semibold text-gray-900 mb-1.5">{label}</p>
      {payload.map((entry) => {
        const series = REVENUE_SERIES.find((s) => s.key === entry.dataKey);
        if (!series || !entry.value) return null;
        return (
          <div key={entry.dataKey} className="flex items-center justify-between gap-8">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: series.color }} />
              <span className="text-gray-500">{series.label}</span>
            </div>
            <span className="font-medium tabular-nums text-gray-900">{formatCurrency(entry.value)}</span>
          </div>
        );
      })}
      {payload.filter((p) => p.dataKey !== "forecast" && p.value).length > 1 && (
        <div className="flex items-center justify-between gap-8 border-t border-gray-200 mt-1.5 pt-1.5 font-medium text-gray-900">
          <span>Total</span>
          <span className="tabular-nums">{formatCurrency(total)}</span>
        </div>
      )}
    </div>
  );
}

function EquipmentTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { type: string; percentage: number } }> }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg text-sm whitespace-nowrap" style={{ zIndex: 50 }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: EQUIP_COLORS[entry.payload.type] || "#6b7280" }} />
        <span className="font-semibold text-gray-900">{entry.name}</span>
      </div>
      <div className="flex items-center justify-between gap-6">
        <span className="text-gray-500">Revenue</span>
        <span className="font-medium tabular-nums text-gray-900">{formatCurrency(entry.value)}</span>
      </div>
      <div className="flex items-center justify-between gap-6">
        <span className="text-gray-500">Share</span>
        <span className="font-medium tabular-nums text-gray-900">{entry.payload.percentage.toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function RevenueProjectionPage({
  entityId: entityIdProp,
  isEmbed,
  defaultTab,
  revenueFilter: revenueFilterProp,
  entityLabel,
}: {
  entityId?: string;
  isEmbed?: boolean;
  defaultTab?: string;
  /** Entity record-prefix filter. When omitted, it's resolved from entity name. */
  revenueFilter?: EntityRevenueFilter;
  /** Display name for headings/exports. When omitted, it's fetched by entityId. */
  entityLabel?: string;
} = {}) {
  const params = useParams();
  const entityId = entityIdProp || (params.entityId as string);

  // Resolve the entity's display name. Embeds pass it explicitly; the direct
  // /[entityId]/revenue-projection route looks it up so the correct record
  // prefix filter (Versatile "V" vs Silverco "AS"/"AC") is applied.
  const [resolvedEntityName, setResolvedEntityName] = useState<string | null>(
    entityLabel ?? null,
  );
  useEffect(() => {
    if (entityLabel) {
      setResolvedEntityName(entityLabel);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const supabase = createSupabaseClient();
        const { data: row } = await supabase
          .from("entities")
          .select("name")
          .eq("id", entityId)
          .single();
        if (!cancelled) {
          setResolvedEntityName((row as { name?: string } | null)?.name ?? null);
        }
      } catch {
        // non-fatal — falls back to the default Versatile filter/label
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId, entityLabel]);

  const revenueFilter = useMemo(
    () => revenueFilterProp ?? getRevenueFilterForEntity(resolvedEntityName),
    [revenueFilterProp, resolvedEntityName],
  );
  const displayName = entityLabel ?? resolvedEntityName ?? "Versatile";

  // Raw rows from the API — cached so we can re-process client-side on mode change
  const [rawInvoices, setRawInvoices] = useState<RWInvoiceRow[] | null>(null);
  const [rawOrders, setRawOrders] = useState<RWOrderRow[] | null>(null);
  const [rawQuotes, setRawQuotes] = useState<RWQuoteRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStep, setLoadStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dateMode, setDateMode] = useState<DateMode>("rental_period");
  const [invoiceMonthFilter, setInvoiceMonthFilter] = useState<string>("all");
  const [pipelineMonthFilter, setPipelineMonthFilter] = useState<string>("all");
  const [unbilledMonthFilter, setUnbilledMonthFilter] = useState<string>("all");
  const [chartDrillDown, setChartDrillDown] = useState<{ month: string; label: string; category: "closed" | "pending" | "pipeline" } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    setLoadProgress(0);
    setLoadStep("Fetching invoices…");
    try {
      const invRes = await fetch("/api/rw-revenue/invoices");
      if (!invRes.ok) throw new Error("Failed to load invoices");
      const invoices = await invRes.json();
      setRawInvoices(invoices);
      setLoadProgress(40);

      setLoadStep("Fetching orders…");
      const ordRes = await fetch("/api/rw-revenue/orders");
      if (!ordRes.ok) throw new Error("Failed to load orders");
      const orders = await ordRes.json();
      setRawOrders(orders);
      setLoadProgress(70);

      setLoadStep("Fetching quotes…");
      const quoRes = await fetch("/api/rw-revenue/quotes");
      if (!quoRes.ok) throw new Error("Failed to load quotes");
      const quotes = await quoRes.json();
      setRawQuotes(quotes);
      setLoadProgress(100);
      setLoadStep("Done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleDateModeChange = (mode: DateMode) => {
    setDateMode(mode);
    setChartDrillDown(null);
    setPipelineMonthFilter("all");
    setUnbilledMonthFilter("all");
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  // Derive processed data client-side — instant on date mode switch
  const data = useMemo(() => {
    if (!rawInvoices || !rawOrders || !rawQuotes) return null;
    return processRevenueData(rawInvoices, rawOrders, rawQuotes, dateMode, revenueFilter);
  }, [rawInvoices, rawOrders, rawQuotes, dateMode, revenueFilter]);

  // Accruals tab always uses invoice_date mode
  const accrualData = useMemo(() => {
    if (!rawInvoices || !rawOrders || !rawQuotes) return null;
    if (dateMode === "invoice_date") return data;
    return processRevenueData(rawInvoices, rawOrders, rawQuotes, "invoice_date", revenueFilter);
  }, [rawInvoices, rawOrders, rawQuotes, dateMode, data, revenueFilter]);

  // Derive unique months from invoices for filter dropdown
  // In rental_period mode, include all months that any invoice spans via allocations
  const invoiceMonths = useMemo(() => {
    if (!data) return [];
    const monthSet = new Map<string, string>();
    const toLabel = (mk: string) =>
      mk.replace(/^(\d{4})-(\d{2})$/, (_, y, m) => {
        const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${names[Number(m) - 1]} ${y}`;
      });
    for (const inv of data.closedInvoices) {
      // Add all allocation months if present
      if (inv.allocations) {
        for (const alloc of inv.allocations) {
          if (!monthSet.has(alloc.month)) {
            monthSet.set(alloc.month, toLabel(alloc.month));
          }
        }
      } else if (inv.month && !monthSet.has(inv.month)) {
        monthSet.set(inv.month, toLabel(inv.month));
      }
    }
    return Array.from(monthSet.entries())
      .sort((a, b) => b[0].localeCompare(a[0])) // newest first
      .map(([key, label]) => ({ key, label }));
  }, [data]);

  // Filter invoices — in rental_period mode, include invoices that have
  // allocations touching the selected month
  const filteredInvoices = useMemo(() => {
    if (!data) return [];
    if (invoiceMonthFilter === "all") return data.closedInvoices;
    return data.closedInvoices.filter((inv) => {
      if (inv.allocations) {
        return inv.allocations.some((a) => a.month === invoiceMonthFilter);
      }
      return inv.month === invoiceMonthFilter;
    });
  }, [data, invoiceMonthFilter]);

  // Group filtered invoices by customer
  const customerGroups = useMemo(() => {
    const groups = new Map<string, { customer: string; invoices: ClosedInvoice[]; totalRevenue: number; totalAllocated: number }>();
    const showAllocation = dateMode === "rental_period" && invoiceMonthFilter !== "all";
    for (const inv of filteredInvoices) {
      const key = inv.customer || "Unknown";
      if (!groups.has(key)) {
        groups.set(key, { customer: key, invoices: [], totalRevenue: 0, totalAllocated: 0 });
      }
      const g = groups.get(key)!;
      g.invoices.push(inv);
      g.totalRevenue += inv.subTotal;
      if (showAllocation) {
        const alloc = inv.allocations?.find((a) => a.month === invoiceMonthFilter);
        g.totalAllocated += alloc ? alloc.amount : inv.subTotal;
      }
    }
    return Array.from(groups.values()).sort((a, b) => {
      const aVal = showAllocation ? b.totalAllocated : b.totalRevenue;
      const bVal = showAllocation ? a.totalAllocated : a.totalRevenue;
      return aVal - bVal;
    });
  }, [filteredInvoices, dateMode, invoiceMonthFilter]);

  // Pipeline months with amounts from chart data (matches the overview chart exactly)
  const pipelineMonths = useMemo(() => {
    if (!data) return [];
    return data.monthlyData
      .filter((m) => m.pipeline > 0)
      .sort((a, b) => b.month.localeCompare(a.month))
      .map((m) => ({ key: m.month, label: m.label, amount: m.pipeline }));
  }, [data]);

  // Filter + allocate pipeline orders by selected month — uses the same
  // allocation logic as the chart so the totals always match the overview.
  const filteredPipelineOrders = useMemo(() => {
    if (!data) return [];
    if (pipelineMonthFilter === "all") {
      return data.pipelineOrders.map((o) => ({ ...o, allocatedAmount: o.total }));
    }
    const month = pipelineMonthFilter;
    const toMonthKey = (dateStr: string) => {
      if (!dateStr) return "";
      const iso = dateStr.match(/^(\d{4})-(\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}`;
      const us = dateStr.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})/);
      if (us) return `${us[2]}-${String(us[1]).padStart(2, "0")}`;
      return "";
    };
    const computeAllocation = (o: typeof data.pipelineOrders[number]): number => {
      if (dateMode === "rental_period" && o.estimatedStartDate && o.estimatedStopDate) {
        const start = new Date(o.estimatedStartDate);
        const end = new Date(o.estimatedStopDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return o.total;
        const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
        if (totalDays <= 0) return o.total;
        const [y, m] = month.split("-").map(Number);
        const monthStart = new Date(y, m - 1, 1);
        const monthEnd = new Date(y, m, 0);
        const overlapStart = start > monthStart ? start : monthStart;
        const overlapEnd = end < monthEnd ? end : monthEnd;
        const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;
        if (overlapDays <= 0) return 0;
        return Math.round((o.total * overlapDays / totalDays) * 100) / 100;
      }
      return o.total;
    };
    const orderMatchesMonth = (o: typeof data.pipelineOrders[number]) => {
      if (dateMode === "rental_period" && o.estimatedStartDate && o.estimatedStopDate) {
        const start = new Date(o.estimatedStartDate);
        const end = new Date(o.estimatedStopDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return toMonthKey(o.orderDate) === month;
        const [y, m] = month.split("-").map(Number);
        const monthStart = new Date(y, m - 1, 1);
        const monthEnd = new Date(y, m, 0);
        return start <= monthEnd && end >= monthStart;
      } else if (dateMode === "billing_date" && o.estimatedStartDate) {
        return toMonthKey(o.estimatedStopDate || o.estimatedStartDate) === month;
      } else {
        return toMonthKey(o.orderDate) === month;
      }
    };
    return data.pipelineOrders
      .filter(orderMatchesMonth)
      .map((o) => ({ ...o, allocatedAmount: computeAllocation(o) }))
      .sort((a, b) => b.allocatedAmount - a.allocatedAmount);
  }, [data, pipelineMonthFilter, dateMode]);

  // Unbilled months — derived from unbilled orders' rental dates
  const unbilledMonths = useMemo(() => {
    if (!data) return [];
    const monthSet = new Map<string, { label: string; amount: number }>();
    const toLabel = (mk: string) =>
      mk.replace(/^(\d{4})-(\d{2})$/, (_, y, m) => {
        const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${names[Number(m) - 1]} ${y}`;
      });
    const allUnbilledAndOverdue = [...data.unbilledOrders, ...data.overdueActiveOrders];
    for (const o of allUnbilledAndOverdue) {
      if (dateMode === "rental_period" && o.estimatedStartDate && o.estimatedStopDate) {
        const start = new Date(o.estimatedStartDate);
        const end = new Date(o.estimatedStopDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
        const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
        if (totalDays <= 0) continue;
        let curDate = new Date(start);
        while (curDate <= end) {
          const y = curDate.getFullYear();
          const m = curDate.getMonth();
          const mk = `${y}-${String(m + 1).padStart(2, "0")}`;
          const monthStart = new Date(y, m, 1);
          const monthEnd = new Date(y, m + 1, 0);
          const overlapStart = start > monthStart ? start : monthStart;
          const overlapEnd = end < monthEnd ? end : monthEnd;
          const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;
          const allocated = Math.round((o.total * overlapDays / totalDays) * 100) / 100;
          if (!monthSet.has(mk)) monthSet.set(mk, { label: toLabel(mk), amount: 0 });
          monthSet.get(mk)!.amount += allocated;
          curDate = new Date(y, m + 1, 1);
        }
      } else {
        const dateStr = dateMode === "billing_date" ? (o.estimatedStopDate || o.estimatedStartDate || o.orderDate) : o.orderDate;
        const match = dateStr?.match(/^(\d{4})-(\d{2})/);
        if (match) {
          const mk = `${match[1]}-${match[2]}`;
          if (!monthSet.has(mk)) monthSet.set(mk, { label: toLabel(mk), amount: 0 });
          monthSet.get(mk)!.amount += o.total;
        }
      }
    }
    return Array.from(monthSet.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, { label, amount }]) => ({ key, label, amount }));
  }, [data, dateMode]);

  // Filter + allocate unbilled orders by selected month
  const filteredUnbilledOrders = useMemo(() => {
    if (!data) return [];
    if (unbilledMonthFilter === "all") {
      return data.unbilledOrders.map((o) => ({ ...o, allocatedAmount: o.total }));
    }
    const month = unbilledMonthFilter;
    const toMonthKey = (dateStr: string) => {
      if (!dateStr) return "";
      const iso = dateStr.match(/^(\d{4})-(\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}`;
      const us = dateStr.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})/);
      if (us) return `${us[2]}-${String(us[1]).padStart(2, "0")}`;
      return "";
    };
    const computeAllocation = (o: typeof data.unbilledOrders[number]): number => {
      if (dateMode === "rental_period" && o.estimatedStartDate && o.estimatedStopDate) {
        const start = new Date(o.estimatedStartDate);
        const end = new Date(o.estimatedStopDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return o.total;
        const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
        if (totalDays <= 0) return o.total;
        const [y, m] = month.split("-").map(Number);
        const monthStart = new Date(y, m - 1, 1);
        const monthEnd = new Date(y, m, 0);
        const overlapStart = start > monthStart ? start : monthStart;
        const overlapEnd = end < monthEnd ? end : monthEnd;
        const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;
        if (overlapDays <= 0) return 0;
        return Math.round((o.total * overlapDays / totalDays) * 100) / 100;
      }
      return o.total;
    };
    const orderMatchesMonth = (o: typeof data.unbilledOrders[number]) => {
      if (dateMode === "rental_period" && o.estimatedStartDate && o.estimatedStopDate) {
        const start = new Date(o.estimatedStartDate);
        const end = new Date(o.estimatedStopDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return toMonthKey(o.orderDate) === month;
        const [y, m] = month.split("-").map(Number);
        const monthStart = new Date(y, m - 1, 1);
        const monthEnd = new Date(y, m, 0);
        return start <= monthEnd && end >= monthStart;
      } else if (dateMode === "billing_date" && o.estimatedStartDate) {
        return toMonthKey(o.estimatedStopDate || o.estimatedStartDate) === month;
      } else {
        return toMonthKey(o.orderDate) === month;
      }
    };
    return data.unbilledOrders
      .filter(orderMatchesMonth)
      .map((o) => ({ ...o, allocatedAmount: computeAllocation(o) }))
      .sort((a, b) => b.allocatedAmount - a.allocatedAmount);
  }, [data, unbilledMonthFilter, dateMode]);

  // Filter + allocate overdue active orders by selected month
  const filteredOverdueActiveOrders = useMemo(() => {
    if (!data) return [];
    if (unbilledMonthFilter === "all") {
      return data.overdueActiveOrders.map((o) => ({ ...o, allocatedAmount: o.total }));
    }
    const month = unbilledMonthFilter;
    const toMonthKey = (dateStr: string) => {
      if (!dateStr) return "";
      const iso = dateStr.match(/^(\d{4})-(\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}`;
      const us = dateStr.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})/);
      if (us) return `${us[2]}-${String(us[1]).padStart(2, "0")}`;
      return "";
    };
    const computeAllocation = (o: typeof data.overdueActiveOrders[number]): number => {
      if (dateMode === "rental_period" && o.estimatedStartDate && o.estimatedStopDate) {
        const start = new Date(o.estimatedStartDate);
        const end = new Date(o.estimatedStopDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return o.total;
        const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
        if (totalDays <= 0) return o.total;
        const [y, m] = month.split("-").map(Number);
        const monthStart = new Date(y, m - 1, 1);
        const monthEnd = new Date(y, m, 0);
        const overlapStart = start > monthStart ? start : monthStart;
        const overlapEnd = end < monthEnd ? end : monthEnd;
        const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;
        if (overlapDays <= 0) return 0;
        return Math.round((o.total * overlapDays / totalDays) * 100) / 100;
      }
      return o.total;
    };
    const orderMatchesMonth = (o: typeof data.overdueActiveOrders[number]) => {
      if (dateMode === "rental_period" && o.estimatedStartDate && o.estimatedStopDate) {
        const start = new Date(o.estimatedStartDate);
        const end = new Date(o.estimatedStopDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return toMonthKey(o.orderDate) === month;
        const [y, m] = month.split("-").map(Number);
        const monthStart = new Date(y, m - 1, 1);
        const monthEnd = new Date(y, m, 0);
        return start <= monthEnd && end >= monthStart;
      } else if (dateMode === "billing_date" && o.estimatedStartDate) {
        return toMonthKey(o.estimatedStopDate || o.estimatedStartDate) === month;
      } else {
        return toMonthKey(o.orderDate) === month;
      }
    };
    return data.overdueActiveOrders
      .filter(orderMatchesMonth)
      .map((o) => ({ ...o, allocatedAmount: computeAllocation(o) }))
      .sort((a, b) => b.allocatedAmount - a.allocatedAmount);
  }, [data, unbilledMonthFilter, dateMode]);

  // Drill-down data for chart click
  const drillDownItems = useMemo(() => {
    type OrderWithAlloc = typeof data extends null ? never : NonNullable<typeof data>["pipelineOrders"][number] & { allocatedAmount: number };
    if (!chartDrillDown || !data) return { invoices: [] as ClosedInvoice[], orders: [] as OrderWithAlloc[] };
    const { month, category } = chartDrillDown;
    if (category === "pipeline") {
      const toMonthKey = (dateStr: string) => {
        if (!dateStr) return "";
        const iso = dateStr.match(/^(\d{4})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}`;
        const us = dateStr.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})/);
        if (us) return `${us[2]}-${String(us[1]).padStart(2, "0")}`;
        return "";
      };
      // Compute allocated amount for each order in rental_period mode
      const computeAllocation = (o: typeof data.pipelineOrders[number]): number => {
        if (dateMode === "rental_period" && o.estimatedStartDate && o.estimatedStopDate) {
          const start = new Date(o.estimatedStartDate);
          const end = new Date(o.estimatedStopDate);
          if (isNaN(start.getTime()) || isNaN(end.getTime())) return o.total;
          const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
          if (totalDays <= 0) return o.total;
          const [y, m] = month.split("-").map(Number);
          const monthStart = new Date(y, m - 1, 1);
          const monthEnd = new Date(y, m, 0);
          const overlapStart = start > monthStart ? start : monthStart;
          const overlapEnd = end < monthEnd ? end : monthEnd;
          const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;
          if (overlapDays <= 0) return 0;
          return Math.round((o.total * overlapDays / totalDays) * 100) / 100;
        }
        return o.total;
      };
      const orderMatchesMonth = (o: typeof data.pipelineOrders[number]) => {
        if (dateMode === "rental_period" && o.estimatedStartDate && o.estimatedStopDate) {
          const start = new Date(o.estimatedStartDate);
          const end = new Date(o.estimatedStopDate);
          if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return toMonthKey(o.orderDate) === month;
          }
          const [y, m] = month.split("-").map(Number);
          const monthStart = new Date(y, m - 1, 1);
          const monthEnd = new Date(y, m, 0);
          return start <= monthEnd && end >= monthStart;
        } else if (dateMode === "billing_date" && o.estimatedStartDate) {
          return toMonthKey(o.estimatedStopDate || o.estimatedStartDate) === month;
        } else {
          return toMonthKey(o.orderDate) === month;
        }
      };
      const orders = data.pipelineOrders
        .filter(orderMatchesMonth)
        .map((o) => ({ ...o, allocatedAmount: computeAllocation(o) }));
      return { invoices: [] as ClosedInvoice[], orders };
    }
    // Closed or pending — filter invoices by status and month
    const statusSet = category === "closed"
      ? new Set(["CLOSED", "PROCESSED"])
      : new Set(["NEW", "APPROVED"]);
    const invoices = data.closedInvoices.filter((inv) => {
      if (!statusSet.has(inv.status)) return false;
      if (dateMode === "rental_period") {
        if (inv.allocations) {
          return inv.allocations.some((a) => a.month === month);
        }
        return inv.month === month;
      }
      return inv.month === month;
    });
    return { invoices, orders: [] as Array<typeof data.pipelineOrders[number] & { allocatedAmount: number }> };
  }, [chartDrillDown, data, dateMode]);

  const handleBarClick = useCallback((category: "closed" | "pending" | "pipeline") => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (barData: any) => {
      const payload = barData?.payload as MonthlyRevenue | undefined;
      if (!payload?.month) return;
      setChartDrillDown((prev) => {
        if (prev && prev.month === payload.month && prev.category === category) return null;
        return { month: payload.month, label: payload.label || payload.month, category };
      });
    };
  }, []);

  // Snapshot / Trends state
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  const fetchSnapshots = useCallback(async () => {
    setSnapshotsLoading(true);
    try {
      const now = new Date();
      const res = await fetch(
        `/api/revenue-projections/snapshot?entityId=${entityId}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`
      );
      if (res.ok) {
        const json = await res.json();
        setSnapshots(json.snapshots ?? []);
      }
    } catch {
      // non-fatal
    } finally {
      setSnapshotsLoading(false);
    }
  }, [entityId]);

  const saveSnapshot = useCallback(async () => {
    if (!data) return;
    setSavingSnapshot(true);
    try {
      const now = new Date();
      const res = await fetch("/api/revenue-projections/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          periodYear: now.getFullYear(),
          periodMonth: now.getMonth() + 1,
          projections: [
            { sectionId: "revenue", amount: data.currentMonthProjected },
            { sectionId: "pipeline", amount: data.pipelineValue },
            { sectionId: "ytd", amount: data.ytdRevenue },
          ],
          source: "manual",
        }),
      });
      if (res.ok) {
        toast.success("Snapshot saved for today");
        fetchSnapshots();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to save snapshot");
      }
    } catch {
      toast.error("Failed to save snapshot");
    } finally {
      setSavingSnapshot(false);
    }
  }, [data, entityId, fetchSnapshots]);

  // Fetch snapshots on mount
  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());

  // Reset expanded state when filter changes
  useEffect(() => {
    setExpandedCustomers(new Set());
  }, [invoiceMonthFilter, pipelineMonthFilter, dateMode]);

  const toggleCustomer = useCallback((customer: string) => {
    setExpandedCustomers((prev) => {
      const next = new Set(prev);
      if (next.has(customer)) next.delete(customer);
      else next.add(customer);
      return next;
    });
  }, []);

  const [exportingInvoices, setExportingInvoices] = useState(false);

  const exportInvoicesToExcel = useCallback(async () => {
    if (!data || filteredInvoices.length === 0) return;
    setExportingInvoices(true);
    try {
      const supabase = createSupabaseClient();
      const { data: entityRow } = await supabase
        .from("entities")
        .select("name")
        .eq("id", entityId)
        .single();
      const entityName =
        (entityRow as { name?: string } | null)?.name ?? displayName;

      const showAllocation =
        dateMode === "rental_period" && invoiceMonthFilter !== "all";
      const dateModeLabel =
        dateMode === "invoice_date"
          ? "Invoice Date"
          : dateMode === "rental_period"
            ? "Rental Period (pro-rata)"
            : "Billing Date";
      const monthLabel =
        invoiceMonthFilter === "all"
          ? "All Months"
          : invoiceMonths.find((m) => m.key === invoiceMonthFilter)?.label ??
            invoiceMonthFilter;
      const periodLabel = `${monthLabel} · ${dateModeLabel}`;
      const generatedOn = new Date().toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

      interface InvoiceExportRow {
        customer: string;
        invoiceNumber: string;
        status: string;
        orderNumber: string;
        orderDescription: string;
        invoiceDate: Date | undefined;
        billingStart: Date | undefined;
        billingEnd: Date | undefined;
        equipmentType: string;
        subTotal: number;
        tax: number;
        grossTotal: number;
        allocatedAmount: number;
        allocationPct: number | null;
        allocationDays: number | null;
      }

      const rows: InvoiceExportRow[] = filteredInvoices.map((inv) => {
        const alloc = showAllocation
          ? inv.allocations?.find((a) => a.month === invoiceMonthFilter)
          : undefined;
        return {
          customer: inv.customer || "Unknown",
          invoiceNumber: inv.invoiceNumber,
          status: inv.status,
          orderNumber: inv.orderNumber,
          orderDescription: inv.orderDescription,
          invoiceDate: parseInvoiceDate(inv.invoiceDate),
          billingStart: parseInvoiceDate(inv.billingStartDate),
          billingEnd: parseInvoiceDate(inv.billingEndDate),
          equipmentType: inv.equipmentType,
          subTotal: inv.subTotal,
          tax: inv.tax,
          grossTotal: inv.grossTotal,
          allocatedAmount: showAllocation
            ? alloc?.amount ?? inv.subTotal
            : inv.subTotal,
          allocationPct: showAllocation ? alloc?.percentage ?? null : null,
          allocationDays: showAllocation ? alloc?.days ?? null : null,
        };
      });

      const wb = createWorkbook({
        company: entityName,
        title: `Invoices — ${monthLabel}`,
      });

      addSheet<InvoiceExportRow>(wb, {
        name: "Invoices",
        title: {
          entityName,
          reportTitle: `Invoices — ${monthLabel}`,
          subtitle: `Grouped by ${dateModeLabel.toLowerCase()} · ${filteredInvoices.length} invoices, ${customerGroups.length} customers`,
          period: periodLabel,
          asOf: `Generated ${generatedOn}`,
        },
        columns: [
          { header: "Customer", width: 30, value: (r) => r.customer },
          { header: "Invoice #", width: 14, value: (r) => r.invoiceNumber },
          { header: "Status", width: 12, value: (r) => r.status },
          { header: "Order #", width: 14, value: (r) => r.orderNumber || "—" },
          {
            header: "Order Description",
            width: 38,
            value: (r) => r.orderDescription || "—",
          },
          {
            header: "Invoice Date",
            width: 14,
            value: (r) => r.invoiceDate ?? null,
            format: NUMBER_FORMATS.date,
          },
          {
            header: "Billing Start",
            width: 14,
            value: (r) => r.billingStart ?? null,
            format: NUMBER_FORMATS.date,
          },
          {
            header: "Billing End",
            width: 14,
            value: (r) => r.billingEnd ?? null,
            format: NUMBER_FORMATS.date,
          },
          {
            header: "Equipment",
            width: 16,
            value: (r) =>
              ({
                vehicle: "Vehicle",
                grip_lighting: "Grip & Lighting",
                studio: "Studio",
                pro_supplies: "Pro Supplies",
              }[r.equipmentType] ?? r.equipmentType),
          },
          {
            header: "Revenue (Subtotal)",
            width: 18,
            value: (r) => r.subTotal,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
          {
            header: "Tax",
            width: 14,
            value: (r) => r.tax,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
          {
            header: "Gross Total",
            width: 16,
            value: (r) => r.grossTotal,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
          ...(showAllocation
            ? ([
                {
                  header: "Alloc %",
                  width: 10,
                  value: (r: InvoiceExportRow) =>
                    r.allocationPct == null ? "" : r.allocationPct / 100,
                  format: NUMBER_FORMATS.percent,
                },
                {
                  header: "Alloc Days",
                  width: 11,
                  value: (r: InvoiceExportRow) => r.allocationDays ?? null,
                  format: NUMBER_FORMATS.integer,
                },
                {
                  header: `Allocated to ${monthLabel}`,
                  width: 22,
                  value: (r: InvoiceExportRow) => r.allocatedAmount,
                  format: NUMBER_FORMATS.currency,
                  total: "sum",
                },
              ] as const)
            : []),
        ],
        rows,
        groupBy: (r) => r.customer,
        sort: (a, b) =>
          a.customer.localeCompare(b.customer) ||
          a.invoiceNumber.localeCompare(b.invoiceNumber),
        grandTotal: true,
        footnote: showAllocation
          ? `"Allocated" column shows the portion of each invoice's subtotal recognised in ${monthLabel} based on rental period overlap.`
          : `For QuickBooks reconciliation: compare Revenue (Subtotal) to QB income for this period. Status column: CLOSED/PROCESSED = synced to QB; NEW/APPROVED = pending in RentalWorks.`,
      });

      const fileSlug = `${entityName.replace(/\s+/g, "_")}_Invoices_${
        invoiceMonthFilter === "all" ? "All" : invoiceMonthFilter
      }`;
      await downloadWorkbook(wb, fileSlug);
      toast.success(`Exported ${filteredInvoices.length} invoices to Excel`);
    } catch (err) {
      console.error("Invoice export error:", err);
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportingInvoices(false);
    }
  }, [
    data,
    filteredInvoices,
    customerGroups,
    invoiceMonthFilter,
    invoiceMonths,
    dateMode,
    entityId,
    displayName,
  ]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <div className="flex flex-col items-center gap-2 w-64">
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
          <p className="text-muted-foreground text-sm">{loadStep}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Revenue Projection</h1>
            <p className="text-destructive text-sm">{error}</p>
          </div>
          <Button onClick={() => fetchData()} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Revenue Projection</h1>
          <p className="text-muted-foreground text-sm">
            {displayName} — RentalWorks invoices, orders & quotes
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isEmbed && (
            <div className="bg-muted inline-flex items-center rounded-lg p-1">
              <button
                onClick={() => handleDateModeChange("invoice_date")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  dateMode === "invoice_date"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Invoice Date
              </button>
              <button
                onClick={() => handleDateModeChange("billing_date")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  dateMode === "billing_date"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Billing Date
              </button>
              <button
                onClick={() => handleDateModeChange("rental_period")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  dateMode === "rental_period"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Rental Period
              </button>
            </div>
          )}
          {!isEmbed && (
            <Button
              onClick={saveSnapshot}
              variant="outline"
              size="sm"
              disabled={savingSnapshot || !data}
            >
              {savingSnapshot ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Snapshot
            </Button>
          )}
          <Button
            onClick={() => fetchData()}
            variant="outline"
            size="sm"
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <KPICard
          title="YTD Revenue"
          value={formatCurrency(data.ytdRevenue)}
          description="Closed invoices this year"
          icon={<DollarSign className="text-muted-foreground h-4 w-4" />}
        />
        <KPICard
          title="Current Month"
          value={formatCurrency(data.currentMonthActual)}
          description={`Projected: ${formatCurrency(data.currentMonthProjected)}`}
          icon={<TrendingUp className="text-muted-foreground h-4 w-4" />}
        />
        <KPICard
          title="Pipeline Value"
          value={formatCurrency(data.pipelineValue)}
          description={`${data.pipelineOrders.length} open orders`}
          icon={<Layers className="text-muted-foreground h-4 w-4" />}
        />
        <KPICard
          title="Quote Opportunities"
          value={formatCurrency(data.quoteOpportunities)}
          description={`${data.pipelineQuotes.length} active quotes`}
          icon={<FileText className="text-muted-foreground h-4 w-4" />}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue={defaultTab || "overview"}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="invoices">
            Invoices ({data.closedInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="pipeline">
            Pipeline ({data.pipelineOrders.length})
          </TabsTrigger>
          <TabsTrigger value="quotes">
            Quotes ({data.pipelineQuotes.length})
          </TabsTrigger>
          {data.unbilledOrders.length > 0 && (
            <TabsTrigger value="unbilled">
              Unbilled ({data.unbilledOrders.length})
            </TabsTrigger>
          )}
          {!isEmbed && (
            <TabsTrigger value="insights">
              <Lightbulb className="mr-1.5 h-3.5 w-3.5" />
              Insights
            </TabsTrigger>
          )}
          {!isEmbed && (
            <TabsTrigger value="trends">
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              Trends
            </TabsTrigger>
          )}
          {!isEmbed && (
            <TabsTrigger value="accruals">
              <BookOpen className="mr-1.5 h-3.5 w-3.5" />
              Accruals
            </TabsTrigger>
          )}
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Revenue Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Revenue</CardTitle>
              <CardDescription>
                12-month history + 3-month forecast (6-month moving average)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart
                  data={data.monthlyData.filter((m) => m.month >= `${new Date().getFullYear()}-01`)}
                  margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="label"
                    className="text-xs"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    tickFormatter={formatCompact}
                    className="text-xs"
                    tick={{ fontSize: 12 }}
                  />
                  <RechartsTooltip
                    content={<RevenueTooltip />}
                    allowEscapeViewBox={{ x: true, y: true }}
                    wrapperStyle={{ zIndex: 50, pointerEvents: "none" }}
                  />
                  <Legend />
                  <Bar
                    dataKey="closed"
                    name="Recognized"
                    fill="#2563eb"
                    stackId="a"
                    radius={[0, 0, 0, 0]}
                    cursor="pointer"
                    onClick={handleBarClick("closed")}
                  />
                  <Bar
                    dataKey="pending"
                    name="Pending"
                    fill="#f59e0b"
                    stackId="a"
                    radius={[0, 0, 0, 0]}
                    cursor="pointer"
                    onClick={handleBarClick("pending")}
                  />
                  <Bar
                    dataKey="pipeline"
                    name="Pipeline"
                    fill="#94a3b8"
                    stackId="a"
                    radius={[2, 2, 0, 0]}
                    cursor="pointer"
                    onClick={handleBarClick("pipeline")}
                  />
                  <Line
                    dataKey="forecast"
                    name="Forecast"
                    stroke="#ea580c"
                    strokeDasharray="5 5"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Chart Drill-Down Panel */}
          {chartDrillDown && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{
                          backgroundColor:
                            chartDrillDown.category === "closed" ? "#2563eb"
                            : chartDrillDown.category === "pending" ? "#f59e0b"
                            : "#94a3b8",
                        }}
                      />
                      {chartDrillDown.label} —{" "}
                      {chartDrillDown.category === "closed" ? "Recognized"
                        : chartDrillDown.category === "pending" ? "Pending"
                        : "Pipeline"}
                    </CardTitle>
                    <CardDescription>
                      {chartDrillDown.category === "pipeline"
                        ? `${drillDownItems.orders.length} open orders`
                        : `${drillDownItems.invoices.length} invoices`}
                      {" — "}
                      {formatCurrency(
                        chartDrillDown.category === "pipeline"
                          ? drillDownItems.orders.reduce((s, o) => s + o.allocatedAmount, 0)
                          : drillDownItems.invoices.reduce((s, i) => s + i.subTotal, 0),
                      )}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setChartDrillDown(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ✕
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {chartDrillDown.category === "pipeline" ? (
                  drillDownItems.orders.length === 0 ? (
                    <p className="text-muted-foreground py-4 text-center text-sm">No orders for this month.</p>
                  ) : (
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Order #</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Deal</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Order Date</TableHead>
                            <TableHead>Rental Period</TableHead>
                            {dateMode === "rental_period" && <TableHead className="text-right">Order Total</TableHead>}
                            <TableHead className="text-right">{dateMode === "rental_period" ? "Allocated" : "Total"}</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {drillDownItems.orders.map((order) => (
                            <TableRow key={order.orderId}>
                              <TableCell className="font-medium">{order.orderNumber}</TableCell>
                              <TableCell>{order.customer}</TableCell>
                              <TableCell className="max-w-[150px] truncate">{order.deal}</TableCell>
                              <TableCell className="max-w-[200px] truncate">{order.description}</TableCell>
                              <TableCell className="text-muted-foreground whitespace-nowrap">{formatDate(order.orderDate)}</TableCell>
                              <TableCell className="text-muted-foreground whitespace-nowrap">
                                {order.estimatedStartDate ? `${formatDate(order.estimatedStartDate)} – ${formatDate(order.estimatedStopDate)}` : "—"}
                              </TableCell>
                              {dateMode === "rental_period" && (
                                <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(order.total)}</TableCell>
                              )}
                              <TableCell className="text-right font-medium tabular-nums">{formatCurrency(order.allocatedAmount)}</TableCell>
                              <TableCell><Badge variant="outline">{order.status}</Badge></TableCell>
                              <TableCell><Badge variant="secondary">{EQUIPMENT_TYPE_LABELS[order.equipmentType] || order.equipmentType}</Badge></TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2 font-semibold">
                            <TableCell colSpan={6}>Total ({drillDownItems.orders.length} orders)</TableCell>
                            {dateMode === "rental_period" && (
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(drillDownItems.orders.reduce((s, o) => s + o.total, 0))}</TableCell>
                            )}
                            <TableCell className="text-right tabular-nums">{formatCurrency(drillDownItems.orders.reduce((s, o) => s + o.allocatedAmount, 0))}</TableCell>
                            <TableCell colSpan={2} />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )
                ) : (
                  drillDownItems.invoices.length === 0 ? (
                    <p className="text-muted-foreground py-4 text-center text-sm">No invoices for this month.</p>
                  ) : (
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice #</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Order / Description</TableHead>
                            <TableHead>Invoice Date</TableHead>
                            <TableHead>Billing Period</TableHead>
                            <TableHead className="text-right">Subtotal</TableHead>
                            <TableHead className="text-right">Tax</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {drillDownItems.invoices.map((inv) => (
                            <TableRow key={inv.invoiceId}>
                              <TableCell className="font-medium">
                                <span className="flex items-center gap-1.5">
                                  {inv.invoiceNumber}
                                  {inv.status !== "CLOSED" && inv.status !== "PROCESSED" && (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{inv.status}</Badge>
                                  )}
                                </span>
                              </TableCell>
                              <TableCell>{inv.customer}</TableCell>
                              <TableCell className="max-w-[200px] truncate">{inv.orderDescription || inv.orderNumber}</TableCell>
                              <TableCell className="text-muted-foreground whitespace-nowrap">{formatDate(inv.invoiceDate)}</TableCell>
                              <TableCell className="text-muted-foreground whitespace-nowrap">
                                {inv.billingStartDate ? `${formatDate(inv.billingStartDate)} – ${formatDate(inv.billingEndDate)}` : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatCurrency(inv.subTotal)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(inv.tax)}</TableCell>
                              <TableCell className="text-right tabular-nums font-medium">{formatCurrency(inv.grossTotal)}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2 font-semibold">
                            <TableCell colSpan={5}>Total ({drillDownItems.invoices.length} invoices)</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(drillDownItems.invoices.reduce((s, i) => s + i.subTotal, 0))}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(drillDownItems.invoices.reduce((s, i) => s + i.tax, 0))}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(drillDownItems.invoices.reduce((s, i) => s + i.grossTotal, 0))}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          )}

          {/* Accrued & Deferred Revenue Chart */}
          {!isEmbed && data.monthlyData.some((m) => m.accrued > 0 || m.deferred > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Accrued & Deferred Revenue</CardTitle>
                <CardDescription>
                  Monthly difference between earned revenue (by rental period) and billed revenue (by invoice date)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart
                    data={data.monthlyData.map((m) => ({
                      ...m,
                      // Show deferred as negative for diverging bar chart
                      deferredNeg: m.deferred > 0 ? -m.deferred : 0,
                    }))}
                    margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={formatCompact} className="text-xs" tick={{ fontSize: 12 }} />
                    <RechartsTooltip
                      content={<AccrualDeferralTooltip />}
                      allowEscapeViewBox={{ x: true, y: true }}
                      wrapperStyle={{ zIndex: 50, pointerEvents: "none" }}
                    />
                    <Legend />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
                    <Bar dataKey="accrued" name="Accrued" fill="#14b8a6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="deferredNeg" name="Deferred" fill="#f59e0b" radius={[0, 0, 3, 3]} />
                    <Line dataKey="billed" name="Billed" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                    <Line dataKey="earned" name="Earned" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Equipment Breakdown */}
          {data.equipmentBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Revenue by Equipment Type</CardTitle>
                <CardDescription>YTD closed invoice breakdown</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center gap-6 md:flex-row">
                  <div className="w-full md:w-1/2">
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={data.equipmentBreakdown}
                          dataKey="amount"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={110}
                        >
                          {data.equipmentBreakdown.map((entry) => (
                            <Cell
                              key={entry.type}
                              fill={EQUIP_COLORS[entry.type] || "#6b7280"}
                            />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          content={<EquipmentTooltip />}
                          allowEscapeViewBox={{ x: true, y: true }}
                          wrapperStyle={{ zIndex: 50, pointerEvents: "none" }}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full space-y-3 md:w-1/2">
                    {data.equipmentBreakdown.map((entry) => (
                      <div
                        key={entry.type}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{
                              backgroundColor:
                                EQUIP_COLORS[entry.type] || "#6b7280",
                            }}
                          />
                          <span className="text-sm font-medium">
                            {entry.label}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold tabular-nums">
                            {formatCurrency(entry.amount)}
                          </span>
                          <span className="text-muted-foreground ml-2 text-xs">
                            ({entry.percentage.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Invoices</CardTitle>
                  <CardDescription>
                    Revenue grouped by{" "}
                    {dateMode === "invoice_date"
                      ? "invoice date"
                      : dateMode === "rental_period"
                        ? "rental period (pro-rata)"
                        : "rental billing date"}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {invoiceMonths.length > 0 && (
                    <>
                      <button
                        onClick={() => setInvoiceMonthFilter("all")}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          invoiceMonthFilter === "all"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        All
                      </button>
                      {invoiceMonths.map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setInvoiceMonthFilter(key)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                            invoiceMonthFilter === key
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportInvoicesToExcel}
                    disabled={
                      exportingInvoices ||
                      !data ||
                      filteredInvoices.length === 0
                    }
                    className="ml-1 h-7 px-2.5"
                    title="Export the filtered invoice list to Excel for QuickBooks reconciliation"
                  >
                    {exportingInvoices ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Export
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredInvoices.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No invoices found.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  {(() => {
                    const showAllocation = dateMode === "rental_period" && invoiceMonthFilter !== "all";
                    const getAlloc = (inv: ClosedInvoice) =>
                      inv.allocations?.find((a) => a.month === invoiceMonthFilter);
                    return (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8" />
                            <TableHead>Customer</TableHead>
                            <TableHead className="text-right">Invoices</TableHead>
                            {showAllocation ? (
                              <>
                                <TableHead className="text-right">Invoice Total</TableHead>
                                <TableHead className="text-right">Allocated</TableHead>
                              </>
                            ) : (
                              <>
                                <TableHead className="text-right">Revenue</TableHead>
                                <TableHead className="text-right">Tax</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                              </>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {customerGroups.map((group) => {
                            const isExpanded = expandedCustomers.has(group.customer);
                            const groupTax = group.invoices.reduce((s, i) => s + i.tax, 0);
                            const groupGross = group.invoices.reduce((s, i) => s + i.grossTotal, 0);
                            return (
                              <React.Fragment key={group.customer}>
                                <TableRow
                                  className="hover:bg-muted/50 cursor-pointer"
                                  onClick={() => toggleCustomer(group.customer)}
                                >
                                  <TableCell className="w-8 px-2">
                                    <ChevronRight
                                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                                        isExpanded ? "rotate-90" : ""
                                      }`}
                                    />
                                  </TableCell>
                                  <TableCell className="font-medium">
                                    {group.customer}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground text-right tabular-nums">
                                    {group.invoices.length}
                                  </TableCell>
                                  {showAllocation ? (
                                    <>
                                      <TableCell className="text-muted-foreground text-right tabular-nums">
                                        {formatCurrency(group.totalRevenue)}
                                      </TableCell>
                                      <TableCell className="text-right font-semibold tabular-nums">
                                        {formatCurrency(group.totalAllocated)}
                                      </TableCell>
                                    </>
                                  ) : (
                                    <>
                                      <TableCell className="text-right font-semibold tabular-nums">
                                        {formatCurrency(group.totalRevenue)}
                                      </TableCell>
                                      <TableCell className="text-muted-foreground text-right tabular-nums">
                                        {formatCurrency(groupTax)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {formatCurrency(groupGross)}
                                      </TableCell>
                                    </>
                                  )}
                                </TableRow>
                                {isExpanded && group.invoices.map((inv) => {
                                  const alloc = showAllocation ? getAlloc(inv) : null;
                                  return (
                                    <TableRow key={inv.invoiceId} className="bg-muted/30">
                                      <TableCell />
                                      <TableCell className="pl-8" colSpan={showAllocation ? 1 : 1}>
                                        <div className="flex flex-col gap-0.5">
                                          <span className="flex items-center gap-1.5 text-sm font-medium">
                                            {inv.invoiceNumber}
                                            {inv.status && inv.status !== "CLOSED" && inv.status !== "PROCESSED" && (
                                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-400 bg-orange-50 text-orange-700">
                                                Pending
                                              </Badge>
                                            )}
                                          </span>
                                          <span className="text-muted-foreground max-w-[260px] truncate text-xs">
                                            {inv.orderDescription || inv.orderNumber}
                                          </span>
                                        </div>
                                      </TableCell>
                                      <TableCell>
                                        <div className="flex flex-col gap-0.5 text-xs">
                                          <span className="text-muted-foreground whitespace-nowrap">
                                            {formatDate(inv.invoiceDate)}
                                          </span>
                                          {(inv.billingStartDate || inv.billingEndDate) && (
                                            <span className="text-muted-foreground whitespace-nowrap">
                                              {formatDate(inv.billingStartDate)} – {formatDate(inv.billingEndDate)}
                                            </span>
                                          )}
                                        </div>
                                      </TableCell>
                                      {showAllocation ? (
                                        <>
                                          <TableCell className="text-muted-foreground text-right tabular-nums text-sm">
                                            {formatCurrency(inv.subTotal)}
                                            {alloc && (
                                              <span className="text-muted-foreground ml-1 text-xs">
                                                ({alloc.percentage}%, {alloc.days}d)
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-right font-medium tabular-nums text-sm">
                                            {alloc ? formatCurrency(alloc.amount) : formatCurrency(inv.subTotal)}
                                          </TableCell>
                                        </>
                                      ) : (
                                        <>
                                          <TableCell className="text-right tabular-nums text-sm">
                                            {formatCurrency(inv.subTotal)}
                                            {dateMode === "rental_period" && inv.allocations && (
                                              <div className="mt-0.5 flex flex-wrap justify-end gap-1">
                                                {inv.allocations.map((a) => (
                                                  <span
                                                    key={a.month}
                                                    className="bg-muted text-muted-foreground rounded px-1 py-0.5 text-[10px]"
                                                  >
                                                    {a.label}: {a.percentage}%
                                                  </span>
                                                ))}
                                              </div>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-muted-foreground text-right tabular-nums text-sm">
                                            {formatCurrency(inv.tax)}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-sm">
                                            {formatCurrency(inv.grossTotal)}
                                          </TableCell>
                                        </>
                                      )}
                                    </TableRow>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}
                          <TableRow className="border-t-2 font-semibold">
                            <TableCell />
                            <TableCell>
                              Total ({filteredInvoices.length} invoices, {customerGroups.length} customers)
                            </TableCell>
                            <TableCell />
                            {showAllocation ? (
                              <>
                                <TableCell className="text-muted-foreground text-right tabular-nums">
                                  {formatCurrency(
                                    filteredInvoices.reduce((s, i) => s + i.subTotal, 0),
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(
                                    customerGroups.reduce((s, g) => s + g.totalAllocated, 0),
                                  )}
                                </TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(
                                    filteredInvoices.reduce((s, i) => s + i.subTotal, 0),
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(
                                    filteredInvoices.reduce((s, i) => s + i.tax, 0),
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(
                                    filteredInvoices.reduce((s, i) => s + i.grossTotal, 0),
                                  )}
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        </TableBody>
                      </Table>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pipeline Tab */}
        <TabsContent value="pipeline">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Open Orders</CardTitle>
                  <CardDescription>
                    {pipelineMonthFilter === "all"
                      ? `Active ${displayName} orders from RentalWorks`
                      : dateMode === "rental_period"
                        ? "Pipeline allocated by rental period (pro-rata)"
                        : dateMode === "billing_date"
                          ? "Pipeline grouped by billing date"
                          : "Pipeline grouped by order date"}
                  </CardDescription>
                </div>
                {pipelineMonths.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => setPipelineMonthFilter("all")}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        pipelineMonthFilter === "all"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      All
                    </button>
                    {pipelineMonths.map(({ key, label, amount }) => (
                      <button
                        key={key}
                        onClick={() => setPipelineMonthFilter(key)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          pipelineMonthFilter === key
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                        title={formatCurrency(amount)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {filteredPipelineOrders.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {pipelineMonthFilter === "all" ? "No open orders found." : "No orders for this month."}
                </p>
              ) : (
                (() => {
                  const showAllocation = pipelineMonthFilter !== "all" && dateMode === "rental_period";
                  return (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order #</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Deal</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Rental Dates</TableHead>
                          {showAllocation && <TableHead className="text-right">Order Total</TableHead>}
                          <TableHead className="text-right">{showAllocation ? "Allocated" : "Total"}</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPipelineOrders.map((order) => (
                          <TableRow key={order.orderId}>
                            <TableCell className="font-medium">
                              {order.orderNumber}
                            </TableCell>
                            <TableCell>{order.customer}</TableCell>
                            <TableCell className="max-w-[150px] truncate">
                              {order.deal}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate">
                              {order.description}
                            </TableCell>
                            <TableCell className="text-muted-foreground whitespace-nowrap">
                              {order.estimatedStartDate ? `${formatDate(order.estimatedStartDate)} – ${formatDate(order.estimatedStopDate)}` : "—"}
                            </TableCell>
                            {showAllocation && (
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {formatCurrency(order.total)}
                              </TableCell>
                            )}
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatCurrency(order.allocatedAmount)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{order.status}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {EQUIPMENT_TYPE_LABELS[order.equipmentType] ||
                                  order.equipmentType}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2 font-semibold">
                          <TableCell colSpan={5}>
                            Total {pipelineMonthFilter === "all" ? "Pipeline" : `(${filteredPipelineOrders.length} orders)`}
                          </TableCell>
                          {showAllocation && (
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {formatCurrency(filteredPipelineOrders.reduce((s, o) => s + o.total, 0))}
                            </TableCell>
                          )}
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(filteredPipelineOrders.reduce((s, o) => s + o.allocatedAmount, 0))}
                          </TableCell>
                          <TableCell colSpan={2} />
                        </TableRow>
                      </TableBody>
                    </Table>
                  );
                })()
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Quotes Tab */}
        <TabsContent value="quotes">
          <Card>
            <CardHeader>
              <CardTitle>Active Quotes</CardTitle>
              <CardDescription>
                Open quote opportunities from RentalWorks
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.pipelineQuotes.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No active quotes found.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quote #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.pipelineQuotes.map((quote) => (
                      <TableRow key={quote.quoteId || quote.quoteNumber}>
                        <TableCell className="font-medium">
                          {quote.quoteNumber}
                        </TableCell>
                        <TableCell>{quote.customer}</TableCell>
                        <TableCell className="max-w-[250px] truncate">
                          {quote.description}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(quote.total)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{quote.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {quote.quoteDate}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell colSpan={3}>Total Opportunities</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(
                          data.pipelineQuotes.reduce(
                            (s, q) => s + q.total,
                            0,
                          ),
                        )}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Unbilled Tab */}
        <TabsContent value="unbilled">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Unbilled Rentals</CardTitle>
                  <CardDescription>
                    {unbilledMonthFilter === "all"
                      ? "Complete orders with no invoice — revenue earned but not yet billed"
                      : dateMode === "rental_period"
                        ? "Unbilled revenue allocated by rental period (pro-rata)"
                        : dateMode === "billing_date"
                          ? "Unbilled revenue grouped by billing date"
                          : "Unbilled revenue grouped by order date"}
                  </CardDescription>
                </div>
                {unbilledMonths.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => setUnbilledMonthFilter("all")}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        unbilledMonthFilter === "all"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      All
                    </button>
                    {unbilledMonths.map(({ key, label, amount }) => (
                      <button
                        key={key}
                        onClick={() => setUnbilledMonthFilter(key)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          unbilledMonthFilter === key
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                        title={formatCurrency(amount)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {filteredUnbilledOrders.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {unbilledMonthFilter === "all" ? "No unbilled rentals found." : "No unbilled rentals for this month."}
                </p>
              ) : (
                (() => {
                  const showAllocation = unbilledMonthFilter !== "all" && dateMode === "rental_period";
                  return (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order #</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Deal</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Rental Dates</TableHead>
                          <TableHead className="text-right">Days Outstanding</TableHead>
                          {showAllocation && <TableHead className="text-right">Order Total</TableHead>}
                          <TableHead className="text-right">{showAllocation ? "Allocated" : "Total"}</TableHead>
                          <TableHead>Type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUnbilledOrders.map((order) => (
                          <TableRow key={order.orderId}>
                            <TableCell className="font-medium">
                              {order.orderNumber}
                            </TableCell>
                            <TableCell>{order.customer}</TableCell>
                            <TableCell className="max-w-[150px] truncate">
                              {order.deal}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate">
                              {order.description}
                            </TableCell>
                            <TableCell className="text-muted-foreground whitespace-nowrap">
                              {order.estimatedStartDate ? `${formatDate(order.estimatedStartDate)} – ${formatDate(order.estimatedStopDate)}` : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {(() => {
                                if (!order.estimatedStopDate) return "—";
                                const end = new Date(order.estimatedStopDate);
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                end.setHours(0, 0, 0, 0);
                                const days = Math.floor((today.getTime() - end.getTime()) / 86400000);
                                return days > 0 ? days : "—";
                              })()}
                            </TableCell>
                            {showAllocation && (
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {formatCurrency(order.total)}
                              </TableCell>
                            )}
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatCurrency(order.allocatedAmount)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {EQUIPMENT_TYPE_LABELS[order.equipmentType] ||
                                  order.equipmentType}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2 font-semibold">
                          <TableCell colSpan={6}>
                            Total {unbilledMonthFilter === "all" ? "Unbilled" : `(${filteredUnbilledOrders.length} orders)`}
                          </TableCell>
                          {showAllocation && (
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {formatCurrency(filteredUnbilledOrders.reduce((s, o) => s + o.total, 0))}
                            </TableCell>
                          )}
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(filteredUnbilledOrders.reduce((s, o) => s + o.allocatedAmount, 0))}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableBody>
                    </Table>
                  );
                })()
              )}
            </CardContent>
          </Card>

          {/* Overdue Active Orders */}
          {data.overdueActiveOrders.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <div>
                  <CardTitle>Overdue Active Orders</CardTitle>
                  <CardDescription>
                    Active orders whose rental period has ended but are not yet marked complete
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {filteredOverdueActiveOrders.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    No overdue active orders for this month.
                  </p>
                ) : (
                  (() => {
                    const showAllocation = unbilledMonthFilter !== "all" && dateMode === "rental_period";
                    return (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Order #</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Deal</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Rental Dates</TableHead>
                            <TableHead className="text-right">Days Outstanding</TableHead>
                            {showAllocation && <TableHead className="text-right">Order Total</TableHead>}
                            <TableHead className="text-right">{showAllocation ? "Allocated" : "Total"}</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredOverdueActiveOrders.map((order) => (
                            <TableRow key={order.orderId}>
                              <TableCell className="font-medium">
                                {order.orderNumber}
                              </TableCell>
                              <TableCell>{order.customer}</TableCell>
                              <TableCell className="max-w-[150px] truncate">
                                {order.deal}
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate">
                                {order.description}
                              </TableCell>
                              <TableCell className="text-muted-foreground whitespace-nowrap">
                                {order.estimatedStartDate ? `${formatDate(order.estimatedStartDate)} – ${formatDate(order.estimatedStopDate)}` : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {(() => {
                                  if (!order.estimatedStopDate) return "—";
                                  const end = new Date(order.estimatedStopDate);
                                  const today = new Date();
                                  today.setHours(0, 0, 0, 0);
                                  end.setHours(0, 0, 0, 0);
                                  const days = Math.floor((today.getTime() - end.getTime()) / 86400000);
                                  return days > 0 ? days : "—";
                                })()}
                              </TableCell>
                              {showAllocation && (
                                <TableCell className="text-right tabular-nums text-muted-foreground">
                                  {formatCurrency(order.total)}
                                </TableCell>
                              )}
                              <TableCell className="text-right font-medium tabular-nums">
                                {formatCurrency(order.allocatedAmount)}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {order.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">
                                  {EQUIPMENT_TYPE_LABELS[order.equipmentType] ||
                                    order.equipmentType}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2 font-semibold">
                            <TableCell colSpan={6}>
                              Total {unbilledMonthFilter === "all" ? "Overdue Active" : `(${filteredOverdueActiveOrders.length} orders)`}
                            </TableCell>
                            {showAllocation && (
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {formatCurrency(filteredOverdueActiveOrders.reduce((s, o) => s + o.total, 0))}
                              </TableCell>
                            )}
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(filteredOverdueActiveOrders.reduce((s, o) => s + o.allocatedAmount, 0))}
                            </TableCell>
                            <TableCell />
                            <TableCell />
                          </TableRow>
                        </TableBody>
                      </Table>
                    );
                  })()
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="space-y-6">
          <InsightsPanel data={data} />
        </TabsContent>

        {/* Trends Tab */}
        <TabsContent value="trends" className="space-y-6">
          <TrendsPanel
            snapshots={snapshots}
            loading={snapshotsLoading}
            onRefresh={fetchSnapshots}
            onSaveSnapshot={saveSnapshot}
            saving={savingSnapshot}
            currentProjected={data.currentMonthProjected}
          />
        </TabsContent>

        {/* Accruals Tab — JE Schedule (always uses invoice_date data) */}
        <TabsContent value="accruals" className="space-y-6">
          {accrualData ? (
            <>
              {dateMode !== "invoice_date" && (
                <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  <strong>Note:</strong> The accrual schedule always uses <strong>Invoice Date</strong> mode to compare billed vs. earned revenue, regardless of the date view selected above.
                </div>
              )}
              <AccrualTab
                entityId={entityId}
                monthlyData={accrualData.monthlyData}
                closedInvoices={accrualData.closedInvoices}
                unbilledEarnedLines={accrualData.unbilledEarnedLines ?? []}
              />
            </>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">Loading accrual data…</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

// ─── Client-side pro-rata allocation (mirrors server-side allocateToMonths) ──

interface InvoiceMonthDetail {
  invoiceId: string;
  invoiceNumber: string;
  customer: string;
  orderDescription: string;
  invoiceDate: string;
  billingStartDate: string;
  billingEndDate: string;
  subTotal: number;
  billedThisMonth: number;
  earnedThisMonth: number;
  adjustment: number; // positive = accrual, negative = deferral
}

function computeEarnedForMonth(
  startDateStr: string | null | undefined,
  endDateStr: string | null | undefined,
  amount: number,
  fallbackDateStr: string | null | undefined,
  targetMonth: string,
): number {
  if (amount === 0) return 0;

  const startDate = startDateStr ? new Date(startDateStr) : null;
  const endDate = endDateStr ? new Date(endDateStr) : null;

  if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate < startDate) {
    return getMonthKey(fallbackDateStr) === targetMonth ? amount : 0;
  }

  const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
  if (totalDays <= 0) {
    return getMonthKey(fallbackDateStr) === targetMonth ? amount : 0;
  }

  const [ty, tm] = targetMonth.split("-").map(Number);
  const monthStart = new Date(ty, tm - 1, 1);
  const monthEnd = new Date(ty, tm, 0);

  const overlapStart = startDate > monthStart ? startDate : monthStart;
  const overlapEnd = endDate < monthEnd ? endDate : monthEnd;
  const daysInMonth = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;

  if (daysInMonth <= 0) return 0;

  const dailyRate = amount / totalDays;
  return Math.round(dailyRate * daysInMonth * 100) / 100;
}

function getInvoiceDetailsForMonth(invoices: ClosedInvoice[], monthKey: string): InvoiceMonthDetail[] {
  const results: InvoiceMonthDetail[] = [];

  for (const inv of invoices) {
    // Only CLOSED/PROCESSED invoices contribute to accrual calc
    if (inv.status !== "CLOSED" && inv.status !== "PROCESSED") continue;

    const billedThisMonth = getMonthKey(inv.invoiceDate) === monthKey ? inv.subTotal : 0;
    const earnedThisMonth = computeEarnedForMonth(
      inv.billingStartDate, inv.billingEndDate,
      inv.subTotal, inv.invoiceDate, monthKey,
    );

    // Skip invoices that don't touch this month at all
    if (billedThisMonth === 0 && earnedThisMonth === 0) continue;

    results.push({
      invoiceId: inv.invoiceId,
      invoiceNumber: inv.invoiceNumber,
      customer: inv.customer,
      orderDescription: inv.orderDescription || inv.orderNumber,
      invoiceDate: inv.invoiceDate,
      billingStartDate: inv.billingStartDate,
      billingEndDate: inv.billingEndDate,
      subTotal: inv.subTotal,
      billedThisMonth,
      earnedThisMonth,
      adjustment: Math.round((earnedThisMonth - billedThisMonth) * 100) / 100,
    });
  }

  // Sort: largest absolute adjustment first
  results.sort((a, b) => Math.abs(b.adjustment) - Math.abs(a.adjustment));
  return results;
}

// ─── AccrualSchedule Component ──────────────────────────────────────────────

function AccrualSchedule({
  monthlyData,
  closedInvoices,
  unbilledEarnedLines = [],
  realizationRate = 1,
}: {
  monthlyData: MonthlyRevenue[];
  closedInvoices: ClosedInvoice[];
  unbilledEarnedLines?: UnbilledEarnedLine[];
  realizationRate?: number;
}) {
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // Only show months that have any billed / earned / unbilled-earned / pending activity
  const activeMonths = monthlyData.filter((m) => m.billed > 0 || m.earned > 0 || m.unbilledEarned > 0 || m.pending > 0);

  // Build a lookup from the full monthlyData array so we can find the prior month
  const monthIndex = new Map<string, MonthlyRevenue>();
  for (const m of monthlyData) monthIndex.set(m.month, m);

  // Get prior month key from a "YYYY-MM" string
  const getPriorMonthKey = (mk: string) => {
    const [y, m] = mk.split("-").map(Number);
    const d = new Date(y, m - 2, 1); // m-1 is current (0-indexed), so m-2 is prior
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  // Compute per-month derived amounts once for reuse in reversal lookup.
  // Pending invoices (NEW/APPROVED in RW) accrue at 100% — no discount applied.
  const derivedByMonth = new Map<string, { totalAccrual: number; totalDeferral: number; unbilledDiscount: number; unbilledNet: number }>();
  for (const m of monthlyData) {
    const unbilledDiscount = Math.round(m.unbilledEarned * (1 - realizationRate) * 100) / 100;
    const unbilledNet = Math.round(m.unbilledEarned * realizationRate * 100) / 100;
    const totalAccrual = Math.round((m.accrued + unbilledNet + m.pending) * 100) / 100;
    derivedByMonth.set(m.month, {
      totalAccrual,
      totalDeferral: m.deferred,
      unbilledDiscount,
      unbilledNet,
    });
  }

  // For each active month, compute reversal (from prior month) and net
  const scheduleRows = activeMonths.map((m) => {
    const priorKey = getPriorMonthKey(m.month);
    const prior = monthIndex.get(priorKey);
    const priorDerived = derivedByMonth.get(priorKey);
    const reversalAccrued = priorDerived?.totalAccrual ?? 0;
    const reversalDeferred = priorDerived?.totalDeferral ?? 0;
    const curDerived = derivedByMonth.get(m.month)!;
    const netRevenueImpact = (curDerived.totalAccrual - curDerived.totalDeferral) - (reversalAccrued - reversalDeferred);
    return {
      ...m,
      unbilledDiscount: curDerived.unbilledDiscount,
      unbilledNet: curDerived.unbilledNet,
      totalAccrual: curDerived.totalAccrual,
      totalDeferral: curDerived.totalDeferral,
      reversalAccrued,
      reversalDeferred,
      netRevenueImpact,
      priorLabel: prior?.label ?? priorKey,
    };
  });

  // Memoize invoice details for the expanded month
  const invoiceDetails = useMemo(() => {
    if (!expandedMonth) return [];
    return getInvoiceDetailsForMonth(closedInvoices, expandedMonth);
  }, [expandedMonth, closedInvoices]);

  // Unbilled earned lines for the expanded month
  const unbilledLinesForExpanded = useMemo(() => {
    if (!expandedMonth) return [];
    return unbilledEarnedLines
      .filter((l) => l.month === expandedMonth)
      .sort((a, b) => b.amountInMonth - a.amountInMonth);
  }, [expandedMonth, unbilledEarnedLines]);

  // Pending invoices (NEW/APPROVED) for the expanded month — grouped by invoice date
  const pendingForExpanded = useMemo(() => {
    if (!expandedMonth) return [];
    return closedInvoices
      .filter((inv) => (inv.status === "NEW" || inv.status === "APPROVED"))
      .filter((inv) => getMonthKey(inv.invoiceDate) === expandedMonth)
      .sort((a, b) => b.subTotal - a.subTotal);
  }, [expandedMonth, closedInvoices]);

  const totals = scheduleRows.reduce(
    (acc, m) => ({
      billed: acc.billed + m.billed,
      earned: acc.earned + m.earned,
      pending: acc.pending + m.pending,
      unbilledEarned: acc.unbilledEarned + m.unbilledEarned,
      unbilledDiscount: acc.unbilledDiscount + m.unbilledDiscount,
      unbilledNet: acc.unbilledNet + m.unbilledNet,
      totalAccrual: acc.totalAccrual + m.totalAccrual,
      totalDeferral: acc.totalDeferral + m.totalDeferral,
      reversalAccrued: acc.reversalAccrued + m.reversalAccrued,
      reversalDeferred: acc.reversalDeferred + m.reversalDeferred,
      netRevenueImpact: acc.netRevenueImpact + m.netRevenueImpact,
    }),
    { billed: 0, earned: 0, pending: 0, unbilledEarned: 0, unbilledDiscount: 0, unbilledNet: 0, totalAccrual: 0, totalDeferral: 0, reversalAccrued: 0, reversalDeferred: 0, netRevenueImpact: 0 },
  );

  const ratePct = Math.round(realizationRate * 1000) / 10;  // e.g. 70.0

  return (
    <>
      {/* Monthly Summary Table */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Accrual & Deferral Schedule</CardTitle>
              <CardDescription>
                Monthly earned vs billed revenue with prior-month reversals — click a row to see invoice + unbilled-order detail
              </CardDescription>
            </div>
            <Badge variant="secondary" className="font-mono">
              <Percent className="mr-1 h-3 w-3" />
              Realization rate: {ratePct}%
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {scheduleRows.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No revenue data available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[30px]" />
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-right border-l border-gray-200">UB Gross</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">UB Net</TableHead>
                    <TableHead className="text-right border-l border-gray-200">Rev Accrual</TableHead>
                    <TableHead className="text-right">Rev Deferral</TableHead>
                    <TableHead className="text-right border-l border-gray-200">New Accrual</TableHead>
                    <TableHead className="text-right">New Deferral</TableHead>
                    <TableHead className="text-right border-l border-gray-200">Net Rev Adj.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scheduleRows.map((m) => {
                    const isExpanded = expandedMonth === m.month;
                    return (
                      <React.Fragment key={m.month}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setExpandedMonth(isExpanded ? null : m.month)}
                        >
                          <TableCell className="text-muted-foreground w-[30px] px-2">
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />
                            }
                          </TableCell>
                          <TableCell className="font-medium">{m.label}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(m.billed)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(m.earned)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sky-700">
                            {m.pending > 0 ? formatCurrency(m.pending) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums border-l border-gray-200 text-muted-foreground">
                            {m.unbilledEarned > 0 ? formatCurrency(m.unbilledEarned) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-rose-500">
                            {m.unbilledDiscount > 0 ? `(${formatCurrency(m.unbilledDiscount)})` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-teal-600">
                            {m.unbilledNet > 0 ? formatCurrency(m.unbilledNet) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-rose-600 border-l border-gray-200">
                            {m.reversalAccrued > 0 ? `(${formatCurrency(m.reversalAccrued)})` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-rose-600">
                            {m.reversalDeferred > 0 ? `(${formatCurrency(m.reversalDeferred)})` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-teal-700 border-l border-gray-200">
                            {m.totalAccrual > 0 ? formatCurrency(m.totalAccrual) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-amber-700">
                            {m.totalDeferral > 0 ? formatCurrency(m.totalDeferral) : "—"}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums font-medium border-l border-gray-200 ${m.netRevenueImpact > 0 ? "text-teal-700" : m.netRevenueImpact < 0 ? "text-amber-700" : ""}`}>
                            {m.netRevenueImpact === 0 ? "—" : formatCurrency(m.netRevenueImpact)}
                          </TableCell>
                        </TableRow>
                        {/* Expanded invoice detail */}
                        {isExpanded && (
                          <TableRow>
                            <TableCell colSpan={13} className="p-0 bg-muted/30">
                              <div className="px-4 py-3">
                                <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                                  Invoice Detail — {m.label} ({invoiceDetails.length} invoices)
                                </h5>
                                {invoiceDetails.length === 0 ? (
                                  <p className="text-muted-foreground text-sm py-2">No invoices touch this month.</p>
                                ) : (
                                  <div className="overflow-x-auto rounded border bg-white">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Invoice #</TableHead>
                                          <TableHead>Customer</TableHead>
                                          <TableHead>Description</TableHead>
                                          <TableHead>Invoice Date</TableHead>
                                          <TableHead>Billing Period</TableHead>
                                          <TableHead className="text-right">Invoice Total</TableHead>
                                          <TableHead className="text-right">Billed This Mo.</TableHead>
                                          <TableHead className="text-right">Earned This Mo.</TableHead>
                                          <TableHead className="text-right">Adjustment</TableHead>
                                          <TableHead>Type</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {invoiceDetails.map((inv) => (
                                          <TableRow key={inv.invoiceId}>
                                            <TableCell className="font-medium text-xs">{inv.invoiceNumber}</TableCell>
                                            <TableCell className="text-xs">{inv.customer}</TableCell>
                                            <TableCell className="text-xs max-w-[160px] truncate">{inv.orderDescription}</TableCell>
                                            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                                              {formatDate(inv.invoiceDate)}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                                              {inv.billingStartDate || inv.billingEndDate
                                                ? `${formatDate(inv.billingStartDate)} – ${formatDate(inv.billingEndDate)}`
                                                : "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                              {formatCurrency(inv.subTotal)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-xs">
                                              {inv.billedThisMonth > 0 ? formatCurrency(inv.billedThisMonth) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-xs">
                                              {inv.earnedThisMonth > 0 ? formatCurrency(inv.earnedThisMonth) : "—"}
                                            </TableCell>
                                            <TableCell className={`text-right tabular-nums text-xs font-medium ${inv.adjustment > 0 ? "text-teal-700" : inv.adjustment < 0 ? "text-amber-700" : ""}`}>
                                              {inv.adjustment === 0 ? "—" : formatCurrency(inv.adjustment)}
                                            </TableCell>
                                            <TableCell>
                                              {inv.adjustment > 0 && (
                                                <Badge className="bg-teal-100 text-teal-800 hover:bg-teal-100 text-[10px] px-1.5 py-0">Accrual</Badge>
                                              )}
                                              {inv.adjustment < 0 && (
                                                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px] px-1.5 py-0">Deferral</Badge>
                                              )}
                                              {inv.adjustment === 0 && (
                                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Matched</Badge>
                                              )}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                        <TableRow className="border-t-2 font-semibold">
                                          <TableCell colSpan={5} className="text-xs">
                                            Total ({invoiceDetails.length} invoices)
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                            {formatCurrency(invoiceDetails.reduce((s, i) => s + i.subTotal, 0))}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-xs">
                                            {formatCurrency(invoiceDetails.reduce((s, i) => s + i.billedThisMonth, 0))}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-xs">
                                            {formatCurrency(invoiceDetails.reduce((s, i) => s + i.earnedThisMonth, 0))}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-xs font-medium">
                                            {formatCurrency(invoiceDetails.reduce((s, i) => s + i.adjustment, 0))}
                                          </TableCell>
                                          <TableCell />
                                        </TableRow>
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}

                                {/* Pending Invoices (NEW/APPROVED in RW, not yet in QB) */}
                                {pendingForExpanded.length > 0 && (
                                  <div className="mt-4">
                                    <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                                      Pending RW Invoices — {m.label} ({pendingForExpanded.length} invoices at 100%, not yet in QuickBooks)
                                    </h5>
                                    <div className="overflow-x-auto rounded border bg-white">
                                      <Table>
                                        <TableHeader>
                                          <TableRow>
                                            <TableHead>Invoice #</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Customer</TableHead>
                                            <TableHead>Description</TableHead>
                                            <TableHead>Invoice Date</TableHead>
                                            <TableHead>Billing Period</TableHead>
                                            <TableHead className="text-right">Amount</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {pendingForExpanded.map((inv) => (
                                            <TableRow key={inv.invoiceId}>
                                              <TableCell className="font-medium text-xs">{inv.invoiceNumber}</TableCell>
                                              <TableCell className="text-xs">
                                                <Badge variant="secondary" className="bg-sky-100 text-sky-800 text-[10px] px-1.5 py-0">{inv.status}</Badge>
                                              </TableCell>
                                              <TableCell className="text-xs">{inv.customer}</TableCell>
                                              <TableCell className="text-xs max-w-[160px] truncate">{inv.orderDescription}</TableCell>
                                              <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                                                {formatDate(inv.invoiceDate)}
                                              </TableCell>
                                              <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                                                {inv.billingStartDate || inv.billingEndDate
                                                  ? `${formatDate(inv.billingStartDate)} – ${formatDate(inv.billingEndDate)}`
                                                  : "—"}
                                              </TableCell>
                                              <TableCell className="text-right tabular-nums text-xs font-medium text-sky-700">
                                                {formatCurrency(inv.subTotal)}
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                          <TableRow className="border-t-2 font-semibold">
                                            <TableCell colSpan={6} className="text-xs">
                                              Total ({pendingForExpanded.length} invoices) — accrues at 100%
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-xs font-medium text-sky-700">
                                              {formatCurrency(pendingForExpanded.reduce((s, i) => s + i.subTotal, 0))}
                                            </TableCell>
                                          </TableRow>
                                        </TableBody>
                                      </Table>
                                    </div>
                                  </div>
                                )}

                                {/* Unbilled Earned Orders for this month */}
                                {unbilledLinesForExpanded.length > 0 && (
                                  <div className="mt-4">
                                    <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                                      Unbilled Earned — {m.label} ({unbilledLinesForExpanded.length} orders at {ratePct}% rate)
                                    </h5>
                                    <div className="overflow-x-auto rounded border bg-white">
                                      <Table>
                                        <TableHeader>
                                          <TableRow>
                                            <TableHead>Order #</TableHead>
                                            <TableHead>Customer</TableHead>
                                            <TableHead>Description</TableHead>
                                            <TableHead>Rental Period</TableHead>
                                            <TableHead className="text-right">Order Total</TableHead>
                                            <TableHead className="text-right">Billed</TableHead>
                                            <TableHead className="text-right">UB Gross (Mo.)</TableHead>
                                            <TableHead className="text-right">Discount</TableHead>
                                            <TableHead className="text-right">UB Net</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {unbilledLinesForExpanded.map((ln) => {
                                            const discount = Math.round(ln.amountInMonth * (1 - realizationRate) * 100) / 100;
                                            const net = Math.round(ln.amountInMonth * realizationRate * 100) / 100;
                                            return (
                                              <TableRow key={`${ln.orderNumber}-${ln.month}`}>
                                                <TableCell className="font-medium text-xs">{ln.orderNumber}</TableCell>
                                                <TableCell className="text-xs">{ln.customer}</TableCell>
                                                <TableCell className="text-xs max-w-[160px] truncate">{ln.orderDescription}</TableCell>
                                                <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                                                  {formatDate(ln.rentalStartDate)} – {formatDate(ln.rentalEndDate)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                                  {formatCurrency(ln.orderTotal)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                                  {ln.billedAgainstOrder > 0 ? formatCurrency(ln.billedAgainstOrder) : "—"}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums text-xs">
                                                  {formatCurrency(ln.amountInMonth)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums text-xs text-rose-500">
                                                  {discount > 0 ? `(${formatCurrency(discount)})` : "—"}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums text-xs font-medium text-teal-700">
                                                  {formatCurrency(net)}
                                                </TableCell>
                                              </TableRow>
                                            );
                                          })}
                                          <TableRow className="border-t-2 font-semibold">
                                            <TableCell colSpan={6} className="text-xs">
                                              Total ({unbilledLinesForExpanded.length} orders)
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-xs">
                                              {formatCurrency(unbilledLinesForExpanded.reduce((s, l) => s + l.amountInMonth, 0))}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-xs text-rose-500">
                                              ({formatCurrency(unbilledLinesForExpanded.reduce((s, l) => s + l.amountInMonth * (1 - realizationRate), 0))})
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-xs font-medium text-teal-700">
                                              {formatCurrency(unbilledLinesForExpanded.reduce((s, l) => s + l.amountInMonth * realizationRate, 0))}
                                            </TableCell>
                                          </TableRow>
                                        </TableBody>
                                      </Table>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell />
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totals.billed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totals.earned)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sky-700">
                      {totals.pending > 0 ? formatCurrency(totals.pending) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums border-l border-gray-200 text-muted-foreground">
                      {totals.unbilledEarned > 0 ? formatCurrency(totals.unbilledEarned) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-500">
                      {totals.unbilledDiscount > 0 ? `(${formatCurrency(totals.unbilledDiscount)})` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-teal-600">
                      {totals.unbilledNet > 0 ? formatCurrency(totals.unbilledNet) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-600 border-l border-gray-200">
                      {totals.reversalAccrued > 0 ? `(${formatCurrency(totals.reversalAccrued)})` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-600">
                      {totals.reversalDeferred > 0 ? `(${formatCurrency(totals.reversalDeferred)})` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-teal-700 border-l border-gray-200">
                      {totals.totalAccrual > 0 ? formatCurrency(totals.totalAccrual) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">
                      {totals.totalDeferral > 0 ? formatCurrency(totals.totalDeferral) : "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-medium border-l border-gray-200 ${totals.netRevenueImpact > 0 ? "text-teal-700" : "text-amber-700"}`}>
                      {formatCurrency(totals.netRevenueImpact)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

    </>
  );
}

function KPICard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-muted-foreground text-xs">{description}</p>
      </CardContent>
    </Card>
  );
}

// ─── Insights Panel ─────────────────────────────────────────────────────────

function InsightsPanel({ data }: { data: RevenueProjectionResponse }) {
  const insights = useMemo(() => {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Month-over-month growth
    const sortedMonths = [...data.monthlyData]
      .filter((m) => m.closed > 0)
      .sort((a, b) => a.month.localeCompare(b.month));
    const lastTwo = sortedMonths.slice(-2);
    let momGrowth: number | null = null;
    let momPrior = 0;
    let momCurrent = 0;
    if (lastTwo.length === 2 && lastTwo[0].closed > 0) {
      momPrior = lastTwo[0].closed;
      momCurrent = lastTwo[1].closed;
      momGrowth = ((momCurrent - momPrior) / momPrior) * 100;
    }

    // Top customers by revenue
    const customerRevenue = new Map<string, number>();
    for (const inv of data.closedInvoices) {
      const key = inv.customer || "Unknown";
      customerRevenue.set(key, (customerRevenue.get(key) ?? 0) + inv.subTotal);
    }
    const topCustomers = Array.from(customerRevenue.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const totalInvoiceRevenue = data.closedInvoices.reduce((s, i) => s + i.subTotal, 0);

    // Revenue concentration — top customer %
    const topCustomerPct =
      topCustomers.length > 0 && totalInvoiceRevenue > 0
        ? (topCustomers[0][1] / totalInvoiceRevenue) * 100
        : 0;

    // Annualized run rate from current month projected
    const annualRunRate = data.currentMonthProjected * 12;

    // Days remaining in month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();
    const daysRemaining = daysInMonth - daysElapsed;

    // Daily run rate this month
    const dailyRate = daysElapsed > 0 ? data.currentMonthActual / daysElapsed : 0;
    const projectedAtCurrentPace = dailyRate * daysInMonth;

    // Pipeline conversion — if all pipeline converts
    const pipelineUpsidePct =
      data.currentMonthActual > 0
        ? (data.pipelineValue / data.currentMonthActual) * 100
        : 0;

    // Best month in last 12
    const bestMonth = sortedMonths.reduce(
      (best, m) => (m.closed > best.closed ? m : best),
      sortedMonths[0] ?? { month: "", label: "N/A", closed: 0 },
    );

    // Average monthly revenue
    const avgMonthly =
      sortedMonths.length > 0
        ? sortedMonths.reduce((s, m) => s + m.closed, 0) / sortedMonths.length
        : 0;

    // Current month vs average
    const vsAvgPct =
      avgMonthly > 0
        ? ((data.currentMonthActual - avgMonthly) / avgMonthly) * 100
        : 0;

    // Equipment type with highest revenue
    const topEquipment = data.equipmentBreakdown.length > 0
      ? data.equipmentBreakdown.reduce((best, e) => (e.amount > best.amount ? e : best), data.equipmentBreakdown[0])
      : null;

    return {
      momGrowth,
      momPrior,
      momCurrent,
      topCustomers,
      totalInvoiceRevenue,
      topCustomerPct,
      annualRunRate,
      daysRemaining,
      daysInMonth,
      daysElapsed,
      dailyRate,
      projectedAtCurrentPace,
      pipelineUpsidePct,
      bestMonth,
      avgMonthly,
      vsAvgPct,
      topEquipment,
      currentMonthKey,
    };
  }, [data]);

  const TrendIcon = ({ value }: { value: number }) => {
    if (value > 0) return <ArrowUpRight className="h-4 w-4 text-emerald-600" />;
    if (value < 0) return <ArrowDownRight className="h-4 w-4 text-rose-600" />;
    return <Minus className="h-4 w-4 text-gray-400" />;
  };

  return (
    <>
      {/* Key Metrics Row */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Month-over-Month Growth
              <TrendIcon value={insights.momGrowth ?? 0} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {insights.momGrowth !== null ? (
              <>
                <div className={`text-2xl font-bold ${insights.momGrowth >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {insights.momGrowth >= 0 ? "+" : ""}{insights.momGrowth.toFixed(1)}%
                </div>
                <p className="text-muted-foreground text-xs mt-1">
                  {formatCurrency(insights.momPrior)} → {formatCurrency(insights.momCurrent)}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Need 2+ months of data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Annualized Run Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(insights.annualRunRate)}</div>
            <p className="text-muted-foreground text-xs mt-1">
              Based on {formatCurrency(data.currentMonthProjected)}/mo projected
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Pacing This Month
              <TrendIcon value={insights.vsAvgPct} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(insights.projectedAtCurrentPace)}</div>
            <p className="text-muted-foreground text-xs mt-1">
              {formatCurrency(insights.dailyRate)}/day &middot; {insights.daysElapsed}d elapsed, {insights.daysRemaining}d remaining
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Insights */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Top Customers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top Customers by Revenue</CardTitle>
            <CardDescription>Invoiced revenue concentration</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {insights.topCustomers.map(([customer, revenue], i) => {
                const pct = insights.totalInvoiceRevenue > 0 ? (revenue / insights.totalInvoiceRevenue) * 100 : 0;
                return (
                  <div key={customer}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate max-w-[200px]">
                        {i + 1}. {customer}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(revenue)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right tabular-nums">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {insights.topCustomerPct > 40 && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <strong>Concentration risk:</strong> Top customer accounts for {insights.topCustomerPct.toFixed(0)}% of revenue
              </div>
            )}
          </CardContent>
        </Card>

        {/* Key Metrics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Performance Summary</CardTitle>
            <CardDescription>Key revenue indicators</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Current Month vs. Average</span>
                <span className={`text-sm font-semibold ${insights.vsAvgPct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {insights.vsAvgPct >= 0 ? "+" : ""}{insights.vsAvgPct.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Monthly Average (trailing)</span>
                <span className="text-sm font-semibold tabular-nums">{formatCurrency(insights.avgMonthly)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Best Month</span>
                <span className="text-sm font-semibold tabular-nums">
                  {insights.bestMonth.label} — {formatCurrency(insights.bestMonth.closed)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Pipeline Upside</span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(data.pipelineValue)} ({insights.pipelineUpsidePct.toFixed(0)}% of actual)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Quote Opportunities</span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(data.quoteOpportunities)} ({data.pipelineQuotes.length} quotes)
                </span>
              </div>
              {insights.topEquipment && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Top Equipment Category</span>
                  <span className="text-sm font-semibold">
                    {insights.topEquipment.label} ({insights.topEquipment.percentage.toFixed(0)}%)
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Highlights */}
      {data.pipelineOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Largest Pipeline Deals</CardTitle>
            <CardDescription>Top open orders by value</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.pipelineOrders]
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 5)
                  .map((order) => (
                    <TableRow key={order.orderId}>
                      <TableCell className="font-medium">{order.orderNumber}</TableCell>
                      <TableCell>{order.customer}</TableCell>
                      <TableCell className="max-w-[250px] truncate">{order.description}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatCurrency(order.total)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{order.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ─── Trends Panel ───────────────────────────────────────────────────────────

function TrendsPanel({
  snapshots,
  loading,
  onRefresh,
  onSaveSnapshot,
  saving,
  currentProjected,
}: {
  snapshots: SnapshotRow[];
  loading: boolean;
  onRefresh: () => void;
  onSaveSnapshot: () => void;
  saving: boolean;
  currentProjected: number;
}) {
  // Group snapshots by date, summing revenue section
  const chartData = useMemo(() => {
    const byDate = new Map<string, { revenue: number; pipeline: number; ytd: number }>();
    for (const s of snapshots) {
      if (!byDate.has(s.snapshot_date)) {
        byDate.set(s.snapshot_date, { revenue: 0, pipeline: 0, ytd: 0 });
      }
      const entry = byDate.get(s.snapshot_date)!;
      if (s.section_id === "revenue") entry.revenue = Number(s.projected_amount);
      else if (s.section_id === "pipeline") entry.pipeline = Number(s.projected_amount);
      else if (s.section_id === "ytd") entry.ytd = Number(s.projected_amount);
    }

    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, values]) => ({
        date,
        label: new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        ...values,
      }));
  }, [snapshots]);

  // Calculate day-over-day changes
  const changes = useMemo(() => {
    if (chartData.length < 2) return [];
    return chartData.slice(1).map((cur, i) => {
      const prev = chartData[i];
      const delta = cur.revenue - prev.revenue;
      const pct = prev.revenue !== 0 ? (delta / prev.revenue) * 100 : 0;
      return { ...cur, delta, pct, prevRevenue: prev.revenue };
    });
  }, [chartData]);

  const now = new Date();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading trend data...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Projection Trend — {monthLabel}</CardTitle>
              <CardDescription>
                How the projected revenue for this month has changed day over day
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={onSaveSnapshot} variant="outline" size="sm" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Today
              </Button>
              <Button onClick={onRefresh} variant="ghost" size="sm">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Calendar className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">No snapshots yet for {monthLabel}.</p>
              <p className="text-muted-foreground text-xs mt-1">
                Click &quot;Save Today&quot; to capture today&apos;s projection ({formatCurrency(currentProjected)}) and start tracking.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={formatCompact} className="text-xs" tick={{ fontSize: 12 }} />
                <RechartsTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-lg border bg-white px-3 py-2 shadow-lg text-sm" style={{ zIndex: 50 }}>
                        <p className="font-semibold text-gray-900 mb-1.5">{label}</p>
                        {payload.map((entry) => (
                          <div key={entry.dataKey as string} className="flex items-center justify-between gap-6">
                            <span className="text-gray-500 capitalize">{entry.dataKey as string}</span>
                            <span className="font-medium tabular-nums">{formatCurrency(entry.value as number)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ zIndex: 50, pointerEvents: "none" }}
                />
                <Legend />
                <Bar dataKey="revenue" name="Projected Revenue" fill="#2563eb" radius={[3, 3, 0, 0]} />
                <Line dataKey="pipeline" name="Pipeline" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Day-over-Day Changes Table */}
      {changes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Daily Changes</CardTitle>
            <CardDescription>Day-over-day projection movement</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Previous</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">% Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...changes].reverse().map((row) => (
                  <TableRow key={row.date}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCurrency(row.prevRevenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatCurrency(row.revenue)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${row.delta > 0 ? "text-emerald-700" : row.delta < 0 ? "text-rose-700" : ""}`}>
                      {row.delta > 0 ? "+" : ""}{formatCurrency(row.delta)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${row.pct > 0 ? "text-emerald-700" : row.pct < 0 ? "text-rose-700" : ""}`}>
                      {row.pct > 0 ? "+" : ""}{row.pct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* All Snapshots */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Snapshot History</CardTitle>
            <CardDescription>All saved snapshots for {monthLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Projected Revenue</TableHead>
                  <TableHead className="text-right">Pipeline</TableHead>
                  <TableHead className="text-right">YTD Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...chartData].reverse().map((row) => (
                  <TableRow key={row.date}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {row.revenue > 0 ? formatCurrency(row.revenue) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.pipeline > 0 ? formatCurrency(row.pipeline) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.ytd > 0 ? formatCurrency(row.ytd) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ─── AccrualTab (Phase 1–3 wrapper) ─────────────────────────────────────────

interface AccrualCloseRow {
  id: string;
  entity_id: string;
  period_year: number;
  period_month: number;
  close_as_of_date: string;
  realization_rate_used: number;
  gross_unbilled_earned: number;
  expected_discount: number;
  net_unbilled_earned: number;
  timing_accrual: number;
  timing_deferral: number;
  total_net_accrual: number;
  total_net_deferral: number;
  line_count: number;
  notes: string | null;
  closed_at: string;
  closed_by: string | null;
  status: string;
}

interface AccrualCloseLine {
  id: string;
  close_period_id: string;
  entity_id: string;
  line_type: string;
  order_number: string | null;
  invoice_number: string | null;
  customer: string | null;
  order_description: string | null;
  rental_start_date: string | null;
  rental_end_date: string | null;
  gross_amount: number;
  realization_rate_applied: number;
  expected_discount: number;
  net_amount: number;
  matched_invoice_number: string | null;
  matched_invoice_date: string | null;
  actual_invoice_subtotal: number | null;
  variance_amount: number | null;
  line_status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  writeoff_notes: string | null;
  created_at: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function AccrualTab({
  entityId,
  monthlyData,
  closedInvoices,
  unbilledEarnedLines,
}: {
  entityId: string;
  monthlyData: MonthlyRevenue[];
  closedInvoices: ClosedInvoice[];
  unbilledEarnedLines: UnbilledEarnedLine[];
}) {
  const [rate, setRate] = useState<number>(1);
  const [rateNotes, setRateNotes] = useState<string | null>(null);
  const [rateLoaded, setRateLoaded] = useState(false);
  const [closes, setCloses] = useState<AccrualCloseRow[]>([]);
  const [closesLoading, setClosesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accrual/config?entityId=${encodeURIComponent(entityId)}`);
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        if (!cancelled) {
          setRate(json.realizationRate ?? 1);
          setRateNotes(json.notes ?? null);
          setRateLoaded(true);
        }
      } catch (err) {
        console.error("Load accrual config error:", err);
        if (!cancelled) setRateLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [entityId]);

  const loadCloses = useCallback(async () => {
    setClosesLoading(true);
    try {
      const res = await fetch(`/api/accrual/closes?entityId=${encodeURIComponent(entityId)}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setCloses(json.closes ?? []);
    } catch (err) {
      console.error("Load closes error:", err);
    } finally {
      setClosesLoading(false);
    }
  }, [entityId]);

  useEffect(() => { loadCloses(); }, [loadCloses]);

  const saveRate = async (newRate: number, newNotes: string | null) => {
    try {
      const res = await fetch("/api/accrual/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, realizationRate: newRate, notes: newNotes }),
      });
      if (!res.ok) throw new Error(await res.text());
      setRate(newRate);
      setRateNotes(newNotes);
      toast.success("Realization rate saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save rate");
    }
  };

  if (!rateLoaded) {
    return <p className="text-muted-foreground py-8 text-center text-sm">Loading accrual config…</p>;
  }

  const closedPeriodKeys = new Set(
    closes.map((c) => `${c.period_year}-${String(c.period_month).padStart(2, "0")}`),
  );

  return (
    <>
      <RealizationRateCard rate={rate} notes={rateNotes} onSave={saveRate} />
      <AccrualSchedule
        monthlyData={monthlyData}
        closedInvoices={closedInvoices}
        unbilledEarnedLines={unbilledEarnedLines}
        realizationRate={rate}
      />
      <CloseMonthSection
        entityId={entityId}
        rate={rate}
        monthlyData={monthlyData}
        unbilledEarnedLines={unbilledEarnedLines}
        pendingInvoices={closedInvoices.filter((inv) => inv.status === "NEW" || inv.status === "APPROVED")}
        closedPeriodKeys={closedPeriodKeys}
        onClosed={loadCloses}
      />
      <HistoricalClosesSection closes={closes} loading={closesLoading} onRefresh={loadCloses} />
      <GLAccountAccrualSection entityId={entityId} />
    </>
  );
}

function RealizationRateCard({
  rate,
  notes,
  onSave,
}: {
  rate: number;
  notes: string | null;
  onSave: (rate: number, notes: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [pctInput, setPctInput] = useState(String(Math.round(rate * 1000) / 10));
  const [notesInput, setNotesInput] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPctInput(String(Math.round(rate * 1000) / 10));
    setNotesInput(notes ?? "");
  }, [rate, notes]);

  const handleSave = async () => {
    const pct = Number(pctInput);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      toast.error("Enter a percentage between 0 and 100");
      return;
    }
    setSaving(true);
    await onSave(pct / 100, notesInput.trim() || null);
    setSaving(false);
    setEditing(false);
  };

  const ratePct = Math.round(rate * 1000) / 10;
  const discountPct = Math.round((1 - rate) * 1000) / 10;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Percent className="h-5 w-5" />
              Realization Rate Rule
            </CardTitle>
            <CardDescription>
              Expected collection rate on unbilled earned revenue. Applies the ASC 606 variable-consideration estimate as a reduction to accrued revenue.
            </CardDescription>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!editing ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Realization Rate</div>
              <div className="text-2xl font-bold tabular-nums">{ratePct}%</div>
              <div className="text-xs text-muted-foreground mt-0.5">Applied to unbilled earned revenue</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Expected Discount</div>
              <div className="text-2xl font-bold tabular-nums text-rose-600">{discountPct}%</div>
              <div className="text-xs text-muted-foreground mt-0.5">Booked as contra-revenue allowance</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Basis Notes</div>
              <div className="text-sm">{notes?.trim() || <span className="text-muted-foreground italic">None</span>}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="rate-input">Realization Rate (%)</Label>
                <Input
                  id="rate-input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={pctInput}
                  onChange={(e) => setPctInput(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  0–100. Example: 70 means you expect to collect 70% of list-rate rental revenue on orders that haven&apos;t been invoiced yet.
                </p>
              </div>
              <div>
                <Label htmlFor="rate-notes">Basis / Notes</Label>
                <Textarea
                  id="rate-notes"
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="e.g. Based on 2025 actuals: avg 28% discount on non-contract rentals"
                  className="mt-1"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Rule
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface CloseLinePreview {
  lineType: "unbilled_earned" | "timing_accrual" | "timing_deferral" | "pending_invoice";
  orderNumber?: string;
  invoiceNumber?: string;
  customer?: string;
  orderDescription?: string;
  rentalStartDate?: string;
  rentalEndDate?: string;
  grossAmount: number;
  realizationRateApplied: number;
  expectedDiscount: number;
  netAmount: number;
}

function CloseMonthSection({
  entityId,
  rate,
  monthlyData,
  unbilledEarnedLines,
  pendingInvoices,
  closedPeriodKeys,
  onClosed,
}: {
  entityId: string;
  rate: number;
  monthlyData: MonthlyRevenue[];
  unbilledEarnedLines: UnbilledEarnedLine[];
  pendingInvoices: ClosedInvoice[];
  closedPeriodKeys: Set<string>;
  onClosed: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [closeAsOfDate, setCloseAsOfDate] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const candidateMonths = useMemo(() => {
    return monthlyData
      .filter((m) => m.billed > 0 || m.earned > 0 || m.unbilledEarned > 0 || m.pending > 0)
      .filter((m) => !closedPeriodKeys.has(m.month))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [monthlyData, closedPeriodKeys]);

  useEffect(() => {
    if (!selectedMonth) return;
    const [y, m] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0);
    const dateStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
    setCloseAsOfDate(dateStr);
  }, [selectedMonth]);

  const openDialog = () => {
    if (candidateMonths.length === 0) {
      toast.error("No open periods to close");
      return;
    }
    setSelectedMonth(candidateMonths[0].month);
    setNotes("");
    setDialogOpen(true);
  };

  const previewLines: CloseLinePreview[] = useMemo(() => {
    if (!selectedMonth) return [];
    const month = monthlyData.find((m) => m.month === selectedMonth);
    if (!month) return [];

    const lines: CloseLinePreview[] = [];

    if (month.accrued > 0) {
      lines.push({
        lineType: "timing_accrual",
        customer: "Timing adjustment (invoiced)",
        orderDescription: `Earned > billed in ${month.label}`,
        grossAmount: month.accrued,
        realizationRateApplied: 1,
        expectedDiscount: 0,
        netAmount: month.accrued,
      });
    }
    if (month.deferred > 0) {
      lines.push({
        lineType: "timing_deferral",
        customer: "Timing adjustment (invoiced)",
        orderDescription: `Billed > earned in ${month.label}`,
        grossAmount: month.deferred,
        realizationRateApplied: 1,
        expectedDiscount: 0,
        netAmount: month.deferred,
      });
    }

    // Pending RW invoices — 100% face value, no realization discount
    const pendingForMonth = pendingInvoices.filter(
      (inv) => (inv.status === "NEW" || inv.status === "APPROVED") && getMonthKey(inv.invoiceDate) === selectedMonth,
    );
    for (const inv of pendingForMonth) {
      lines.push({
        lineType: "pending_invoice",
        invoiceNumber: inv.invoiceNumber,
        orderNumber: inv.orderNumber || undefined,
        customer: inv.customer,
        orderDescription: inv.orderDescription,
        rentalStartDate: inv.billingStartDate ? inv.billingStartDate.slice(0, 10) : undefined,
        rentalEndDate: inv.billingEndDate ? inv.billingEndDate.slice(0, 10) : undefined,
        grossAmount: inv.subTotal,
        realizationRateApplied: 1,
        expectedDiscount: 0,
        netAmount: inv.subTotal,
      });
    }

    const ubForMonth = unbilledEarnedLines.filter((l) => l.month === selectedMonth);
    for (const ln of ubForMonth) {
      const discount = Math.round(ln.amountInMonth * (1 - rate) * 100) / 100;
      const net = Math.round(ln.amountInMonth * rate * 100) / 100;
      lines.push({
        lineType: "unbilled_earned",
        orderNumber: ln.orderNumber,
        customer: ln.customer,
        orderDescription: ln.orderDescription,
        rentalStartDate: ln.rentalStartDate.slice(0, 10),
        rentalEndDate: ln.rentalEndDate.slice(0, 10),
        grossAmount: ln.amountInMonth,
        realizationRateApplied: rate,
        expectedDiscount: discount,
        netAmount: net,
      });
    }
    return lines;
  }, [selectedMonth, monthlyData, unbilledEarnedLines, pendingInvoices, rate]);

  const previewTotals = previewLines.reduce(
    (acc, l) => ({
      gross: acc.gross + (l.lineType === "timing_deferral" ? 0 : l.grossAmount),
      discount: acc.discount + l.expectedDiscount,
      netAccrual: acc.netAccrual + (l.lineType === "timing_accrual" || l.lineType === "unbilled_earned" || l.lineType === "pending_invoice" ? l.netAmount : 0),
      netDeferral: acc.netDeferral + (l.lineType === "timing_deferral" ? l.netAmount : 0),
      pending: acc.pending + (l.lineType === "pending_invoice" ? l.netAmount : 0),
    }),
    { gross: 0, discount: 0, netAccrual: 0, netDeferral: 0, pending: 0 },
  );

  const submitClose = async () => {
    if (!selectedMonth || !closeAsOfDate) return;
    const [y, m] = selectedMonth.split("-").map(Number);
    setSubmitting(true);
    try {
      const res = await fetch("/api/accrual/closes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          periodYear: y,
          periodMonth: m,
          closeAsOfDate,
          realizationRate: rate,
          lines: previewLines,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`${MONTH_NAMES[m - 1]} ${y} books closed`);
      setDialogOpen(false);
      onClosed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Close failed");
    } finally {
      setSubmitting(false);
    }
  };

  const [selectedY, selectedM] = selectedMonth ? selectedMonth.split("-").map(Number) : [0, 0];
  const selectedLabel = selectedMonth ? `${MONTH_NAMES[selectedM - 1]} ${selectedY}` : "";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Close Month
            </CardTitle>
            <CardDescription>
              Lock the accrual journal entry for a specific period. Once closed, lines become the baseline for variance tracking against actual invoices.
            </CardDescription>
          </div>
          <Button onClick={openDialog} disabled={candidateMonths.length === 0}>
            <Lock className="mr-2 h-4 w-4" />
            Close a Period
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {candidateMonths.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            All months with activity are already closed.
          </p>
        ) : (
          <div className="text-sm text-muted-foreground">
            {candidateMonths.length} open period{candidateMonths.length === 1 ? "" : "s"} available to close: {candidateMonths.slice(0, 6).map((m) => m.label).join(", ")}
            {candidateMonths.length > 6 && "…"}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Close {selectedLabel} Books</DialogTitle>
            <DialogDescription>
              Review the preview below. Once saved, this close is immutable — adjustments go through the next period as a true-up.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="period-select">Period</Label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger id="period-select" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {candidateMonths.map((m) => (
                      <SelectItem key={m.month} value={m.month}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="close-date">Close As Of Date</Label>
                <Input
                  id="close-date"
                  type="date"
                  value={closeAsOfDate}
                  onChange={(e) => setCloseAsOfDate(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  JE will be dated as of this date. Defaults to month-end; change if closing later.
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="close-notes">Notes (optional)</Label>
              <Textarea
                id="close-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Closed after receiving final pricing adjustment from Client X"
                className="mt-1"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Gross Unbilled</div>
                <div className="text-lg font-semibold tabular-nums">{formatCurrency(previewTotals.gross)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Expected Discount</div>
                <div className="text-lg font-semibold tabular-nums text-rose-600">({formatCurrency(previewTotals.discount)})</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Net Accrual (Dr.)</div>
                <div className="text-lg font-semibold tabular-nums text-teal-700">{formatCurrency(previewTotals.netAccrual)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Net Deferral (Cr.)</div>
                <div className="text-lg font-semibold tabular-nums text-amber-700">{formatCurrency(previewTotals.netDeferral)}</div>
              </div>
            </div>

            <div>
              <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Journal Entry Preview (for QuickBooks manual entry)
              </h5>
              <div className="rounded border bg-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Memo</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const timing = previewLines.filter(l => l.lineType === "timing_accrual").reduce((s, l) => s + l.netAmount, 0);
                      const pendingTotal = previewLines.filter(l => l.lineType === "pending_invoice").reduce((s, l) => s + l.netAmount, 0);
                      const unbilledGross = previewLines.filter(l => l.lineType === "unbilled_earned").reduce((s, l) => s + l.grossAmount, 0);
                      const unbilledNet = previewLines.filter(l => l.lineType === "unbilled_earned").reduce((s, l) => s + l.netAmount, 0);
                      const discount = previewLines.filter(l => l.lineType === "unbilled_earned").reduce((s, l) => s + l.expectedDiscount, 0);
                      return (
                        <>
                          {timing > 0 && (
                            <>
                              <TableRow>
                                <TableCell className="font-medium">Accrued Revenue (Asset)</TableCell>
                                <TableCell className="text-sm text-muted-foreground">Timing accrual — {selectedLabel}</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatCurrency(timing)}</TableCell>
                                <TableCell className="text-right">—</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell className="font-medium">Rental Revenue (Income)</TableCell>
                                <TableCell className="text-sm text-muted-foreground">Timing accrual — {selectedLabel}</TableCell>
                                <TableCell className="text-right">—</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatCurrency(timing)}</TableCell>
                              </TableRow>
                            </>
                          )}
                          {pendingTotal > 0 && (
                            <>
                              <TableRow>
                                <TableCell className="font-medium">Unbilled Receivables (Asset)</TableCell>
                                <TableCell className="text-sm text-muted-foreground">Pending RW invoices (not yet in QuickBooks) — {selectedLabel}</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatCurrency(pendingTotal)}</TableCell>
                                <TableCell className="text-right">—</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell className="font-medium">Rental Revenue (Income)</TableCell>
                                <TableCell className="text-sm text-muted-foreground">Pending invoices at 100% — {selectedLabel}</TableCell>
                                <TableCell className="text-right">—</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatCurrency(pendingTotal)}</TableCell>
                              </TableRow>
                            </>
                          )}
                          {unbilledGross > 0 && (
                            <>
                              <TableRow>
                                <TableCell className="font-medium">Unbilled Receivables (Asset)</TableCell>
                                <TableCell className="text-sm text-muted-foreground">Earned, not yet invoiced — {selectedLabel}</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatCurrency(unbilledGross)}</TableCell>
                                <TableCell className="text-right">—</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell className="font-medium">Rental Revenue (Income)</TableCell>
                                <TableCell className="text-sm text-muted-foreground">Net of expected discount @ {Math.round(rate * 1000) / 10}%</TableCell>
                                <TableCell className="text-right">—</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatCurrency(unbilledNet)}</TableCell>
                              </TableRow>
                              {discount > 0 && (
                                <TableRow>
                                  <TableCell className="font-medium">Allowance for Discounts (Contra-Revenue)</TableCell>
                                  <TableCell className="text-sm text-muted-foreground">Expected customer discount</TableCell>
                                  <TableCell className="text-right">—</TableCell>
                                  <TableCell className="text-right tabular-nums font-medium">{formatCurrency(discount)}</TableCell>
                                </TableRow>
                              )}
                            </>
                          )}
                          {previewTotals.netDeferral > 0 && (
                            <>
                              <TableRow>
                                <TableCell className="font-medium">Rental Revenue (Income)</TableCell>
                                <TableCell className="text-sm text-muted-foreground">Timing deferral — {selectedLabel}</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatCurrency(previewTotals.netDeferral)}</TableCell>
                                <TableCell className="text-right">—</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell className="font-medium">Deferred Revenue (Liability)</TableCell>
                                <TableCell className="text-sm text-muted-foreground">Timing deferral — {selectedLabel}</TableCell>
                                <TableCell className="text-right">—</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatCurrency(previewTotals.netDeferral)}</TableCell>
                              </TableRow>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div>
              <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Source Lines ({previewLines.length})
              </h5>
              <div className="rounded border bg-white max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Order</TableHead>
                      <TableHead className="text-xs">Customer</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="text-right text-xs">Gross</TableHead>
                      <TableHead className="text-right text-xs">Discount</TableHead>
                      <TableHead className="text-right text-xs">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewLines.map((l, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-xs">
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {l.lineType === "unbilled_earned" ? "UB Earned"
                              : l.lineType === "timing_accrual" ? "Timing Acc"
                              : l.lineType === "timing_deferral" ? "Timing Def"
                              : "Pending Inv"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-medium">{l.invoiceNumber ?? l.orderNumber ?? "—"}</TableCell>
                        <TableCell className="text-xs">{l.customer ?? "—"}</TableCell>
                        <TableCell className="text-xs max-w-[220px] truncate">{l.orderDescription ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{formatCurrency(l.grossAmount)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-rose-500">
                          {l.expectedDiscount > 0 ? `(${formatCurrency(l.expectedDiscount)})` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums font-medium">{formatCurrency(l.netAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={submitClose} disabled={submitting || previewLines.length === 0}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
              Lock {selectedLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function HistoricalClosesSection({
  closes,
  loading,
  onRefresh,
}: {
  closes: AccrualCloseRow[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Closed Periods</CardTitle>
            <CardDescription>
              Each closed period locks the accrual JE as the baseline. Expand a row to see variance against actual invoices.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>
        ) : closes.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">No closed periods yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30px]" />
                  <TableHead>Period</TableHead>
                  <TableHead>Closed As Of</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-right">Net Accrual</TableHead>
                  <TableHead className="text-right">Net Deferral</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closes.map((c) => {
                  const isExpanded = expandedId === c.id;
                  const label = `${MONTH_NAMES[c.period_month - 1]} ${c.period_year}`;
                  return (
                    <React.Fragment key={c.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(isExpanded ? null : c.id)}
                      >
                        <TableCell className="text-muted-foreground">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-medium">{label}</TableCell>
                        <TableCell className="text-muted-foreground">{c.close_as_of_date}</TableCell>
                        <TableCell className="tabular-nums">{Math.round(c.realization_rate_used * 1000) / 10}%</TableCell>
                        <TableCell className="text-right tabular-nums text-teal-700">
                          {c.total_net_accrual > 0 ? formatCurrency(c.total_net_accrual) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700">
                          {c.total_net_deferral > 0 ? formatCurrency(c.total_net_deferral) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.line_count}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === "closed" ? "secondary" : "outline"} className="text-[10px]">
                            <Lock className="h-3 w-3 mr-1" />
                            {c.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={8} className="p-0 bg-muted/30">
                            <ClosePeriodDetail closeId={c.id} closeRecord={c} />
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClosePeriodDetail({
  closeId,
  closeRecord,
}: {
  closeId: string;
  closeRecord: AccrualCloseRow;
}) {
  const [lines, setLines] = useState<AccrualCloseLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);

  const loadLines = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/accrual/closes/${closeId}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setLines(json.lines ?? []);
    } catch (err) {
      console.error("Load close detail error:", err);
    } finally {
      setLoading(false);
    }
  }, [closeId]);

  useEffect(() => { loadLines(); }, [loadLines]);

  const runMatching = async () => {
    setMatching(true);
    try {
      const res = await fetch(`/api/accrual/closes/${closeId}/match`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      toast.success(`Matched ${json.matched} of ${json.checked} unresolved lines`);
      await loadLines();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Matching failed");
    } finally {
      setMatching(false);
    }
  };

  const writeOff = async (lineId: string) => {
    const notes = window.prompt("Write-off reason:") ?? null;
    if (notes === null) return;
    try {
      const res = await fetch(`/api/accrual/closes/${closeId}/writeoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId, notes }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Line written off");
      await loadLines();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Write-off failed");
    }
  };

  const summary = useMemo(() => {
    const res = {
      accrued: 0,
      invoiced: 0,
      writtenOff: 0,
      actualTotal: 0,
      varianceTotal: 0,
    };
    for (const l of lines) {
      if (l.line_status === "accrued") res.accrued += 1;
      else if (l.line_status === "invoiced") res.invoiced += 1;
      else if (l.line_status === "written_off") res.writtenOff += 1;
      res.actualTotal += l.actual_invoice_subtotal ?? 0;
      res.varianceTotal += l.variance_amount ?? 0;
    }
    return res;
  }, [lines]);

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Closed on {formatDate(closeRecord.closed_at)} {closeRecord.notes ? `· "${closeRecord.notes}"` : ""}
        </div>
        <Button variant="outline" size="sm" onClick={runMatching} disabled={matching}>
          {matching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          Match Against Current Invoices
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="rounded border bg-white p-2">
          <div className="text-[10px] uppercase text-muted-foreground">Locked Net</div>
          <div className="text-sm font-semibold">{formatCurrency(closeRecord.total_net_accrual)}</div>
        </div>
        <div className="rounded border bg-white p-2">
          <div className="text-[10px] uppercase text-muted-foreground">Actually Invoiced</div>
          <div className="text-sm font-semibold text-teal-700">{formatCurrency(summary.actualTotal)}</div>
          <div className="text-[10px] text-muted-foreground">{summary.invoiced} of {lines.length}</div>
        </div>
        <div className="rounded border bg-white p-2">
          <div className="text-[10px] uppercase text-muted-foreground">Variance</div>
          <div className={`text-sm font-semibold ${summary.varianceTotal >= 0 ? "text-teal-700" : "text-amber-700"}`}>
            {summary.varianceTotal >= 0 ? "+" : ""}{formatCurrency(summary.varianceTotal)}
          </div>
        </div>
        <div className="rounded border bg-white p-2">
          <div className="text-[10px] uppercase text-muted-foreground">Still Unresolved</div>
          <div className="text-sm font-semibold">{summary.accrued}</div>
        </div>
        <div className="rounded border bg-white p-2">
          <div className="text-[10px] uppercase text-muted-foreground">Written Off</div>
          <div className="text-sm font-semibold text-rose-600">{summary.writtenOff}</div>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading lines…</p>
      ) : lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">No lines.</p>
      ) : (
        <div className="rounded border bg-white overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Order</TableHead>
                <TableHead className="text-xs">Customer</TableHead>
                <TableHead className="text-xs">Description</TableHead>
                <TableHead className="text-right text-xs">Net Accrued</TableHead>
                <TableHead className="text-right text-xs">Actual Invoiced</TableHead>
                <TableHead className="text-right text-xs">Variance</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs font-medium">{l.order_number ?? l.invoice_number ?? "—"}</TableCell>
                  <TableCell className="text-xs">{l.customer ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">
                    {l.order_description ?? "—"}
                    {l.writeoff_notes && <div className="text-[10px] text-rose-600 italic">Write-off: {l.writeoff_notes}</div>}
                    {l.matched_invoice_number && <div className="text-[10px] text-teal-600">Inv: {l.matched_invoice_number}</div>}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{formatCurrency(l.net_amount)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {l.actual_invoice_subtotal !== null ? formatCurrency(l.actual_invoice_subtotal) : "—"}
                  </TableCell>
                  <TableCell className={`text-right text-xs tabular-nums font-medium ${
                    l.variance_amount === null ? "" : l.variance_amount >= 0 ? "text-teal-700" : "text-amber-700"
                  }`}>
                    {l.variance_amount === null ? "—" : `${l.variance_amount >= 0 ? "+" : ""}${formatCurrency(l.variance_amount)}`}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 py-0 ${
                        l.line_status === "invoiced" ? "bg-teal-100 text-teal-800" :
                        l.line_status === "written_off" ? "bg-rose-100 text-rose-800" :
                        "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {l.line_status === "accrued" ? <Unlock className="h-2.5 w-2.5 mr-0.5" /> : null}
                      {l.line_status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {l.line_status === "accrued" && (
                      <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => writeOff(l.id)}>
                        Write off
                      </Button>
                    )}
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

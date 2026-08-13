"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Plus,
  Calculator,
  DollarSign,
  TrendingDown,
  TrendingUp,
  Percent,
  ChevronDown,
  ChevronRight,
  Trash2,
  Pencil,
  Check,
  ChevronsUpDown,
  X,
  Loader2,
  AlertTriangle,
  FileText,
  Printer,
} from "lucide-react";
import {
  formatCurrency,
  formatPercentage,
  getCurrentPeriod,
  getPeriodLabel,
  getPeriodShortLabel,
} from "@/lib/utils/dates";
import { cn } from "@/lib/utils";
import type { AccountClassification, ClassFilterMode } from "@/lib/types/database";
import { SalesCommissionSection } from "@/components/commissions/sales-commission-section";

// ── Types ──────────────────────────────────────────────────────────────

interface CommissionProfile {
  id: string;
  entity_id: string;
  name: string;
  commission_rate: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

interface QboClass {
  id: string;
  name: string;
}

interface AccountAssignment {
  id: string;
  commission_profile_id: string;
  account_id: string;
  role: "revenue" | "expense";
  class_filter_mode: ClassFilterMode;
  qbo_class_ids: string[];
  accounts?: {
    name: string;
    account_number: string | null;
    classification: string;
    account_type: string;
  };
}

interface CommissionResult {
  id: string;
  commission_profile_id: string;
  period_year: number;
  period_month: number;
  total_revenue: number;
  total_expenses: number;
  commission_base: number;
  commission_rate: number;
  commission_earned: number;
  is_payable: boolean;
  is_paid: boolean;
  paid_amount: number | null;
  calculated_at: string;
}

interface EntityAccount {
  id: string;
  name: string;
  account_number: string | null;
  classification: AccountClassification;
  account_type: string;
  is_active: boolean;
}

interface FormAssignment {
  account_id: string;
  role: "revenue" | "expense";
  class_filter_mode: ClassFilterMode;
  qbo_class_ids: string[];
}

interface ReportAccountRow {
  accountId: string;
  accountNumber: string | null;
  accountName: string;
  accountType: string;
  role: "revenue" | "expense";
  classFilterLabel: string;
  monthlyValues: Record<string, number>;
}

interface ReportData {
  entityName: string;
  profileName: string;
  commissionRate: number;
  months: { year: number; month: number }[];
  accountRows: ReportAccountRow[];
  results: Record<string, { isPaid: boolean; paidAmount: number | null; commissionEarned: number }>;
}

// ── GL-based calculator (original) ─────────────────────────────────────

function GlCommissionsSection() {
  const params = useParams();
  const entityId = params.entityId as string;
  const current = getCurrentPeriod();

  // Period
  const [periodYear, setPeriodYear] = useState(current.year);
  const [periodMonth, setPeriodMonth] = useState(current.month);

  // Data
  const [profiles, setProfiles] = useState<CommissionProfile[]>([]);
  const [assignments, setAssignments] = useState<
    Record<string, AccountAssignment[]>
  >({});
  const [results, setResults] = useState<CommissionResult[]>([]);
  const [accounts, setAccounts] = useState<EntityAccount[]>([]);

  // GL balances for detail view
  const [detailBalances, setDetailBalances] = useState<
    Record<string, number>
  >({});
  // Prior month GL balances for standalone derivation
  const [priorDetailBalances, setPriorDetailBalances] = useState<
    Record<string, number>
  >({});

  // QBO Classes
  const [qboClasses, setQboClasses] = useState<QboClass[]>([]);
  const [classBalances, setClassBalances] = useState<
    Record<string, number>
  >({}); // key: `${account_id}__${class_id}` — already standalone monthly

  // Annual results for calendar grid (all months for selected year)
  const [annualResults, setAnnualResults] = useState<CommissionResult[]>([]);

  // Diagnostics
  const [missingClassData, setMissingClassData] = useState(false);
  const [missingPriorData, setMissingPriorData] = useState(false);

  // UI
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<CommissionProfile | null>(
    null
  );
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Form
  const [formName, setFormName] = useState("");
  const [formRate, setFormRate] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formAssignments, setFormAssignments] = useState<FormAssignment[]>([]);
  const [saving, setSaving] = useState(false);

  // Report
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportProfileId, setReportProfileId] = useState("");
  const [reportStartYear, setReportStartYear] = useState(current.year);
  const [reportStartMonth, setReportStartMonth] = useState(1);
  const [reportEndYear, setReportEndYear] = useState(current.year);
  const [reportEndMonth, setReportEndMonth] = useState(current.month);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);

  // Account picker popovers
  const [openPopovers, setOpenPopovers] = useState<Record<number, boolean>>({});

  const supabase = createClient();

  // ── Data Loading ─────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);

    // Compute prior month for standalone derivation
    const pm = periodMonth === 1 ? 12 : periodMonth - 1;
    const py = periodMonth === 1 ? periodYear - 1 : periodYear;

    // Fetch profiles and assignments via API
    const res = await fetch(
      `/api/commissions?entityId=${entityId}`
    );
    if (res.ok) {
      const data = await res.json();
      setProfiles(data.profiles);
      setAssignments(data.assignments);
    }

    // Fetch commission results for this period
    const { data: resultData } = await supabase
      .from("commission_results")
      .select("*")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    setResults(resultData ?? []);

    // Fetch all results for the selected year (for calendar grid)
    const { data: annualData } = await supabase
      .from("commission_results")
      .select("*")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear);

    setAnnualResults(annualData ?? []);

    // Fetch entity accounts for the picker
    const { data: acctData } = await supabase
      .from("accounts")
      .select("id, name, account_number, classification, account_type, is_active")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number");

    setAccounts((acctData ?? []) as EntityAccount[]);

    // Fetch QBO classes for the entity
    const { data: classData } = await supabase
      .from("qbo_classes")
      .select("id, name")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("name");

    setQboClasses((classData ?? []) as QboClass[]);

    // Fetch GL balances for detail expansion (current period ending_balance)
    const glData = await fetchAllPaginated<any>((offset, limit) =>
      supabase
        .from("gl_balances")
        .select("account_id, ending_balance")
        .eq("entity_id", entityId)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth)
        .range(offset, offset + limit - 1)
    );

    const balanceMap: Record<string, number> = {};
    for (const row of glData) {
      balanceMap[row.account_id] = Number(row.ending_balance ?? 0);
    }
    setDetailBalances(balanceMap);

    // Fetch prior month GL balances for standalone derivation
    if (periodMonth !== 1) {
      const priorGlData = await fetchAllPaginated<any>((offset, limit) =>
        supabase
          .from("gl_balances")
          .select("account_id, ending_balance")
          .eq("entity_id", entityId)
          .eq("period_year", py)
          .eq("period_month", pm)
          .range(offset, offset + limit - 1)
      );

      const priorMap: Record<string, number> = {};
      for (const row of priorGlData) {
        priorMap[row.account_id] = Number(row.ending_balance ?? 0);
      }
      setPriorDetailBalances(priorMap);

      // Check if prior month data exists
      setMissingPriorData(priorGlData.length === 0 && glData.length > 0);
    } else {
      setPriorDetailBalances({});
      setMissingPriorData(false);
    }

    // Fetch class-level GL balances for detail expansion.
    // gl_class_balances.net_change is already standalone monthly
    // (from QBO P&L by Class report), no prior month subtraction needed.
    const classGlData = await fetchAllPaginated<any>((offset, limit) =>
      supabase
        .from("gl_class_balances")
        .select("account_id, qbo_class_id, net_change")
        .eq("entity_id", entityId)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth)
        .range(offset, offset + limit - 1)
    );

    const classBalanceMap: Record<string, number> = {};
    for (const row of classGlData) {
      classBalanceMap[`${row.account_id}__${row.qbo_class_id}`] = Number(
        row.net_change ?? 0
      );
    }
    setClassBalances(classBalanceMap);

    // Check if any assignments use include/exclude but class data is missing
    setMissingClassData(false); // Reset; will be checked in useEffect after state settles

    setLoading(false);
  }, [entityId, periodYear, periodMonth, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Check for missing class balance data when assignments or classBalances change
  useEffect(() => {
    const allAssignments = Object.values(assignments).flat();
    const hasClassFilters = allAssignments.some(
      (a) => a.class_filter_mode === "include" || a.class_filter_mode === "exclude"
    );
    const hasClassBalanceData = Object.keys(classBalances).length > 0;
    setMissingClassData(hasClassFilters && !hasClassBalanceData);
  }, [assignments, classBalances]);

  // ── Group accounts by classification ─────────────────────────────────

  const groupedAccounts = accounts.reduce(
    (groups, acct) => {
      const key = acct.classification;
      if (!groups[key]) groups[key] = [];
      groups[key].push(acct);
      return groups;
    },
    {} as Record<string, EntityAccount[]>
  );

  // ── Helpers ──────────────────────────────────────────────────────────

  function getResultForProfile(profileId: string): CommissionResult | undefined {
    return results.find((r) => r.commission_profile_id === profileId);
  }

  const summaryRevenue = results.reduce(
    (sum, r) => sum + Number(r.total_revenue),
    0
  );
  const summaryExpenses = results.reduce(
    (sum, r) => sum + Number(r.total_expenses),
    0
  );
  const summaryBase = results.reduce(
    (sum, r) => sum + Number(r.commission_base),
    0
  );
  const summaryEarned = results.reduce(
    (sum, r) => sum + Number(r.commission_earned),
    0
  );

  // ── Actions ──────────────────────────────────────────────────────────

  async function handleCalculate() {
    setCalculating(true);
    try {
      const res = await fetch("/api/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "calculate",
          entityId,
          periodYear,
          periodMonth,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.warnings?.length > 0) {
          for (const w of data.warnings) {
            toast.warning(w, { duration: 15000 });
          }
        } else {
          const diag = data.diagnostics;
          toast.success(
            `Calculated commissions for ${data.results.length} salesperson(s)` +
            (diag ? ` (${diag.currentGlAccounts} current / ${diag.priorGlAccounts} prior GL accounts)` : "")
          );
        }
        await loadData();
      } else {
        toast.error(data.error || "Calculation failed");
      }
    } catch {
      toast.error("Failed to calculate commissions");
    }
    setCalculating(false);
  }

  async function handleMarkPayable(resultId: string, isPayable: boolean) {
    const res = await fetch("/api/commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mark_payable",
        resultId,
        isPayable,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setResults((prev) =>
        prev.map((r) =>
          r.id === resultId ? { ...r, is_payable: isPayable } : r
        )
      );
      toast.success(isPayable ? "Marked as payable" : "Unmarked as payable");
    } else {
      toast.error(data.error || "Failed to update");
    }
  }

  async function handleMarkPaid(resultId: string, isPaid: boolean, paidAmount?: number) {
    const res = await fetch("/api/commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mark_paid",
        resultId,
        isPaid,
        paidAmount: isPaid ? paidAmount : null,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setResults((prev) =>
        prev.map((r) =>
          r.id === resultId
            ? { ...r, is_paid: isPaid, paid_amount: isPaid ? (paidAmount ?? null) : null }
            : r
        )
      );
      setAnnualResults((prev) =>
        prev.map((r) =>
          r.id === resultId
            ? { ...r, is_paid: isPaid, paid_amount: isPaid ? (paidAmount ?? null) : null }
            : r
        )
      );
      toast.success(isPaid ? "Marked as paid" : "Unmarked as paid");
    } else {
      toast.error(data.error || "Failed to update");
    }
  }

  async function handleUpdatePaidAmount(resultId: string, paidAmount: number) {
    const res = await fetch("/api/commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_paid_amount",
        resultId,
        paidAmount,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setResults((prev) =>
        prev.map((r) =>
          r.id === resultId ? { ...r, paid_amount: paidAmount } : r
        )
      );
      setAnnualResults((prev) =>
        prev.map((r) =>
          r.id === resultId ? { ...r, paid_amount: paidAmount } : r
        )
      );
      toast.success("Paid amount updated");
    } else {
      toast.error(data.error || "Failed to update paid amount");
    }
  }

  async function handleDeleteProfile(profileId: string) {
    const res = await fetch("/api/commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete_profile",
        profileId,
      }),
    });
    const data = await res.json();
    if (data.success) {
      toast.success("Salesperson profile deleted");
      await loadData();
    } else {
      toast.error(data.error || "Failed to delete");
    }
  }

  // ── Report ──────────────────────────────────────────────────────────

  function openReportDialog() {
    setReportProfileId(profiles.length === 1 ? profiles[0].id : "");
    setReportStartYear(periodYear);
    setReportStartMonth(1);
    setReportEndYear(periodYear);
    setReportEndMonth(periodMonth);
    setReportData(null);
    setReportDialogOpen(true);
  }

  async function handleGenerateReport() {
    if (!reportProfileId) {
      toast.error("Please select a salesperson");
      return;
    }
    if (
      reportEndYear < reportStartYear ||
      (reportEndYear === reportStartYear && reportEndMonth < reportStartMonth)
    ) {
      toast.error("End period must be after start period");
      return;
    }
    setReportLoading(true);
    try {
      const res = await fetch("/api/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_report",
          entityId,
          profileId: reportProfileId,
          startYear: reportStartYear,
          startMonth: reportStartMonth,
          endYear: reportEndYear,
          endMonth: reportEndMonth,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setReportData(data.report);
      } else {
        toast.error(data.error || "Failed to generate report");
      }
    } catch {
      toast.error("Failed to generate report");
    }
    setReportLoading(false);
  }

  function handlePrintReport() {
    const el = document.getElementById("commission-report-content");
    if (!el) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const styleLinks = Array.from(
      document.querySelectorAll('link[rel="stylesheet"]')
    )
      .map((link) => link.outerHTML)
      .join("\n");
    const inlineStyles = Array.from(document.querySelectorAll("style"))
      .map((s) => s.outerHTML)
      .join("\n");
    const orientation =
      (reportData?.months.length ?? 0) > 4 ? "landscape" : "portrait";
    win.document.write(
      `<!DOCTYPE html><html><head><title>Commission Report</title>${styleLinks}${inlineStyles}<style>body{padding:0.5in;background:white}@media print{body{padding:0}@page{size:letter ${orientation}!important;margin:0.3in 0.4in}}</style></head><body>${el.outerHTML}</body></html>`
    );
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
    }, 500);
  }

  // ── Dialog ───────────────────────────────────────────────────────────

  function openAddDialog() {
    setEditingProfile(null);
    setFormName("");
    setFormRate("");
    setFormNotes("");
    setFormAssignments([]);
    setOpenPopovers({});
    setDialogOpen(true);
  }

  function openEditDialog(profile: CommissionProfile) {
    setEditingProfile(profile);
    setFormName(profile.name);
    setFormRate(String(Number(profile.commission_rate) * 100));
    setFormNotes(profile.notes || "");
    const profileAssignments = assignments[profile.id] ?? [];
    setFormAssignments(
      profileAssignments.map((a) => ({
        account_id: a.account_id,
        role: a.role,
        class_filter_mode: (a.class_filter_mode ?? "all") as ClassFilterMode,
        qbo_class_ids: a.qbo_class_ids ?? [],
      }))
    );
    setOpenPopovers({});
    setDialogOpen(true);
  }

  async function handleSaveProfile() {
    if (!formName.trim()) {
      toast.error("Salesperson name is required");
      return;
    }
    const rateNum = parseFloat(formRate);
    if (isNaN(rateNum) || rateNum < 0) {
      toast.error("Please enter a valid commission rate");
      return;
    }

    // Validate class selections
    const invalidClassFilter = formAssignments.find(
      (a) => a.account_id && a.class_filter_mode !== "all" && a.qbo_class_ids.length === 0
    );
    if (invalidClassFilter) {
      toast.error("Please select at least one class for include/exclude filter");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_profile",
          entityId,
          profile: {
            id: editingProfile?.id || null,
            name: formName.trim(),
            commission_rate: rateNum / 100, // Convert percentage to decimal
            notes: formNotes.trim() || null,
            assignments: formAssignments
              .filter((a) => a.account_id)
              .map((a) => ({
                account_id: a.account_id,
                role: a.role,
                class_filter_mode: a.class_filter_mode,
                qbo_class_ids: a.class_filter_mode === "all" ? [] : a.qbo_class_ids,
              })),
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          editingProfile
            ? "Salesperson updated"
            : "Salesperson added"
        );
        setDialogOpen(false);
        await loadData();
      } else {
        toast.error(data.error || "Failed to save");
      }
    } catch {
      toast.error("Failed to save profile");
    }
    setSaving(false);
  }

  function addAssignmentRow() {
    setFormAssignments((prev) => [
      ...prev,
      { account_id: "", role: "revenue", class_filter_mode: "all" as ClassFilterMode, qbo_class_ids: [] },
    ]);
  }

  function removeAssignmentRow(index: number) {
    setFormAssignments((prev) => prev.filter((_, i) => i !== index));
  }

  function updateAssignment(
    index: number,
    field: "account_id" | "role" | "class_filter_mode",
    value: string
  ) {
    setFormAssignments((prev) =>
      prev.map((a, i) => {
        if (i !== index) return a;
        const updated = { ...a, [field]: value };
        // Reset class IDs when switching to "all"
        if (field === "class_filter_mode" && value === "all") {
          updated.qbo_class_ids = [];
        }
        return updated;
      })
    );
  }

  function toggleClassId(index: number, classId: string) {
    setFormAssignments((prev) =>
      prev.map((a, i) => {
        if (i !== index) return a;
        const ids = a.qbo_class_ids.includes(classId)
          ? a.qbo_class_ids.filter((id) => id !== classId)
          : [...a.qbo_class_ids, classId];
        return { ...a, qbo_class_ids: ids };
      })
    );
  }

  function toggleRow(profileId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) {
        next.delete(profileId);
      } else {
        next.add(profileId);
      }
      return next;
    });
  }

  // ── Detail row helpers ──────────────────────────────────────────────

  function getAssignmentRawBalance(a: AccountAssignment): number {
    const classIds = a.qbo_class_ids ?? [];
    const isFYStart = periodMonth === 1;

    if (a.class_filter_mode === "include" && classIds.length > 0) {
      // Include mode: gl_class_balances.net_change is already standalone
      // monthly (from QBO P&L by Class report). Use directly.
      return classIds.reduce(
        (sum, cid) => sum + (classBalances[`${a.account_id}__${cid}`] ?? 0),
        0
      );
    }

    // For "all" and "exclude" modes, gl_balances stores cumulative YTD.
    // Derive standalone = current ending_balance - prior ending_balance.
    const currentEnding = detailBalances[a.account_id] ?? 0;
    const priorEnding = isFYStart ? 0 : (priorDetailBalances[a.account_id] ?? 0);
    const totalStandalone = currentEnding - priorEnding;

    if (a.class_filter_mode === "exclude" && classIds.length > 0) {
      // Exclude mode: subtract excluded class balances (already standalone).
      const excludedStandalone = classIds.reduce(
        (sum, cid) => sum + (classBalances[`${a.account_id}__${cid}`] ?? 0),
        0
      );
      return totalStandalone - excludedStandalone;
    }

    // All classes
    return totalStandalone;
  }

  function getClassFilterLabel(a: AccountAssignment): string {
    const classIds = a.qbo_class_ids ?? [];
    if (a.class_filter_mode === "all" || classIds.length === 0) return "All Classes";
    const names = classIds
      .map((id) => qboClasses.find((c) => c.id === id)?.name ?? "Unknown")
      .sort();
    const prefix = a.class_filter_mode === "include" ? "Include: " : "Exclude: ";
    return prefix + names.join(", ");
  }

  // ── Render ───────────────────────────────────────────────────────────

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Commissions Calculator
          </h1>
          <p className="text-muted-foreground">
            Calculate commission earnings from GL account activity
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openReportDialog}>
            <FileText className="mr-2 h-4 w-4" />
            Commission Report
          </Button>
          <Button variant="outline" onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Salesperson
          </Button>
          <Button onClick={handleCalculate} disabled={calculating}>
            {calculating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="mr-2 h-4 w-4" />
            )}
            Calculate
          </Button>
        </div>
      </div>

      {/* Period Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label>Year</Label>
              <Select
                value={String(periodYear)}
                onValueChange={(v) => setPeriodYear(Number(v))}
              >
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label>Month</Label>
              <Select
                value={String(periodMonth)}
                onValueChange={(v) => setPeriodMonth(Number(v))}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {new Date(2000, m - 1).toLocaleString("default", {
                        month: "long",
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Badge variant="secondary" className="ml-2">
              {getPeriodLabel(periodYear, periodMonth)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Commission Calendar Grid */}
      {profiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Commission by Month — {periodYear}</CardTitle>
            <CardDescription>
              Monthly commission earned per salesperson. Click a month to navigate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background z-10">Salesperson</TableHead>
                    {months.map((m) => (
                      <TableHead key={m} className="text-right min-w-[90px]">
                        {new Date(2000, m - 1).toLocaleString("default", { month: "short" })}
                      </TableHead>
                    ))}
                    <TableHead className="text-right font-semibold min-w-[100px]">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((profile) => {
                    let yearTotal = 0;
                    return (
                      <TableRow key={profile.id}>
                        <TableCell className="sticky left-0 bg-background z-10 font-medium whitespace-nowrap">
                          {profile.name}
                        </TableCell>
                        {months.map((m) => {
                          const r = annualResults.find(
                            (ar) =>
                              ar.commission_profile_id === profile.id &&
                              ar.period_month === m
                          );
                          const earned = r ? Number(r.commission_earned) : 0;
                          yearTotal += earned;
                          const isSelected = m === periodMonth;
                          return (
                            <TableCell
                              key={m}
                              className={cn(
                                "text-right tabular-nums cursor-pointer hover:bg-muted/50 transition-colors",
                                isSelected && "bg-primary/10 font-semibold",
                                !r && "text-muted-foreground"
                              )}
                              onClick={() => setPeriodMonth(m)}
                            >
                              <div className="flex items-center justify-end gap-1.5">
                                {r && (
                                  <div
                                    className={cn(
                                      "h-2.5 w-2.5 rounded-full shrink-0",
                                      r.is_paid ? "bg-green-500" : "bg-red-500"
                                    )}
                                    title={r.is_paid ? "Paid" : "Not paid"}
                                  />
                                )}
                                <span>{r ? formatCurrency(earned) : "—"}</span>
                              </div>
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right tabular-nums font-semibold border-l">
                          {formatCurrency(yearTotal)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals row */}
                  {profiles.length > 1 && (
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell className="sticky left-0 bg-background z-10">Total</TableCell>
                      {months.map((m) => {
                        const monthTotal = annualResults
                          .filter((ar) => ar.period_month === m)
                          .reduce((sum, ar) => sum + Number(ar.commission_earned), 0);
                        return (
                          <TableCell
                            key={m}
                            className={cn(
                              "text-right tabular-nums cursor-pointer hover:bg-muted/50",
                              m === periodMonth && "bg-primary/10"
                            )}
                            onClick={() => setPeriodMonth(m)}
                          >
                            {monthTotal !== 0 ? formatCurrency(monthTotal) : "—"}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right tabular-nums border-l">
                        {formatCurrency(
                          annualResults.reduce(
                            (sum, ar) => sum + Number(ar.commission_earned),
                            0
                          )
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenue Base</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(summaryRevenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Expense Deductions
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(summaryExpenses)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Commission Base
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(summaryBase)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Commissions
            </CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(summaryEarned)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Missing class balance data warning */}
      {missingPriorData && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">
              Prior month GL data missing
            </p>
            <p className="text-red-700 dark:text-red-300 mt-0.5">
              No GL data found for {getPeriodLabel(
                periodMonth === 1 ? periodYear - 1 : periodYear,
                periodMonth === 1 ? 12 : periodMonth - 1
              )}. Commission values may show cumulative YTD instead of standalone monthly amounts.
              Sync the prior month from QBO, then recalculate.
            </p>
          </div>
        </div>
      )}

      {missingClassData && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">
              Class-level GL data not found for {getPeriodLabel(periodYear, periodMonth)}
            </p>
            <p className="text-amber-700 dark:text-amber-300 mt-0.5">
              Some commission accounts use Include/Exclude class filters, but no
              class balance data exists for this period. Run a QBO sync to
              pull the P&amp;L by Class report, then recalculate.
            </p>
          </div>
        </div>
      )}

      {/* Commissions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Commissions by Salesperson</CardTitle>
          <CardDescription>
            Click a row to view assigned account detail for the period
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Percent className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">No salesperson profiles</h3>
              <p className="text-muted-foreground mb-4">
                Add a salesperson to start calculating commissions
              </p>
              <Button onClick={openAddDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Add Salesperson
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30px]" />
                  <TableHead>Salesperson</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Revenue Base</TableHead>
                  <TableHead className="text-right">
                    Expense Deductions
                  </TableHead>
                  <TableHead className="text-right">Commission Base</TableHead>
                  <TableHead className="text-right">
                    Commission Earned
                  </TableHead>
                  <TableHead className="text-center">Paid</TableHead>
                  <TableHead className="text-right">Paid Amount</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((profile) => {
                  const result = getResultForProfile(profile.id);
                  const isExpanded = expandedRows.has(profile.id);
                  const profileAssignments = assignments[profile.id] ?? [];

                  return (
                    <>
                      <TableRow
                        key={profile.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleRow(profile.id)}
                      >
                        <TableCell>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {profile.name}
                          {!profile.is_active && (
                            <Badge
                              variant="outline"
                              className="ml-2 text-xs"
                            >
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPercentage(Number(profile.commission_rate))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {result
                            ? formatCurrency(Number(result.total_revenue))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {result
                            ? formatCurrency(Number(result.total_expenses))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {result
                            ? formatCurrency(Number(result.commission_base))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {result
                            ? formatCurrency(Number(result.commission_earned))
                            : "—"}
                        </TableCell>
                        <TableCell
                          className="text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {result && (
                            <Checkbox
                              checked={result.is_paid}
                              onCheckedChange={(checked) => {
                                const isPaid = checked as boolean;
                                if (isPaid) {
                                  // Default paid amount to commission earned, rounded to cents
                                  handleMarkPaid(result.id, true, Math.round(Number(result.commission_earned) * 100) / 100);
                                } else {
                                  handleMarkPaid(result.id, false);
                                }
                              }}
                            />
                          )}
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {result && result.is_paid && (
                            <Input
                              type="number"
                              step="0.01"
                              className="w-[130px] ml-auto text-right tabular-nums h-8 text-sm"
                              value={result.paid_amount ?? ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setResults((prev) =>
                                  prev.map((r) =>
                                    r.id === result.id
                                      ? { ...r, paid_amount: val === "" ? null : parseFloat(val) }
                                      : r
                                  )
                                );
                              }}
                              onBlur={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val)) {
                                  const rounded = Math.round(val * 100) / 100;
                                  handleUpdatePaidAmount(result.id, rounded);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {result && result.is_paid && result.paid_amount != null ? (() => {
                            const variance = Number(result.paid_amount) - Number(result.commission_earned);
                            return (
                              <span className={cn(
                                variance === 0 && "text-muted-foreground",
                                variance > 0 && "text-green-600",
                                variance < 0 && "text-red-600"
                              )}>
                                {variance >= 0 ? "+" : ""}{formatCurrency(variance)}
                              </span>
                            );
                          })() : "—"}
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditDialog(profile)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDeleteProfile(profile.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {/* Expanded detail row */}
                      {isExpanded && profileAssignments.length > 0 && (
                        <TableRow key={`${profile.id}-detail`}>
                          <TableCell colSpan={11} className="bg-muted/30 p-0">
                            <div className="px-8 py-4">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Account #</TableHead>
                                    <TableHead>Account Name</TableHead>
                                    <TableHead>Type</TableHead>
                                    {qboClasses.length > 0 && (
                                      <TableHead>Class</TableHead>
                                    )}
                                    <TableHead className="text-center">
                                      Role
                                    </TableHead>
                                    <TableHead className="text-right">
                                      Net Change
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {profileAssignments.map((a) => {
                                    const rawChange = getAssignmentRawBalance(a);
                                    // Negate revenue accounts (GL stores credits as negative)
                                    // Use || 0 to avoid -0 display from 0 * -1
                                    const netChange =
                                      (a.role === "revenue"
                                        ? rawChange * -1
                                        : rawChange) || 0;
                                    return (
                                      <TableRow key={a.id}>
                                        <TableCell className="font-mono text-muted-foreground">
                                          {a.accounts?.account_number ?? "—"}
                                        </TableCell>
                                        <TableCell>
                                          {a.accounts?.name ?? "Unknown"}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                          {a.accounts?.account_type ?? "—"}
                                        </TableCell>
                                        {qboClasses.length > 0 && (
                                          <TableCell className="text-muted-foreground text-xs max-w-[200px]">
                                            <span title={getClassFilterLabel(a)}>
                                              {a.class_filter_mode === "all" ? (
                                                "All Classes"
                                              ) : (
                                                <span className="flex items-center gap-1 flex-wrap">
                                                  <Badge
                                                    variant={a.class_filter_mode === "include" ? "default" : "destructive"}
                                                    className="text-[10px] px-1.5 py-0"
                                                  >
                                                    {a.class_filter_mode === "include" ? "Include" : "Exclude"}
                                                  </Badge>
                                                  {a.qbo_class_ids
                                                    .map((id) => qboClasses.find((c) => c.id === id)?.name ?? "?")
                                                    .join(", ")}
                                                </span>
                                              )}
                                            </span>
                                          </TableCell>
                                        )}
                                        <TableCell className="text-center">
                                          <Badge
                                            variant={
                                              a.role === "revenue"
                                                ? "default"
                                                : "secondary"
                                            }
                                          >
                                            {a.role === "revenue"
                                              ? "Revenue (+)"
                                              : "Expense (-)"}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                          {formatCurrency(netChange)}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {isExpanded && profileAssignments.length === 0 && (
                        <TableRow key={`${profile.id}-empty`}>
                          <TableCell
                            colSpan={11}
                            className="bg-muted/30 text-center py-4 text-muted-foreground"
                          >
                            No accounts assigned. Edit this salesperson to add
                            revenue/expense accounts.
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {/* Totals Row */}
                {results.length > 0 && (
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell />
                    <TableCell>Totals</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(summaryRevenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(summaryExpenses)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(summaryBase)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(summaryEarned)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(
                        results
                          .filter((r) => r.is_paid && r.paid_amount != null)
                          .reduce((sum, r) => sum + Number(r.paid_amount), 0)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(() => {
                        const paidResults = results.filter((r) => r.is_paid && r.paid_amount != null);
                        if (paidResults.length === 0) return "—";
                        const totalVariance = paidResults.reduce(
                          (sum, r) => sum + (Number(r.paid_amount) - Number(r.commission_earned)),
                          0
                        );
                        return (
                          <span className={cn(
                            totalVariance === 0 && "text-muted-foreground",
                            totalVariance > 0 && "text-green-600",
                            totalVariance < 0 && "text-red-600"
                          )}>
                            {totalVariance >= 0 ? "+" : ""}{formatCurrency(totalVariance)}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Salesperson Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingProfile ? "Edit Salesperson" : "Add Salesperson"}
            </DialogTitle>
            <DialogDescription>
              Configure the salesperson name, commission rate, and which GL
              accounts contribute to their commission calculation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Salesperson Name</Label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. John Smith"
              />
            </div>

            {/* Rate */}
            <div className="space-y-2">
              <Label htmlFor="rate">Commission Rate (%)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={formRate}
                  onChange={(e) => setFormRate(e.target.value)}
                  placeholder="e.g. 5.00"
                  className="w-[140px]"
                />
                <span className="text-muted-foreground">%</span>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Additional notes..."
                rows={3}
                className="max-h-[120px] resize-none"
              />
            </div>

            {/* Account Assignments */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Account Assignments</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addAssignmentRow}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Account
                </Button>
              </div>

              {formAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  No accounts assigned yet. Click &quot;Add Account&quot; to select
                  revenue or expense accounts.
                </p>
              ) : (
                <div className="space-y-2">
                  {formAssignments.map((assignment, index) => {
                    const selectedAccount = accounts.find(
                      (a) => a.id === assignment.account_id
                    );

                    return (
                      <div
                        key={index}
                        className="flex items-center gap-2 p-2 rounded-md border"
                      >
                        {/* Account Picker */}
                        <Popover
                          open={openPopovers[index] ?? false}
                          onOpenChange={(open) =>
                            setOpenPopovers((prev) => ({
                              ...prev,
                              [index]: open,
                            }))
                          }
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              className="flex-1 justify-between text-sm"
                            >
                              {selectedAccount
                                ? `${selectedAccount.account_number ?? ""} ${selectedAccount.name}`.trim()
                                : "Select account..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[320px] p-0"
                            align="start"
                          >
                            <Command>
                              <CommandInput placeholder="Search accounts..." />
                              <CommandList>
                                <CommandEmpty>No accounts found.</CommandEmpty>
                                {Object.entries(groupedAccounts).map(
                                  ([classification, accts]) => (
                                    <CommandGroup
                                      key={classification}
                                      heading={classification}
                                    >
                                      {accts.map((acct) => (
                                        <CommandItem
                                          key={acct.id}
                                          value={`${acct.account_number ?? ""} ${acct.name} ${acct.account_type}`}
                                          onSelect={() => {
                                            updateAssignment(
                                              index,
                                              "account_id",
                                              acct.id
                                            );
                                            // Auto-set role based on classification
                                            if (
                                              acct.classification === "Revenue"
                                            ) {
                                              updateAssignment(
                                                index,
                                                "role",
                                                "revenue"
                                              );
                                            } else if (
                                              acct.classification === "Expense"
                                            ) {
                                              updateAssignment(
                                                index,
                                                "role",
                                                "expense"
                                              );
                                            }
                                            setOpenPopovers((prev) => ({
                                              ...prev,
                                              [index]: false,
                                            }));
                                          }}
                                        >
                                          <Check
                                            className={cn(
                                              "mr-2 h-4 w-4",
                                              assignment.account_id === acct.id
                                                ? "opacity-100"
                                                : "opacity-0"
                                            )}
                                          />
                                          <div className="flex flex-col">
                                            <span className="text-sm">
                                              {acct.account_number && (
                                                <span className="font-mono text-muted-foreground mr-1">
                                                  {acct.account_number}
                                                </span>
                                              )}
                                              {acct.name}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                              {acct.account_type}
                                            </span>
                                          </div>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  )
                                )}
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>

                        {/* Role Selector */}
                        <Select
                          value={assignment.role}
                          onValueChange={(v) =>
                            updateAssignment(
                              index,
                              "role",
                              v as "revenue" | "expense"
                            )
                          }
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="revenue">
                              Revenue (+)
                            </SelectItem>
                            <SelectItem value="expense">
                              Expense (-)
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        {/* Class Filter (optional) */}
                        {qboClasses.length > 0 && (
                          <div className="flex items-center gap-1">
                            {/* Mode Selector */}
                            <Select
                              value={assignment.class_filter_mode}
                              onValueChange={(v) =>
                                updateAssignment(index, "class_filter_mode", v)
                              }
                            >
                              <SelectTrigger className="w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All Classes</SelectItem>
                                <SelectItem value="include">Include</SelectItem>
                                <SelectItem value="exclude">Exclude</SelectItem>
                              </SelectContent>
                            </Select>

                            {/* Multi-select class picker (only when include/exclude) */}
                            {assignment.class_filter_mode !== "all" && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    className="w-[150px] justify-between text-xs"
                                  >
                                    {assignment.qbo_class_ids.length === 0
                                      ? "Select classes..."
                                      : `${assignment.qbo_class_ids.length} selected`}
                                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[220px] p-0" align="start">
                                  <Command>
                                    <CommandInput placeholder="Search classes..." />
                                    <CommandList>
                                      <CommandEmpty>No classes found.</CommandEmpty>
                                      <CommandGroup>
                                        {qboClasses.map((cls) => (
                                          <CommandItem
                                            key={cls.id}
                                            value={cls.name}
                                            onSelect={() => toggleClassId(index, cls.id)}
                                          >
                                            <div className={cn(
                                              "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                              assignment.qbo_class_ids.includes(cls.id)
                                                ? "bg-primary text-primary-foreground"
                                                : "opacity-50"
                                            )}>
                                              {assignment.qbo_class_ids.includes(cls.id) && (
                                                <Check className="h-3 w-3" />
                                              )}
                                            </div>
                                            {cls.name}
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        )}

                        {/* Remove */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => removeAssignmentRow(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Save / Cancel */}
            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveProfile} disabled={saving}>
                {saving && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editingProfile ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Commission Report Dialog */}
      <Dialog
        open={reportDialogOpen}
        onOpenChange={(open) => {
          setReportDialogOpen(open);
          if (!open) setReportData(null);
        }}
      >
        <DialogContent
          className={cn(
            "max-h-[90vh] overflow-y-auto",
            reportData ? "max-w-[95vw]" : "max-w-lg"
          )}
        >
          {reportData ? (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <DialogTitle>Commission Report</DialogTitle>
                    <DialogDescription>
                      {reportData.profileName} —{" "}
                      {getPeriodLabel(
                        reportData.months[0].year,
                        reportData.months[0].month
                      )}
                      {reportData.months.length > 1 &&
                        ` through ${getPeriodLabel(
                          reportData.months[reportData.months.length - 1].year,
                          reportData.months[reportData.months.length - 1].month
                        )}`}
                    </DialogDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setReportData(null)}
                    >
                      Back
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePrintReport}
                    >
                      <Printer className="mr-2 h-4 w-4" />
                      Print
                    </Button>
                  </div>
                </div>
              </DialogHeader>
              <div id="commission-report-content" className="overflow-x-auto">
                {(() => {
                  const {
                    entityName,
                    profileName,
                    commissionRate,
                    months: rMonths,
                    accountRows,
                  } = reportData;
                  const revenueRows = accountRows.filter(
                    (r) => r.role === "revenue"
                  );
                  const expenseRows = accountRows.filter(
                    (r) => r.role === "expense"
                  );
                  const monthKeys = rMonths.map(
                    (m) => `${m.year}-${m.month}`
                  );

                  const monthlyRevenue: Record<string, number> = {};
                  const monthlyExpenses: Record<string, number> = {};
                  for (const key of monthKeys) {
                    monthlyRevenue[key] = revenueRows.reduce(
                      (sum, r) => sum + (r.monthlyValues[key] ?? 0),
                      0
                    );
                    monthlyExpenses[key] = expenseRows.reduce(
                      (sum, r) => sum + (r.monthlyValues[key] ?? 0),
                      0
                    );
                  }
                  const totalRevenue = Object.values(monthlyRevenue).reduce(
                    (sum, v) => sum + v,
                    0
                  );
                  const totalExpenses = Object.values(monthlyExpenses).reduce(
                    (sum, v) => sum + v,
                    0
                  );

                  let stripeIndex = 0;
                  const colCount = rMonths.length + 2;

                  const fmtVal = (v: number) =>
                    v < 0 ? (
                      <span className="stmt-negative">
                        {formatCurrency(v)}
                      </span>
                    ) : (
                      formatCurrency(v)
                    );

                  return (
                    <div className="stmt-single-page">
                      {/* Report Header */}
                      <div className="stmt-header text-center space-y-0.5 mb-4">
                        <div className="text-lg font-semibold">
                          {entityName}
                        </div>
                        <div className="text-base font-semibold">
                          Commission Report
                        </div>
                        <div className="text-sm">
                          {profileName}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {rMonths.length === 1
                            ? getPeriodLabel(
                                rMonths[0].year,
                                rMonths[0].month
                              )
                            : `${getPeriodLabel(
                                rMonths[0].year,
                                rMonths[0].month
                              )} through ${getPeriodLabel(
                                rMonths[rMonths.length - 1].year,
                                rMonths[rMonths.length - 1].month
                              )}`}
                        </div>
                      </div>

                      {/* Report Table */}
                      <table className="stmt-table">
                        <thead>
                          <tr>
                            <th>Account</th>
                            {rMonths.map((m) => (
                              <th key={`${m.year}-${m.month}`}>
                                {getPeriodShortLabel(m.year, m.month)}
                              </th>
                            ))}
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Revenue Section */}
                          <tr className="stmt-section-header">
                            <td colSpan={colCount}>Revenue</td>
                          </tr>
                          {revenueRows.map((row) => {
                            const isStriped = stripeIndex % 2 === 0;
                            stripeIndex++;
                            const rowTotal = monthKeys.reduce(
                              (sum, k) =>
                                sum + (row.monthlyValues[k] ?? 0),
                              0
                            );
                            return (
                              <tr
                                key={`rev-${row.accountId}`}
                                className={`stmt-line-item ${isStriped ? "stmt-row-striped" : ""}`}
                              >
                                <td>
                                  {[row.accountNumber, row.accountName]
                                    .filter(Boolean)
                                    .join(" ")}
                                  {row.classFilterLabel !==
                                    "All Classes" && (
                                    <span className="text-xs text-muted-foreground ml-1">
                                      ({row.classFilterLabel})
                                    </span>
                                  )}
                                </td>
                                {monthKeys.map((k) => (
                                  <td key={k}>
                                    {fmtVal(row.monthlyValues[k] ?? 0)}
                                  </td>
                                ))}
                                <td>{fmtVal(rowTotal)}</td>
                              </tr>
                            );
                          })}
                          {revenueRows.length === 0 && (
                            <tr className="stmt-line-item">
                              <td
                                colSpan={colCount}
                                className="text-muted-foreground italic"
                              >
                                No revenue accounts assigned
                              </td>
                            </tr>
                          )}
                          <tr className="stmt-subtotal">
                            <td>Total Revenue</td>
                            {monthKeys.map((k) => (
                              <td key={k}>
                                {fmtVal(monthlyRevenue[k] ?? 0)}
                              </td>
                            ))}
                            <td>{fmtVal(totalRevenue)}</td>
                          </tr>

                          <tr className="stmt-separator">
                            <td colSpan={colCount} />
                          </tr>

                          {/* Expense Section */}
                          <tr className="stmt-section-header">
                            <td colSpan={colCount}>
                              Expense Deductions
                            </td>
                          </tr>
                          {expenseRows.map((row) => {
                            const isStriped = stripeIndex % 2 === 0;
                            stripeIndex++;
                            const rowTotal = monthKeys.reduce(
                              (sum, k) =>
                                sum + (row.monthlyValues[k] ?? 0),
                              0
                            );
                            return (
                              <tr
                                key={`exp-${row.accountId}`}
                                className={`stmt-line-item ${isStriped ? "stmt-row-striped" : ""}`}
                              >
                                <td>
                                  {[row.accountNumber, row.accountName]
                                    .filter(Boolean)
                                    .join(" ")}
                                  {row.classFilterLabel !==
                                    "All Classes" && (
                                    <span className="text-xs text-muted-foreground ml-1">
                                      ({row.classFilterLabel})
                                    </span>
                                  )}
                                </td>
                                {monthKeys.map((k) => (
                                  <td key={k}>
                                    {fmtVal(row.monthlyValues[k] ?? 0)}
                                  </td>
                                ))}
                                <td>{fmtVal(rowTotal)}</td>
                              </tr>
                            );
                          })}
                          {expenseRows.length === 0 && (
                            <tr className="stmt-line-item">
                              <td
                                colSpan={colCount}
                                className="text-muted-foreground italic"
                              >
                                No expense accounts assigned
                              </td>
                            </tr>
                          )}
                          <tr className="stmt-subtotal">
                            <td>Total Expense Deductions</td>
                            {monthKeys.map((k) => (
                              <td key={k}>
                                {fmtVal(monthlyExpenses[k] ?? 0)}
                              </td>
                            ))}
                            <td>{fmtVal(totalExpenses)}</td>
                          </tr>

                          <tr className="stmt-separator">
                            <td colSpan={colCount} />
                          </tr>

                          {/* Commission Summary */}
                          <tr className="stmt-subtotal">
                            <td>Commission Base</td>
                            {monthKeys.map((k) => (
                              <td key={k}>
                                {fmtVal(
                                  (monthlyRevenue[k] ?? 0) -
                                    (monthlyExpenses[k] ?? 0)
                                )}
                              </td>
                            ))}
                            <td>
                              {fmtVal(
                                totalRevenue - totalExpenses
                              )}
                            </td>
                          </tr>
                          <tr className="stmt-margin-row">
                            <td style={{ paddingLeft: "2rem" }}>
                              Commission Rate
                            </td>
                            {monthKeys.map((k) => (
                              <td key={k}>
                                {formatPercentage(commissionRate)}
                              </td>
                            ))}
                            <td>
                              {formatPercentage(commissionRate)}
                            </td>
                          </tr>
                          <tr className="stmt-grand-total">
                            <td>Commission Earned</td>
                            {monthKeys.map((k) => {
                              const base =
                                (monthlyRevenue[k] ?? 0) -
                                (monthlyExpenses[k] ?? 0);
                              return (
                                <td key={k}>
                                  {fmtVal(base * commissionRate)}
                                </td>
                              );
                            })}
                            <td>
                              {fmtVal(
                                (totalRevenue - totalExpenses) *
                                  commissionRate
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Commission Report</DialogTitle>
                <DialogDescription>
                  Select a salesperson and date range to generate a
                  detailed commission report.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Salesperson</Label>
                  <Select
                    value={reportProfileId}
                    onValueChange={setReportProfileId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select salesperson..." />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Start Period</Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={String(reportStartMonth)}
                      onValueChange={(v) =>
                        setReportStartMonth(Number(v))
                      }
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {months.map((m) => (
                          <SelectItem key={m} value={String(m)}>
                            {new Date(2000, m - 1).toLocaleString(
                              "default",
                              { month: "long" }
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(reportStartYear)}
                      onValueChange={(v) =>
                        setReportStartYear(Number(v))
                      }
                    >
                      <SelectTrigger className="w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>End Period</Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={String(reportEndMonth)}
                      onValueChange={(v) =>
                        setReportEndMonth(Number(v))
                      }
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {months.map((m) => (
                          <SelectItem key={m} value={String(m)}>
                            {new Date(2000, m - 1).toLocaleString(
                              "default",
                              { month: "long" }
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(reportEndYear)}
                      onValueChange={(v) =>
                        setReportEndYear(Number(v))
                      }
                    >
                      <SelectTrigger className="w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setReportDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleGenerateReport}
                    disabled={reportLoading}
                  >
                    {reportLoading && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Generate Report
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page: toggle between GL calculator and RW sales commissions ────────

export default function CommissionsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const [mode, setMode] = useState<"gl" | "sales">("gl");

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-lg border bg-muted/40 p-1 gap-1">
        <Button
          variant={mode === "gl" ? "default" : "ghost"}
          size="sm"
          onClick={() => setMode("gl")}
        >
          GL Calculator
        </Button>
        <Button
          variant={mode === "sales" ? "default" : "ghost"}
          size="sm"
          onClick={() => setMode("sales")}
        >
          Sales Commissions (RentalWorks)
        </Button>
      </div>
      {mode === "gl" ? (
        <GlCommissionsSection />
      ) : (
        <SalesCommissionSection entityId={entityId} />
      )}
    </div>
  );
}

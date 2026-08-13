"use client";

/**
 * Salesperson commissions driven by RentalWorks invoices, per customer.
 * Rates are percentage tiers: each plan has named rate types with one
 * default; customers are assigned to a rate type and everyone unassigned
 * flows into the default. A 0% rate type is how customers get excluded.
 */

import { useState, useEffect, useCallback, useRef } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Plus,
  Calculator,
  Trash2,
  Pencil,
  Loader2,
  Download,
  Search,
  UserPlus,
} from "lucide-react";
import { formatCurrency, getCurrentPeriod } from "@/lib/utils/dates";
import {
  createWorkbook,
  addSheet,
  downloadWorkbook,
  NUMBER_FORMATS,
} from "@/lib/utils/excel";

// ── Types ──────────────────────────────────────────────────────────────

interface SalesPlan {
  id: string;
  entity_id: string;
  salesperson_name: string;
  is_active: boolean;
  notes: string | null;
}

interface RateType {
  id: string;
  plan_id: string;
  name: string;
  rate_percent: number;
  is_default: boolean;
}

interface CustomerAssignment {
  id: string;
  plan_id: string;
  rate_type_id: string;
  rw_customer_id: string;
  customer_name: string;
}

interface SavedRun {
  id: string;
  plan_id: string;
  period_year: number;
  period_month: number;
  total_revenue: number;
  total_commission: number;
  calculated_at: string;
}

interface CalcInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  subtotal: number;
}

interface CalcRow {
  rwCustomerId: string;
  customerName: string;
  invoiceCount: number;
  revenue: number;
  rateTypeName: string;
  ratePercent: number;
  commission: number;
  assigned: boolean;
  invoices?: CalcInvoice[];
}

interface SearchResult {
  rwCustomerId: string;
  customerName: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

async function api(body: Record<string, unknown>) {
  const res = await fetch("/api/sales-commissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

// ── Component ──────────────────────────────────────────────────────────

export function SalesCommissionSection({
  entityId,
  entityName,
}: {
  entityId: string;
  entityName?: string;
}) {
  const current = getCurrentPeriod();

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<SalesPlan[]>([]);
  const [rateTypes, setRateTypes] = useState<RateType[]>([]);
  const [assignments, setAssignments] = useState<CustomerAssignment[]>([]);
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  // Period
  const [periodYear, setPeriodYear] = useState(current.year);
  const [periodMonth, setPeriodMonth] = useState(current.month);

  // Calculation state
  const [calculating, setCalculating] = useState(false);
  const [calcRows, setCalcRows] = useState<CalcRow[] | null>(null);
  const [calcTotals, setCalcTotals] = useState<{
    revenue: number;
    commission: number;
  } | null>(null);
  const [calcPeriodLabel, setCalcPeriodLabel] = useState("");

  // Plan dialog
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SalesPlan | null>(null);
  const [planName, setPlanName] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [planSaving, setPlanSaving] = useState(false);

  // Rate dialog
  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<RateType | null>(null);
  const [rateName, setRateName] = useState("");
  const [ratePercent, setRatePercent] = useState("");
  const [rateIsDefault, setRateIsDefault] = useState(false);
  const [rateSaving, setRateSaving] = useState(false);

  // Customer search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addRateTypeId, setAddRateTypeId] = useState<string>("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const data = await api({ action: "get_config", entityId });
      setPlans(data.plans);
      setRateTypes(data.rateTypes);
      setAssignments(data.assignments);
      setRuns(data.runs);
      setSelectedPlanId((prev) => {
        if (prev && data.plans.some((p: SalesPlan) => p.id === prev)) return prev;
        return data.plans[0]?.id ?? null;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;
  const planRates = rateTypes.filter((rt) => rt.plan_id === selectedPlanId);
  const defaultRate = planRates.find((rt) => rt.is_default);
  const planAssignments = assignments.filter(
    (a) => a.plan_id === selectedPlanId,
  );

  // ── Plan CRUD ────────────────────────────────────────────────────────

  const openPlanDialog = (plan: SalesPlan | null) => {
    setEditingPlan(plan);
    setPlanName(plan?.salesperson_name ?? "");
    setPlanNotes(plan?.notes ?? "");
    setPlanDialogOpen(true);
  };

  const savePlan = async () => {
    if (!planName.trim()) return;
    setPlanSaving(true);
    try {
      const data = await api({
        action: "upsert_plan",
        entityId,
        planId: editingPlan?.id,
        salespersonName: planName,
        notes: planNotes || null,
      });
      toast.success(editingPlan ? "Salesperson updated" : "Salesperson added");
      setPlanDialogOpen(false);
      await loadConfig();
      if (!editingPlan && data.plan?.id) setSelectedPlanId(data.plan.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPlanSaving(false);
    }
  };

  const deletePlan = async (plan: SalesPlan) => {
    if (
      !window.confirm(
        `Delete ${plan.salesperson_name} and all their rates, customer assignments, and saved calculations?`,
      )
    )
      return;
    try {
      await api({ action: "delete_plan", planId: plan.id });
      toast.success("Salesperson deleted");
      setSelectedPlanId(null);
      await loadConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  // ── Rate type CRUD ───────────────────────────────────────────────────

  const openRateDialog = (rate: RateType | null) => {
    setEditingRate(rate);
    setRateName(rate?.name ?? "");
    setRatePercent(rate ? String(Number(rate.rate_percent)) : "");
    setRateIsDefault(rate?.is_default ?? false);
    setRateDialogOpen(true);
  };

  const saveRate = async () => {
    if (!selectedPlanId || !rateName.trim() || ratePercent === "") return;
    setRateSaving(true);
    try {
      await api({
        action: "upsert_rate_type",
        planId: selectedPlanId,
        rateTypeId: editingRate?.id,
        name: rateName,
        ratePercent: Number(ratePercent),
        isDefault: rateIsDefault,
      });
      toast.success(editingRate ? "Rate updated" : "Rate added");
      setRateDialogOpen(false);
      await loadConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setRateSaving(false);
    }
  };

  const deleteRate = async (rate: RateType) => {
    if (!window.confirm(`Delete the "${rate.name}" rate?`)) return;
    try {
      await api({ action: "delete_rate_type", rateTypeId: rate.id });
      toast.success("Rate deleted");
      await loadConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  // ── Customer assignment ──────────────────────────────────────────────

  const runSearch = (query: string) => {
    setSearchQuery(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api({ action: "search_rw_customers", query });
        setSearchResults(data.customers);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  };

  const assignCustomer = async (customer: SearchResult) => {
    if (!selectedPlanId) return;
    const rateTypeId = addRateTypeId || defaultRate?.id;
    if (!rateTypeId) {
      toast.error("Add a rate type first");
      return;
    }
    try {
      await api({
        action: "assign_customer",
        planId: selectedPlanId,
        rateTypeId,
        rwCustomerId: customer.rwCustomerId,
        customerName: customer.customerName,
      });
      toast.success(`${customer.customerName} assigned`);
      setSearchQuery("");
      setSearchResults([]);
      await loadConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assign failed");
    }
  };

  const changeAssignmentRate = async (
    assignment: CustomerAssignment,
    rateTypeId: string,
  ) => {
    try {
      await api({
        action: "assign_customer",
        planId: assignment.plan_id,
        rateTypeId,
        rwCustomerId: assignment.rw_customer_id,
        customerName: assignment.customer_name,
      });
      await loadConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const removeAssignment = async (assignment: CustomerAssignment) => {
    try {
      await api({ action: "remove_assignment", assignmentId: assignment.id });
      toast.success(
        `${assignment.customer_name} removed — flows to the default rate`,
      );
      await loadConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    }
  };

  // ── Calculate ────────────────────────────────────────────────────────

  const calculate = async () => {
    if (!selectedPlanId) return;
    setCalculating(true);
    setCalcRows(null);
    try {
      const data = await api({
        action: "calculate",
        planId: selectedPlanId,
        periodYear,
        periodMonth,
      });
      setCalcRows(data.detail);
      setCalcTotals({
        revenue: data.totalRevenue,
        commission: data.totalCommission,
      });
      setCalcPeriodLabel(`${MONTH_NAMES[periodMonth - 1]} ${periodYear}`);
      await loadConfig();
      toast.success(
        `Calculated: ${formatCurrency(data.totalCommission)} commission on ${formatCurrency(data.totalRevenue)} revenue`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Calculation failed");
    } finally {
      setCalculating(false);
    }
  };

  const exportExcel = async () => {
    if (!calcRows || !selectedPlan) return;
    const wb = createWorkbook({
      title: `${selectedPlan.salesperson_name} Commission — ${calcPeriodLabel}`,
    });
    addSheet(wb, {
      name: "Commission Summary",
      title: {
        entityName: entityName ?? "Versatile Studios",
        reportTitle: `Sales Commission — ${selectedPlan.salesperson_name}`,
        period: calcPeriodLabel,
        subtitle: "Base = RentalWorks invoice subtotal (pre-tax), by invoice date",
      },
      columns: [
        { header: "Customer", width: 42, value: (r: CalcRow) => r.customerName },
        {
          header: "Rate Type",
          width: 18,
          value: (r: CalcRow) => r.rateTypeName + (r.assigned ? "" : " (default)"),
        },
        {
          header: "Rate",
          width: 10,
          value: (r: CalcRow) => r.ratePercent / 100,
          format: NUMBER_FORMATS.percent,
        },
        {
          header: "Invoices",
          width: 10,
          value: (r: CalcRow) => r.invoiceCount,
          format: NUMBER_FORMATS.integer,
        },
        {
          header: "Revenue",
          width: 16,
          value: (r: CalcRow) => r.revenue,
          format: NUMBER_FORMATS.currency,
          total: "sum",
        },
        {
          header: "Commission",
          width: 16,
          value: (r: CalcRow) => r.commission,
          format: NUMBER_FORMATS.currency,
          total: "sum",
        },
      ],
      rows: calcRows,
      grandTotal: true,
      footnote:
        "Customers without an assigned rate type flow into the default rate. VOID, no-charge, and non-billable invoices are excluded.",
    });

    const invoiceRows = calcRows.flatMap((r) =>
      (r.invoices ?? []).map((inv) => ({
        customer: r.customerName,
        ...inv,
      })),
    );
    if (invoiceRows.length > 0) {
      addSheet(wb, {
        name: "Invoice Detail",
        title: {
          entityName: entityName ?? "Versatile Studios",
          reportTitle: "Invoices in Commission Base",
          period: calcPeriodLabel,
        },
        columns: [
          { header: "Customer", width: 42, value: (r) => r.customer },
          { header: "Invoice #", width: 14, value: (r) => r.invoiceNumber },
          { header: "Date", width: 12, value: (r) => r.invoiceDate },
          { header: "Status", width: 12, value: (r) => r.status },
          {
            header: "Subtotal",
            width: 16,
            value: (r) => r.subtotal,
            format: NUMBER_FORMATS.currency,
            total: "sum",
          },
        ],
        rows: invoiceRows,
        groupBy: (r) => r.customer,
        grandTotal: true,
      });
    }

    await downloadWorkbook(
      wb,
      `${selectedPlan.salesperson_name.replace(/\s+/g, "_")}_Commission_${periodYear}-${String(periodMonth).padStart(2, "0")}`,
    );
  };

  // ── Render ───────────────────────────────────────────────────────────

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const planRuns = runs.filter((r) => r.plan_id === selectedPlanId);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
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
            Sales Commissions
          </h1>
          <p className="text-muted-foreground">
            Percentage of RentalWorks invoice revenue, by customer
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => openPlanDialog(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Salesperson
          </Button>
        </div>
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No salespeople yet. Add one to set up their rates and customers.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Salesperson selector */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label>Salesperson</Label>
                  <Select
                    value={selectedPlanId ?? undefined}
                    onValueChange={setSelectedPlanId}
                  >
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Select salesperson" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.salesperson_name}
                          {!p.is_active && " (inactive)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedPlan && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openPlanDialog(selectedPlan)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deletePlan(selectedPlan)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {selectedPlan && (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Rate types */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>Rate Types</CardTitle>
                    <CardDescription>
                      Unassigned customers get the default rate. Use 0% to
                      exclude customers.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openRateDialog(null)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Rate
                  </Button>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Customers</TableHead>
                        <TableHead className="w-[90px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planRates.map((rt) => (
                        <TableRow key={rt.id}>
                          <TableCell>
                            {rt.name}{" "}
                            {rt.is_default && (
                              <Badge variant="secondary" className="ml-1">
                                default
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {Number(rt.rate_percent).toFixed(2).replace(/\.?0+$/, "")}%
                          </TableCell>
                          <TableCell className="text-right">
                            {
                              planAssignments.filter(
                                (a) => a.rate_type_id === rt.id,
                              ).length
                            }
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openRateDialog(rt)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {!rt.is_default && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => deleteRate(rt)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Customer assignments */}
              <Card>
                <CardHeader>
                  <CardTitle>Customer Assignments</CardTitle>
                  <CardDescription>
                    Search RentalWorks customers and pin them to a rate.
                    Everyone else flows into the default rate automatically.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search RW customers…"
                        value={searchQuery}
                        onChange={(e) => runSearch(e.target.value)}
                        className="pl-8"
                      />
                    </div>
                    <Select
                      value={addRateTypeId || defaultRate?.id || ""}
                      onValueChange={setAddRateTypeId}
                    >
                      <SelectTrigger className="w-[170px]">
                        <SelectValue placeholder="Rate" />
                      </SelectTrigger>
                      <SelectContent>
                        {planRates.map((rt) => (
                          <SelectItem key={rt.id} value={rt.id}>
                            {rt.name} (
                            {Number(rt.rate_percent).toFixed(2).replace(/\.?0+$/, "")}
                            %)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {(searching || searchResults.length > 0) && (
                    <div className="rounded-md border divide-y max-h-56 overflow-y-auto">
                      {searching && (
                        <div className="p-3 text-sm text-muted-foreground">
                          Searching…
                        </div>
                      )}
                      {searchResults.map((c) => {
                        const already = planAssignments.some(
                          (a) => a.rw_customer_id === c.rwCustomerId,
                        );
                        return (
                          <button
                            key={c.rwCustomerId}
                            className="flex w-full items-center justify-between p-2.5 text-sm hover:bg-muted text-left"
                            onClick={() => assignCustomer(c)}
                          >
                            <span>{c.customerName}</span>
                            {already ? (
                              <Badge variant="outline">assigned</Badge>
                            ) : (
                              <UserPlus className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="w-[190px]">Rate Type</TableHead>
                        <TableHead className="w-[50px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planAssignments.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            className="text-center text-muted-foreground"
                          >
                            No customers pinned — everyone gets the default
                            rate.
                          </TableCell>
                        </TableRow>
                      )}
                      {planAssignments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>{a.customer_name}</TableCell>
                          <TableCell>
                            <Select
                              value={a.rate_type_id}
                              onValueChange={(v) => changeAssignmentRate(a, v)}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {planRates.map((rt) => (
                                  <SelectItem key={rt.id} value={rt.id}>
                                    {rt.name} (
                                    {Number(rt.rate_percent)
                                      .toFixed(2)
                                      .replace(/\.?0+$/, "")}
                                    %)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeAssignment(a)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Calculate */}
          {selectedPlan && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Monthly Calculation</CardTitle>
                  <CardDescription>
                    Pulls the month&apos;s Versatile invoices from RentalWorks
                    and applies each customer&apos;s rate to the pre-tax
                    subtotal.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(periodYear)}
                    onValueChange={(v) => setPeriodYear(Number(v))}
                  >
                    <SelectTrigger className="w-[95px]">
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
                  <Select
                    value={String(periodMonth)}
                    onValueChange={(v) => setPeriodMonth(Number(v))}
                  >
                    <SelectTrigger className="w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.map((m, i) => (
                        <SelectItem key={m} value={String(i + 1)}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={calculate} disabled={calculating}>
                    {calculating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Calculator className="mr-2 h-4 w-4" />
                    )}
                    Calculate
                  </Button>
                  {calcRows && (
                    <Button variant="outline" onClick={exportExcel}>
                      <Download className="mr-2 h-4 w-4" />
                      Excel
                    </Button>
                  )}
                </div>
              </CardHeader>
              {calcRows && calcTotals && (
                <CardContent>
                  <div className="mb-3 text-sm text-muted-foreground">
                    {calcPeriodLabel} — {calcRows.length} customers,{" "}
                    {formatCurrency(calcTotals.revenue)} revenue,{" "}
                    <span className="font-medium text-foreground">
                      {formatCurrency(calcTotals.commission)} commission
                    </span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Rate Type</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Invoices</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calcRows.map((r) => (
                        <TableRow key={r.rwCustomerId}>
                          <TableCell>{r.customerName}</TableCell>
                          <TableCell>
                            {r.rateTypeName}{" "}
                            {!r.assigned && (
                              <Badge variant="outline" className="ml-1">
                                default
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.ratePercent.toFixed(2).replace(/\.?0+$/, "")}%
                          </TableCell>
                          <TableCell className="text-right">
                            {r.invoiceCount}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(r.revenue)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(r.commission)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold">
                        <TableCell colSpan={4}>Total</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(calcTotals.revenue)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(calcTotals.commission)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          )}

          {/* History */}
          {selectedPlan && planRuns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Saved Calculations</CardTitle>
                <CardDescription>
                  Each month&apos;s last calculation is kept for reference.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead className="text-right">Calculated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {planRuns.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          {MONTH_NAMES[r.period_month - 1]} {r.period_year}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(r.total_revenue))}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(r.total_commission))}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {new Date(r.calculated_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Plan dialog */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPlan ? "Edit Salesperson" : "Add Salesperson"}
            </DialogTitle>
            <DialogDescription>
              Each salesperson has their own rates and customer assignments.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="Sean French"
              />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input
                value={planNotes}
                onChange={(e) => setPlanNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setPlanDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={savePlan} disabled={planSaving || !planName.trim()}>
                {planSaving && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rate dialog */}
      <Dialog open={rateDialogOpen} onOpenChange={setRateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRate ? "Edit Rate" : "Add Rate"}</DialogTitle>
            <DialogDescription>
              A percentage of invoice subtotal. Use 0% for excluded customers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={rateName}
                onChange={(e) => setRateName(e.target.value)}
                placeholder="Standard"
              />
            </div>
            <div className="space-y-2">
              <Label>Rate (%)</Label>
              <Input
                type="number"
                step="0.25"
                min="0"
                max="100"
                value={ratePercent}
                onChange={(e) => setRatePercent(e.target.value)}
                placeholder="6"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="rate-default"
                checked={rateIsDefault}
                disabled={editingRate?.is_default}
                onCheckedChange={(v) => setRateIsDefault(v === true)}
              />
              <Label htmlFor="rate-default" className="font-normal">
                Default rate (applies to all unassigned customers)
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setRateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={saveRate}
                disabled={rateSaving || !rateName.trim() || ratePercent === ""}
              >
                {rateSaving && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

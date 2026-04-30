"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Plus,
  RefreshCw,
  Calculator,
  Settings,
  Loader2,
  Trash2,
  Search,
  FileText,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { getCurrentQuarter } from "@/lib/utils/rebate-calculations";

interface RebateCustomer {
  id: string;
  customer_name: string;
  rw_customer_id: string | null;
  rw_customer_number: string | null;
  agreement_type: string;
  status: string;
  tax_rate: number;
  max_discount_percent: number | null;
  effective_date: string | null;
  use_global_exclusions: boolean;
  contract_storage_path: string | null;
  notes: string | null;
}

interface RebateTier {
  id?: string;
  label: string;
  threshold_min: number;
  threshold_max: number | null;
  rate_pro_supplies: number;
  rate_vehicle: number;
  rate_grip_lighting: number;
  rate_studio: number;
  max_disc_pro_supplies: number;
  max_disc_vehicle: number;
  max_disc_grip_lighting: number;
  max_disc_studio: number;
}

interface QuarterlySummary {
  id: string;
  quarter: string;
  total_revenue: number;       // rebate-applicable revenue (sum of final_amount)
  total_list_revenue: number;  // all revenue generated (sum of list_total)
  total_rebate: number;
  invoice_count: number;
  tier_label: string | null;
  is_paid: boolean;
}

interface RWCustomerResult {
  Customer: string;
  CustomerId: string;
  CustomerNumber: string;
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

const EMPTY_TIER: RebateTier = {
  label: "",
  threshold_min: 0,
  threshold_max: null,
  rate_pro_supplies: 0,
  rate_vehicle: 0,
  rate_grip_lighting: 0,
  rate_studio: 0,
  max_disc_pro_supplies: 0,
  max_disc_vehicle: 0,
  max_disc_grip_lighting: 0,
  max_disc_studio: 0,
};

export default function RebateTrackerPage({ entityId: entityIdProp, isEmbed, embedKey }: { entityId?: string; isEmbed?: boolean; embedKey?: string } = {}) {
  const params = useParams();
  const router = useRouter();
  const entityId = entityIdProp || (params.entityId as string);

  const apiFetch = useCallback((url: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as Record<string, string> || {}) };
    if (embedKey) headers["x-embed-key"] = embedKey;
    return fetch(url, { ...init, headers });
  }, [embedKey]);

  const [customers, setCustomers] = useState<RebateCustomer[]>([]);
  const [allTiers, setAllTiers] = useState<Record<string, RebateTier[]>>({});
  const [quarterlySummaries, setQuarterlySummaries] = useState<
    Record<string, QuarterlySummary[]>
  >({});
  const [orderTotals, setOrderTotals] = useState<Record<string, number>>({});
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [calculating, setCalculating] = useState(false);

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<RebateCustomer | null>(
    null,
  );
  const [formName, setFormName] = useState("");
  const [formRwId, setFormRwId] = useState("");
  const [formRwNumber, setFormRwNumber] = useState("");
  const [formType, setFormType] = useState<string>("commercial");
  const [formTaxRate, setFormTaxRate] = useState("9.75");
  const [formMaxDiscount, setFormMaxDiscount] = useState("");
  const [formEffectiveDate, setFormEffectiveDate] = useState("");
  const [formUseGlobalExcl, setFormUseGlobalExcl] = useState(true);
  const [formNotes, setFormNotes] = useState("");
  const [formContractPath, setFormContractPath] = useState<string | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [formTiers, setFormTiers] = useState<RebateTier[]>([]);
  const [saving, setSaving] = useState(false);

  // RW customer search
  const [rwSearchQuery, setRwSearchQuery] = useState("");
  const [rwSearchResults, setRwSearchResults] = useState<RWCustomerResult[]>(
    [],
  );
  const [rwSearching, setRwSearching] = useState(false);

  const loadData = useCallback(async () => {
    try {
      // Load config
      const configRes = await apiFetch("/api/rebates", {
        method: "POST",
        body: JSON.stringify({ action: "get_config", entityId }),
      });
      const config = await configRes.json();

      setCustomers(config.customers || []);

      // Group tiers by customer
      const tierMap: Record<string, RebateTier[]> = {};
      for (const t of config.tiers || []) {
        if (!tierMap[t.rebate_customer_id]) tierMap[t.rebate_customer_id] = [];
        tierMap[t.rebate_customer_id].push(t);
      }
      setAllTiers(tierMap);

      // Build quarterly summaries map from config response
      const summaryMap: Record<string, QuarterlySummary[]> = {};
      for (const s of config.quarterlySummaries || []) {
        const cid = s.rebate_customer_id;
        if (!summaryMap[cid]) summaryMap[cid] = [];
        summaryMap[cid].push(s);
      }
      setQuarterlySummaries(summaryMap);

      // Fetch active orders for commercial customers in parallel (non-blocking)
      const commercialCustomers = (config.customers || []).filter(
        (c: RebateCustomer) => c.agreement_type === "commercial" && c.rw_customer_id,
      );
      if (commercialCustomers.length > 0) {
        setLoadingOrders(true);
        Promise.allSettled(
          commercialCustomers.map(async (c: RebateCustomer) => {
            const res = await apiFetch("/api/rebates/sync", {
              method: "POST",
              body: JSON.stringify({
                action: "fetch_active_orders",
                customerId: c.id,
              }),
            });
            const data = await res.json();
            const total = (data.orders || []).reduce(
              (sum: number, o: { total: number }) => sum + o.total,
              0,
            );
            return { customerId: c.id, total };
          }),
        ).then((results) => {
          const totals: Record<string, number> = {};
          for (const r of results) {
            if (r.status === "fulfilled") {
              totals[r.value.customerId] = r.value.total;
            }
          }
          setOrderTotals(totals);
          setLoadingOrders(false);
        });
      }
    } finally {
      setLoading(false);
    }
  }, [entityId, apiFetch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-sync + calculate on mount in embed mode
  const embedSyncDone = useRef(false);
  useEffect(() => {
    if (!isEmbed || embedSyncDone.current || !entityId) return;
    embedSyncDone.current = true;
    (async () => {
      setSyncing(true);
      try {
        const syncRes = await apiFetch("/api/rebates/sync", {
          method: "POST",
          body: JSON.stringify({ action: "sync_all", entityId }),
        });
        const syncData = await syncRes.json();
        if (syncData.success) {
          await apiFetch("/api/rebates/calculate", {
            method: "POST",
            body: JSON.stringify({ action: "calculate_all", entityId }),
          });
          loadData();
        }
      } catch {
        // Silent fail for auto-sync
      } finally {
        setSyncing(false);
      }
    })();
  }, [isEmbed, entityId, apiFetch, loadData]);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch("/api/rebates/sync", {
        method: "POST",
        body: JSON.stringify({ action: "sync_all", entityId }),
      });
      const data = await res.json();
      if (data.success) {
        await apiFetch("/api/rebates/calculate", {
          method: "POST",
          body: JSON.stringify({ action: "calculate_all", entityId }),
        });
        toast.success(
          `Synced ${data.results?.length || 0} customers from RentalWorks`,
        );
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

  const handleCalculateAll = async () => {
    setCalculating(true);
    try {
      const res = await apiFetch("/api/rebates/calculate", {
        method: "POST",
        body: JSON.stringify({ action: "calculate_all", entityId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Rebates calculated for all customers");
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

  const handleSearchRwCustomer = async () => {
    if (!rwSearchQuery.trim()) return;
    setRwSearching(true);
    try {
      const res = await apiFetch("/api/rebates", {
        method: "POST",
        body: JSON.stringify({
          action: "search_rw_customers",
          query: rwSearchQuery,
        }),
      });
      const data = await res.json();
      setRwSearchResults(data.customers || []);
    } catch {
      toast.error("Search failed");
    } finally {
      setRwSearching(false);
    }
  };

  const selectRwCustomer = (c: RWCustomerResult) => {
    setFormName(c.Customer);
    setFormRwId(c.CustomerId);
    setFormRwNumber(c.CustomerNumber || "");
    setRwSearchResults([]);
    setRwSearchQuery("");
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF file");
      e.target.value = "";
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File too large. Maximum 25 MB.");
      e.target.value = "";
      return;
    }

    setUploadingPdf(true);
    try {
      const timestamp = Date.now();
      const storagePath = `${entityId}/rebates/${timestamp}_${file.name}`;
      const urlRes = await fetch("/api/storage/signed-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucket: "rebate-contracts",
          path: storagePath,
        }),
      });

      if (!urlRes.ok) {
        const urlData = await urlRes.json().catch(() => ({}));
        toast.error(urlData.error || "Failed to get upload URL");
        e.target.value = "";
        return;
      }

      const { signedUrl, token } = await urlRes.json();

      const uploadRes = await fetch(signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
          ...(token ? { "x-upsert": "false" } : {}),
        },
        body: file,
      });

      if (!uploadRes.ok) {
        toast.error("Failed to upload PDF to storage");
        e.target.value = "";
        return;
      }

      setFormContractPath(storagePath);
      toast.success("PDF uploaded successfully");
    } catch {
      toast.error("PDF upload failed");
    } finally {
      setUploadingPdf(false);
      e.target.value = "";
    }
  };

  const openAddDialog = () => {
    setEditingCustomer(null);
    setFormName("");
    setFormRwId("");
    setFormRwNumber("");
    setFormType("commercial");
    setFormTaxRate("9.75");
    setFormMaxDiscount("");
    setFormEffectiveDate("");
    setFormUseGlobalExcl(true);
    setFormNotes("");
    setFormContractPath(null);
    setFormTiers([
      {
        ...EMPTY_TIER,
        label: "Tier 1: $0 - $150k",
        threshold_min: 0,
        threshold_max: 150000,
      },
      {
        ...EMPTY_TIER,
        label: "Tier 2: $150k - $300k",
        threshold_min: 150000,
        threshold_max: 300000,
      },
      {
        ...EMPTY_TIER,
        label: "Tier 3: $300k+",
        threshold_min: 300000,
        threshold_max: null,
      },
    ]);
    setRwSearchQuery("");
    setRwSearchResults([]);
    setDialogOpen(true);
  };

  const openEditDialog = (c: RebateCustomer) => {
    setEditingCustomer(c);
    setFormName(c.customer_name);
    setFormRwId(c.rw_customer_id || "");
    setFormRwNumber(c.rw_customer_number || "");
    setFormType(c.agreement_type);
    setFormTaxRate(String(c.tax_rate));
    setFormMaxDiscount(c.max_discount_percent ? String(c.max_discount_percent) : "");
    setFormEffectiveDate(c.effective_date || "");
    setFormUseGlobalExcl(c.use_global_exclusions);
    setFormNotes(c.notes || "");
    setFormContractPath(c.contract_storage_path);
    setFormTiers(allTiers[c.id] || [{ ...EMPTY_TIER, label: "Default" }]);
    setDialogOpen(true);
  };

  const handleSaveCustomer = async () => {
    if (!formName) {
      toast.error("Customer name is required");
      return;
    }
    if (formType !== "freelancer" && !formRwId) {
      toast.error("RW Customer ID is required for commercial agreements");
      return;
    }
    if (formTiers.length === 0) {
      toast.error("At least one tier is required");
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch("/api/rebates", {
        method: "POST",
        body: JSON.stringify({
          action: "upsert_customer",
          entityId,
          customer: {
            id: editingCustomer?.id,
            customer_name: formName,
            rw_customer_id: formType === "freelancer" ? null : formRwId,
            rw_customer_number: formType === "freelancer" ? null : (formRwNumber || null),
            agreement_type: formType,
            tax_rate: parseFloat(formTaxRate) || 9.75,
            max_discount_percent: formMaxDiscount
              ? parseFloat(formMaxDiscount)
              : null,
            effective_date: formEffectiveDate || null,
            use_global_exclusions: formUseGlobalExcl,
            contract_storage_path: formContractPath,
            notes: formNotes || null,
          },
          tiers: formTiers,
          excludedICodes: [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          editingCustomer ? "Customer updated" : "Customer added",
        );
        setDialogOpen(false);
        loadData();

        // Auto-trigger sync for new commercial customers (freelancers add invoices manually)
        if (!editingCustomer && data.customerId && formType !== "freelancer") {
          toast.info("Starting initial invoice sync...");
          apiFetch("/api/rebates/sync", {
            method: "POST",
            body: JSON.stringify({
              action: "sync_customer",
              entityId,
              customerId: data.customerId,
            }),
          }).then(async (syncRes) => {
            const syncData = await syncRes.json();
            if (syncData.success) {
              toast.success(`Synced ${syncData.synced} invoices`);
              loadData();
            }
          });
        }
      } else {
        toast.error(data.error || "Save failed");
      }
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    if (!confirm("Delete this customer and all associated data?")) return;
    try {
      const res = await apiFetch("/api/rebates", {
        method: "POST",
        body: JSON.stringify({ action: "delete_customer", customerId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Customer deleted");
        loadData();
      } else {
        toast.error(data.error || "Delete failed");
      }
    } catch {
      toast.error("Delete failed");
    }
  };

  const updateTier = (idx: number, field: string, value: string | number | null) => {
    setFormTiers((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addTier = () => {
    setFormTiers((prev) => [
      ...prev,
      { ...EMPTY_TIER, label: `Tier ${prev.length + 1}` },
    ]);
  };

  const removeTier = (idx: number) => {
    setFormTiers((prev) => prev.filter((_, i) => i !== idx));
  };

  // Quarter navigation
  const currentQtr = getCurrentQuarter();
  const [selectedQuarter, setSelectedQuarter] = useState(currentQtr);

  const shiftQuarter = (quarter: string, delta: number): string => {
    const match = quarter.match(/^(\d{4})\s*Q(\d)$/);
    if (!match) return quarter;
    let year = parseInt(match[1]);
    let q = parseInt(match[2]) + delta;
    while (q < 1) { year--; q += 4; }
    while (q > 4) { year++; q -= 4; }
    return `${year} Q${q}`;
  };

  const selectedYear = parseInt(selectedQuarter.split(" ")[0]);

  // Revenue displays on this page show ALL revenue generated (list_total),
  // not just rebate-applicable revenue. Rebate columns still use total_rebate.
  const getCustomerYTDRevenue = (customerId: string) => {
    const sums = quarterlySummaries[customerId] || [];
    return sums
      .filter((s) => s.quarter.startsWith(String(selectedYear)))
      .reduce((total, s) => total + (s.total_list_revenue || 0), 0);
  };

  const getCustomerYTDRebate = (customerId: string) => {
    const sums = quarterlySummaries[customerId] || [];
    return sums
      .filter((s) => s.quarter.startsWith(String(selectedYear)))
      .reduce((total, s) => total + (s.total_rebate || 0), 0);
  };

  const getCustomerQtrRevenue = (customerId: string) => {
    const sums = quarterlySummaries[customerId] || [];
    const qtr = sums.find((s) => s.quarter === selectedQuarter);
    return qtr?.total_list_revenue || 0;
  };

  const getCustomerQtrRebate = (customerId: string) => {
    const sums = quarterlySummaries[customerId] || [];
    const qtr = sums.find((s) => s.quarter === selectedQuarter);
    return qtr?.total_rebate || 0;
  };

  const getCustomerTotalRevenue = (customerId: string) => {
    const sums = quarterlySummaries[customerId] || [];
    return sums.reduce((total, s) => total + (s.total_list_revenue || 0), 0);
  };

  const totalYTDRevenue = customers.reduce(
    (s, c) => s + getCustomerYTDRevenue(c.id),
    0,
  );
  const totalYTDRebate = customers.reduce(
    (s, c) => s + getCustomerYTDRebate(c.id),
    0,
  );
  const totalQtrRebate = customers.reduce(
    (s, c) => s + getCustomerQtrRebate(c.id),
    0,
  );
  const totalActiveOrders = Object.values(orderTotals).reduce(
    (s, v) => s + v,
    0,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Rebate Tracker</h1>
          <p className="text-muted-foreground">
            Track commercial exclusive rebate agreements
          </p>
        </div>
        <div className="flex gap-2">
          {!isEmbed && (
            <Link href={`/${entityId}/rebates/settings`}>
              <Button variant="outline" size="sm">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
            </Link>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncAll}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCalculateAll}
            disabled={calculating}
          >
            {calculating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="mr-2 h-4 w-4" />
            )}
            Calculate All
          </Button>
          <Button size="sm" onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Customer
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Agreements</CardDescription>
            <CardTitle className="text-3xl">
              {customers.filter((c) => c.status === "active").length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Orders</CardDescription>
            <CardTitle className="text-3xl">
              {loadingOrders ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                formatCurrency(totalActiveOrders)
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{selectedYear} Revenue</CardDescription>
            <CardTitle className="text-3xl">
              {formatCurrency(totalYTDRevenue)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{selectedYear} Rebates</CardDescription>
            <CardTitle className="text-3xl">
              {formatCurrency(totalYTDRebate)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSelectedQuarter(shiftQuarter(selectedQuarter, -1))}
                className="p-0.5 rounded hover:bg-muted transition-colors"
              >
                <ChevronLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              <CardDescription>{selectedQuarter} Rebates</CardDescription>
              <button
                onClick={() => setSelectedQuarter(shiftQuarter(selectedQuarter, 1))}
                className="p-0.5 rounded hover:bg-muted transition-colors"
              >
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <CardTitle className="text-3xl">
              {formatCurrency(totalQtrRebate)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Commercial Agreements Table */}
      <Card>
        <CardHeader>
          <CardTitle>Commercial Agreements</CardTitle>
          <CardDescription>Exclusive rebate agreements with commercial customers</CardDescription>
        </CardHeader>
        <CardContent>
          {customers.filter((c) => c.agreement_type === "commercial").length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <p className="text-sm">No commercial agreements yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Account #</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">Active Orders</TableHead>
                  <TableHead className="text-right">{selectedYear} Revenue</TableHead>
                  <TableHead className="text-right">{selectedYear} Rebate</TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedQuarter(shiftQuarter(selectedQuarter, -1)); }}
                        className="p-0.5 rounded hover:bg-muted transition-colors"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="whitespace-nowrap">{selectedQuarter} Revenue</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedQuarter(shiftQuarter(selectedQuarter, 1)); }}
                        className="p-0.5 rounded hover:bg-muted transition-colors"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    {selectedQuarter} Rebate
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers
                  .filter((c) => c.agreement_type === "commercial")
                  .map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(isEmbed ? `/embed/versatile/rebates/${c.id}` : `/${entityId}/rebates/${c.id}`)
                    }
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {c.contract_storage_path && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetch("/api/storage/signed-download-url", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    bucket: "rebate-contracts",
                                    path: c.contract_storage_path,
                                  }),
                                });
                                const data = await res.json();
                                if (data.signedUrl) {
                                  window.open(data.signedUrl, "_blank");
                                } else {
                                  toast.error(data.error || "Failed to open PDF");
                                }
                              } catch {
                                toast.error("Failed to open PDF");
                              }
                            }}
                            title="View contract PDF"
                          >
                            <FileText className="h-4 w-4 text-red-600 shrink-0 hover:text-red-800 transition-colors" />
                          </button>
                        )}
                        {c.customer_name}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.agreement_type === "freelancer"
                        ? "N/A"
                        : c.rw_customer_number || c.rw_customer_id}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerTotalRevenue(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      {loadingOrders ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />
                      ) : (
                        formatCurrency(orderTotals[c.id] || 0)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerYTDRevenue(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerYTDRebate(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerQtrRevenue(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerQtrRebate(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="flex justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(c)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => handleDeleteCustomer(c.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Freelancer Agreements Table */}
      <Card>
        <CardHeader>
          <CardTitle>Freelancer Agreements</CardTitle>
          <CardDescription>Rebate agreements with freelancers (invoices added manually)</CardDescription>
        </CardHeader>
        <CardContent>
          {customers.filter((c) => c.agreement_type === "freelancer").length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <p className="text-sm">No freelancer agreements yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">{selectedYear} Revenue</TableHead>
                  <TableHead className="text-right">{selectedYear} Rebate</TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedQuarter(shiftQuarter(selectedQuarter, -1)); }}
                        className="p-0.5 rounded hover:bg-muted transition-colors"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="whitespace-nowrap">{selectedQuarter} Revenue</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedQuarter(shiftQuarter(selectedQuarter, 1)); }}
                        className="p-0.5 rounded hover:bg-muted transition-colors"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    {selectedQuarter} Rebate
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers
                  .filter((c) => c.agreement_type === "freelancer")
                  .map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(isEmbed ? `/embed/versatile/rebates/${c.id}` : `/${entityId}/rebates/${c.id}`)
                    }
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {c.contract_storage_path && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetch("/api/storage/signed-download-url", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    bucket: "rebate-contracts",
                                    path: c.contract_storage_path,
                                  }),
                                });
                                const data = await res.json();
                                if (data.signedUrl) {
                                  window.open(data.signedUrl, "_blank");
                                } else {
                                  toast.error(data.error || "Failed to open PDF");
                                }
                              } catch {
                                toast.error("Failed to open PDF");
                              }
                            }}
                            title="View contract PDF"
                          >
                            <FileText className="h-4 w-4 text-red-600 shrink-0 hover:text-red-800 transition-colors" />
                          </button>
                        )}
                        {c.customer_name}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerTotalRevenue(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerYTDRevenue(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerYTDRebate(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerQtrRevenue(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerQtrRebate(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="flex justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(c)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => handleDeleteCustomer(c.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Customer Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCustomer ? "Edit Customer" : "Add New Customer"}
            </DialogTitle>
            <DialogDescription>
              {editingCustomer
                ? "Update the rebate agreement configuration."
                : "Search RentalWorks for the customer, then configure their rebate agreement."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* RW Customer Search (only for new commercial customers) */}
            {!editingCustomer && formType !== "freelancer" && (
              <div className="space-y-2">
                <Label>Search RentalWorks Customer</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Type customer name..."
                    value={rwSearchQuery}
                    onChange={(e) => setRwSearchQuery(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleSearchRwCustomer()
                    }
                  />
                  <Button
                    variant="outline"
                    onClick={handleSearchRwCustomer}
                    disabled={rwSearching}
                  >
                    {rwSearching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {rwSearchResults.length > 0 && (
                  <div className="border rounded-md max-h-40 overflow-y-auto">
                    {rwSearchResults.map((r) => (
                      <button
                        key={r.CustomerId}
                        className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                        onClick={() => selectRwCustomer(r)}
                      >
                        <span className="font-medium">{r.Customer}</span>
                        {r.CustomerNumber && (
                          <span className="text-muted-foreground ml-2">
                            #{r.CustomerNumber}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer Name</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={formType === "freelancer" ? "Enter customer name" : ""}
                />
              </div>
              {formType !== "freelancer" && (
                <div className="space-y-2">
                  <Label>RW Customer ID</Label>
                  <Input
                    value={formRwId}
                    onChange={(e) => setFormRwId(e.target.value)}
                    placeholder="Auto-filled from search"
                    readOnly={!!formRwNumber}
                  />
                  {formRwNumber && (
                    <p className="text-xs text-muted-foreground">
                      Account #: {formRwNumber}
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label>Agreement Type</Label>
                <Select value={formType} onValueChange={(v) => {
                  setFormType(v);
                  if (v === "freelancer") {
                    setFormRwId("");
                    setFormRwNumber("");
                    setRwSearchQuery("");
                    setRwSearchResults([]);
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="freelancer">Freelancer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tax Rate (%)</Label>
                <Input
                  value={formTaxRate}
                  onChange={(e) => setFormTaxRate(e.target.value)}
                  type="number"
                  step="0.01"
                />
              </div>
              {formType === "freelancer" && (
                <div className="space-y-2">
                  <Label>Max Discount (%)</Label>
                  <Input
                    value={formMaxDiscount}
                    onChange={(e) => setFormMaxDiscount(e.target.value)}
                    type="number"
                    step="0.01"
                    placeholder="Global cap"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Effective Date</Label>
                <Input
                  value={formEffectiveDate}
                  onChange={(e) => setFormEffectiveDate(e.target.value)}
                  type="date"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={formUseGlobalExcl}
                onCheckedChange={setFormUseGlobalExcl}
              />
              <Label>Use global I-Code exclusions</Label>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
              />
            </div>

            {/* Contract PDF Upload */}
            <div className="space-y-2">
              <Label>Exclusive Agreement PDF</Label>
              {formContractPath ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 text-red-600 shrink-0" />
                  <span className="truncate flex-1">
                    {formContractPath.split("/").pop()?.replace(/^\d+_/, "")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => setFormContractPath(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    type="file"
                    accept=".pdf"
                    onChange={handlePdfUpload}
                    disabled={uploadingPdf}
                  />
                  {uploadingPdf && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-md">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="ml-2 text-sm">Uploading...</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tier Editor */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Rebate Tiers</Label>
                <Button variant="outline" size="sm" onClick={addTier}>
                  <Plus className="mr-1 h-3 w-3" />
                  Add Tier
                </Button>
              </div>
              {formTiers.map((tier, idx) => (
                <Card key={idx} className="overflow-hidden">
                  {/* Tier Header */}
                  <div className="flex items-center gap-3 bg-muted/50 px-4 py-2.5 border-b">
                    <Input
                      value={tier.label}
                      onChange={(e) =>
                        updateTier(idx, "label", e.target.value)
                      }
                      placeholder="Tier label"
                      className="max-w-[160px] h-8 text-sm font-medium bg-background"
                    />
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span>$</span>
                      <Input
                        type="number"
                        value={tier.threshold_min}
                        onChange={(e) =>
                          updateTier(
                            idx,
                            "threshold_min",
                            parseFloat(e.target.value) || 0,
                          )
                        }
                        className="w-24 h-8 text-sm bg-background"
                      />
                      <span>&ndash;</span>
                      <span>$</span>
                      <Input
                        type="number"
                        value={tier.threshold_max ?? ""}
                        onChange={(e) =>
                          updateTier(
                            idx,
                            "threshold_max",
                            e.target.value
                              ? parseFloat(e.target.value)
                              : null,
                          )
                        }
                        placeholder="No limit"
                        className="w-24 h-8 text-sm bg-background"
                      />
                    </div>
                    <div className="flex-1" />
                    {formTiers.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => removeTier(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>

                  {/* Rates Table */}
                  <div className="px-1">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-[140px] text-xs font-medium h-9">
                            Equipment Type
                          </TableHead>
                          <TableHead className="text-xs font-medium text-center h-9">
                            Rebate %
                          </TableHead>
                          <TableHead className="text-xs font-medium text-center h-9">
                            Max Disc %
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {([
                          { label: "Pro Supplies", rateKey: "rate_pro_supplies", discKey: "max_disc_pro_supplies" },
                          { label: "Vehicle", rateKey: "rate_vehicle", discKey: "max_disc_vehicle" },
                          { label: "G&L", rateKey: "rate_grip_lighting", discKey: "max_disc_grip_lighting" },
                          { label: "Studio", rateKey: "rate_studio", discKey: "max_disc_studio" },
                        ] as const).map((eq) => (
                          <TableRow key={eq.rateKey} className="hover:bg-transparent">
                            <TableCell className="py-1.5 text-sm font-medium">
                              {eq.label}
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                type="number"
                                step="0.01"
                                value={tier[eq.rateKey]}
                                onChange={(e) =>
                                  updateTier(
                                    idx,
                                    eq.rateKey,
                                    parseFloat(e.target.value) || 0,
                                  )
                                }
                                className="h-8 text-sm text-center w-24 mx-auto"
                              />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                type="number"
                                step="0.01"
                                value={tier[eq.discKey]}
                                onChange={(e) =>
                                  updateTier(
                                    idx,
                                    eq.discKey,
                                    parseFloat(e.target.value) || 0,
                                  )
                                }
                                className="h-8 text-sm text-center w-24 mx-auto"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCustomer} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingCustomer ? "Save Changes" : "Add Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

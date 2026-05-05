"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AccountCombobox } from "@/components/ui/account-combobox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { formatCurrency, getCurrentPeriod } from "@/lib/utils/dates";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Link2,
  Unlink,
  BarChart3,
  Pencil,
  Upload,
  Wand2,
  AlertTriangle,
  ArrowLeftRight,
} from "lucide-react";
import type { AccountClassification } from "@/lib/types/database";
import { ImportMappingsDialog } from "./import-mappings-dialog";

interface MasterAccount {
  id: string;
  organization_id: string;
  account_number: string;
  name: string;
  description: string | null;
  classification: string;
  account_type: string;
  account_sub_type: string | null;
  parent_account_id: string | null;
  is_active: boolean;
  is_intercompany: boolean;
  display_order: number;
  normal_balance: string;
  created_at: string;
}

interface EntityAccount {
  id: string;
  entity_id: string;
  name: string;
  account_number: string | null;
  classification: string;
  account_type: string;
  current_balance: number;
}

interface Entity {
  id: string;
  name: string;
  code: string;
}

interface Mapping {
  id: string;
  master_account_id: string;
  entity_id: string;
  account_id: string;
  entities: Entity;
  accounts: EntityAccount;
}

interface UnmappedAccountMonthly {
  id: string;
  entityId: string;
  entityName: string;
  entityCode: string;
  name: string;
  accountNumber: string | null;
  classification: string;
  monthlyBalances: Record<number, number>;
}

interface MasterChart {
  id: string;
  organization_id: string;
  name: string;
  kind: "management" | "accountant";
  is_default: boolean;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const CLASSIFICATION_COLORS: Record<AccountClassification, string> = {
  Asset: "bg-blue-100 text-blue-800",
  Liability: "bg-red-100 text-red-800",
  Equity: "bg-purple-100 text-purple-800",
  Revenue: "bg-green-100 text-green-800",
  Expense: "bg-orange-100 text-orange-800",
};

const CLASSIFICATIONS: AccountClassification[] = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
];

const ACCOUNT_TYPES: Record<AccountClassification, string[]> = {
  Asset: [
    "Bank",
    "Accounts Receivable",
    "Other Current Asset",
    "Fixed Asset",
    "Other Asset",
  ],
  Liability: [
    "Accounts Payable",
    "Credit Card",
    "Other Current Liability",
    "Long Term Liability",
  ],
  Equity: ["Equity"],
  Revenue: ["Income", "Other Income"],
  Expense: ["Expense", "Other Expense", "Cost of Goods Sold"],
};

export default function MasterGLPage() {
  const router = useRouter();
  const supabase = createClient();

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [charts, setCharts] = useState<MasterChart[]>([]);
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [masterAccounts, setMasterAccounts] = useState<MasterAccount[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityAccounts, setEntityAccounts] = useState<
    Record<string, EntityAccount[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"classification" | "rollup">(
    "classification",
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Dialog state for adding/editing master accounts
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingAccount, setEditingAccount] = useState<MasterAccount | null>(
    null
  );
  const [formData, setFormData] = useState({
    accountNumber: "",
    name: "",
    description: "",
    classification: "Asset" as AccountClassification,
    accountType: "",
    accountSubType: "",
    parentAccountId: "" as string,
    isIntercompany: false,
  });
  const [saving, setSaving] = useState(false);

  // Sheet state for mapping
  const [mappingAccount, setMappingAccount] = useState<MasterAccount | null>(
    null
  );
  const [mappingSheetOpen, setMappingSheetOpen] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string>("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  // Bulk setup state
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [bulkEntityId, setBulkEntityId] = useState<string>("");
  const [bulkRunning, setBulkRunning] = useState(false);

  // Import wizard state
  const [showImportDialog, setShowImportDialog] = useState(false);

  // Unmapped accounts monthly grid state
  const currentPeriod = getCurrentPeriod();
  const [unmappedYear, setUnmappedYear] = useState(currentPeriod.year);

  // Mapped totals state (year-end balances per master account & per mapping)
  const [totalsYear, setTotalsYear] = useState(2025);
  const [masterTotals, setMasterTotals] = useState<Record<string, number>>({});
  const [mappedBalances, setMappedBalances] = useState<Record<string, number>>(
    {},
  );
  const [totalsLoading, setTotalsLoading] = useState(false);

  // Year-end adjustments for the active chart, keyed by master_account_id +
  // period_year. Used to true up the accountant view to externally prepared
  // statements (e.g., IC residual offsets).
  interface YearAdjustment {
    id: string;
    master_account_id: string;
    chart_id: string;
    entity_id?: string | null;
    period_year: number;
    amount: number;
    note: string | null;
    offset_to_ic_net?: boolean;
  }
  const [yearAdjustments, setYearAdjustments] = useState<YearAdjustment[]>([]);
  const [adjAmountInput, setAdjAmountInput] = useState("");
  const [adjNoteInput, setAdjNoteInput] = useState("");
  const [adjOffsetIc, setAdjOffsetIc] = useState(false);
  const [adjEntityId, setAdjEntityId] = useState<string>("");
  const [adjSaving, setAdjSaving] = useState(false);
  const [unmappedAccounts, setUnmappedAccounts] = useState<
    UnmappedAccountMonthly[]
  >([]);
  const [unmappedLoading, setUnmappedLoading] = useState(false);
  const [unmappedEntityFilter, setUnmappedEntityFilter] =
    useState("all");
  const [collapsedEntities, setCollapsedEntities] = useState<
    Record<string, boolean>
  >({});

  const loadOrganization = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (membership) {
      setOrganizationId(membership.organization_id);
    }
  }, [supabase]);

  const loadCharts = useCallback(async () => {
    const response = await fetch("/api/master-charts");
    const data = await response.json();
    if (data.charts) {
      setCharts(data.charts);
      // Default to the management chart on first load
      if (!selectedChartId) {
        const mgmt = data.charts.find(
          (c: MasterChart) => c.kind === "management"
        );
        if (mgmt) setSelectedChartId(mgmt.id);
      }
    }
  }, [selectedChartId]);

  const loadMasterAccounts = useCallback(async () => {
    if (!organizationId || !selectedChartId) return;

    const response = await fetch(
      `/api/master-accounts?chartId=${selectedChartId}`
    );
    const data = await response.json();
    if (data.accounts) {
      setMasterAccounts(data.accounts);
    }
  }, [organizationId, selectedChartId]);

  const loadMappings = useCallback(async () => {
    if (!organizationId || !selectedChartId) return;

    const response = await fetch(
      `/api/master-accounts/mappings?organizationId=${organizationId}&chartId=${selectedChartId}`
    );
    const data = await response.json();
    if (data.mappings) {
      setMappings(data.mappings);
    }
  }, [organizationId, selectedChartId]);

  const loadEntities = useCallback(async () => {
    if (!organizationId) return;

    const data = await fetchAllPaginated<any>((offset, limit) =>
      supabase
        .from("entities")
        .select("id, name, code")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name")
        .range(offset, offset + limit - 1)
    );

    setEntities(data);
    // Load accounts for each entity
    const accountsByEntity: Record<string, EntityAccount[]> = {};
    for (const entity of data) {
      const accounts = await fetchAllPaginated<EntityAccount>((offset, limit) =>
        supabase
          .from("accounts")
          .select(
            "id, entity_id, name, account_number, classification, account_type, current_balance"
          )
          .eq("entity_id", entity.id)
          .eq("is_active", true)
          .order("classification")
          .order("account_number")
          .order("name")
          .range(offset, offset + limit - 1)
      );
      accountsByEntity[entity.id] = accounts;
    }
    setEntityAccounts(accountsByEntity);
  }, [supabase, organizationId]);

  const loadYearAdjustments = useCallback(async () => {
    if (!organizationId || !selectedChartId) return;
    try {
      const response = await fetch(
        `/api/master-accounts/year-adjustments?organizationId=${organizationId}&chartId=${selectedChartId}`,
      );
      const data = await response.json();
      if (data.adjustments) setYearAdjustments(data.adjustments);
    } catch {
      // silent
    }
  }, [organizationId, selectedChartId]);

  const loadMappedTotals = useCallback(async () => {
    if (!organizationId || !selectedChartId) return;
    setTotalsLoading(true);
    try {
      const response = await fetch(
        `/api/master-accounts/consolidated?organizationId=${organizationId}&chartId=${selectedChartId}&periodYear=${totalsYear}&periodMonth=12`,
      );
      const data = await response.json();
      if (data.consolidated) {
        const masterMap: Record<string, number> = {};
        const accountMap: Record<string, number> = {};
        for (const item of data.consolidated as Array<{
          masterAccountId: string;
          endingBalance: number;
          entityBreakdown: Array<{ accountId: string; endingBalance: number }>;
        }>) {
          masterMap[item.masterAccountId] = item.endingBalance;
          for (const eb of item.entityBreakdown) {
            accountMap[eb.accountId] = eb.endingBalance;
          }
        }
        setMasterTotals(masterMap);
        setMappedBalances(accountMap);
      }
    } catch {
      // silent — Total column will just show zeros
    }
    setTotalsLoading(false);
  }, [organizationId, selectedChartId, totalsYear]);

  const loadUnmappedMonthly = useCallback(async () => {
    if (!organizationId || !selectedChartId) return;
    setUnmappedLoading(true);

    try {
      const response = await fetch(
        `/api/master-accounts/unmapped-monthly?organizationId=${organizationId}&year=${unmappedYear}&chartId=${selectedChartId}`
      );
      const data = await response.json();
      if (data.unmappedAccounts) {
        setUnmappedAccounts(data.unmappedAccounts);
      }
    } catch {
      // silently fail — the section will just show empty
    }
    setUnmappedLoading(false);
  }, [organizationId, selectedChartId, unmappedYear]);

  useEffect(() => {
    loadOrganization();
    loadCharts();
  }, [loadOrganization, loadCharts]);

  useEffect(() => {
    if (organizationId && selectedChartId) {
      Promise.all([loadMasterAccounts(), loadMappings(), loadEntities()]).then(
        () => setLoading(false)
      );
    }
  }, [
    organizationId,
    selectedChartId,
    loadMasterAccounts,
    loadMappings,
    loadEntities,
  ]);

  useEffect(() => {
    if (organizationId && selectedChartId) {
      loadUnmappedMonthly();
    }
  }, [organizationId, selectedChartId, loadUnmappedMonthly]);

  useEffect(() => {
    if (organizationId && selectedChartId) {
      loadMappedTotals();
    }
  }, [organizationId, selectedChartId, loadMappedTotals]);

  useEffect(() => {
    if (organizationId && selectedChartId) {
      loadYearAdjustments();
    }
  }, [organizationId, selectedChartId, loadYearAdjustments]);

  // Default the master account list view based on the active chart's kind:
  // accountant charts open in "By Rollup" since their structure is built
  // around parent rollups; management charts default to "By Classification".
  // Re-runs only when the chart changes — within a session the user can
  // still flip the toggle and have it stick until the next chart switch.
  useEffect(() => {
    if (!selectedChartId || charts.length === 0) return;
    const chart = charts.find((c) => c.id === selectedChartId);
    if (!chart) return;
    setViewMode(chart.kind === "accountant" ? "rollup" : "classification");
  }, [selectedChartId, charts]);

  function resetForm() {
    setFormData({
      accountNumber: "",
      name: "",
      description: "",
      classification: "Asset",
      accountType: "",
      accountSubType: "",
      parentAccountId: "",
      isIntercompany: false,
    });
  }

  function openAddDialog() {
    resetForm();
    setEditingAccount(null);
    setShowAddDialog(true);
  }

  function openEditDialog(account: MasterAccount) {
    setEditingAccount(account);
    setFormData({
      accountNumber: account.account_number,
      name: account.name,
      description: account.description ?? "",
      classification: account.classification as AccountClassification,
      accountType: account.account_type,
      accountSubType: account.account_sub_type ?? "",
      parentAccountId: account.parent_account_id ?? "",
      isIntercompany: account.is_intercompany ?? false,
    });
    setShowAddDialog(true);
  }

  async function handleSaveAccount() {
    setSaving(true);

    if (!formData.accountNumber || !formData.name || !formData.accountType) {
      toast.error("Account number, name, and type are required");
      setSaving(false);
      return;
    }

    try {
      if (editingAccount) {
        const response = await fetch("/api/master-accounts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingAccount.id,
            accountNumber: formData.accountNumber,
            name: formData.name,
            description: formData.description || null,
            classification: formData.classification,
            accountType: formData.accountType,
            accountSubType: formData.accountSubType || null,
            parentAccountId: formData.parentAccountId || null,
            isIntercompany: formData.isIntercompany,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          toast.error(data.error || "Failed to update account");
          setSaving(false);
          return;
        }
        toast.success("Master account updated");
      } else {
        const response = await fetch("/api/master-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId,
            chartId: selectedChartId,
            accountNumber: formData.accountNumber,
            name: formData.name,
            description: formData.description || null,
            classification: formData.classification,
            accountType: formData.accountType,
            accountSubType: formData.accountSubType || null,
            parentAccountId: formData.parentAccountId || null,
            isIntercompany: formData.isIntercompany,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          toast.error(data.error || "Failed to create account");
          setSaving(false);
          return;
        }
        toast.success("Master account created");
      }

      setShowAddDialog(false);
      resetForm();
      setEditingAccount(null);
      await loadMasterAccounts();
    } catch {
      toast.error("An error occurred");
    }
    setSaving(false);
  }

  async function handleDeleteAccount(account: MasterAccount) {
    if (
      !confirm(
        `Delete master account "${account.account_number} - ${account.name}"? This will also remove all entity mappings for this account.`
      )
    ) {
      return;
    }

    const response = await fetch("/api/master-accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: account.id }),
    });

    if (!response.ok) {
      const data = await response.json();
      toast.error(data.error || "Failed to delete account");
      return;
    }

    toast.success("Master account deleted");
    await loadMasterAccounts();
    await loadMappings();
    await loadUnmappedMonthly();
  }

  function openMappingSheet(account: MasterAccount) {
    setMappingAccount(account);
    setSelectedEntityId("");
    setSelectedAccountId("");
    // Pre-fill year-adjustment inputs from existing record for the totals year
    const existing = yearAdjustments.find(
      (a) => a.master_account_id === account.id && a.period_year === totalsYear,
    );
    setAdjAmountInput(existing ? String(existing.amount) : "");
    setAdjNoteInput(existing?.note ?? "");
    setAdjOffsetIc(existing?.offset_to_ic_net ?? false);
    setAdjEntityId(existing?.entity_id ?? "");
    setMappingSheetOpen(true);
  }

  async function handleSaveYearAdjustment() {
    if (!mappingAccount || !organizationId || !selectedChartId) return;
    const trimmed = adjAmountInput.trim();
    setAdjSaving(true);
    try {
      const existing = yearAdjustments.find(
        (a) =>
          a.master_account_id === mappingAccount.id &&
          a.period_year === totalsYear,
      );
      const parsed = parseFloat(trimmed);
      if (!trimmed || (Number.isFinite(parsed) && parsed === 0)) {
        // 0 or empty → delete if there's an existing row
        if (existing) {
          const res = await fetch("/api/master-accounts/year-adjustments", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: existing.id, organizationId }),
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            toast.error(d.error || "Failed to clear adjustment");
            return;
          }
          toast.success("Adjustment cleared");
        }
      } else {
        if (!Number.isFinite(parsed)) {
          toast.error("Amount must be a number");
          return;
        }
        const res = await fetch("/api/master-accounts/year-adjustments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId,
            chartId: selectedChartId,
            masterAccountId: mappingAccount.id,
            entityId: adjEntityId || null,
            periodYear: totalsYear,
            amount: parsed,
            note: adjNoteInput || null,
            offsetToIcNet: adjOffsetIc,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          toast.error(d.error || "Failed to save adjustment");
          return;
        }
        toast.success("Adjustment saved");
      }
      await Promise.all([loadYearAdjustments(), loadMappedTotals()]);
    } finally {
      setAdjSaving(false);
    }
  }

  async function handleAddMapping() {
    if (!mappingAccount || !selectedEntityId || !selectedAccountId) {
      toast.error("Please select an entity and account");
      return;
    }

    const response = await fetch("/api/master-accounts/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        masterAccountId: mappingAccount.id,
        entityId: selectedEntityId,
        accountId: selectedAccountId,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error || "Failed to create mapping");
      return;
    }

    toast.success("Account mapped successfully");
    setSelectedEntityId("");
    setSelectedAccountId("");
    await loadMappings();
    await loadUnmappedMonthly();
  }

  async function handleRemoveMapping(mappingId: string) {
    const response = await fetch("/api/master-accounts/mappings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: mappingId }),
    });

    if (!response.ok) {
      const data = await response.json();
      toast.error(data.error || "Failed to remove mapping");
      return;
    }

    toast.success("Mapping removed");
    await loadMappings();
    await loadUnmappedMonthly();
  }

  async function handleBulkSetup() {
    if (!bulkEntityId) {
      toast.error("Please select an entity");
      return;
    }

    setBulkRunning(true);
    try {
      const response = await fetch("/api/master-accounts/bulk-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: bulkEntityId, chartId: selectedChartId }),
      });

      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || "Bulk setup failed");
        setBulkRunning(false);
        return;
      }

      const unmappedCount = data.unmapped?.length ?? 0;
      toast.success(
        `Mapped ${data.mappingsCreated} of ${data.totalEntityAccounts} entity accounts` +
          (unmappedCount > 0 ? ` (${unmappedCount} unmapped)` : "")
      );

      if (unmappedCount > 0) {
        console.log("Unmapped entity accounts:", data.unmapped);
      }

      setShowBulkDialog(false);
      setBulkEntityId("");
      await Promise.all([loadMasterAccounts(), loadMappings(), loadUnmappedMonthly()]);
    } catch {
      toast.error("An error occurred during bulk setup");
    }
    setBulkRunning(false);
  }

  // Build a parent → children index. A "parent" master account is one that
  // any other master account points to via parent_account_id.
  const childrenByParent = new Map<string, MasterAccount[]>();
  for (const a of masterAccounts) {
    if (a.parent_account_id) {
      const list = childrenByParent.get(a.parent_account_id) ?? [];
      list.push(a);
      childrenByParent.set(a.parent_account_id, list);
    }
  }

  type RollupRow = { account: MasterAccount; role: "parent" | "child" | "leaf" };

  // For a given list of accounts (within a classification), produce a
  // hierarchical order: parent → its children → next parent → ... → orphan leaves.
  function buildRollupOrder(accounts: MasterAccount[]): RollupRow[] {
    const result: RollupRow[] = [];
    const seen = new Set<string>();
    const inputIds = new Set(accounts.map((a) => a.id));

    const parents = accounts
      .filter((a) => childrenByParent.has(a.id) && !a.parent_account_id)
      .sort((x, y) =>
        (x.account_number || "").localeCompare(y.account_number || ""),
      );

    for (const p of parents) {
      if (seen.has(p.id)) continue;
      result.push({ account: p, role: "parent" });
      seen.add(p.id);
      const kids = (childrenByParent.get(p.id) ?? [])
        .filter((k) => inputIds.has(k.id))
        .sort((x, y) =>
          (x.account_number || "").localeCompare(y.account_number || ""),
        );
      for (const k of kids) {
        if (seen.has(k.id)) continue;
        result.push({ account: k, role: "child" });
        seen.add(k.id);
      }
    }

    const orphans = accounts
      .filter((a) => !seen.has(a.id))
      .sort((x, y) =>
        (x.account_number || "").localeCompare(y.account_number || ""),
      );
    for (const o of orphans) result.push({ account: o, role: "leaf" });

    return result;
  }

  // Filter accounts
  const filtered = masterAccounts.filter((a) => {
    const matchesSearch =
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.account_number.includes(search);
    const matchesClass =
      classFilter === "all" || a.classification === classFilter;
    const matchesEntity =
      entityFilter === "all" ||
      mappings.some(
        (m) => m.master_account_id === a.id && m.entity_id === entityFilter
      );
    return matchesSearch && matchesClass && matchesEntity;
  });

  const grouped = filtered.reduce<Record<string, MasterAccount[]>>(
    (acc, account) => {
      const key = account.classification;
      if (!acc[key]) acc[key] = [];
      acc[key].push(account);
      return acc;
    },
    {}
  );

  function getMappingsForAccount(masterAccountId: string) {
    return mappings.filter((m) => m.master_account_id === masterAccountId);
  }

  function toggleCollapse(classification: string) {
    setCollapsed((prev) => ({
      ...prev,
      [classification]: !prev[classification],
    }));
  }

  // Get entity accounts available for mapping (not already mapped)
  const mappedAccountIds = new Set(mappings.map((m) => m.account_id));
  function getAvailableAccounts(entityId: string) {
    const accounts = entityAccounts[entityId] ?? [];
    return accounts.filter((a) => !mappedAccountIds.has(a.id));
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Master General Ledger
          </h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const activeChart = charts.find((c) => c.id === selectedChartId);
  const isAccountantChart = activeChart?.kind === "accountant";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Master General Ledger
          </h1>
          <p className="text-muted-foreground">
            {isAccountantChart
              ? "Accountant-prepared chart of accounts. Aggregations may differ from the management view."
              : "Define a consolidated chart of accounts and map entity accounts from QuickBooks."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {charts.length > 0 && (
            <Select
              value={selectedChartId ?? undefined}
              onValueChange={(v) => setSelectedChartId(v)}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Chart" />
              </SelectTrigger>
              <SelectContent>
                {charts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.kind === "accountant" ? " (Accountant)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            onClick={() =>
              router.push(
                `/settings/master-gl/consolidated?chartId=${selectedChartId ?? ""}`
              )
            }
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            Consolidated View
          </Button>
          <Button variant="outline" onClick={() => setShowImportDialog(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import Mappings
          </Button>
          <Button variant="outline" onClick={() => setShowBulkDialog(true)}>
            <Wand2 className="mr-2 h-4 w-4" />
            Bulk Setup
          </Button>
          <Button onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Account
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-4">
            <Input
              placeholder="Search master accounts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Classification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classifications</SelectItem>
                {CLASSIFICATIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.code} &mdash; {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={viewMode}
              onValueChange={(v) =>
                setViewMode(v as "classification" | "rollup")
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="classification">By Classification</SelectItem>
                <SelectItem value="rollup">By Rollup</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 ml-auto">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">
                Total year
              </Label>
              <Select
                value={String(totalsYear)}
                onValueChange={(v) => setTotalsYear(parseInt(v))}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(
                    new Set([
                      currentPeriod.year + 1,
                      currentPeriod.year,
                      currentPeriod.year - 1,
                      currentPeriod.year - 2,
                      currentPeriod.year - 3,
                      2025,
                    ]),
                  )
                    .sort((a, b) => b - a)
                    .map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">
                {masterAccounts.length} master account
                {masterAccounts.length !== 1 ? "s" : ""} &middot;{" "}
                {mappings.length} mapping
                {mappings.length !== 1 ? "s" : ""} across {entities.length}{" "}
                entit{entities.length !== 1 ? "ies" : "y"}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {masterAccounts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">
                No master accounts defined yet. Create your consolidated chart
                of accounts to begin mapping entity accounts.
              </p>
              <Button onClick={openAddDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Add First Account
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accounts match your search.
            </p>
          ) : (
            <div className="space-y-2">
              {CLASSIFICATIONS.map((classification) => {
                const classAccounts = grouped[classification];
                if (!classAccounts || classAccounts.length === 0) return null;
                const isCollapsed = collapsed[classification];

                return (
                  <div key={classification}>
                    <button
                      onClick={() => toggleCollapse(classification)}
                      className="flex items-center gap-2 w-full py-2 px-1 hover:bg-muted/50 rounded-md transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      <Badge
                        variant="outline"
                        className={CLASSIFICATION_COLORS[classification]}
                      >
                        {classification}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {classAccounts.length} account
                        {classAccounts.length !== 1 ? "s" : ""}
                      </span>
                    </button>

                    {!isCollapsed && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-24">Number</TableHead>
                            <TableHead>Account Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Mapped Entities</TableHead>
                            <TableHead className="text-right whitespace-nowrap">
                              Total ({totalsYear})
                            </TableHead>
                            <TableHead className="w-32 text-right">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(viewMode === "rollup"
                            ? buildRollupOrder(classAccounts)
                            : classAccounts.map(
                                (a) =>
                                  ({ account: a, role: "leaf" }) as RollupRow,
                              )
                          ).map(({ account, role }) => {
                            const accountMappings = getMappingsForAccount(
                              account.id
                            );
                            const childrenCount =
                              childrenByParent.get(account.id)?.length ?? 0;
                            return (
                              <TableRow
                                key={account.id}
                                className={
                                  role === "parent"
                                    ? "bg-blue-50/40 font-semibold"
                                    : undefined
                                }
                              >
                                <TableCell className="font-mono text-sm">
                                  {role === "child" && (
                                    <span className="text-muted-foreground mr-1">
                                      ↳
                                    </span>
                                  )}
                                  {account.account_number}
                                </TableCell>
                                <TableCell>
                                  <div className={role === "child" ? "pl-4" : undefined}>
                                    <span className="font-medium">
                                      {account.name}
                                    </span>
                                    {role === "parent" && (
                                      <Badge
                                        variant="outline"
                                        className="ml-2 text-[10px] px-1.5 py-0 border-blue-400 text-blue-700 bg-blue-100"
                                      >
                                        Rollup ({childrenCount} child{childrenCount === 1 ? "" : "ren"})
                                      </Badge>
                                    )}
                                    {account.is_intercompany && (
                                      <Badge
                                        variant="outline"
                                        className="ml-2 text-[10px] px-1.5 py-0 border-amber-400 text-amber-700 bg-amber-50"
                                      >
                                        <ArrowLeftRight className="h-3 w-3 mr-0.5" />
                                        IC Elim
                                      </Badge>
                                    )}
                                    {viewMode !== "rollup" && account.parent_account_id && (() => {
                                      const parent = masterAccounts.find(
                                        (m) => m.id === account.parent_account_id,
                                      );
                                      if (!parent) return null;
                                      return (
                                        <Badge
                                          variant="outline"
                                          className="ml-2 text-[10px] px-1.5 py-0 border-blue-400 text-blue-700 bg-blue-50"
                                        >
                                          → {parent.account_number}
                                        </Badge>
                                      );
                                    })()}
                                    {account.description && (
                                      <span className="text-xs block text-muted-foreground">
                                        {account.description}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                  {account.account_type}
                                  {account.account_sub_type && (
                                    <span className="text-xs block text-muted-foreground/60">
                                      {account.account_sub_type}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {role === "parent" ? (
                                      <span className="text-xs text-muted-foreground">
                                        Rolls up {childrenCount} master account
                                        {childrenCount === 1 ? "" : "s"}
                                      </span>
                                    ) : accountMappings.length === 0 ? (
                                      <span className="text-xs text-muted-foreground">
                                        No mappings
                                      </span>
                                    ) : (
                                      accountMappings
                                      .filter((m) => entityFilter === "all" || m.entity_id === entityFilter)
                                      .map((m) => {
                                        const prefix = m.entities?.code?.[0] ?? "?";
                                        const badgeColor =
                                          prefix === "H"
                                            ? "bg-blue-600 hover:bg-blue-700"
                                            : prefix === "V"
                                              ? "bg-black hover:bg-gray-800"
                                              : "bg-red-600 hover:bg-red-700";
                                        return (
                                          <Badge
                                            key={m.id}
                                            className={`text-xs text-white ${badgeColor}`}
                                          >
                                            {prefix + (m.accounts?.account_number ?? "")}
                                          </Badge>
                                        );
                                      }))
                                    }
                                  </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums whitespace-nowrap">
                                  {(() => {
                                    if (totalsLoading) {
                                      return (
                                        <span className="text-muted-foreground text-xs">
                                          …
                                        </span>
                                      );
                                    }
                                    const adj = yearAdjustments.find(
                                      (a) =>
                                        a.master_account_id === account.id &&
                                        a.period_year === totalsYear,
                                    );
                                    let valueNode: React.ReactNode;
                                    if (role === "parent") {
                                      const kids =
                                        childrenByParent.get(account.id) ?? [];
                                      const sum = kids.reduce(
                                        (s, k) =>
                                          s + (masterTotals[k.id] ?? 0),
                                        0,
                                      );
                                      valueNode =
                                        sum === 0 ? (
                                          <span className="text-muted-foreground text-xs">
                                            —
                                          </span>
                                        ) : (
                                          formatCurrency(sum)
                                        );
                                    } else if (
                                      accountMappings.length === 0 &&
                                      !adj
                                    ) {
                                      valueNode = (
                                        <span className="text-muted-foreground text-xs">
                                          —
                                        </span>
                                      );
                                    } else {
                                      valueNode = formatCurrency(
                                        masterTotals[account.id] ?? 0,
                                      );
                                    }
                                    return (
                                      <div className="inline-flex items-center gap-1.5 justify-end">
                                        {valueNode}
                                        {adj && (
                                          <Badge
                                            variant="outline"
                                            className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-700 bg-amber-50"
                                            title={
                                              adj.note ||
                                              `Year-end adj ${formatCurrency(Number(adj.amount))}`
                                            }
                                          >
                                            adj
                                          </Badge>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end gap-1">
                                    {role !== "parent" && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          openMappingSheet(account)
                                        }
                                        title="Map entity accounts"
                                      >
                                        <Link2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        openEditDialog(account)
                                      }
                                      title="Edit account"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleDeleteAccount(account)
                                      }
                                      title="Delete account"
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Master Account Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingAccount ? "Edit Master Account" : "Add Master Account"}
            </DialogTitle>
            <DialogDescription>
              {editingAccount
                ? "Update the master account details."
                : "Define a new account in your consolidated chart of accounts."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid gap-4 grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="accountNumber">Account Number</Label>
                <Input
                  id="accountNumber"
                  placeholder="e.g., 1000"
                  value={formData.accountNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, accountNumber: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Account Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Cash and Equivalents"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                placeholder="e.g., All operating cash accounts"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
              />
            </div>

            <div className="grid gap-4 grid-cols-2">
              <div className="space-y-2">
                <Label>Classification</Label>
                <Select
                  value={formData.classification}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      classification: v as AccountClassification,
                      accountType: "",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASSIFICATIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Account Type</Label>
                <Select
                  value={formData.accountType}
                  onValueChange={(v) =>
                    setFormData({ ...formData, accountType: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(ACCOUNT_TYPES[formData.classification] ?? []).map(
                      (type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Parent Account (rollup)</Label>
              <p className="text-xs text-muted-foreground">
                Optional. Roll this account into a parent line on the
                financial model. Pick from accounts in this chart that share
                the same classification.
              </p>
              <Select
                value={formData.parentAccountId || "__none"}
                onValueChange={(v) =>
                  setFormData({
                    ...formData,
                    parentAccountId: v === "__none" ? "" : v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No parent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— No parent —</SelectItem>
                  {masterAccounts
                    .filter(
                      (m) =>
                        m.classification === formData.classification &&
                        m.id !== editingAccount?.id,
                    )
                    .sort((a, b) =>
                      (a.account_number || "").localeCompare(
                        b.account_number || "",
                      ),
                    )
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.account_number} — {m.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {(formData.classification === "Revenue" ||
              formData.classification === "Expense") && (
              <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                <div className="space-y-0.5">
                  <Label htmlFor="isIntercompany" className="text-sm font-medium">
                    Intercompany Elimination
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Zero out this account on consolidated financial statements.
                    It will still appear at the entity level.
                  </p>
                </div>
                <Switch
                  id="isIntercompany"
                  checked={formData.isIntercompany}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, isIntercompany: checked })
                  }
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveAccount} disabled={saving}>
              {saving
                ? "Saving..."
                : editingAccount
                ? "Update Account"
                : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Setup Dialog */}
      <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Setup — Map Entity Accounts</DialogTitle>
            <DialogDescription>
              Auto-maps the selected entity&apos;s accounts to existing master
              GL accounts using predefined rules. Safe to run multiple
              times — existing mappings are preserved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Entity to Map</Label>
              <Select value={bulkEntityId} onValueChange={setBulkEntityId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select entity..." />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} ({e.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowBulkDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkSetup}
              disabled={bulkRunning || !bulkEntityId}
            >
              {bulkRunning ? "Running..." : "Run Bulk Setup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mapping Side Sheet */}
      <Sheet open={mappingSheetOpen} onOpenChange={setMappingSheetOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {mappingAccount && (
            <>
              <SheetHeader>
                <SheetTitle>
                  Map Entity Accounts
                </SheetTitle>
                <SheetDescription>
                  <span className="flex items-center gap-2 mt-1">
                    <Badge
                      variant="outline"
                      className={
                        CLASSIFICATION_COLORS[
                          mappingAccount.classification as AccountClassification
                        ]
                      }
                    >
                      {mappingAccount.classification}
                    </Badge>
                    <span className="font-mono">
                      {mappingAccount.account_number}
                    </span>
                    <span>{mappingAccount.name}</span>
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Current mappings */}
                <div className="space-y-3">
                  <h3 className="font-medium text-sm">Current Mappings</h3>
                  {getMappingsForAccount(mappingAccount.id).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No entity accounts mapped yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {getMappingsForAccount(mappingAccount.id).map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between rounded-md border p-3"
                        >
                          <div>
                            <div className="font-medium text-sm">
                              {m.entities?.name ?? "Unknown Entity"}
                              <Badge
                                variant="destructive"
                                className="ml-2 text-xs"
                              >
                                {(m.entities?.code?.[0] ?? "?") + (m.accounts?.account_number ?? "")}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {m.accounts?.account_number
                                ? `#${m.accounts.account_number} - `
                                : ""}
                              {m.accounts?.name ?? "Unknown Account"}
                            </div>
                            <div className="text-xs mt-1">
                              <span className="text-muted-foreground">
                                Balance as of {totalsYear}-12-31:{" "}
                              </span>
                              <span className="font-medium tabular-nums">
                                {totalsLoading
                                  ? "…"
                                  : formatCurrency(
                                      mappedBalances[m.account_id] ?? 0,
                                    )}
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveMapping(m.id)}
                          >
                            <Unlink className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Add new mapping */}
                <div className="space-y-3">
                  <h3 className="font-medium text-sm">Add Mapping</h3>

                  <div className="space-y-2">
                    <Label>Entity</Label>
                    <Select
                      value={selectedEntityId}
                      onValueChange={(v) => {
                        setSelectedEntityId(v);
                        setSelectedAccountId("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select entity..." />
                      </SelectTrigger>
                      <SelectContent>
                        {entities.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name} ({e.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedEntityId && (
                    <div className="space-y-2">
                      <Label>Entity Account</Label>
                      <AccountCombobox
                        accounts={getAvailableAccounts(selectedEntityId).map((a) => ({
                          id: a.id,
                          account_number: a.account_number,
                          name: a.name,
                          account_type: a.classification,
                        }))}
                        value={selectedAccountId}
                        onValueChange={setSelectedAccountId}
                      />
                      {getAvailableAccounts(selectedEntityId).length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          All accounts for this entity are already mapped.
                        </p>
                      )}
                    </div>
                  )}

                  <Button
                    onClick={handleAddMapping}
                    disabled={!selectedEntityId || !selectedAccountId}
                    className="w-full"
                  >
                    <Link2 className="mr-2 h-4 w-4" />
                    Map Account
                  </Button>
                </div>

                <Separator />

                {/* Year-End Adjustment (chart-scoped) */}
                <div className="space-y-3">
                  <div>
                    <h3 className="font-medium text-sm">
                      Year-End Adjustment
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      One-time adjustment applied as a Dec-31 entry on this
                      master account in the{" "}
                      <span className="font-medium">
                        {charts.find((c) => c.id === selectedChartId)?.name ??
                          "active"}
                      </span>{" "}
                      chart only. Use this to true the consolidated view to
                      externally prepared statements (e.g., IC residual). Flows
                      through to the Financial Model when this chart is
                      selected.
                    </p>
                  </div>

                  <div className="grid gap-2 grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Year</Label>
                      <div className="text-sm font-medium px-3 py-2 rounded-md border bg-muted/40">
                        {totalsYear}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="e.g. -34079.00"
                        value={adjAmountInput}
                        onChange={(e) => setAdjAmountInput(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Note (optional)</Label>
                    <Input
                      placeholder="e.g. IC residual true-up to match prepared statements"
                      value={adjNoteInput}
                      onChange={(e) => setAdjNoteInput(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Attribute to entity (optional)</Label>
                    <select
                      className="w-full text-sm rounded-md border bg-background px-3 py-2"
                      value={adjEntityId}
                      onChange={(e) => setAdjEntityId(e.target.value)}
                    >
                      <option value="">Chart-wide (no entity)</option>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.code} — {e.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted-foreground">
                      P&amp;L adjustments tagged to an entity flow into that
                      entity&rsquo;s accumulated-deficit / member&rsquo;s-equity
                      line on the accountant balance sheet. Untagged adjustments
                      fall back to whichever entity carries the largest
                      |Net Income|.
                    </p>
                  </div>
                  <div className="flex items-start gap-2 rounded-md border p-3 bg-muted/30">
                    <Switch
                      id="adj-offset-ic"
                      checked={adjOffsetIc}
                      onCheckedChange={setAdjOffsetIc}
                    />
                    <div className="space-y-0.5 flex-1">
                      <Label
                        htmlFor="adj-offset-ic"
                        className="text-sm font-medium cursor-pointer"
                      >
                        Apply to Intercompany Eliminations, Net
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Treats this as a balanced journal entry: the source
                        account gets the amount you entered and the IC
                        eliminations net line on the financial model gets the
                        opposite amount. Use to zero out an IC residual that
                        the prepared statements show as $0.
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={handleSaveYearAdjustment}
                    disabled={adjSaving}
                    variant="outline"
                    className="w-full"
                  >
                    {adjSaving ? "Saving..." : "Save Adjustment"}
                  </Button>

                  {yearAdjustments.filter(
                    (a) => a.master_account_id === mappingAccount.id,
                  ).length > 0 && (
                    <div className="space-y-1 pt-2">
                      <Label className="text-xs text-muted-foreground">
                        All adjustments for this account
                      </Label>
                      {yearAdjustments
                        .filter(
                          (a) => a.master_account_id === mappingAccount.id,
                        )
                        .sort((a, b) => b.period_year - a.period_year)
                        .map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs gap-2"
                          >
                            <div className="font-mono">{a.period_year}</div>
                            <div className="tabular-nums">
                              {formatCurrency(Number(a.amount))}
                            </div>
                            {a.offset_to_ic_net && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-700 bg-amber-50"
                              >
                                IC offset
                              </Badge>
                            )}
                            {a.entity_id && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-blue-400 text-blue-700 bg-blue-50"
                              >
                                {entities.find((e) => e.id === a.entity_id)?.code ?? "entity"}
                              </Badge>
                            )}
                            {a.note && (
                              <div className="text-muted-foreground truncate max-w-[140px]">
                                {a.note}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Import Mappings Wizard */}
      <ImportMappingsDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        entities={entities}
        chartId={selectedChartId}
        chartName={
          charts.find((c) => c.id === selectedChartId)?.name ?? null
        }
        onComplete={() => {
          Promise.all([loadMasterAccounts(), loadMappings(), loadUnmappedMonthly()]);
        }}
      />

      {/* Unmapped Accounts Monthly Grid */}
      <Card className="border-amber-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              Unmapped Accounts
              {unmappedAccounts.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {unmappedAccounts.length}
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select
                value={unmappedEntityFilter}
                onValueChange={setUnmappedEntityFilter}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Entity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.code} &mdash; {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(unmappedYear)}
                onValueChange={(v) => setUnmappedYear(parseInt(v))}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    currentPeriod.year - 2,
                    currentPeriod.year - 1,
                    currentPeriod.year,
                    currentPeriod.year + 1,
                  ].map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardDescription>
            Entity accounts not yet mapped to any master GL account. Their
            balances are excluded from the consolidated view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unmappedLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading unmapped accounts...
            </p>
          ) : unmappedAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              All entity accounts are mapped to master GL accounts.
            </p>
          ) : (() => {
            const filteredUnmapped =
              unmappedEntityFilter === "all"
                ? unmappedAccounts
                : unmappedAccounts.filter(
                    (a) => a.entityId === unmappedEntityFilter
                  );

            if (filteredUnmapped.length === 0) {
              return (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No unmapped accounts for the selected entity.
                </p>
              );
            }

            // Group unmapped accounts by entity
            const groupedByEntity: Record<
              string,
              {
                entityId: string;
                entityName: string;
                entityCode: string;
                accounts: UnmappedAccountMonthly[];
              }
            > = {};
            for (const account of filteredUnmapped) {
              if (!groupedByEntity[account.entityId]) {
                groupedByEntity[account.entityId] = {
                  entityId: account.entityId,
                  entityName: account.entityName,
                  entityCode: account.entityCode,
                  accounts: [],
                };
              }
              groupedByEntity[account.entityId].accounts.push(account);
            }

            // Sort entity groups by entity name
            const entityGroups = Object.values(groupedByEntity).sort(
              (a, b) => a.entityName.localeCompare(b.entityName)
            );

            return (
              <div className="space-y-3">
                {entityGroups.map((group) => {
                  const isEntityCollapsed =
                    collapsedEntities[group.entityId] ?? false;

                  // Calculate monthly subtotals for this entity
                  const monthlySubtotals: Record<number, number> = {};
                  for (const account of group.accounts) {
                    for (let m = 1; m <= 12; m++) {
                      const bal = account.monthlyBalances[m];
                      if (bal != null) {
                        monthlySubtotals[m] =
                          (monthlySubtotals[m] ?? 0) + bal;
                      }
                    }
                  }

                  return (
                    <div key={group.entityId}>
                      <button
                        onClick={() =>
                          setCollapsedEntities((prev) => ({
                            ...prev,
                            [group.entityId]: !prev[group.entityId],
                          }))
                        }
                        className="flex items-center gap-2 w-full py-2 px-1 hover:bg-muted/50 rounded-md transition-colors"
                      >
                        {isEntityCollapsed ? (
                          <ChevronRight className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                        <Badge
                          variant="outline"
                          className="bg-amber-100 text-amber-800"
                        >
                          {group.entityCode}
                        </Badge>
                        <span className="font-medium text-sm">
                          {group.entityName}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {group.accounts.length} unmapped account
                          {group.accounts.length !== 1 ? "s" : ""}
                        </span>
                      </button>

                      {!isEntityCollapsed && (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="sticky left-0 bg-background z-10 min-w-[80px]">
                                  Number
                                </TableHead>
                                <TableHead className="sticky left-[80px] bg-background z-10 min-w-[200px]">
                                  Account Name
                                </TableHead>
                                {MONTH_LABELS.map((m) => (
                                  <TableHead
                                    key={m}
                                    className="text-right min-w-[100px]"
                                  >
                                    {m}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {group.accounts.map((account) => (
                                <TableRow
                                  key={account.id}
                                  className="bg-amber-50/50"
                                >
                                  <TableCell className="sticky left-0 bg-amber-50/80 z-10 font-mono text-sm">
                                    {account.accountNumber ?? "—"}
                                  </TableCell>
                                  <TableCell className="sticky left-[80px] bg-amber-50/80 z-10">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm">
                                        {account.name}
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className={`text-xs ${
                                          CLASSIFICATION_COLORS[
                                            account.classification as AccountClassification
                                          ] ?? ""
                                        }`}
                                      >
                                        {account.classification}
                                      </Badge>
                                    </div>
                                  </TableCell>
                                  {MONTH_LABELS.map((_, i) => {
                                    const balance =
                                      account.monthlyBalances[i + 1];
                                    return (
                                      <TableCell
                                        key={i}
                                        className="text-right tabular-nums text-sm"
                                      >
                                        {balance != null && balance !== 0
                                          ? formatCurrency(balance)
                                          : "—"}
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))}
                              {/* Entity subtotal row */}
                              <TableRow className="bg-amber-100/60 font-semibold">
                                <TableCell className="sticky left-0 bg-amber-100/80 z-10" />
                                <TableCell className="sticky left-[80px] bg-amber-100/80 z-10 text-sm">
                                  Subtotal
                                </TableCell>
                                {MONTH_LABELS.map((_, i) => {
                                  const subtotal = monthlySubtotals[i + 1];
                                  return (
                                    <TableCell
                                      key={i}
                                      className="text-right tabular-nums text-sm"
                                    >
                                      {subtotal != null && subtotal !== 0
                                        ? formatCurrency(subtotal)
                                        : "—"}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
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
        </CardContent>
      </Card>
    </div>
  );
}

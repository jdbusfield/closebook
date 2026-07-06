"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  DollarSign,
  Building2,
  Search,
  TrendingUp,
  Loader2,
  Settings,
  Info,
  Landmark,
  Pencil,
  Check,
  X,
  Upload,
  CalendarDays,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImportAllocationsDialog } from "./import-allocations-dialog";
import { AllocationHistoryDialog, type AllocationPeriod } from "./allocation-history-dialog";
import {
  ClassSplitsEditor,
  draftsFromAllocation,
  draftsToPayload,
  draftsValid,
  formatClassSplits,
  type ClassAllocationEntry,
  type ClassSplitDraft,
} from "./class-splits-editor";

// --- Constants ---

/** Employing entity IDs → Paylocity company IDs */
const EMPLOYING_ENTITIES: Record<string, string> = {
  "b664a9c1-3817-4df4-9261-f51b3403a5de": "132427", // Silverco
  "7529580d-3b44-4a9b-91f4-bc2db25f5211": "316791", // HDR
};

/** All operating entities for Company dropdown */
const OPERATING_ENTITIES = [
  { id: "b664a9c1-3817-4df4-9261-f51b3403a5de", code: "AVON", name: "Silverco Enterprises" },
  { id: "b56dec66-edea-4d8d-8cb4-4043af3e41de", code: "ARH", name: "Avon Rental Holdings" },
  { id: "2fdafa28-8ba2-4caa-aa9f-5d8f39f57081", code: "VS", name: "Versatile Studios" },
  { id: "7529580d-3b44-4a9b-91f4-bc2db25f5211", code: "HDR", name: "Hollywood Depot Rentals" },
  { id: "f641caa2-c87e-4a71-a98b-d51cc559f3ff", code: "HSS", name: "Hollywood Site Services" },
];

// --- Types ---

interface MappedEmployee {
  id: string;
  companyId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  status: string;
  statusType: string;
  jobTitle: string;
  payType: string;
  annualComp: number;
  erTaxes: number;
  erBenefits: number;
  erBenefitBreakdown: Record<string, number>;
  totalComp: number;
  baseRate: number;
  hireDate: string | null;
  costCenterCode: string;
  department: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
}

interface AllocationOverride {
  employee_id: string;
  paylocity_company_id: string;
  department: string | null;
  class: string | null;
  class_allocations?: ClassAllocationEntry[] | null;
  allocated_entity_id: string | null;
  allocated_entity_name: string | null;
  effective_date?: string;
}

/** Employee with merged allocation overrides */
interface DisplayEmployee extends MappedEmployee {
  /** Effective department (override or default) */
  effectiveDepartment: string;
  /** Class display label (from override only; multi-class shows splits) */
  classValue: string;
  /** Class % splits currently in effect */
  classAllocations: ClassAllocationEntry[] | null;
  /** Effective company/entity (override or default) */
  effectiveEntityId: string;
  effectiveEntityName: string;
  /** Whether this employee has any overrides */
  hasOverrides: boolean;
}

/** An inline edit awaiting an effective-date choice. */
interface PendingEdit {
  emp: DisplayEmployee;
  field: "department" | "company" | "class";
  /** New department name or entity id (unused for class edits) */
  value: string;
  /** New class splits (class edits only) */
  classDrafts?: ClassSplitDraft[];
}

// --- Helpers ---

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

// --- Editable Cell Component ---

function EditableTextCell({
  value,
  onSave,
  placeholder = "---",
}: {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSave = async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          className="h-7 text-xs w-[140px]"
          disabled={saving}
        />
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSave} disabled={saving}>
          <Check className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancel} disabled={saving}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="group flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 py-0.5"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      <span className={value ? "" : "text-muted-foreground"}>{value || placeholder}</span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

function EditableSelectCell({
  value,
  options,
  onSave,
}: {
  value: string;
  options: { value: string; label: string }[];
  onSave: (newValue: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (newValue: string) => {
    if (newValue === value) return;
    setSaving(true);
    try {
      await onSave(newValue);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Select value={value} onValueChange={handleChange} disabled={saving}>
      <SelectTrigger className="h-7 text-xs w-[160px] border-transparent hover:border-input">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-xs">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// --- Page ---

export default function EmployeeRosterPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  const [employees, setEmployees] = useState<MappedEmployee[]>([]);
  const [allocations, setAllocations] = useState<AllocationOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [payTypeFilter, setPayTypeFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [historyDialogEmp, setHistoryDialogEmp] = useState<DisplayEmployee | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [activeTab, setActiveTab] = useState<"roster" | "allocations">("roster");

  // Determine if this entity is an employing entity (Silverco or HDR)
  const paylocityCompanyId = EMPLOYING_ENTITIES[entityId] ?? null;
  const isEmployingEntity = paylocityCompanyId !== null;
  const currentEntity = OPERATING_ENTITIES.find((e) => e.id === entityId);
  const entityName = currentEntity?.name ?? "this entity";

  // Fetch employees + allocations
  useEffect(() => {
    async function load() {
      try {
        const [empRes, allocRes] = await Promise.all([
          fetch("/api/paylocity/employees"),
          fetch("/api/paylocity/allocations"),
        ]);
        if (!empRes.ok) throw new Error(`Failed to fetch employees: ${empRes.status}`);
        const empData = await empRes.json();
        setEmployees(empData.employees ?? []);

        if (allocRes.ok) {
          const allocData = await allocRes.json();
          setAllocations(allocData.allocations ?? []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Reset company filter when switching to allocations tab (irrelevant there)
  useEffect(() => {
    if (activeTab === "allocations") {
      setCompanyFilter("all");
    }
  }, [activeTab]);

  // Refresh allocations (called after import wizard completes)
  const refreshAllocations = useCallback(async () => {
    try {
      const res = await fetch("/api/paylocity/allocations");
      if (res.ok) {
        const data = await res.json();
        setAllocations(data.allocations ?? []);
      }
    } catch {
      // Silent fail — stale data is acceptable
    }
  }, []);

  // Group allocation periods per employee, sorted ASC by effective date
  const periodsByEmp = useMemo(() => {
    const map: Record<string, AllocationOverride[]> = {};
    for (const a of allocations) {
      const key = `${a.employee_id}:${a.paylocity_company_id}`;
      (map[key] ??= []).push(a);
    }
    for (const arr of Object.values(map)) {
      arr.sort((x, y) =>
        (x.effective_date ?? "2000-01-01").localeCompare(y.effective_date ?? "2000-01-01")
      );
    }
    return map;
  }, [allocations]);

  const todayIso = new Date().toISOString().slice(0, 10);

  // The allocation period active today (most recent effective_date <= today)
  const activeOverride = useCallback(
    (employeeId: string, companyId: string): AllocationOverride | undefined => {
      const arr = periodsByEmp[`${employeeId}:${companyId}`];
      if (!arr || arr.length === 0) return undefined;
      let active: AllocationOverride | undefined;
      for (const a of arr) {
        if ((a.effective_date ?? "2000-01-01") <= todayIso) active = a;
      }
      return active ?? arr[0];
    },
    [periodsByEmp, todayIso]
  );

  // Helper: merge a single employee with allocation overrides
  const mergeOverrides = useCallback(
    (emp: MappedEmployee): DisplayEmployee => {
      const override = activeOverride(emp.id, emp.companyId);
      const classAllocations =
        override?.class_allocations && override.class_allocations.length > 0
          ? override.class_allocations
          : override?.class
            ? [{ class: override.class, pct: 100 }]
            : null;
      return {
        ...emp,
        effectiveDepartment: override?.department || emp.department,
        classValue: formatClassSplits(override?.class_allocations, override?.class),
        classAllocations,
        effectiveEntityId: override?.allocated_entity_id || emp.operatingEntityId,
        effectiveEntityName: override?.allocated_entity_name || emp.operatingEntityName,
        hasOverrides: !!override,
      };
    },
    [activeOverride]
  );

  // Roster employees: ALL from the Paylocity company (clerical view)
  const rosterDisplayEmployees: DisplayEmployee[] = useMemo(() => {
    if (!isEmployingEntity) return [];
    return employees
      .filter((e) => e.companyId === paylocityCompanyId)
      .map(mergeOverrides);
  }, [employees, isEmployingEntity, paylocityCompanyId, mergeOverrides]);

  // Cost allocation employees: those whose effective entity matches THIS entity (across all companies)
  const allocDisplayEmployees: DisplayEmployee[] = useMemo(() => {
    return employees
      .filter((e) => {
        const override = activeOverride(e.id, e.companyId);
        const effectiveEntityId = override?.allocated_entity_id || e.operatingEntityId;
        return effectiveEntityId === entityId;
      })
      .map(mergeOverrides);
  }, [employees, entityId, activeOverride, mergeOverrides]);

  // Active display employees based on tab selection
  const displayEmployees: DisplayEmployee[] = useMemo(() => {
    if (!isEmployingEntity) return allocDisplayEmployees;
    return activeTab === "roster" ? rosterDisplayEmployees : allocDisplayEmployees;
  }, [isEmployingEntity, activeTab, rosterDisplayEmployees, allocDisplayEmployees]);

  // Department and company lists for filters
  const uniqueDepts = useMemo(
    () => [...new Set(displayEmployees.map((e) => e.effectiveDepartment))].filter(Boolean).sort(),
    [displayEmployees]
  );

  const uniqueCompanies = useMemo(
    () =>
      [...new Set(displayEmployees.map((e) => e.effectiveEntityName))].filter(Boolean).sort(),
    [displayEmployees]
  );

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return displayEmployees.filter((emp) => {
      if (deptFilter !== "all" && emp.effectiveDepartment !== deptFilter) return false;
      if (payTypeFilter !== "all" && emp.payType !== payTypeFilter) return false;
      if (companyFilter !== "all" && emp.effectiveEntityName !== companyFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          emp.displayName.toLowerCase().includes(q) ||
          emp.id.toLowerCase().includes(q) ||
          (emp.jobTitle ?? "").toLowerCase().includes(q) ||
          emp.effectiveDepartment.toLowerCase().includes(q) ||
          emp.effectiveEntityName.toLowerCase().includes(q) ||
          emp.classValue.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [displayEmployees, deptFilter, payTypeFilter, companyFilter, search]);

  // KPIs
  const totalAnnualComp = displayEmployees.reduce((s, e) => s + e.annualComp, 0);
  const totalERTaxes = displayEmployees.reduce((s, e) => s + e.erTaxes, 0);
  const totalERBenefits = displayEmployees.reduce((s, e) => s + (e.erBenefits ?? 0), 0);
  const totalFullComp = displayEmployees.reduce((s, e) => s + e.totalComp, 0);
  const avgComp = displayEmployees.length > 0 ? totalFullComp / displayEmployees.length : 0;
  const deptCount = uniqueDepts.length;

  // Silverco total payroll (company 132427, all entities)
  const silvercoEmployees = useMemo(
    () => employees.filter((e) => e.companyId === "132427"),
    [employees]
  );
  const silvercoTotalComp = silvercoEmployees.reduce((s, e) => s + e.totalComp, 0);
  const silvercoHeadcount = silvercoEmployees.length;

  // Inline edits don't save directly — they queue a PendingEdit so the user
  // picks an effective date first (new period vs. rewrite current period).
  const requestEdit = useCallback(
    async (emp: DisplayEmployee, field: "department" | "company", value: string) => {
      setPendingEdit({ emp, field, value });
    },
    []
  );

  const openClassEditor = useCallback((emp: DisplayEmployee) => {
    setPendingEdit({
      emp,
      field: "class",
      value: "",
      classDrafts: draftsFromAllocation(emp.classAllocations, null),
    });
  }, []);

  /**
   * Persist a pending edit. mode "new" creates a period starting on `date`
   * (carrying forward the fields in effect on that date); mode "current"
   * rewrites the period active today without changing its start date.
   */
  const commitPendingEdit = useCallback(
    async (edit: PendingEdit, mode: "new" | "current", date: string, classDrafts: ClassSplitDraft[]) => {
      const { emp, field } = edit;
      const periods = periodsByEmp[`${emp.id}:${emp.companyId}`] ?? [];
      const asOf = mode === "new" ? date : todayIso;
      let base: AllocationOverride | undefined;
      for (const p of periods) {
        if ((p.effective_date ?? "2000-01-01") <= asOf) base = p;
      }
      const effectiveDate = mode === "new" ? date : (base?.effective_date ?? "2000-01-01");

      let department = base?.department ?? emp.department;
      let allocatedEntityId = base?.allocated_entity_id ?? emp.operatingEntityId;
      let allocatedEntityName = base?.allocated_entity_name ?? emp.operatingEntityName;
      let classValue = base?.class ?? null;
      let classAllocations: ClassAllocationEntry[] | null =
        base?.class_allocations && base.class_allocations.length > 0
          ? base.class_allocations
          : null;

      if (field === "department") department = edit.value;
      if (field === "company") {
        allocatedEntityId = edit.value;
        const entity = OPERATING_ENTITIES.find((e) => e.id === edit.value);
        allocatedEntityName = entity?.name ?? edit.value;
      }
      if (field === "class") {
        classAllocations = draftsToPayload(classDrafts);
        classValue = null; // API derives the legacy column from classAllocations
      }

      const res = await fetch("/api/paylocity/allocations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: emp.id,
          paylocityCompanyId: emp.companyId,
          effectiveDate,
          department,
          class: classValue,
          classAllocations,
          allocatedEntityId,
          allocatedEntityName,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save");
      }
      await refreshAllocations();
    },
    [periodsByEmp, todayIso, refreshAllocations]
  );

  // Entity options for Company dropdown
  const entityOptions = OPERATING_ENTITIES.map((e) => ({
    value: e.id,
    label: e.name,
  }));

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
            <p className="text-muted-foreground">
              {isEmployingEntity
                ? activeTab === "roster"
                  ? "Full payroll roster — click any Company, Department, or Class cell to edit as of a chosen date"
                  : `Employees allocated to ${entityName} with compensation costs`
                : "Employee roster, compensation, and department breakdown"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(true)}
            >
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
            <Link href={`/${entityId}/employees/monthly`}>
              <Button variant="outline" size="sm">
                <DollarSign className="mr-2 h-4 w-4" />
                Monthly Cost
              </Button>
            </Link>
            <Link href={`/${entityId}/employees/overtime`}>
              <Button variant="outline" size="sm">
                <TrendingUp className="mr-2 h-4 w-4" />
                Overtime
              </Button>
            </Link>
            <Link href={`/${entityId}/employees/settings`}>
              <Button variant="outline" size="sm">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
            </Link>
          </div>
        </div>

        {/* Tabs — only for employing entities (Silverco, HDR) */}
        {isEmployingEntity && (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "roster" | "allocations")}
          >
            <TabsList>
              <TabsTrigger value="roster">
                Roster ({rosterDisplayEmployees.length})
              </TabsTrigger>
              <TabsTrigger value="allocations">
                Cost Allocations ({allocDisplayEmployees.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Headcount</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{displayEmployees.length}</div>
              <p className="text-xs text-muted-foreground">Active employees</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCompact(totalFullComp)}</div>
              <p className="text-xs text-muted-foreground">
                Wages {formatCompact(totalAnnualComp)} + Taxes {formatCompact(totalERTaxes)} + Benefits {formatCompact(totalERBenefits)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Total Comp</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCompact(avgComp)}</div>
              <p className="text-xs text-muted-foreground">Per employee (incl. ER taxes)</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Departments</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{deptCount}</div>
              <p className="text-xs text-muted-foreground">Active departments</p>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Silverco Payroll</CardTitle>
              <Landmark className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCompact(silvercoTotalComp)}</div>
              <p className="text-xs text-muted-foreground">
                {silvercoHeadcount} employees across all entities
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Employee Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isEmployingEntity && activeTab === "allocations"
                ? "Cost Allocations"
                : "Employee Roster"}
            </CardTitle>
            <CardDescription>
              {isEmployingEntity && activeTab === "allocations"
                ? `${displayEmployees.length} employee${displayEmployees.length !== 1 ? "s" : ""} allocated to ${entityName}`
                : `${displayEmployees.length} active employee${displayEmployees.length !== 1 ? "s" : ""}${isEmployingEntity ? " (full payroll company view)" : ""}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Filter Bar */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name, title, department, company, class..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {isEmployingEntity && activeTab === "roster" && (
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All Companies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Companies</SelectItem>
                    {uniqueCompanies.map((co) => (
                      <SelectItem key={co} value={co}>
                        {co}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {uniqueDepts.map((dept) => (
                    <SelectItem key={dept} value={dept}>
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={payTypeFilter} onValueChange={setPayTypeFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="Salary">Salary</SelectItem>
                  <SelectItem value="Hourly">Hourly</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">
                {filteredEmployees.length} of {displayEmployees.length}
              </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Job Title</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Company
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            Operating entity this employee is allocated to
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Pay Type</TableHead>
                    <TableHead className="text-right">Annual Comp</TableHead>
                    <TableHead className="text-right">ER Taxes</TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex items-center gap-1">
                        ER Benefits
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            Annualized employer-paid benefits (medical, 401k match). Does not include employee-paid deductions.
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex items-center gap-1">
                        Total Comp
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            Annual wages + employer payroll taxes + employer-paid benefits
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </TableHead>
                    <TableHead className="text-right">Base Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.map((emp) => (
                    <TableRow key={`${emp.companyId}-${emp.id}`} className="group">
                      <TableCell className="font-medium whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {emp.displayName}
                          <button
                            onClick={() => setHistoryDialogEmp(emp)}
                            className="opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                            title="Allocation history"
                          >
                            <CalendarDays className="h-3.5 w-3.5" />
                          </button>
                          {(periodsByEmp[`${emp.id}:${emp.companyId}`]?.length ?? 0) > 1 && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-normal">
                              multi
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {emp.id}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        {emp.jobTitle || "---"}
                      </TableCell>
                      {/* Company — editable select (effective-dated) */}
                      <TableCell>
                        <EditableSelectCell
                          value={emp.effectiveEntityId}
                          options={entityOptions}
                          onSave={(val) => requestEdit(emp, "company", val)}
                        />
                      </TableCell>
                      {/* Department — editable text (effective-dated) */}
                      <TableCell>
                        <EditableTextCell
                          value={emp.effectiveDepartment}
                          onSave={(val) => requestEdit(emp, "department", val)}
                          placeholder="Set department"
                        />
                      </TableCell>
                      {/* Class — multi-class % splits (effective-dated) */}
                      <TableCell>
                        <div
                          className="flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 py-0.5"
                          onClick={() => openClassEditor(emp)}
                          title="Edit class allocation"
                        >
                          <span
                            className={`whitespace-nowrap ${emp.classValue ? "" : "text-muted-foreground"}`}
                          >
                            {emp.classValue || "Set class"}
                          </span>
                          {(emp.classAllocations?.length ?? 0) > 1 && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 font-normal">
                              split
                            </Badge>
                          )}
                          <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={emp.payType === "Salary" ? "default" : "secondary"}>
                          {emp.payType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(emp.annualComp)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {formatCurrency(emp.erTaxes)}
                      </TableCell>
                      <TableCell
                        className="text-right font-mono text-muted-foreground"
                        title={
                          emp.erBenefitBreakdown && Object.keys(emp.erBenefitBreakdown).length > 0
                            ? Object.entries(emp.erBenefitBreakdown)
                                .map(([k, v]) => `${k}: $${v.toLocaleString()}`)
                                .join(", ")
                            : "No employer benefits"
                        }
                      >
                        {(emp.erBenefits ?? 0) > 0 ? formatCurrency(emp.erBenefits) : "---"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCurrency(emp.totalComp)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground whitespace-nowrap">
                        {emp.baseRate > 0
                          ? `$${emp.baseRate.toFixed(2)}${emp.payType === "Hourly" ? "/hr" : ""}`
                          : "---"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredEmployees.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                        No employees match the current filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Totals */}
            {filteredEmployees.length > 0 && (
              <div className="mt-3 flex justify-end gap-6 text-sm">
                <span className="text-muted-foreground">
                  Annual Wages:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(filteredEmployees.reduce((s, e) => s + e.annualComp, 0))}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  ER Taxes:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(filteredEmployees.reduce((s, e) => s + e.erTaxes, 0))}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  ER Benefits:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(filteredEmployees.reduce((s, e) => s + (e.erBenefits ?? 0), 0))}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Total Cost:{" "}
                  <span className="font-bold text-foreground">
                    {formatCurrency(filteredEmployees.reduce((s, e) => s + e.totalComp, 0))}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Monthly:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(filteredEmployees.reduce((s, e) => s + e.totalComp, 0) / 12)}
                  </span>
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Import Allocations Dialog */}
      <ImportAllocationsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        employees={displayEmployees}
        operatingEntities={OPERATING_ENTITIES}
        paylocityCompanyId={paylocityCompanyId}
        onComplete={refreshAllocations}
      />

      {historyDialogEmp && (
        <AllocationHistoryDialog
          open={!!historyDialogEmp}
          onOpenChange={(open) => { if (!open) setHistoryDialogEmp(null); }}
          employeeName={historyDialogEmp.displayName}
          employeeId={historyDialogEmp.id}
          companyId={historyDialogEmp.companyId}
          periods={
            allocations
              .filter(
                (a) =>
                  a.employee_id === historyDialogEmp.id &&
                  a.paylocity_company_id === historyDialogEmp.companyId
              )
              .sort((a, b) =>
                (a.effective_date ?? "2000-01-01").localeCompare(
                  b.effective_date ?? "2000-01-01"
                )
              )
              .map((a) => ({
                employee_id: a.employee_id,
                paylocity_company_id: a.paylocity_company_id,
                effective_date: a.effective_date ?? "2000-01-01",
                department: a.department,
                class: a.class,
                class_allocations: a.class_allocations ?? null,
                allocated_entity_id: a.allocated_entity_id,
                allocated_entity_name: a.allocated_entity_name,
              })) as AllocationPeriod[]
          }
          entities={OPERATING_ENTITIES}
          defaultDepartment={historyDialogEmp.department}
          defaultEntityId={historyDialogEmp.operatingEntityId}
          defaultEntityName={historyDialogEmp.operatingEntityName}
          onChanged={refreshAllocations}
        />
      )}

      {pendingEdit && (
        <AllocationEditDialog
          pendingEdit={pendingEdit}
          onClose={() => setPendingEdit(null)}
          onCommit={commitPendingEdit}
        />
      )}
    </TooltipProvider>
  );
}

// --- Effective-dated allocation edit dialog ---

function AllocationEditDialog({
  pendingEdit,
  onClose,
  onCommit,
}: {
  pendingEdit: PendingEdit;
  onClose: () => void;
  onCommit: (
    edit: PendingEdit,
    mode: "new" | "current",
    date: string,
    classDrafts: ClassSplitDraft[]
  ) => Promise<void>;
}) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState<"new" | "current">("new");
  const [date, setDate] = useState(todayIso);
  const [classDrafts, setClassDrafts] = useState<ClassSplitDraft[]>(
    pendingEdit.classDrafts ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { emp, field } = pendingEdit;
  const isClassEdit = field === "class";
  const targetEntity = OPERATING_ENTITIES.find((e) => e.id === pendingEdit.value);

  const changeSummary = isClassEdit
    ? null
    : field === "company"
      ? `Company: ${emp.effectiveEntityName} → ${targetEntity?.name ?? pendingEdit.value}`
      : `Department: ${emp.effectiveDepartment || "—"} → ${pendingEdit.value || "—"}`;

  const classOk = !isClassEdit || draftsValid(classDrafts);
  const canSave = classOk && (mode === "current" || !!date) && !saving;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onCommit(pendingEdit, mode, date, classDrafts);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isClassEdit ? "Class Allocation" : "Allocation Change"}
          </DialogTitle>
          <DialogDescription>{emp.displayName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {changeSummary && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {changeSummary}
            </div>
          )}

          {isClassEdit && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Split this employee&apos;s cost across classes (must total 100%)
              </p>
              <ClassSplitsEditor
                drafts={classDrafts}
                onChange={setClassDrafts}
                disabled={saving}
              />
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">When does this take effect?</p>
            <label className="flex items-start gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                checked={mode === "new"}
                onChange={() => setMode("new")}
                className="mt-0.5"
                disabled={saving}
              />
              <span className="flex-1">
                <span className="font-medium">As of a specific date</span>
                <span className="block text-xs text-muted-foreground">
                  Starts a new allocation period; months before this date keep the prior
                  allocation, and the change pro-rates by day within the month.
                </span>
                {mode === "new" && (
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1.5 h-8 text-sm border rounded px-2 bg-background"
                    disabled={saving}
                  />
                )}
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                checked={mode === "current"}
                onChange={() => setMode("current")}
                className="mt-0.5"
                disabled={saving}
              />
              <span className="flex-1">
                <span className="font-medium">Update the current period</span>
                <span className="block text-xs text-muted-foreground">
                  Rewrites the allocation already in effect (applies retroactively to its
                  whole period).
                </span>
              </span>
            </label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

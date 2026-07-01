"use client";

import { useState, useEffect, useMemo } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Users,
  DollarSign,
  Building2,
  Search,
  TrendingUp,
  Loader2,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

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
  baseRate: number;
  hireDate: string | null;
  costCenterCode: string;
  department: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  erBenefits: number;
  erBenefitBreakdown: Record<string, number>;
}

interface AllocationOverride {
  employee_id: string;
  paylocity_company_id: string;
  department: string | null;
  class: string | null;
  allocated_entity_id: string | null;
  allocated_entity_name: string | null;
}

/** Entity code lookup for allocation overrides */
const ENTITY_ID_TO_CODE: Record<string, string> = {
  "b664a9c1-3817-4df4-9261-f51b3403a5de": "AVON",
  "b56dec66-edea-4d8d-8cb4-4043af3e41de": "ARH",
  "2fdafa28-8ba2-4caa-aa9f-5d8f39f57081": "VS",
  "7529580d-3b44-4a9b-91f4-bc2db25f5211": "HDR",
  "f641caa2-c87e-4a71-a98b-d51cc559f3ff": "HSS",
};

// --- Constants ---

const ENTITY_COLORS: Record<string, string> = {
  AVON: "#2563eb",
  ARH: "#16a34a",
  VS: "#ea580c",
  HDR: "#9333ea",
  HSS: "#dc2626",
};

const DEFAULT_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#dc2626", "#0891b2"];

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

// --- Page ---

export default function OrgPayrollPage() {
  const [employees, setEmployees] = useState<MappedEmployee[]>([]);
  const [allocations, setAllocations] = useState<AllocationOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");

  // --- Data Fetching ---

  useEffect(() => {
    async function load() {
      try {
        const [empRes, allocRes] = await Promise.all([
          fetch("/api/paylocity/employees"),
          fetch("/api/paylocity/allocations"),
        ]);
        if (!empRes.ok) throw new Error(`Failed to fetch: ${empRes.status}`);
        const empData = await empRes.json();
        setEmployees(empData.employees ?? []);

        if (allocRes.ok) {
          const allocData = await allocRes.json();
          setAllocations(allocData.allocations ?? []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load employee data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // --- Allocation Overrides ---

  const allocationMap = useMemo(() => {
    const map: Record<string, AllocationOverride> = {};
    for (const a of allocations) {
      map[`${a.employee_id}:${a.paylocity_company_id}`] = a;
    }
    return map;
  }, [allocations]);

  /** Apply allocation overrides to get effective entity/department per employee */
  const effectiveEmployees = useMemo(() => {
    return employees.map((emp) => {
      const override = allocationMap[`${emp.id}:${emp.companyId}`];
      if (!override) return emp;

      const entityId = override.allocated_entity_id || emp.operatingEntityId;
      const entityName = override.allocated_entity_name || emp.operatingEntityName;
      const entityCode = ENTITY_ID_TO_CODE[entityId] || emp.operatingEntityCode;

      return {
        ...emp,
        department: override.department || emp.department,
        operatingEntityId: entityId,
        operatingEntityCode: entityCode,
        operatingEntityName: entityName,
      };
    });
  }, [employees, allocationMap]);

  // --- Computed Data ---

  const entitySummaries = useMemo(() => {
    const map: Record<
      string,
      {
        entityCode: string;
        entityName: string;
        entityId: string;
        headcount: number;
        totalComp: number;
        totalBenefits: number;
        departments: Record<string, { headcount: number; totalComp: number }>;
      }
    > = {};

    for (const emp of effectiveEmployees) {
      const key = emp.operatingEntityCode;
      if (!map[key]) {
        map[key] = {
          entityCode: emp.operatingEntityCode,
          entityName: emp.operatingEntityName,
          entityId: emp.operatingEntityId,
          headcount: 0,
          totalComp: 0,
          totalBenefits: 0,
          departments: {},
        };
      }
      map[key].headcount++;
      map[key].totalComp += emp.annualComp;
      map[key].totalBenefits += emp.erBenefits ?? 0;

      if (!map[key].departments[emp.department]) {
        map[key].departments[emp.department] = { headcount: 0, totalComp: 0 };
      }
      map[key].departments[emp.department].headcount++;
      map[key].departments[emp.department].totalComp += emp.annualComp;
    }

    return Object.values(map).sort((a, b) => b.totalComp - a.totalComp);
  }, [effectiveEmployees]);

  const totalHeadcount = effectiveEmployees.length;
  const totalAnnualComp = effectiveEmployees.reduce((s, e) => s + e.annualComp, 0);
  const totalMonthlyComp = totalAnnualComp / 12;
  const avgComp = totalHeadcount > 0 ? totalAnnualComp / totalHeadcount : 0;
  const totalAnnualBenefits = effectiveEmployees.reduce((s, e) => s + (e.erBenefits ?? 0), 0);

  // Filter options
  const uniqueEntities = useMemo(
    () => [...new Set(effectiveEmployees.map((e) => e.operatingEntityCode))].sort(),
    [effectiveEmployees]
  );
  const uniqueDepts = useMemo(() => {
    const depts = effectiveEmployees
      .filter((e) => entityFilter === "all" || e.operatingEntityCode === entityFilter)
      .map((e) => e.department);
    return [...new Set(depts)].sort();
  }, [effectiveEmployees, entityFilter]);

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return effectiveEmployees.filter((emp) => {
      if (entityFilter !== "all" && emp.operatingEntityCode !== entityFilter) return false;
      if (deptFilter !== "all" && emp.department !== deptFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          emp.displayName.toLowerCase().includes(q) ||
          emp.jobTitle.toLowerCase().includes(q) ||
          emp.department.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [effectiveEmployees, entityFilter, deptFilter, search]);

  // Chart data
  const barChartData = useMemo(() => {
    return entitySummaries.map((e) => ({
      name: e.entityCode,
      fullName: e.entityName,
      annual: Math.round(e.totalComp),
      monthly: Math.round(e.totalComp / 12),
      headcount: e.headcount,
    }));
  }, [entitySummaries]);

  const pieChartData = useMemo(() => {
    return entitySummaries.map((e) => ({
      name: e.entityCode,
      fullName: e.entityName,
      value: e.headcount,
    }));
  }, [entitySummaries]);

  // --- Loading ---

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
            <CardTitle className="text-destructive">Error Loading Payroll Data</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // --- Render ---

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payroll Overview</h1>
          <p className="text-muted-foreground">
            Organization-wide headcount, compensation, and cost allocation across all entities.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/payroll/estimate">
            <Button variant="default" size="sm">
              <Calendar className="mr-2 h-4 w-4" />
              Monthly Estimate
            </Button>
          </Link>
          <Link href="/payroll/monthly">
            <Button variant="outline" size="sm">
              <Calendar className="mr-2 h-4 w-4" />
              Monthly Cost
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Headcount</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalHeadcount}</div>
            <p className="text-xs text-muted-foreground">
              Active employees across {entitySummaries.length} entities
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Annual Payroll</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCompact(totalAnnualComp)}</div>
            <p className="text-xs text-muted-foreground">
              Total annual compensation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ER Benefits</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCompact(totalAnnualBenefits)}</div>
            <p className="text-xs text-muted-foreground">
              Employer-paid benefits (annual)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Payroll</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCompact(totalMonthlyComp)}</div>
            <p className="text-xs text-muted-foreground">
              Estimated monthly cost
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Compensation</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCompact(avgComp)}</div>
            <p className="text-xs text-muted-foreground">
              Per employee annual
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Bar Chart — Payroll by Entity */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Payroll Cost by Entity</CardTitle>
            <CardDescription>Annual compensation allocated by operating entity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis
                    tickFormatter={(v: number) => formatCompact(v)}
                    className="text-xs"
                  />
                  <RechartsTooltip
                    formatter={(value) => [formatCurrency(Number(value)), "Annual Comp"]}
                    labelFormatter={(label) => {
                      const item = barChartData.find((d) => d.name === String(label));
                      return item ? `${item.fullName} (${item.headcount} employees)` : String(label);
                    }}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                    }}
                  />
                  <Bar
                    dataKey="annual"
                    radius={[4, 4, 0, 0]}
                    fill="#2563eb"
                  >
                    {barChartData.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={ENTITY_COLORS[entry.name] ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Pie Chart — Headcount Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Headcount by Entity</CardTitle>
            <CardDescription>Employee distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, value }) =>
                      `${name ?? ""}: ${value ?? 0}`
                    }
                  >
                    {pieChartData.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={ENTITY_COLORS[entry.name] ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Legend />
                  <RechartsTooltip
                    formatter={(value) => [
                      `${value} employees`,
                      "",
                    ]}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Entity Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {entitySummaries.map((entity) => (
          <Link key={entity.entityCode} href={`/${entity.entityId}/employees`}>
            <Card className="transition-colors hover:border-primary/50">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <Badge
                    variant="outline"
                    style={{
                      borderColor: ENTITY_COLORS[entity.entityCode] ?? "#6b7280",
                      color: ENTITY_COLORS[entity.entityCode] ?? "#6b7280",
                    }}
                  >
                    {entity.entityCode}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {entity.headcount} emp
                  </span>
                </div>
                <CardTitle className="text-sm">{entity.entityName}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-semibold">
                  {formatCompact(entity.totalComp / 12)}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatCurrency(entity.totalComp)} annual
                </div>
                {entity.totalBenefits > 0 && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    + {formatCurrency(entity.totalBenefits)} ER benefits
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Filters + Employee Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employee Roster</CardTitle>
          <CardDescription>All active employees with cost allocation</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filter Bar */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, title, or department..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setDeptFilter("all"); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Entities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {uniqueEntities.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <span className="text-sm text-muted-foreground">
              {filteredEmployees.length} of {employees.length}
            </span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Job Title</TableHead>
                  <TableHead>Pay Type</TableHead>
                  <TableHead className="text-right">Annual Comp</TableHead>
                  <TableHead className="text-right" title="Employer-paid benefits (medical, 401k match, etc.)">ER Benefits</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-medium">{emp.displayName}</TableCell>
                    <TableCell>{emp.department}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{
                          borderColor: ENTITY_COLORS[emp.operatingEntityCode] ?? "#6b7280",
                          color: ENTITY_COLORS[emp.operatingEntityCode] ?? "#6b7280",
                        }}
                      >
                        {emp.operatingEntityCode}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {emp.jobTitle || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={emp.payType === "Salary" ? "default" : "secondary"}>
                        {emp.payType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(emp.annualComp)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground" title={
                      Object.entries(emp.erBenefitBreakdown ?? {})
                        .map(([k, v]) => `${k}: $${v.toFixed(2)}`)
                        .join(", ") || "No employer benefits"
                    }>
                      {formatCurrency(emp.erBenefits ?? 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatCurrency(emp.annualComp / 12)}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredEmployees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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
                Total Annual:{" "}
                <span className="font-semibold text-foreground">
                  {formatCurrency(filteredEmployees.reduce((s, e) => s + e.annualComp, 0))}
                </span>
              </span>
              <span className="text-muted-foreground">
                ER Benefits:{" "}
                <span className="font-semibold text-foreground">
                  {formatCurrency(filteredEmployees.reduce((s, e) => s + (e.erBenefits ?? 0), 0))}
                </span>
              </span>
              <span className="text-muted-foreground">
                Monthly:{" "}
                <span className="font-semibold text-foreground">
                  {formatCurrency(filteredEmployees.reduce((s, e) => s + e.annualComp, 0) / 12)}
                </span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
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
import {
  Building,
  Building2,
  Search,
  ArrowRight,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { formatCurrency, getCurrentPeriod, formatIsoDateLocal } from "@/lib/utils/dates";
import { fetchAllRows } from "@/lib/utils/paginated-fetch";
import { PaymentScheduleGrids } from "@/components/real-estate/payment-schedule-grids";
import { cn } from "@/lib/utils";
import {
  calculateLeaseLiability,
  calculateROUAsset,
} from "@/lib/utils/lease-calculations";
import { getCurrentRent } from "@/lib/utils/lease-payments";
import type { EscalationRule } from "@/lib/utils/lease-payments";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import type { LeaseStatus, LeaseType, MaintenanceType, PropertyType, SplitType } from "@/lib/types/database";
import { isActiveLeaseStatus } from "@/lib/types/database";

// --- Types ---

interface LeaseRow {
  id: string;
  entity_id: string;
  lease_name: string;
  nickname: string | null;
  lease_type: LeaseType;
  status: LeaseStatus;
  lessor_name: string | null;
  commencement_date: string;
  expiration_date: string;
  lease_term_months: number;
  base_rent_monthly: number;
  base_rent_annual: number;
  cam_monthly: number;
  insurance_monthly: number;
  property_tax_annual: number;
  utilities_monthly: number;
  other_monthly_costs: number;
  discount_rate: number;
  initial_direct_costs: number;
  lease_incentives_received: number;
  prepaid_rent: number;
  maintenance_type: MaintenanceType | null;
  properties: {
    property_name: string;
    property_type: PropertyType | null;
    city: string | null;
    state: string | null;
    rentable_square_footage: number | null;
  } | null;
}

interface SubleaseRow {
  id: string;
  lease_id: string;
  entity_id: string;
  status: string;
  commencement_date: string;
  expiration_date: string;
  base_rent_monthly: number;
  cam_recovery_monthly: number;
  insurance_recovery_monthly: number;
  property_tax_recovery_monthly: number;
  utilities_recovery_monthly: number;
  other_recovery_monthly: number;
}

interface CostSplitRow {
  id: string;
  lease_id: string;
  source_entity_id: string;
  destination_entity_id: string;
  split_type: SplitType;
  split_percentage: number | null;
  split_fixed_amount: number | null;
  is_active: boolean;
}

interface EntityRow {
  id: string;
  name: string;
  code: string;
}

// --- Constants ---

const ENTITY_COLORS = [
  "#2563eb", "#16a34a", "#ea580c", "#9333ea",
  "#dc2626", "#0891b2", "#ca8a04", "#be185d",
];

const STATUS_VARIANT: Record<LeaseStatus, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  active_non_operational: "secondary",
  draft: "secondary",
  expired: "outline",
  terminated: "destructive",
};

const STATUS_LABEL: Record<LeaseStatus, string> = {
  active: "Active",
  active_non_operational: "Active (Non-Operational)",
  draft: "Draft",
  expired: "Expired",
  terminated: "Terminated",
};

// --- Helpers ---

function getMonthlySubleaseIncome(
  leaseId: string,
  subleases: SubleaseRow[],
  subleaseEscMap: Record<string, EscalationRule[]>,
): number {
  const activeSubs = subleases.filter(
    (s) => s.lease_id === leaseId && s.status === "active"
  );
  let income = 0;
  for (const sub of activeSubs) {
    const subEscs = subleaseEscMap[sub.id] ?? [];
    const currentSubRent =
      subEscs.length > 0
        ? getCurrentRent(sub.base_rent_monthly, subEscs)
        : sub.base_rent_monthly;
    income +=
      currentSubRent +
      sub.cam_recovery_monthly +
      sub.insurance_recovery_monthly +
      sub.property_tax_recovery_monthly +
      sub.utilities_recovery_monthly +
      sub.other_recovery_monthly;
  }
  return income;
}

function getSubleaseIncomeForPeriod(
  leaseId: string,
  subleases: SubleaseRow[],
  subleaseEscMap: Record<string, EscalationRule[]>,
  year: number,
  month: number,
): number {
  const periodDate = new Date(year, month - 1, 15);
  const activeSubs = subleases.filter((s) => {
    if (s.lease_id !== leaseId || s.status !== "active") return false;
    const start = parseLocalDate(s.commencement_date);
    const end = parseLocalDate(s.expiration_date);
    return periodDate >= start && periodDate <= end;
  });
  let income = 0;
  for (const sub of activeSubs) {
    const subEscs = subleaseEscMap[sub.id] ?? [];
    const currentSubRent = subEscs.length > 0
      ? getCurrentRent(sub.base_rent_monthly, subEscs, periodDate)
      : sub.base_rent_monthly;
    income +=
      currentSubRent +
      sub.cam_recovery_monthly +
      sub.insurance_recovery_monthly +
      sub.property_tax_recovery_monthly +
      sub.utilities_recovery_monthly +
      sub.other_recovery_monthly;
  }
  return income;
}

function getCurrentMonthlyGross(
  lease: LeaseRow,
  escalations: EscalationRule[],
): number {
  const currentRent =
    escalations.length > 0
      ? getCurrentRent(lease.base_rent_monthly, escalations)
      : lease.base_rent_monthly;
  return (
    currentRent +
    lease.cam_monthly +
    lease.insurance_monthly +
    lease.property_tax_annual / 12 +
    lease.utilities_monthly +
    lease.other_monthly_costs
  );
}

function getMonthlyGrossForPeriod(
  lease: LeaseRow,
  escalations: EscalationRule[],
  asOfDate: Date,
): number {
  const currentRent =
    escalations.length > 0
      ? getCurrentRent(lease.base_rent_monthly, escalations, asOfDate)
      : lease.base_rent_monthly;
  return (
    currentRent +
    lease.cam_monthly +
    lease.insurance_monthly +
    lease.property_tax_annual / 12 +
    lease.utilities_monthly +
    lease.other_monthly_costs
  );
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function getMonthLabel(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function leaseDisplayName(lease: LeaseRow): string {
  return lease.nickname || lease.lease_name;
}

// Parse a bare "YYYY-MM-DD" value as LOCAL midnight. Using `new Date(iso)`
// directly parses as UTC midnight, which renders/compares as the prior day in
// negative-offset timezones (PST/PDT) — the source of the off-by-one dates.
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

// Today at local midnight, for date-only comparisons.
function startOfToday(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

// Whole days from today (local) until the given date; negative if already past.
function daysUntil(iso: string): number {
  return Math.ceil(
    (parseLocalDate(iso).getTime() - startOfToday().getTime()) / 86_400_000
  );
}

// A lease counts as active only if it is flagged active AND has not passed its
// expiration date. A lease left flagged "active" after expiring (e.g. Pico)
// should drop out of the consolidated view.
function isLeaseActive(lease: { status: LeaseStatus; expiration_date: string }): boolean {
  return isActiveLeaseStatus(lease.status) && parseLocalDate(lease.expiration_date) >= startOfToday();
}

// --- Page ---

export default function OrgRealEstatePage() {
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [subleases, setSubleases] = useState<SubleaseRow[]>([]);
  const [costSplits, setCostSplits] = useState<CostSplitRow[]>([]);
  const [escalationsByLease, setEscalationsByLease] = useState<Record<string, EscalationRule[]>>({});
  const [subleaseEscMap, setSubleaseEscMap] = useState<Record<string, EscalationRule[]>>({});
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());
  const [leasePayments, setLeasePayments] = useState<
    Array<{ lease_id: string; period_year: number; period_month: number; scheduled_amount: number }>
  >([]);
  const [subleasePayments, setSubleasePayments] = useState<
    Array<{ sublease_id: string; lease_id: string; period_year: number; period_month: number; scheduled_amount: number }>
  >([]);

  // --- Data Fetching ---

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // Fetch entities and leases in parallel
      const [{ data: entData }, { data: leaseData }] = await Promise.all([
        supabase
          .from("entities")
          .select("id, name, code")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("leases")
          .select(
            `id, entity_id, lease_name, nickname, lease_type, status, lessor_name,
             commencement_date, expiration_date, lease_term_months,
             base_rent_monthly, base_rent_annual, cam_monthly, insurance_monthly,
             property_tax_annual, utilities_monthly, other_monthly_costs,
             discount_rate, initial_direct_costs, lease_incentives_received,
             prepaid_rent, maintenance_type,
             properties(property_name, property_type, city, state, rentable_square_footage)`
          )
          .order("lease_name"),
      ]);

      const allLeases = (leaseData as unknown as LeaseRow[]) ?? [];
      const allEntities = entData ?? [];

      setEntities(allEntities);
      setLeases(allLeases);

      // Auto-expand entities with leases
      const idsWithLeases = new Set(allLeases.map((l) => l.entity_id));
      setExpandedEntities(idsWithLeases);

      // Fetch subleases, escalations, cost splits sequentially (Supabase Promise.all depth issue)
      const subleasesResult = await supabase
        .from("subleases")
        .select(
          `id, lease_id, entity_id, status, commencement_date, expiration_date,
           base_rent_monthly, cam_recovery_monthly, insurance_recovery_monthly,
           property_tax_recovery_monthly, utilities_recovery_monthly, other_recovery_monthly`
        )
        .order("sublease_name");
      setSubleases((subleasesResult.data as unknown as SubleaseRow[]) ?? []);

      const escalationsResult = await supabase
        .from("lease_escalations")
        .select("lease_id, escalation_type, effective_date, percentage_increase, amount_increase, frequency")
        .order("effective_date");

      const escMap: Record<string, EscalationRule[]> = {};
      for (const row of (escalationsResult.data ?? []) as Array<{ lease_id: string } & EscalationRule>) {
        if (!escMap[row.lease_id]) escMap[row.lease_id] = [];
        escMap[row.lease_id].push(row as unknown as EscalationRule);
      }
      setEscalationsByLease(escMap);

      // Sublease escalations
      const subIds = ((subleasesResult.data ?? []) as unknown as SubleaseRow[]).map((s) => s.id);
      if (subIds.length > 0) {
        const subEscResult = await supabase
          .from("sublease_escalations")
          .select("sublease_id, escalation_type, effective_date, percentage_increase, amount_increase, frequency")
          .in("sublease_id", subIds)
          .order("effective_date");
        const sEscMap: Record<string, EscalationRule[]> = {};
        for (const row of (subEscResult.data ?? []) as Array<{ sublease_id: string } & EscalationRule>) {
          if (!sEscMap[row.sublease_id]) sEscMap[row.sublease_id] = [];
          sEscMap[row.sublease_id].push(row as unknown as EscalationRule);
        }
        setSubleaseEscMap(sEscMap);
      }

      // Cost splits (all active)
      const splitsResult = await supabase
        .from("lease_cost_splits")
        .select("id, lease_id, source_entity_id, destination_entity_id, split_type, split_percentage, split_fixed_amount, is_active")
        .eq("is_active", true);
      setCostSplits((splitsResult.data as unknown as CostSplitRow[]) ?? []);

      // Payment schedules for the active portfolio, driving the year × month
      // cost grids. Scoped to currently-active leases/subleases (date-aware),
      // and paginated so we don't hit the 1000-row PostgREST cap across all
      // entities.
      const activeLeaseIds = allLeases.filter(isLeaseActive).map((l) => l.id);
      if (activeLeaseIds.length > 0) {
        const lp = await fetchAllRows<{
          lease_id: string;
          period_year: number;
          period_month: number;
          scheduled_amount: number;
        }>(supabase, {
          table: "lease_payments",
          select: "lease_id, period_year, period_month, scheduled_amount",
          filters: [{ type: "in", column: "lease_id", value: activeLeaseIds }],
          order: [{ column: "period_year" }, { column: "period_month" }],
        });
        setLeasePayments(lp);
      } else {
        setLeasePayments([]);
      }

      const allSubs = (subleasesResult.data as unknown as SubleaseRow[]) ?? [];
      const activeSubIds = allSubs.filter((s) => s.status === "active").map((s) => s.id);
      if (activeSubIds.length > 0) {
        const subToLease: Record<string, string> = {};
        for (const s of allSubs) subToLease[s.id] = s.lease_id;
        const sp = await fetchAllRows<{
          sublease_id: string;
          period_year: number;
          period_month: number;
          scheduled_amount: number;
        }>(supabase, {
          table: "sublease_payments",
          select: "sublease_id, period_year, period_month, scheduled_amount",
          filters: [{ type: "in", column: "sublease_id", value: activeSubIds }],
          order: [{ column: "period_year" }, { column: "period_month" }],
        });
        setSubleasePayments(
          sp.map((p) => ({ ...p, lease_id: subToLease[p.sublease_id] ?? "" }))
        );
      } else {
        setSubleasePayments([]);
      }

      setLoading(false);
    }
    load();
  }, []);

  // --- Active leases ---

  const activeLeases = useMemo(
    () => leases.filter(isLeaseActive),
    [leases]
  );

  // --- Net monthly cost per lease (current rent with escalations, minus sublease income) ---

  const leaseNetMonthlyCost = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of activeLeases) {
      const gross = getCurrentMonthlyGross(l, escalationsByLease[l.id] ?? []);
      const subIncome = getMonthlySubleaseIncome(l.id, subleases, subleaseEscMap);
      map.set(l.id, gross - subIncome);
    }
    return map;
  }, [activeLeases, escalationsByLease, subleases, subleaseEscMap]);

  // --- Next-12-months net cost per lease (from the generated payment schedule) ---
  // Sums the scheduled lease payments (net of sublease recoveries) over the
  // current month plus the next 11 — so it reflects escalations, abatements,
  // and leases that end partway through the window, instead of a flat
  // currentMonthly × 12.

  const next12MonthKeys = useMemo(() => {
    const { year, month } = getCurrentPeriod();
    const set = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const d = new Date(year, month - 1 + i, 1);
      set.add(`${d.getFullYear()}-${d.getMonth() + 1}`);
    }
    return set;
  }, []);

  const leasesWithSchedule = useMemo(
    () => new Set(leasePayments.map((p) => p.lease_id)),
    [leasePayments]
  );

  const leaseNext12Net = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of leasePayments) {
      if (!next12MonthKeys.has(`${p.period_year}-${p.period_month}`)) continue;
      map.set(p.lease_id, (map.get(p.lease_id) ?? 0) + p.scheduled_amount);
    }
    for (const p of subleasePayments) {
      if (!next12MonthKeys.has(`${p.period_year}-${p.period_month}`)) continue;
      map.set(p.lease_id, (map.get(p.lease_id) ?? 0) - p.scheduled_amount);
    }
    return map;
  }, [leasePayments, subleasePayments, next12MonthKeys]);

  // --- Cost by entity including allocations ---

  const entityNetCosts = useMemo(() => {
    // Start with each entity's own leases' net costs
    const map = new Map<string, number>();
    for (const entity of entities) {
      let ownedCost = 0;
      for (const l of activeLeases) {
        if (l.entity_id === entity.id) {
          ownedCost += leaseNetMonthlyCost.get(l.id) ?? 0;
        }
      }
      map.set(entity.id, ownedCost);
    }

    // Apply cost splits
    for (const split of costSplits) {
      const leaseNet = leaseNetMonthlyCost.get(split.lease_id);
      if (leaseNet == null) continue; // lease not active

      const allocatedAmount =
        split.split_type === "percentage"
          ? leaseNet * (split.split_percentage ?? 0)
          : (split.split_fixed_amount ?? 0);

      // Reduce source entity cost
      const srcCurrent = map.get(split.source_entity_id) ?? 0;
      map.set(split.source_entity_id, srcCurrent - allocatedAmount);

      // Increase destination entity cost
      const dstCurrent = map.get(split.destination_entity_id) ?? 0;
      map.set(split.destination_entity_id, dstCurrent + allocatedAmount);
    }

    return map;
  }, [entities, activeLeases, leaseNetMonthlyCost, costSplits]);

  // --- Filtered data ---

  const filteredLeases = useMemo(() => {
    return leases.filter((l) => {
      // "Active" is date-aware: a lease still flagged active but past its
      // expiration date is treated as inactive and excluded.
      if (statusFilter === "active") {
        if (!isLeaseActive(l)) return false;
      } else if (statusFilter !== "all" && l.status !== statusFilter) {
        return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const match =
          l.lease_name.toLowerCase().includes(q) ||
          (l.nickname && l.nickname.toLowerCase().includes(q)) ||
          (l.lessor_name && l.lessor_name.toLowerCase().includes(q)) ||
          (l.properties?.property_name?.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [leases, statusFilter, search]);

  // --- Computed KPIs ---

  const kpis = useMemo(() => {
    let totalMonthlyNet = 0;
    for (const [, cost] of entityNetCosts) {
      totalMonthlyNet += cost;
    }
    const totalAnnualNet = totalMonthlyNet * 12;

    const totalLiability = activeLeases.reduce((sum, l) => {
      return (
        sum +
        calculateLeaseLiability({
          lease_type: l.lease_type,
          lease_term_months: l.lease_term_months,
          discount_rate: l.discount_rate,
          commencement_date: l.commencement_date,
          initial_direct_costs: l.initial_direct_costs,
          lease_incentives_received: l.lease_incentives_received,
          prepaid_rent: l.prepaid_rent,
          base_rent_monthly: l.base_rent_monthly,
        })
      );
    }, 0);
    const totalROU = activeLeases.reduce((sum, l) => {
      return (
        sum +
        calculateROUAsset({
          lease_type: l.lease_type,
          lease_term_months: l.lease_term_months,
          discount_rate: l.discount_rate,
          commencement_date: l.commencement_date,
          initial_direct_costs: l.initial_direct_costs,
          lease_incentives_received: l.lease_incentives_received,
          prepaid_rent: l.prepaid_rent,
          base_rent_monthly: l.base_rent_monthly,
        })
      );
    }, 0);
    const totalSqFt = activeLeases.reduce(
      (sum, l) => sum + (l.properties?.rentable_square_footage ?? 0),
      0
    );

    return { totalMonthlyNet, totalAnnualNet, totalLiability, totalROU, totalSqFt };
  }, [activeLeases, entityNetCosts]);

  // --- Cost Timeline (next 24 months by entity, net of subleases, with allocations) ---

  const costTimeline = useMemo(() => {
    const { year, month } = getCurrentPeriod();
    const months: { label: string; year: number; month: number }[] = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(year, month - 1 + i, 1);
      months.push({
        label: getMonthLabel(d.getFullYear(), d.getMonth() + 1),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
    }

    return months.map((m) => {
      // Step 1: compute each entity's gross lease cost for this period (net of subleases)
      const entityGross = new Map<string, number>();
      const leaseNetForPeriod = new Map<string, number>();

      for (const l of activeLeases) {
        const start = parseLocalDate(l.commencement_date);
        const end = parseLocalDate(l.expiration_date);
        const periodDate = new Date(m.year, m.month - 1, 15);
        if (periodDate < start || periodDate > end) continue;

        const gross = getMonthlyGrossForPeriod(l, escalationsByLease[l.id] ?? [], periodDate);
        const subIncome = getSubleaseIncomeForPeriod(l.id, subleases, subleaseEscMap, m.year, m.month);
        const net = gross - subIncome;
        leaseNetForPeriod.set(l.id, net);

        const prev = entityGross.get(l.entity_id) ?? 0;
        entityGross.set(l.entity_id, prev + net);
      }

      // Step 2: apply cost splits
      for (const split of costSplits) {
        const leaseNet = leaseNetForPeriod.get(split.lease_id);
        if (leaseNet == null) continue;

        const allocatedAmount =
          split.split_type === "percentage"
            ? leaseNet * (split.split_percentage ?? 0)
            : (split.split_fixed_amount ?? 0);

        const srcPrev = entityGross.get(split.source_entity_id) ?? 0;
        entityGross.set(split.source_entity_id, srcPrev - allocatedAmount);

        const dstPrev = entityGross.get(split.destination_entity_id) ?? 0;
        entityGross.set(split.destination_entity_id, dstPrev + allocatedAmount);
      }

      // Step 3: build chart row
      const row: Record<string, string | number> = { name: m.label };
      let total = 0;
      for (const entity of entities) {
        const val = entityGross.get(entity.id) ?? 0;
        if (val > 0) {
          row[entity.code] = Math.round(val);
          total += val;
        }
      }
      row.total = Math.round(total);
      return row;
    });
  }, [activeLeases, entities, subleases, costSplits, escalationsByLease, subleaseEscMap]);

  // --- Entity cost breakdown (pie) including allocations ---

  const entityCostPie = useMemo(() => {
    const results: { name: string; value: number }[] = [];
    for (const entity of entities) {
      const annualCost = (entityNetCosts.get(entity.id) ?? 0) * 12;
      if (annualCost > 0) {
        results.push({ name: entity.code, value: Math.round(annualCost) });
      }
    }
    return results.sort((a, b) => b.value - a.value);
  }, [entities, entityNetCosts]);

  // --- Cost category breakdown (pie) — net of sublease recoveries ---

  const costCategoryPie = useMemo(() => {
    let baseRent = 0, cam = 0, insurance = 0, propTax = 0, utilities = 0, other = 0;
    let subBaseRent = 0, subCam = 0, subInsurance = 0, subPropTax = 0, subUtilities = 0, subOther = 0;

    for (const l of activeLeases) {
      const escs = escalationsByLease[l.id] ?? [];
      const currentRent = escs.length > 0 ? getCurrentRent(l.base_rent_monthly, escs) : l.base_rent_monthly;
      baseRent += currentRent * 12;
      cam += l.cam_monthly * 12;
      insurance += l.insurance_monthly * 12;
      propTax += l.property_tax_annual;
      utilities += l.utilities_monthly * 12;
      other += l.other_monthly_costs * 12;
    }

    // Sublease recoveries
    const activeSubs = subleases.filter((s) => s.status === "active");
    for (const sub of activeSubs) {
      const subEscs = subleaseEscMap[sub.id] ?? [];
      const currentSubRent = subEscs.length > 0
        ? getCurrentRent(sub.base_rent_monthly, subEscs)
        : sub.base_rent_monthly;
      subBaseRent += currentSubRent * 12;
      subCam += sub.cam_recovery_monthly * 12;
      subInsurance += sub.insurance_recovery_monthly * 12;
      subPropTax += sub.property_tax_recovery_monthly * 12;
      subUtilities += sub.utilities_recovery_monthly * 12;
      subOther += sub.other_recovery_monthly * 12;
    }

    return [
      { name: "Base Rent", value: Math.round(baseRent - subBaseRent) },
      { name: "CAM", value: Math.round(cam - subCam) },
      { name: "Insurance", value: Math.round(insurance - subInsurance) },
      { name: "Property Tax", value: Math.round(propTax - subPropTax) },
      { name: "Utilities", value: Math.round(utilities - subUtilities) },
      { name: "Other", value: Math.round(other - subOther) },
    ].filter((d) => d.value > 0);
  }, [activeLeases, escalationsByLease, subleases, subleaseEscMap]);

  // --- Lease type breakdown (pie) ---

  const leaseTypePie = useMemo(() => {
    const operating = activeLeases.filter((l) => l.lease_type === "operating").length;
    const finance = activeLeases.filter((l) => l.lease_type === "finance").length;
    return [
      { name: "Operating", value: operating },
      { name: "Finance", value: finance },
    ].filter((d) => d.value > 0);
  }, [activeLeases]);

  // --- Lease expiration timeline (bar) ---

  const expirationTimeline = useMemo(() => {
    const { year } = getCurrentPeriod();
    const buckets: Record<string, number> = {};
    for (const l of activeLeases) {
      const expYear = parseLocalDate(l.expiration_date).getFullYear();
      const label =
        expYear <= year ? `${year}` : expYear > year + 5 ? `${year + 6}+` : `${expYear}`;
      buckets[label] = (buckets[label] ?? 0) + 1;
    }
    const labels: string[] = [];
    for (let y = year; y <= year + 5; y++) labels.push(`${y}`);
    labels.push(`${year + 6}+`);
    return labels
      .filter((label) => buckets[label])
      .map((label) => ({ name: label, leases: buckets[label] }));
  }, [activeLeases]);

  // --- Maintenance type breakdown (pie) — net of subleases ---

  const maintenancePie = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of activeLeases) {
      const mt = l.maintenance_type ?? "unknown";
      const label =
        mt === "triple_net" ? "Triple Net (NNN)"
          : mt === "gross" ? "Gross"
          : mt === "modified_gross" ? "Modified Gross"
          : "Unknown";
      const net = (leaseNetMonthlyCost.get(l.id) ?? 0) * 12;
      map.set(label, (map.get(label) ?? 0) + net);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [activeLeases, leaseNetMonthlyCost]);

  // --- Property type breakdown ---

  const propertyTypePie = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of activeLeases) {
      const pt = l.properties?.property_type ?? "other";
      const label = pt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [activeLeases]);

  // --- Upcoming expirations (within 12 months) ---

  const upcomingExpirations = useMemo(() => {
    const today = startOfToday();
    const in12Months = new Date(today.getFullYear(), today.getMonth() + 12, today.getDate());
    return activeLeases
      .filter((l) => {
        const exp = parseLocalDate(l.expiration_date);
        return exp <= in12Months && exp >= today;
      })
      .sort(
        (a, b) =>
          parseLocalDate(a.expiration_date).getTime() -
          parseLocalDate(b.expiration_date).getTime()
      );
  }, [activeLeases]);

  // --- Entity toggle ---

  function toggleEntity(entityId: string) {
    setExpandedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  }

  // --- Grouped leases ---

  const groupedLeases = useMemo(() => {
    const map = new Map<string, LeaseRow[]>();
    for (const l of filteredLeases) {
      const arr = map.get(l.entity_id) ?? [];
      arr.push(l);
      map.set(l.entity_id, arr);
    }
    return map;
  }, [filteredLeases]);

  // --- Render ---

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Real Estate Portfolio</h1>
          <p className="text-muted-foreground">Loading lease data across all entities...</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-7 w-32 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const entitiesWithCosts = entities.filter(
    (e) => (entityNetCosts.get(e.id) ?? 0) > 0 || activeLeases.some((l) => l.entity_id === e.id)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Real Estate Portfolio</h1>
        <p className="text-muted-foreground">
          Consolidated view of {activeLeases.length} active lease
          {activeLeases.length !== 1 ? "s" : ""} across{" "}
          {entitiesWithCosts.length} entit
          {entitiesWithCosts.length !== 1 ? "ies" : "y"}
          {subleases.filter((s) => s.status === "active").length > 0 &&
            ` (net of ${subleases.filter((s) => s.status === "active").length} active sublease${subleases.filter((s) => s.status === "active").length !== 1 ? "s" : ""})`}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Annual Occupancy Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(kpis.totalAnnualNet)}</div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(kpis.totalMonthlyNet)}/month (current)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Lease Liability</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(kpis.totalLiability)}</div>
            <p className="text-xs text-muted-foreground">ASC 842 balance</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ROU Asset</CardTitle>
            <Building className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(kpis.totalROU)}</div>
            <p className="text-xs text-muted-foreground">Right-of-use assets</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Square Footage</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis.totalSqFt > 0 ? new Intl.NumberFormat("en-US").format(kpis.totalSqFt) : "N/A"}
            </div>
            <p className="text-xs text-muted-foreground">
              {kpis.totalSqFt > 0 && kpis.totalAnnualNet > 0
                ? `${formatCurrency(kpis.totalAnnualNet / kpis.totalSqFt)}/SF/yr (net)`
                : "Rentable area"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1: Cost Timeline + Entity Breakdown */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Monthly Net Occupancy Cost Forecast</CardTitle>
            <CardDescription>Projected costs by entity over the next 24 months (net of subleases, with allocations)</CardDescription>
          </CardHeader>
          <CardContent>
            {costTimeline.length > 0 && entitiesWithCosts.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={costTimeline} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={2} className="text-muted-foreground" />
                  <YAxis tickFormatter={formatCompact} tick={{ fontSize: 11 }} className="text-muted-foreground" width={55} />
                  <RechartsTooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  {entitiesWithCosts.map((entity, i) => (
                    <Area
                      key={entity.id}
                      type="monotone"
                      dataKey={entity.code}
                      stackId="1"
                      fill={ENTITY_COLORS[i % ENTITY_COLORS.length]}
                      stroke={ENTITY_COLORS[i % ENTITY_COLORS.length]}
                      fillOpacity={0.6}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[320px] text-muted-foreground">No active leases to chart</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Net Cost by Entity</CardTitle>
            <CardDescription>Annual net occupancy cost (incl. allocations)</CardDescription>
          </CardHeader>
          <CardContent>
            {entityCostPie.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={entityCostPie}
                    cx="50%"
                    cy="45%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={{ strokeWidth: 1 }}
                  >
                    {entityCostPie.map((_, i) => (
                      <Cell key={i} fill={ENTITY_COLORS[i % ENTITY_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[320px] text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2: Cost Categories + Lease Expirations + Lease Structure */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Net Cost Breakdown</CardTitle>
            <CardDescription>Annual net cost by category</CardDescription>
          </CardHeader>
          <CardContent>
            {costCategoryPie.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={costCategoryPie}
                    cx="50%"
                    cy="45%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {costCategoryPie.map((_, i) => (
                      <Cell key={i} fill={ENTITY_COLORS[i % ENTITY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend verticalAlign="bottom" height={36} iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <RechartsTooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[260px] text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lease Expirations</CardTitle>
            <CardDescription>Active leases expiring by year</CardDescription>
          </CardHeader>
          <CardContent>
            {expirationTimeline.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={expirationTimeline} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="leases" fill="#2563eb" radius={[4, 4, 0, 0]} name="Leases" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[260px] text-muted-foreground">No expirations</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lease Structure</CardTitle>
            <CardDescription>By type and maintenance responsibility</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {leaseTypePie.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Classification</p>
                  <div className="flex gap-4">
                    {leaseTypePie.map((d, i) => (
                      <div key={d.name} className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: ENTITY_COLORS[i % ENTITY_COLORS.length] }} />
                        <span className="text-sm">{d.name} <span className="font-semibold">{d.value}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {maintenancePie.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Maintenance Responsibility (Net)</p>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={maintenancePie} cx="50%" cy="50%" innerRadius={30} outerRadius={55} paddingAngle={2} dataKey="value">
                        {maintenancePie.map((_, i) => (
                          <Cell key={i} fill={ENTITY_COLORS[i % ENTITY_COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend verticalAlign="bottom" height={30} iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                      <RechartsTooltip
                        formatter={(value) => formatCurrency(Number(value))}
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "var(--radius)",
                          fontSize: 12,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {propertyTypePie.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Property Types</p>
                  <div className="flex flex-wrap gap-2">
                    {propertyTypePie.map((d) => (
                      <Badge key={d.name} variant="outline" className="text-xs">
                        {d.name} ({d.value})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Expirations Alert */}
      {upcomingExpirations.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Upcoming Lease Expirations
            </CardTitle>
            <CardDescription>
              {upcomingExpirations.length} lease{upcomingExpirations.length !== 1 ? "s" : ""} expiring within 12 months
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {upcomingExpirations.map((l) => {
                const entity = entities.find((e) => e.id === l.entity_id);
                const daysLeft = daysUntil(l.expiration_date);
                return (
                  <Link
                    key={l.id}
                    href={`/${l.entity_id}/real-estate/${l.id}`}
                    className="flex items-center justify-between rounded-md border p-3 hover:bg-accent transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{leaseDisplayName(l)}</p>
                      <p className="text-xs text-muted-foreground">
                        {entity?.code} &middot; {formatIsoDateLocal(l.expiration_date)}
                      </p>
                    </div>
                    <Badge variant={daysLeft <= 90 ? "destructive" : "secondary"} className="ml-2 shrink-0">
                      {daysLeft}d
                    </Badge>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lease List by Entity */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-base">All Leases</CardTitle>
              <CardDescription>
                {filteredLeases.length} lease{filteredLeases.length !== 1 ? "s" : ""} across all entities
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search leases..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-[200px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="active_non_operational">Active (Non-Operational)</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {entities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Building2 className="h-10 w-10 mb-3" />
              <p>No entities found</p>
            </div>
          ) : (
            <div className="space-y-1">
              {entities.map((entity) => {
                const entityLeases = groupedLeases.get(entity.id) ?? [];
                const isExpanded = expandedEntities.has(entity.id);
                const entityAnnualNet = (entityNetCosts.get(entity.id) ?? 0) * 12;

                if (entityLeases.length === 0 && statusFilter !== "all") return null;

                return (
                  <div key={entity.id} className="border rounded-lg">
                    <button
                      onClick={() => toggleEntity(entity.id)}
                      className="flex items-center justify-between w-full px-4 py-3 hover:bg-accent/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div>
                          <span className="font-medium">{entity.name}</span>
                          <span className="text-muted-foreground ml-2 text-sm">({entity.code})</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">
                          {entityLeases.length} lease{entityLeases.length !== 1 ? "s" : ""}
                        </span>
                        {entityAnnualNet > 0 && (
                          <span className="text-sm font-medium">{formatCurrency(entityAnnualNet)}/yr net</span>
                        )}
                      </div>
                    </button>

                    {isExpanded && entityLeases.length > 0 && (
                      <div className="border-t">
                        <Table className="table-fixed w-full">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-11 w-[22%]">Nickname</TableHead>
                              <TableHead className="w-[20%]">Property</TableHead>
                              <TableHead className="w-[10%]">Status</TableHead>
                              <TableHead className="text-right w-[15%]">Current Monthly (Net)</TableHead>
                              <TableHead className="text-right w-[13%]">Next 12 Mo (Net)</TableHead>
                              <TableHead className="w-[13%]">Expiration</TableHead>
                              <TableHead className="w-[7%]" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {entityLeases.map((lease) => {
                              const netMonthly = leaseNetMonthlyCost.get(lease.id) ?? 0;
                              // Scheduled net over the next 12 months; fall back to
                              // annualized run-rate only if no schedule exists yet.
                              const next12Net = leasesWithSchedule.has(lease.id)
                                ? (leaseNext12Net.get(lease.id) ?? 0)
                                : netMonthly * 12;
                              const hasSubleases = subleases.some(
                                (s) => s.lease_id === lease.id && s.status === "active"
                              );
                              const daysToExpiry = daysUntil(lease.expiration_date);
                              const isExpiringSoon =
                                isActiveLeaseStatus(lease.status) && daysToExpiry <= 180 && daysToExpiry > 0;

                              return (
                                <TableRow key={lease.id} className="cursor-pointer hover:bg-accent/50">
                                  <TableCell className="pl-11">
                                    <Link
                                      href={`/${lease.entity_id}/real-estate/${lease.id}`}
                                      className="hover:underline"
                                    >
                                      <div className="font-medium truncate">
                                        {leaseDisplayName(lease)}
                                      </div>
                                      {lease.nickname && (
                                        <div className="text-xs text-muted-foreground truncate">
                                          {lease.lease_name}
                                        </div>
                                      )}
                                    </Link>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm truncate">{lease.properties?.property_name ?? "—"}</div>
                                    {lease.properties?.city && (
                                      <div className="text-xs text-muted-foreground truncate">
                                        {lease.properties.city}
                                        {lease.properties.state ? `, ${lease.properties.state}` : ""}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {hasSubleases ? (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/40 dark:text-green-300"
                                      >
                                        Subleased
                                      </Badge>
                                    ) : (
                                      <Badge variant={STATUS_VARIANT[lease.status]} className="text-xs">{STATUS_LABEL[lease.status]}</Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    <div>{formatCurrency(netMonthly)}</div>
                                    {hasSubleases && (
                                      <div className="text-xs text-emerald-600">incl. sublease offset</div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {formatCurrency(next12Net)}
                                  </TableCell>
                                  <TableCell>
                                    <div className={cn("text-sm", isExpiringSoon && "text-amber-600 font-medium")}>
                                      {formatIsoDateLocal(lease.expiration_date)}
                                    </div>
                                    {isExpiringSoon && (
                                      <div className="text-xs text-amber-600">{daysToExpiry}d remaining</div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Link href={`/${lease.entity_id}/real-estate/${lease.id}`}>
                                      <ArrowRight className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                                    </Link>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {isExpanded && entityLeases.length === 0 && (
                      <div className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
                        No leases match the current filters
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Total cost grids — per month and per year, across the active portfolio */}
      {leasePayments.length > 0 && (
        <PaymentScheduleGrids
          leasePayments={leasePayments}
          subleasePayments={subleasePayments}
        />
      )}
    </div>
  );
}

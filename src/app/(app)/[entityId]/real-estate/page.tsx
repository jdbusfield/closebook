"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  ArrowRight,
  Building,
  Search,
  Upload,
  Download,
  AlertTriangle,
  Calendar,
  Check,
} from "lucide-react";
import * as XLSX from "xlsx";
import { formatCurrency, formatPercentage, getCurrentPeriod } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";
import {
  calculateLeaseLiability,
  calculateROUAsset,
} from "@/lib/utils/lease-calculations";
import { getCurrentRent, generateLeasePaymentSchedule } from "@/lib/utils/lease-payments";
import type { EscalationRule, LeaseForPayments } from "@/lib/utils/lease-payments";
import type { LeaseStatus, LeaseType, CriticalDateType, SubleaseStatus, SplitType } from "@/lib/types/database";
import { isActiveLeaseStatus } from "@/lib/types/database";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PaymentScheduleGrids } from "@/components/real-estate/payment-schedule-grids";

// --- Interfaces ---

interface LeaseListItem {
  id: string;
  lease_name: string;
  nickname: string | null;
  status: LeaseStatus;
  lease_type: LeaseType;
  lessor_name: string | null;
  commencement_date: string;
  expiration_date: string;
  lease_term_months: number;
  base_rent_monthly: number;
  cam_monthly: number;
  insurance_monthly: number;
  property_tax_annual: number;
  property_tax_frequency: string;
  utilities_monthly: number;
  other_monthly_costs: number;
  rent_commencement_date: string | null;
  rent_abatement_months: number;
  rent_abatement_amount: number;
  security_deposit: number;
  discount_rate: number;
  initial_direct_costs: number;
  lease_incentives_received: number;
  prepaid_rent: number;
  properties: {
    property_name: string;
    rentable_square_footage: number | null;
    lot_square_footage: number | null;
  } | null;
}

interface CriticalDateItem {
  id: string;
  date_type: CriticalDateType;
  critical_date: string;
  description: string | null;
  alert_days_before: number;
  is_resolved: boolean;
  lease_id: string;
  leases: {
    lease_name: string;
    nickname: string | null;
  } | null;
}

interface SubleaseListItem {
  id: string;
  lease_id: string;
  sublease_name: string;
  subtenant_name: string;
  status: SubleaseStatus;
  commencement_date: string;
  expiration_date: string;
  sublease_term_months: number;
  base_rent_monthly: number;
  cam_recovery_monthly: number;
  insurance_recovery_monthly: number;
  property_tax_recovery_monthly: number;
  utilities_recovery_monthly: number;
  other_recovery_monthly: number;
  subleased_square_footage: number | null;
  leases: { lease_name: string; nickname: string | null } | null;
}

interface CostSplitItem {
  id: string;
  lease_id: string;
  source_entity_id: string;
  destination_entity_id: string;
  split_type: SplitType;
  split_percentage: number | null;
  split_fixed_amount: number | null;
  description: string | null;
  is_active: boolean;
  dest_entity_name: string;
  dest_entity_code: string;
}

interface AllocatedLeaseItem {
  split_id: string;
  lease_id: string;
  lease_name: string;
  lease_nickname: string | null;
  source_entity_id: string;
  source_entity_name: string;
  source_entity_code: string;
  split_type: SplitType;
  split_percentage: number | null;
  split_fixed_amount: number | null;
  lease_total_monthly: number;
  allocated_monthly: number;
}

interface EntityOption {
  id: string;
  name: string;
  code: string;
}

// --- Constants ---

const STATUS_LABELS: Record<LeaseStatus, string> = {
  draft: "Draft",
  active: "Active",
  active_non_operational: "Active (Non-Operational)",
  expired: "Expired",
  terminated: "Terminated",
};

const STATUS_VARIANTS: Record<
  LeaseStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  active: "default",
  active_non_operational: "secondary",
  expired: "secondary",
  terminated: "destructive",
};

const TYPE_LABELS: Record<LeaseType, string> = {
  operating: "Operating",
  finance: "Finance",
};

const DATE_TYPE_LABELS: Record<CriticalDateType, string> = {
  lease_expiration: "Lease Expiration",
  renewal_deadline: "Renewal Deadline",
  termination_notice: "Termination Notice",
  rent_escalation: "Rent Escalation",
  rent_review: "Rent Review",
  cam_reconciliation: "CAM Reconciliation",
  insurance_renewal: "Insurance Renewal",
  custom: "Custom",
};

function totalMonthlyCost(lease: LeaseListItem, currentRentOverride?: number): number {
  return (
    (currentRentOverride ?? lease.base_rent_monthly) +
    lease.cam_monthly +
    lease.insurance_monthly +
    lease.property_tax_annual / 12 +
    lease.utilities_monthly +
    lease.other_monthly_costs
  );
}

function totalLifetimeCost(lease: LeaseListItem): number {
  return totalMonthlyCost(lease) * lease.lease_term_months;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyColor(days: number): string {
  if (days < 0) return "text-red-600 font-semibold";
  if (days <= 30) return "text-red-500";
  if (days <= 90) return "text-yellow-600";
  return "text-muted-foreground";
}

function subleaseMonthlyIncome(s: SubleaseListItem): number {
  return (
    s.base_rent_monthly +
    s.cam_recovery_monthly +
    s.insurance_recovery_monthly +
    s.property_tax_recovery_monthly +
    s.utilities_recovery_monthly +
    s.other_recovery_monthly
  );
}

function urgencyBadge(days: number) {
  if (days < 0)
    return <Badge variant="destructive">Overdue</Badge>;
  if (days <= 30)
    return <Badge variant="destructive">{days}d</Badge>;
  if (days <= 90)
    return (
      <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
        {days}d
      </Badge>
    );
  return <Badge variant="outline">{days}d</Badge>;
}

// --- Component ---

export default function RealEstatePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const [leases, setLeases] = useState<LeaseListItem[]>([]);
  const [escalationsByLease, setEscalationsByLease] = useState<Record<string, EscalationRule[]>>({});
  const [subleases, setSubleases] = useState<SubleaseListItem[]>([]);
  const [subleaseEscalationsMap, setSubleaseEscalationsMap] = useState<Record<string, EscalationRule[]>>({});
  const [criticalDates, setCriticalDates] = useState<CriticalDateItem[]>([]);
  const [costSplits, setCostSplits] = useState<CostSplitItem[]>([]);
  const [allocatedLeases, setAllocatedLeases] = useState<AllocatedLeaseItem[]>([]);
  // Payment schedule grids
  const [allLeasePayments, setAllLeasePayments] = useState<Array<{ lease_id: string; period_year: number; period_month: number; scheduled_amount: number }>>([]);
  const [allSubleasePayments, setAllSubleasePayments] = useState<Array<{ sublease_id: string; lease_id: string; period_year: number; period_month: number; scheduled_amount: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = useCallback(async () => {
    const leasesQuery = supabase
      .from("leases")
      .select(
        `id, lease_name, nickname, status, lease_type, lessor_name,
        commencement_date, rent_commencement_date, expiration_date, lease_term_months,
        base_rent_monthly, cam_monthly, insurance_monthly,
        property_tax_annual, property_tax_frequency, utilities_monthly, other_monthly_costs,
        rent_abatement_months, rent_abatement_amount, security_deposit,
        discount_rate, initial_direct_costs, lease_incentives_received, prepaid_rent,
        properties(property_name, rentable_square_footage, lot_square_footage)`
      )
      .eq("entity_id", entityId)
      .order("lease_name");

    const datesQuery = supabase
      .from("lease_critical_dates")
      .select(
        `id, date_type, critical_date, description, alert_days_before, is_resolved, lease_id,
        leases(lease_name, nickname)`
      )
      .eq("is_resolved", false)
      .order("critical_date");

    const subleasesQuery = supabase
      .from("subleases")
      .select(
        `id, lease_id, sublease_name, subtenant_name, status,
        commencement_date, expiration_date, sublease_term_months,
        base_rent_monthly, cam_recovery_monthly, insurance_recovery_monthly,
        property_tax_recovery_monthly, utilities_recovery_monthly, other_recovery_monthly,
        subleased_square_footage,
        leases(lease_name, nickname)`
      )
      .eq("entity_id", entityId)
      .order("sublease_name");

    const escalationsQuery = supabase
      .from("lease_escalations")
      .select("lease_id, escalation_type, effective_date, percentage_increase, amount_increase, frequency")
      .order("effective_date");

    const leasesResult = await leasesQuery;
    const datesResult = await datesQuery;
    const subleasesResult = await subleasesQuery;
    const escalationsResult = await escalationsQuery;

    // Build escalation map by lease_id
    const escMap: Record<string, EscalationRule[]> = {};
    if (escalationsResult.data) {
      for (const row of escalationsResult.data) {
        const lid = (row as { lease_id: string }).lease_id;
        if (!escMap[lid]) escMap[lid] = [];
        escMap[lid].push(row as unknown as EscalationRule);
      }
    }

    const leasesData = (leasesResult.data as unknown as LeaseListItem[]) ?? [];
    const subleasesData = (subleasesResult.data as unknown as SubleaseListItem[]) ?? [];

    // Fetch sublease escalations for current income computation
    const subIds = subleasesData.map((s) => s.id);
    const subEscMap: Record<string, EscalationRule[]> = {};
    if (subIds.length > 0) {
      const subEscResult = await supabase
        .from("sublease_escalations")
        .select("sublease_id, escalation_type, effective_date, percentage_increase, amount_increase, frequency")
        .in("sublease_id", subIds)
        .order("effective_date");
      for (const row of (subEscResult.data ?? []) as Array<{ sublease_id: string } & EscalationRule>) {
        const sid = row.sublease_id;
        if (!subEscMap[sid]) subEscMap[sid] = [];
        subEscMap[sid].push(row as unknown as EscalationRule);
      }
    }

    setLeases(leasesData);
    setEscalationsByLease(escMap);
    setSubleases(subleasesData);
    setSubleaseEscalationsMap(subEscMap);
    setCriticalDates((datesResult.data as unknown as CriticalDateItem[]) ?? []);

    // Fetch all lease payments for the grids
    const leaseIds = leasesData.map((l) => l.id);
    if (leaseIds.length > 0) {
      const lpResult = await supabase
        .from("lease_payments")
        .select("lease_id, period_year, period_month, scheduled_amount")
        .in("lease_id", leaseIds)
        .order("period_year")
        .order("period_month");
      setAllLeasePayments(
        (lpResult.data as unknown as Array<{ lease_id: string; period_year: number; period_month: number; scheduled_amount: number }>) ?? []
      );

      // Fetch sublease payments (already have sublease IDs from subleasesData)
      if (subIds.length > 0) {
        const spResult = await supabase
          .from("sublease_payments")
          .select("sublease_id, period_year, period_month, scheduled_amount")
          .in("sublease_id", subIds)
          .order("period_year")
          .order("period_month");
        // Enrich with lease_id
        const subIdToLeaseId: Record<string, string> = {};
        for (const s of subleasesData) subIdToLeaseId[s.id] = s.lease_id;
        const spData = ((spResult.data ?? []) as unknown as Array<{ sublease_id: string; period_year: number; period_month: number; scheduled_amount: number }>).map((p) => ({
          ...p,
          lease_id: subIdToLeaseId[p.sublease_id] ?? "",
        }));
        setAllSubleasePayments(spData);
      } else {
        setAllSubleasePayments([]);
      }
    } else {
      setAllLeasePayments([]);
      setAllSubleasePayments([]);
    }

    // --- Cost Splits: outgoing from this entity ---
    const splitsResult = await supabase
      .from("lease_cost_splits")
      .select("id, lease_id, source_entity_id, destination_entity_id, split_type, split_percentage, split_fixed_amount, description, is_active")
      .eq("source_entity_id", entityId)
      .eq("is_active", true);

    // Get destination entity names
    const splitsRaw = (splitsResult.data ?? []) as Array<{
      id: string; lease_id: string; source_entity_id: string; destination_entity_id: string;
      split_type: SplitType; split_percentage: number | null; split_fixed_amount: number | null;
      description: string | null; is_active: boolean;
    }>;
    const destIds = [...new Set(splitsRaw.map((s) => s.destination_entity_id))];
    let destEntityMap: Record<string, { name: string; code: string }> = {};
    if (destIds.length > 0) {
      const entRes = await supabase
        .from("entities")
        .select("id, name, code")
        .in("id", destIds);
      for (const e of (entRes.data ?? []) as Array<{ id: string; name: string; code: string }>) {
        destEntityMap[e.id] = { name: e.name, code: e.code };
      }
    }
    const mappedSplits: CostSplitItem[] = splitsRaw.map((s) => ({
      ...s,
      dest_entity_name: destEntityMap[s.destination_entity_id]?.name ?? "Unknown",
      dest_entity_code: destEntityMap[s.destination_entity_id]?.code ?? "?",
    }));
    setCostSplits(mappedSplits);

    // --- Cost Splits: incoming to this entity from other entities ---
    const incomingSplitsResult = await supabase
      .from("lease_cost_splits")
      .select("id, lease_id, source_entity_id, destination_entity_id, split_type, split_percentage, split_fixed_amount")
      .eq("destination_entity_id", entityId)
      .eq("is_active", true);

    const incomingSplitsRaw = (incomingSplitsResult.data ?? []) as Array<{
      id: string; lease_id: string; source_entity_id: string; destination_entity_id: string;
      split_type: SplitType; split_percentage: number | null; split_fixed_amount: number | null;
    }>;

    if (incomingSplitsRaw.length > 0) {
      // Fetch source leases, their escalations, their subleases + sublease escalations, and source entity names
      const sourceLeaseIds = [...new Set(incomingSplitsRaw.map((s) => s.lease_id))];
      const sourceEntityIds = [...new Set(incomingSplitsRaw.map((s) => s.source_entity_id))];

      const srcLeasesRes = await supabase
        .from("leases")
        .select("id, lease_name, nickname, base_rent_monthly, cam_monthly, insurance_monthly, property_tax_annual, utilities_monthly, other_monthly_costs")
        .in("id", sourceLeaseIds);

      // Fetch escalations for source leases to compute current rent
      const srcEscResult = await supabase
        .from("lease_escalations")
        .select("lease_id, escalation_type, effective_date, percentage_increase, amount_increase, frequency")
        .in("lease_id", sourceLeaseIds)
        .order("effective_date");
      const srcEscMap: Record<string, EscalationRule[]> = {};
      for (const row of (srcEscResult.data ?? []) as Array<{ lease_id: string } & EscalationRule>) {
        if (!srcEscMap[row.lease_id]) srcEscMap[row.lease_id] = [];
        srcEscMap[row.lease_id].push(row as unknown as EscalationRule);
      }

      // Fetch active subleases for source leases to compute net cost
      const srcSubResult = await supabase
        .from("subleases")
        .select("id, lease_id, base_rent_monthly, cam_recovery_monthly, insurance_recovery_monthly, property_tax_recovery_monthly, utilities_recovery_monthly, other_recovery_monthly, status")
        .in("lease_id", sourceLeaseIds)
        .eq("status", "active");
      const srcSubleases = (srcSubResult.data ?? []) as Array<{
        id: string; lease_id: string; base_rent_monthly: number;
        cam_recovery_monthly: number; insurance_recovery_monthly: number;
        property_tax_recovery_monthly: number; utilities_recovery_monthly: number;
        other_recovery_monthly: number; status: string;
      }>;
      const srcSubIds = srcSubleases.map((s) => s.id);

      // Fetch sublease escalations for source subleases
      let srcSubEscMap: Record<string, EscalationRule[]> = {};
      if (srcSubIds.length > 0) {
        const srcSubEscResult = await supabase
          .from("sublease_escalations")
          .select("sublease_id, escalation_type, effective_date, percentage_increase, amount_increase, frequency")
          .in("sublease_id", srcSubIds)
          .order("effective_date");
        for (const row of (srcSubEscResult.data ?? []) as Array<{ sublease_id: string } & EscalationRule>) {
          if (!srcSubEscMap[row.sublease_id]) srcSubEscMap[row.sublease_id] = [];
          srcSubEscMap[row.sublease_id].push(row as unknown as EscalationRule);
        }
      }

      // Group source subleases by lease_id
      const srcSubByLease: Record<string, typeof srcSubleases> = {};
      for (const s of srcSubleases) {
        if (!srcSubByLease[s.lease_id]) srcSubByLease[s.lease_id] = [];
        srcSubByLease[s.lease_id].push(s);
      }

      const srcEntitiesRes = await supabase
        .from("entities")
        .select("id, name, code")
        .in("id", sourceEntityIds);

      const srcLeaseMap: Record<string, { lease_name: string; nickname: string | null; net_monthly: number }> = {};
      for (const l of ((srcLeasesRes.data ?? []) as unknown) as Array<{
        id: string; lease_name: string; nickname: string | null;
        base_rent_monthly: number; cam_monthly: number; insurance_monthly: number;
        property_tax_annual: number; utilities_monthly: number; other_monthly_costs: number;
      }>) {
        // Compute current rent for source lease (same logic as source entity uses)
        const escs = srcEscMap[l.id] ?? [];
        const currentRent = escs.length > 0
          ? getCurrentRent(l.base_rent_monthly, escs)
          : l.base_rent_monthly;
        const totalCost = currentRent + l.cam_monthly + l.insurance_monthly +
          l.property_tax_annual / 12 + l.utilities_monthly + l.other_monthly_costs;

        // Compute current sublease income for source lease
        const leaseSubleases = srcSubByLease[l.id] ?? [];
        let subleaseIncome = 0;
        for (const sub of leaseSubleases) {
          const subEscs = srcSubEscMap[sub.id] ?? [];
          const currentSubBase = subEscs.length > 0
            ? getCurrentRent(sub.base_rent_monthly, subEscs)
            : sub.base_rent_monthly;
          subleaseIncome += currentSubBase + sub.cam_recovery_monthly + sub.insurance_recovery_monthly +
            sub.property_tax_recovery_monthly + sub.utilities_recovery_monthly + sub.other_recovery_monthly;
        }

        srcLeaseMap[l.id] = {
          lease_name: l.lease_name,
          nickname: l.nickname,
          net_monthly: totalCost - subleaseIncome,
        };
      }

      const srcEntityMap: Record<string, { name: string; code: string }> = {};
      for (const e of (srcEntitiesRes.data ?? []) as Array<{ id: string; name: string; code: string }>) {
        srcEntityMap[e.id] = { name: e.name, code: e.code };
      }

      const allocated: AllocatedLeaseItem[] = incomingSplitsRaw.map((s) => {
        const lease = srcLeaseMap[s.lease_id];
        const srcEntity = srcEntityMap[s.source_entity_id];
        const leaseNet = lease?.net_monthly ?? 0;
        const allocatedAmt =
          s.split_type === "percentage"
            ? leaseNet * (s.split_percentage ?? 0)
            : (s.split_fixed_amount ?? 0);
        return {
          split_id: s.id,
          lease_id: s.lease_id,
          lease_name: lease?.lease_name ?? "Unknown",
          lease_nickname: lease?.nickname ?? null,
          source_entity_id: s.source_entity_id,
          source_entity_name: srcEntity?.name ?? "Unknown",
          source_entity_code: srcEntity?.code ?? "?",
          split_type: s.split_type,
          split_percentage: s.split_percentage,
          split_fixed_amount: s.split_fixed_amount,
          lease_total_monthly: leaseNet,
          allocated_monthly: allocatedAmt,
        };
      });
      setAllocatedLeases(allocated);
    } else {
      setAllocatedLeases([]);
    }

    setLoading(false);
  }, [supabase, entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filtered leases
  const filteredLeases = leases.filter((l) => {
    if (statusFilter && statusFilter !== "all") {
      // "Active" includes non-operational; other statuses match exactly.
      if (statusFilter === "active") {
        if (!isActiveLeaseStatus(l.status)) return false;
      } else if (l.status !== statusFilter) {
        return false;
      }
    }
    if (typeFilter && typeFilter !== "all" && l.lease_type !== typeFilter)
      return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = l.lease_name.toLowerCase();
    const nick = (l.nickname ?? "").toLowerCase();
    const lessor = (l.lessor_name ?? "").toLowerCase();
    const property = (l.properties?.property_name ?? "").toLowerCase();
    return name.includes(q) || nick.includes(q) || lessor.includes(q) || property.includes(q);
  });

  // Compute current rent (after escalations) for each lease
  const currentRentMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of leases) {
      map[l.id] = getCurrentRent(l.base_rent_monthly, escalationsByLease[l.id] ?? []);
    }
    return map;
  }, [leases, escalationsByLease]);

  function leaseCurrentRent(lease: LeaseListItem): number {
    return currentRentMap[lease.id] ?? lease.base_rent_monthly;
  }

  // Current sublease income using escalations
  function currentSubleaseIncome(s: SubleaseListItem): number {
    const escs = subleaseEscalationsMap[s.id] ?? [];
    const currentBase = escs.length > 0
      ? getCurrentRent(s.base_rent_monthly, escs)
      : s.base_rent_monthly;
    return (
      currentBase +
      s.cam_recovery_monthly +
      s.insurance_recovery_monthly +
      s.property_tax_recovery_monthly +
      s.utilities_recovery_monthly +
      s.other_recovery_monthly
    );
  }

  // Group subleases by lease_id
  const subleasesByLease = useMemo(() => {
    const map: Record<string, SubleaseListItem[]> = {};
    for (const s of subleases) {
      if (s.status !== "active") continue;
      if (!map[s.lease_id]) map[s.lease_id] = [];
      map[s.lease_id].push(s);
    }
    return map;
  }, [subleases]);

  // Group cost splits by lease_id
  const splitsByLease = useMemo(() => {
    const map: Record<string, CostSplitItem[]> = {};
    for (const s of costSplits) {
      if (!map[s.lease_id]) map[s.lease_id] = [];
      map[s.lease_id].push(s);
    }
    return map;
  }, [costSplits]);

  // Per-lease sublease income (current, after escalations)
  function leaseSubleaseIncome(leaseId: string): number {
    return (subleasesByLease[leaseId] ?? []).reduce(
      (s, sub) => s + currentSubleaseIncome(sub),
      0
    );
  }

  // Per-lease net cost (total monthly - sublease income)
  function leaseNetCost(lease: LeaseListItem): number {
    return totalMonthlyCost(lease, leaseCurrentRent(lease)) - leaseSubleaseIncome(lease.id);
  }

  // Per-lease allocated-out amount (sum of split amounts going to partner entities)
  function leaseAllocatedOut(lease: LeaseListItem): number {
    const splits = splitsByLease[lease.id];
    if (!splits || splits.length === 0) return 0;
    const net = leaseNetCost(lease);
    return splits.reduce((s, sp) => {
      if (sp.split_type === "percentage") {
        return s + net * (sp.split_percentage ?? 0);
      }
      return s + (sp.split_fixed_amount ?? 0);
    }, 0);
  }

  // Effective net cost to this entity (net cost - allocated out)
  function leaseEffectiveNetCost(lease: LeaseListItem): number {
    return leaseNetCost(lease) - leaseAllocatedOut(lease);
  }

  const activeLeases = leases.filter((l) => isActiveLeaseStatus(l.status));
  const totalMonthly = activeLeases.reduce((s, l) => s + totalMonthlyCost(l, leaseCurrentRent(l)), 0);
  const totalAnnual = totalMonthly * 12;
  const totalSF = activeLeases.reduce(
    (s, l) => s + (l.properties?.rentable_square_footage ?? 0),
    0
  );
  const avgCostPerSF = totalSF > 0 ? totalAnnual / totalSF : 0;

  // Sublease income totals (current, after escalations)
  const activeSubleases = subleases.filter((s) => s.status === "active");
  const totalSubleaseMonthlyIncome = activeSubleases.reduce(
    (s, sub) => s + currentSubleaseIncome(sub),
    0
  );
  const totalSubleaseAnnualIncome = totalSubleaseMonthlyIncome * 12;
  const netMonthly = totalMonthly - totalSubleaseMonthlyIncome;

  // Cost split totals
  const totalAllocatedOut = activeLeases.reduce((s, l) => s + leaseAllocatedOut(l), 0);
  const totalAllocatedIn = allocatedLeases.reduce((s, a) => s + a.allocated_monthly, 0);
  const effectiveNetMonthly = netMonthly - totalAllocatedOut + totalAllocatedIn;

  // ASC 842 portfolio summary (active leases with discount rate)
  const asc842Summary = useMemo(() => {
    let totalLiability = 0;
    let totalROU = 0;
    let leasesWithRate = 0;

    for (const l of activeLeases) {
      if (l.discount_rate > 0 && l.lease_term_months > 0) {
        const input = {
          lease_type: l.lease_type as "operating" | "finance",
          lease_term_months: l.lease_term_months,
          discount_rate: l.discount_rate,
          commencement_date: l.commencement_date,
          initial_direct_costs: l.initial_direct_costs,
          lease_incentives_received: l.lease_incentives_received,
          prepaid_rent: l.prepaid_rent,
          base_rent_monthly: l.base_rent_monthly,
        };
        totalLiability += calculateLeaseLiability(input);
        totalROU += calculateROUAsset(input);
        leasesWithRate++;
      }
    }
    return { totalLiability, totalROU, leasesWithRate };
  }, [activeLeases]);

  function handleExportExcel() {
    const wb = XLSX.utils.book_new();

    // --- Sheet 1: Lease Summary ---
    const summaryHeaders = [
      "Lease Name", "Nickname", "Status", "Type", "Lessor", "Property",
      "Commencement", "Expiration", "Term (mo)",
      "Rentable SF", "Lot SF", "Total SF",
      "Base Rent (mo)", "CAM (mo)", "Insurance (mo)", "Prop Tax (mo)",
      "Utilities (mo)", "Other (mo)", "Total Monthly", "Total Annual",
      "Rent/SF (annual)", "Security Deposit", "Discount Rate",
    ];
    const summaryRows: (string | number | null)[][] = [summaryHeaders];
    for (const l of filteredLeases) {
      const rentableSF = l.properties?.rentable_square_footage ?? 0;
      const lotSF = l.properties?.lot_square_footage ?? 0;
      const totalSF = rentableSF + lotSF;
      const monthly = totalMonthlyCost(l, leaseCurrentRent(l));
      const annual = monthly * 12;
      summaryRows.push([
        l.lease_name,
        l.nickname ?? "",
        STATUS_LABELS[l.status] ?? l.status,
        TYPE_LABELS[l.lease_type] ?? l.lease_type,
        l.lessor_name ?? "",
        l.properties?.property_name ?? "",
        l.commencement_date,
        l.expiration_date,
        l.lease_term_months,
        rentableSF || null,
        lotSF || null,
        totalSF || null,
        leaseCurrentRent(l),
        l.cam_monthly,
        l.insurance_monthly,
        l.property_tax_annual / 12,
        l.utilities_monthly,
        l.other_monthly_costs,
        Math.round(monthly * 100) / 100,
        Math.round(annual * 100) / 100,
        totalSF > 0 ? Math.round((annual / totalSF) * 100) / 100 : null,
        l.security_deposit,
        l.discount_rate,
      ]);
    }
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = summaryHeaders.map((h) => ({
      wch: Math.max(h.length + 2, 14),
    }));
    // Number format for currency columns (index 12–21)
    for (let r = 1; r < summaryRows.length; r++) {
      for (let c = 12; c <= 21; c++) {
        const cell = summarySheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
      }
    }
    XLSX.utils.book_append_sheet(wb, summarySheet, "Lease Summary");

    // --- Sheet 2: Payment Schedule ---
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const schedHeaders = [
      "Lease Name", "Year", "Month", "Base Rent", "CAM",
      "Insurance", "Property Tax", "Utilities", "Other", "Total",
    ];
    const schedRows: (string | number | null)[][] = [schedHeaders];

    for (const l of filteredLeases) {
      if (l.status === "expired" || l.status === "terminated") continue;
      const leaseForPmt: LeaseForPayments = {
        commencement_date: l.commencement_date,
        rent_commencement_date: l.rent_commencement_date,
        expiration_date: l.expiration_date,
        base_rent_monthly: l.base_rent_monthly,
        cam_monthly: l.cam_monthly,
        insurance_monthly: l.insurance_monthly,
        property_tax_annual: l.property_tax_annual,
        property_tax_frequency: (l.property_tax_frequency ?? "monthly") as LeaseForPayments["property_tax_frequency"],
        utilities_monthly: l.utilities_monthly,
        other_monthly_costs: l.other_monthly_costs,
        rent_abatement_months: l.rent_abatement_months ?? 0,
        rent_abatement_amount: l.rent_abatement_amount ?? 0,
      };
      const entries = generateLeasePaymentSchedule(leaseForPmt, escalationsByLease[l.id] ?? []);

      // Group by period
      const byPeriod = new Map<string, Record<string, number>>();
      for (const e of entries) {
        if (e.period_year < currentYear || (e.period_year === currentYear && e.period_month < currentMonth)) continue;
        const key = `${e.period_year}-${e.period_month}`;
        if (!byPeriod.has(key)) byPeriod.set(key, { year: e.period_year, month: e.period_month, base_rent: 0, cam: 0, insurance: 0, property_tax: 0, utilities: 0, other: 0 });
        const row = byPeriod.get(key)!;
        row[e.payment_type] = (row[e.payment_type] ?? 0) + e.scheduled_amount;
      }

      for (const row of byPeriod.values()) {
        const total = row.base_rent + row.cam + row.insurance + row.property_tax + row.utilities + row.other;
        schedRows.push([
          l.nickname || l.lease_name,
          row.year,
          MONTH_NAMES[row.month],
          Math.round(row.base_rent * 100) / 100,
          Math.round(row.cam * 100) / 100,
          Math.round(row.insurance * 100) / 100,
          Math.round(row.property_tax * 100) / 100,
          Math.round(row.utilities * 100) / 100,
          Math.round(row.other * 100) / 100,
          Math.round(total * 100) / 100,
        ]);
      }
    }

    const schedSheet = XLSX.utils.aoa_to_sheet(schedRows);
    schedSheet["!cols"] = schedHeaders.map((h) => ({
      wch: Math.max(h.length + 2, 14),
    }));
    for (let r = 1; r < schedRows.length; r++) {
      for (let c = 3; c <= 9; c++) {
        const cell = schedSheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
      }
    }
    XLSX.utils.book_append_sheet(wb, schedSheet, "Payment Schedule");

    // Download
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Real_Estate_Leases_${currentYear}-${String(currentMonth).padStart(2, "0")}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Lease expiration timeline (sorted by expiration date)
  const expirationTimeline = [...activeLeases].sort(
    (a, b) =>
      new Date(a.expiration_date).getTime() -
      new Date(b.expiration_date).getTime()
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Real Estate
          </h1>
          <p className="text-muted-foreground">
            Manage leases, operating costs, and property portfolio
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportExcel} disabled={filteredLeases.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export Excel
          </Button>
          <Link href={`/${entityId}/real-estate/from-pdf`}>
            <Button variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              From PDF
            </Button>
          </Link>
          <Link href={`/${entityId}/real-estate/new`}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Lease
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Active Leases</p>
            <p className="text-2xl font-semibold tabular-nums">
              {activeLeases.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Monthly Cost</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(totalMonthly)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Sublease Income</p>
            <p className="text-2xl font-semibold tabular-nums text-green-600">
              {totalSubleaseMonthlyIncome > 0
                ? formatCurrency(totalSubleaseMonthlyIncome)
                : "---"}
            </p>
            {activeSubleases.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {activeSubleases.length} active sublease{activeSubleases.length !== 1 ? "s" : ""}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className={(totalSubleaseMonthlyIncome > 0 || totalAllocatedOut > 0 || totalAllocatedIn > 0) ? "border-green-200" : ""}>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Effective Net Monthly</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(effectiveNetMonthly)}
            </p>
            {(totalSubleaseMonthlyIncome > 0 || totalAllocatedOut > 0 || totalAllocatedIn > 0) && (
              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                {totalSubleaseMonthlyIncome > 0 && (
                  <p className="text-green-600">
                    Subleases: -{formatCurrency(totalSubleaseMonthlyIncome)}
                  </p>
                )}
                {totalAllocatedOut > 0 && (
                  <p className="text-green-600">
                    Split out: -{formatCurrency(totalAllocatedOut)}
                  </p>
                )}
                {totalAllocatedIn > 0 && (
                  <p className="text-amber-600">
                    Allocated in: +{formatCurrency(totalAllocatedIn)}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Annual Cost</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(totalAnnual)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Avg Cost / SF</p>
            <p className="text-2xl font-semibold tabular-nums">
              {totalSF > 0 ? formatCurrency(avgCostPerSF) : "N/A"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total ROU Assets</p>
            <p className="text-2xl font-semibold tabular-nums">
              {asc842Summary.leasesWithRate > 0
                ? formatCurrency(asc842Summary.totalROU)
                : "N/A"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Lease Liability</p>
            <p className="text-2xl font-semibold tabular-nums">
              {asc842Summary.leasesWithRate > 0
                ? formatCurrency(asc842Summary.totalLiability)
                : "N/A"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="leases" className="space-y-4">
        <TabsList>
          <TabsTrigger value="leases">Leases</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="dates">
            Critical Dates
            {criticalDates.length > 0 && (
              <Badge variant="secondary" className="ml-2 h-5">
                {criticalDates.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* === Leases Tab === */}
        <TabsContent value="leases">
          {/* Filters */}
          <div className="flex items-center gap-4 flex-wrap mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by lease, lessor, or property..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="active_non_operational">Active (Non-Operational)</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="operating">Operating</SelectItem>
                <SelectItem value="finance">Finance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="pt-6">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : filteredLeases.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Building className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Leases Found</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    {searchQuery ||
                    statusFilter !== "active" ||
                    typeFilter !== "all"
                      ? "No leases match your current filters."
                      : "Add your first lease to start tracking real estate."}
                  </p>
                  {!searchQuery &&
                    statusFilter === "active" &&
                    typeFilter === "all" && (
                      <Link href={`/${entityId}/real-estate/new`}>
                        <Button>
                          <Plus className="mr-2 h-4 w-4" />
                          New Lease
                        </Button>
                      </Link>
                    )}
                </div>
              ) : (
                <>
                <div className="overflow-x-auto">
                  <TooltipProvider>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lease Name</TableHead>
                        <TableHead className="text-right">Monthly Rent</TableHead>
                        <TableHead className="text-right">Total Monthly</TableHead>
                        <TableHead className="text-right">Sublease Income</TableHead>
                        <TableHead className="text-right">Net Cost</TableHead>
                        <TableHead className="text-right">Cost Split</TableHead>
                        <TableHead className="text-muted-foreground">Property</TableHead>
                        <TableHead className="text-muted-foreground">Expiration</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLeases.map((lease) => {
                        const curRent = leaseCurrentRent(lease);
                        const total = totalMonthlyCost(lease, curRent);
                        const subIncome = leaseSubleaseIncome(lease.id);
                        const net = leaseNetCost(lease);
                        const splits = splitsByLease[lease.id] ?? [];
                        const allocOut = leaseAllocatedOut(lease);
                        const effectiveNet = leaseEffectiveNetCost(lease);

                        return (
                          <TableRow key={lease.id}>
                            <TableCell className="font-medium">
                              {lease.nickname || lease.lease_name}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(curRent)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatCurrency(total)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {subIncome > 0 ? (
                                <span className="text-green-600">
                                  {formatCurrency(subIncome)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">---</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatCurrency(net)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {splits.length > 0 ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="cursor-help text-right">
                                      <div className="text-xs text-muted-foreground">
                                        {splits.map((sp) => (
                                          <span key={sp.id} className="block">
                                            {sp.dest_entity_code}{" "}
                                            {sp.split_type === "percentage"
                                              ? `${((sp.split_percentage ?? 0) * 100).toFixed(0)}%`
                                              : formatCurrency(sp.split_fixed_amount ?? 0)}
                                          </span>
                                        ))}
                                      </div>
                                      <div className="font-medium text-sm">
                                        Net: {formatCurrency(effectiveNet)}
                                      </div>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="left" className="max-w-xs">
                                    <div className="space-y-1 text-xs">
                                      <p className="font-semibold">Cost Splits</p>
                                      {splits.map((sp) => (
                                        <p key={sp.id}>
                                          {sp.dest_entity_name}:{" "}
                                          {sp.split_type === "percentage"
                                            ? `${((sp.split_percentage ?? 0) * 100).toFixed(1)}% = ${formatCurrency(
                                                net * (sp.split_percentage ?? 0)
                                              )}`
                                            : `${formatCurrency(sp.split_fixed_amount ?? 0)}/mo`}
                                          {sp.description ? ` — ${sp.description}` : ""}
                                        </p>
                                      ))}
                                      <p className="pt-1 border-t font-medium">
                                        Total allocated out: {formatCurrency(allocOut)}
                                      </p>
                                      <p className="font-semibold">
                                        Effective net to us: {formatCurrency(effectiveNet)}
                                      </p>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-muted-foreground">---</span>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {lease.properties?.property_name ?? "---"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {new Date(
                                lease.expiration_date + "T00:00:00"
                              ).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={STATUS_VARIANTS[lease.status] ?? "outline"}
                              >
                                {STATUS_LABELS[lease.status] ?? lease.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Link href={`/${entityId}/real-estate/${lease.id}`}>
                                <Button variant="ghost" size="sm">
                                  <ArrowRight className="h-4 w-4" />
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="font-semibold border-t-2">
                        <TableCell>
                          Totals ({filteredLeases.length} lease{filteredLeases.length !== 1 ? "s" : ""})
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(
                            filteredLeases.reduce((s, l) => s + leaseCurrentRent(l), 0)
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(
                            filteredLeases.reduce((s, l) => s + totalMonthlyCost(l, leaseCurrentRent(l)), 0)
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(() => {
                            const totalSub = filteredLeases.reduce((s, l) => s + leaseSubleaseIncome(l.id), 0);
                            return totalSub > 0 ? (
                              <span className="text-green-600">{formatCurrency(totalSub)}</span>
                            ) : (
                              <span className="text-muted-foreground">---</span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(
                            filteredLeases.reduce((s, l) => s + leaseNetCost(l), 0)
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(() => {
                            const totalOut = filteredLeases.reduce((s, l) => s + leaseAllocatedOut(l), 0);
                            return totalOut > 0 ? (
                              <div className="text-xs">
                                <span className="text-muted-foreground block">
                                  Out: {formatCurrency(totalOut)}
                                </span>
                                <span className="font-medium text-sm">
                                  Net: {formatCurrency(
                                    filteredLeases.reduce((s, l) => s + leaseEffectiveNetCost(l), 0)
                                  )}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">---</span>
                            );
                          })()}
                        </TableCell>
                        <TableCell colSpan={4} />
                      </TableRow>
                    </TableBody>
                  </Table>
                  </TooltipProvider>
                </div>

                {/* Allocated from Other Entities */}
                {allocatedLeases.length > 0 && (
                  <div className="mt-6 pt-6 border-t">
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                      Allocated from Other Entities
                    </h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Lease</TableHead>
                          <TableHead>From Entity</TableHead>
                          <TableHead className="text-right">Split</TableHead>
                          <TableHead className="text-right">Allocated Monthly</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allocatedLeases.map((al) => (
                          <TableRow key={al.split_id}>
                            <TableCell className="font-medium">
                              {al.lease_nickname || al.lease_name}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {al.source_entity_name}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {al.split_type === "percentage"
                                ? `${((al.split_percentage ?? 0) * 100).toFixed(1)}%`
                                : formatCurrency(al.split_fixed_amount ?? 0)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium text-amber-600">
                              {formatCurrency(al.allocated_monthly)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="font-semibold border-t-2">
                          <TableCell colSpan={3}>
                            Total Allocated In ({allocatedLeases.length} split{allocatedLeases.length !== 1 ? "s" : ""})
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-amber-600">
                            {formatCurrency(allocatedLeases.reduce((s, a) => s + a.allocated_monthly, 0))}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Payment Schedule Grids */}
          {allLeasePayments.length > 0 && (
            <PaymentScheduleGrids
              leasePayments={allLeasePayments}
              subleasePayments={allSubleasePayments}
            />
          )}
        </TabsContent>

        {/* === Analytics Tab === */}
        <TabsContent value="analytics">
          <div className="space-y-6">
            {/* Lease Expiration Timeline */}
            <Card>
              <CardHeader>
                <CardTitle>Lease Expiration Timeline</CardTitle>
                <CardDescription>
                  Active leases sorted by expiration date
                </CardDescription>
              </CardHeader>
              <CardContent>
                {expirationTimeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No active leases.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lease</TableHead>
                        <TableHead>Property</TableHead>
                        <TableHead>Expiration</TableHead>
                        <TableHead>Remaining</TableHead>
                        <TableHead className="text-right">
                          Monthly Cost
                        </TableHead>
                        <TableHead className="text-right">
                          Remaining Cost
                        </TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expirationTimeline.map((lease) => {
                        const days = daysUntil(lease.expiration_date);
                        const monthsRemaining = Math.max(
                          0,
                          Math.ceil(days / 30.44)
                        );
                        const remainingCost =
                          totalMonthlyCost(lease, leaseCurrentRent(lease)) * monthsRemaining;
                        return (
                          <TableRow key={lease.id}>
                            <TableCell className="font-medium">
                              {lease.nickname || lease.lease_name}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {lease.properties?.property_name ?? "---"}
                            </TableCell>
                            <TableCell className={urgencyColor(days)}>
                              {new Date(
                                lease.expiration_date + "T00:00:00"
                              ).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              {days < 0 ? (
                                <Badge variant="destructive">Expired</Badge>
                              ) : days <= 180 ? (
                                <Badge
                                  variant="secondary"
                                  className="bg-yellow-100 text-yellow-800"
                                >
                                  {monthsRemaining} mo
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">
                                  {monthsRemaining} mo
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(totalMonthlyCost(lease, leaseCurrentRent(lease)))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(remainingCost)}
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/${entityId}/real-estate/${lease.id}`}
                              >
                                <Button variant="ghost" size="sm">
                                  <ArrowRight className="h-4 w-4" />
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Lifetime Cost Analysis */}
            <Card>
              <CardHeader>
                <CardTitle>Lifetime Cost Analysis</CardTitle>
                <CardDescription>
                  Total estimated cost over the full lease term for each active
                  lease
                </CardDescription>
              </CardHeader>
              <CardContent>
                {activeLeases.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No active leases.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lease</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Term</TableHead>
                        <TableHead className="text-right">
                          Monthly Cost
                        </TableHead>
                        <TableHead className="text-right">
                          Lifetime Cost
                        </TableHead>
                        <TableHead className="text-right">
                          Lease Liability
                        </TableHead>
                        <TableHead className="text-right">
                          ROU Asset
                        </TableHead>
                        <TableHead className="text-right">
                          Discount Rate
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeLeases.map((lease) => {
                        const liability =
                          lease.discount_rate > 0
                            ? calculateLeaseLiability({
                                lease_type: lease.lease_type as "operating" | "finance",
                                lease_term_months: lease.lease_term_months,
                                discount_rate: lease.discount_rate,
                                commencement_date: lease.commencement_date,
                                initial_direct_costs:
                                  lease.initial_direct_costs,
                                lease_incentives_received:
                                  lease.lease_incentives_received,
                                prepaid_rent: lease.prepaid_rent,
                                base_rent_monthly: lease.base_rent_monthly,
                              })
                            : 0;
                        const rou =
                          lease.discount_rate > 0
                            ? calculateROUAsset({
                                lease_type: lease.lease_type as "operating" | "finance",
                                lease_term_months: lease.lease_term_months,
                                discount_rate: lease.discount_rate,
                                commencement_date: lease.commencement_date,
                                initial_direct_costs:
                                  lease.initial_direct_costs,
                                lease_incentives_received:
                                  lease.lease_incentives_received,
                                prepaid_rent: lease.prepaid_rent,
                                base_rent_monthly: lease.base_rent_monthly,
                              })
                            : 0;
                        return (
                          <TableRow key={lease.id}>
                            <TableCell className="font-medium">
                              {lease.nickname || lease.lease_name}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {TYPE_LABELS[lease.lease_type]}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {lease.lease_term_months} mo
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(totalMonthlyCost(lease, leaseCurrentRent(lease)))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatCurrency(totalLifetimeCost(lease))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {liability > 0
                                ? formatCurrency(liability)
                                : "---"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {rou > 0 ? formatCurrency(rou) : "---"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {lease.discount_rate > 0
                                ? formatPercentage(lease.discount_rate)
                                : "---"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="font-semibold border-t-2">
                        <TableCell colSpan={3}>Portfolio Totals</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(totalMonthly)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(
                            activeLeases.reduce(
                              (s, l) => s + totalLifetimeCost(l),
                              0
                            )
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {asc842Summary.totalLiability > 0
                            ? formatCurrency(asc842Summary.totalLiability)
                            : "---"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {asc842Summary.totalROU > 0
                            ? formatCurrency(asc842Summary.totalROU)
                            : "---"}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Cost Breakdown by Type */}
            <Card>
              <CardHeader>
                <CardTitle>Occupancy Cost Breakdown</CardTitle>
                <CardDescription>
                  Monthly cost by category across all active leases
                </CardDescription>
              </CardHeader>
              <CardContent>
                {activeLeases.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No active leases.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Monthly</TableHead>
                        <TableHead className="text-right">Annual</TableHead>
                        <TableHead className="text-right">% of Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const totals = {
                          "Base Rent": activeLeases.reduce(
                            (s, l) => s + leaseCurrentRent(l),
                            0
                          ),
                          CAM: activeLeases.reduce(
                            (s, l) => s + l.cam_monthly,
                            0
                          ),
                          Insurance: activeLeases.reduce(
                            (s, l) => s + l.insurance_monthly,
                            0
                          ),
                          "Property Tax": activeLeases.reduce(
                            (s, l) => s + l.property_tax_annual / 12,
                            0
                          ),
                          Utilities: activeLeases.reduce(
                            (s, l) => s + l.utilities_monthly,
                            0
                          ),
                          Other: activeLeases.reduce(
                            (s, l) => s + l.other_monthly_costs,
                            0
                          ),
                        };
                        return Object.entries(totals)
                          .filter(([, v]) => v > 0)
                          .map(([label, monthly]) => (
                            <TableRow key={label}>
                              <TableCell className="font-medium">
                                {label}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(monthly)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(monthly * 12)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {totalMonthly > 0
                                  ? `${((monthly / totalMonthly) * 100).toFixed(1)}%`
                                  : "---"}
                              </TableCell>
                            </TableRow>
                          ));
                      })()}
                      <TableRow className="font-semibold border-t-2">
                        <TableCell>Gross Occupancy Cost</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(totalMonthly)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(totalAnnual)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          100.0%
                        </TableCell>
                      </TableRow>
                      {totalSubleaseMonthlyIncome > 0 && (
                        <>
                          <TableRow className="text-green-600">
                            <TableCell className="font-medium">Less: Sublease Income</TableCell>
                            <TableCell className="text-right tabular-nums">
                              ({formatCurrency(totalSubleaseMonthlyIncome)})
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              ({formatCurrency(totalSubleaseAnnualIncome)})
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {totalMonthly > 0
                                ? `-${((totalSubleaseMonthlyIncome / totalMonthly) * 100).toFixed(1)}%`
                                : "---"}
                            </TableCell>
                          </TableRow>
                          <TableRow className="font-semibold border-t-2">
                            <TableCell>Net Occupancy Cost</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(netMonthly)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(netMonthly * 12)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {totalMonthly > 0
                                ? `${((netMonthly / totalMonthly) * 100).toFixed(1)}%`
                                : "---"}
                            </TableCell>
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* === Critical Dates Tab === */}
        <TabsContent value="dates">
          <Card>
            <CardHeader>
              <CardTitle>All Open Critical Dates</CardTitle>
              <CardDescription>
                Unresolved dates across all leases, sorted by urgency
              </CardDescription>
            </CardHeader>
            <CardContent>
              {criticalDates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No open critical dates.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Urgency</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Lease</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {criticalDates.map((cd) => {
                      const days = daysUntil(cd.critical_date);
                      return (
                        <TableRow key={cd.id}>
                          <TableCell>{urgencyBadge(days)}</TableCell>
                          <TableCell className={urgencyColor(days)}>
                            {new Date(
                              cd.critical_date + "T00:00:00"
                            ).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            {DATE_TYPE_LABELS[cd.date_type]}
                          </TableCell>
                          <TableCell className="font-medium">
                            {cd.leases?.nickname || (cd.leases?.lease_name ?? "---")}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {cd.description ?? "---"}
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/${entityId}/real-estate/${cd.lease_id}`}
                            >
                              <Button variant="ghost" size="sm">
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

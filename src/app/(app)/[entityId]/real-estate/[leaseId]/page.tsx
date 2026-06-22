"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardAction,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  ArrowLeft,
  Save,
  Plus,
  RefreshCw,
  Upload,
  Calendar,
  Check,
  ChevronsUpDown,
  Download,
  FileText,
  Users,
  Pencil,
  X,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  formatCurrency,
  formatPercentage,
  getCurrentPeriod,
  getPeriodLabel,
} from "@/lib/utils/dates";
import { generateLeasePaymentSchedule, getCurrentRent } from "@/lib/utils/lease-payments";
import { generateSubleasePaymentSchedule } from "@/lib/utils/sublease-payments";
import {
  generateASC842Schedule,
  generateInitialJournalEntries,
  generateMonthlyJournalEntry,
} from "@/lib/utils/lease-calculations";
import type {
  ASC842ScheduleEntry,
  ASC842Summary,
  ASC842JournalEntry,
  LeaseClassification,
  LeaseAccountMapping,
} from "@/lib/utils/lease-calculations";
import type {
  LeaseStatus,
  LeaseType,
  MaintenanceType,
  PropertyTaxFrequency,
  PaymentType,
  EscalationType,
  EscalationFrequency,
  OptionType,
  CriticalDateType,
  LeaseDocumentType,
  SubleaseStatus,
  SubleasePaymentType,
  SplitType,
} from "@/lib/types/database";

// --- Interfaces ---

interface LeaseData {
  id: string;
  entity_id: string;
  property_id: string;
  lease_name: string;
  nickname: string | null;
  lessor_name: string | null;
  lessor_contact_info: string | null;
  lease_type: LeaseType;
  status: LeaseStatus;
  commencement_date: string;
  rent_commencement_date: string | null;
  expiration_date: string;
  lease_term_months: number;
  base_rent_monthly: number;
  base_rent_annual: number;
  rent_per_sf: number | null;
  security_deposit: number;
  tenant_improvement_allowance: number;
  rent_abatement_months: number;
  rent_abatement_amount: number;
  discount_rate: number;
  initial_direct_costs: number;
  lease_incentives_received: number;
  prepaid_rent: number;
  fair_value_of_asset: number | null;
  remaining_economic_life_months: number | null;
  cam_monthly: number;
  insurance_monthly: number;
  property_tax_annual: number;
  property_tax_frequency: PropertyTaxFrequency;
  utilities_monthly: number;
  other_monthly_costs: number;
  other_monthly_costs_description: string | null;
  maintenance_type: MaintenanceType;
  permitted_use: string | null;
  notes: string | null;
  rou_asset_account_id: string | null;
  lease_liability_account_id: string | null;
  lease_expense_account_id: string | null;
  interest_expense_account_id: string | null;
  cam_expense_account_id: string | null;
  asc842_adjustment_account_id: string | null;
  cash_ap_account_id: string | null;
  properties: {
    property_name: string;
    address_line1: string | null;
    city: string | null;
    state: string | null;
    rentable_square_footage: number | null;
    lot_square_footage: number | null;
  } | null;
}

interface PaymentRow {
  id: string;
  period_year: number;
  period_month: number;
  payment_type: PaymentType;
  scheduled_amount: number;
  actual_amount: number | null;
  is_paid: boolean;
  payment_date: string | null;
}

interface SubleasePaymentRow {
  id: string;
  sublease_id: string;
  period_year: number;
  period_month: number;
  payment_type: SubleasePaymentType;
  scheduled_amount: number;
  actual_amount: number | null;
  is_received: boolean;
  received_date: string | null;
}

interface SubleaseEscalationRow {
  id: string;
  escalation_type: EscalationType;
  effective_date: string;
  percentage_increase: number | null;
  amount_increase: number | null;
  frequency: EscalationFrequency;
}

interface EscalationRow {
  id: string;
  escalation_type: EscalationType;
  effective_date: string;
  percentage_increase: number | null;
  amount_increase: number | null;
  cpi_index_name: string | null;
  cpi_cap: number | null;
  cpi_floor: number | null;
  frequency: EscalationFrequency;
  notes: string | null;
}

interface OptionRow {
  id: string;
  option_type: OptionType;
  exercise_deadline: string | null;
  notice_required_days: number | null;
  option_term_months: number | null;
  option_rent_terms: string | null;
  option_price: number | null;
  penalty_amount: number | null;
  is_reasonably_certain: boolean;
  is_exercised: boolean;
  exercised_date: string | null;
  notes: string | null;
}

interface CriticalDateRow {
  id: string;
  date_type: CriticalDateType;
  critical_date: string;
  alert_days_before: number;
  description: string | null;
  is_resolved: boolean;
  resolved_date: string | null;
  notes: string | null;
}

interface DocumentRow {
  id: string;
  document_type: LeaseDocumentType;
  file_name: string;
  file_path: string;
  file_size_bytes: number | null;
  created_at: string;
}

interface AmendmentRow {
  id: string;
  amendment_number: number;
  effective_date: string;
  description: string | null;
  changed_fields: Record<string, unknown> | null;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
}

interface SubleaseListItem {
  id: string;
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
  floor_suite: string | null;
}

interface CostSplitRow {
  id: string;
  lease_id: string;
  source_entity_id: string;
  destination_entity_id: string;
  split_type: SplitType;
  split_percentage: number | null;
  split_fixed_amount: number | null;
  description: string | null;
  is_active: boolean;
}

interface SiblingEntity {
  id: string;
  name: string;
  code: string;
}

interface Account {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
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

const MAINTENANCE_LABELS: Record<MaintenanceType, string> = {
  triple_net: "Triple Net (NNN)",
  gross: "Gross",
  modified_gross: "Modified Gross",
};

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  base_rent: "Base Rent",
  cam: "CAM",
  property_tax: "Property Tax",
  insurance: "Insurance",
  utilities: "Utilities",
  other: "Other",
};

const SUBLEASE_PAYMENT_TYPE_LABELS: Record<SubleasePaymentType, string> = {
  base_rent: "Base Rent",
  cam_recovery: "CAM Recovery",
  property_tax_recovery: "Property Tax Recovery",
  insurance_recovery: "Insurance Recovery",
  utilities_recovery: "Utilities Recovery",
  other_recovery: "Other Recovery",
};

const OPTION_TYPE_LABELS: Record<OptionType, string> = {
  renewal: "Renewal",
  termination: "Termination",
  purchase: "Purchase",
  expansion: "Expansion",
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

const DOC_TYPE_LABELS: Record<LeaseDocumentType, string> = {
  original_lease: "Original Lease",
  amendment: "Amendment",
  addendum: "Addendum",
  correspondence: "Correspondence",
  insurance_cert: "Insurance Certificate",
  other: "Other",
};

const SUBLEASE_STATUS_LABELS: Record<SubleaseStatus, string> = {
  draft: "Draft",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
};

const SUBLEASE_STATUS_VARIANTS: Record<
  SubleaseStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  active: "default",
  expired: "secondary",
  terminated: "destructive",
};

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

// --- Component ---

export default function LeaseDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const leaseId = params.leaseId as string;
  const router = useRouter();
  const supabase = createClient();

  const current = getCurrentPeriod();

  // Core data
  const [lease, setLease] = useState<LeaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Tab data
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [escalations, setEscalations] = useState<EscalationRow[]>([]);
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [criticalDates, setCriticalDates] = useState<CriticalDateRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [amendments, setAmendments] = useState<AmendmentRow[]>([]);
  const [subleases, setSubleases] = useState<SubleaseListItem[]>([]);

  // Payment period selector
  const [periodYear, setPeriodYear] = useState(current.year);
  const [periodMonth, setPeriodMonth] = useState(current.month);
  // Full payment schedule for grid view
  const [allPayments, setAllPayments] = useState<PaymentRow[]>([]);
  // Sublease income schedule for grid view
  const [allSubleasePayments, setAllSubleasePayments] = useState<SubleasePaymentRow[]>([]);
  // Sublease escalations keyed by sublease_id — for computing current income
  const [subleaseEscalationsMap, setSubleaseEscalationsMap] = useState<Record<string, SubleaseEscalationRow[]>>({});

  // GL account editing
  const [rouAssetAccountId, setRouAssetAccountId] = useState("");
  const [leaseLiabilityAccountId, setLeaseLiabilityAccountId] = useState("");
  const [leaseExpenseAccountId, setLeaseExpenseAccountId] = useState("");
  const [interestExpenseAccountId, setInterestExpenseAccountId] = useState("");
  const [camExpenseAccountId, setCamExpenseAccountId] = useState("");
  const [asc842AdjustmentAccountId, setAsc842AdjustmentAccountId] = useState("");
  const [cashApAccountId, setCashApAccountId] = useState("");

  // GL account combobox open states
  const [glPopoverOpen, setGlPopoverOpen] = useState<Record<string, boolean>>({});

  // Sheet states
  const [escalationSheetOpen, setEscalationSheetOpen] = useState(false);
  const [optionSheetOpen, setOptionSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);

  // Escalation form (shared for add/edit)
  const [editingEscId, setEditingEscId] = useState<string | null>(null);
  const [newEscType, setNewEscType] = useState<EscalationType>("fixed_percentage");
  const [newEscDate, setNewEscDate] = useState("");
  const [newEscPercent, setNewEscPercent] = useState("");
  const [newEscAmount, setNewEscAmount] = useState("");
  const [newEscNewRent, setNewEscNewRent] = useState("");
  const [newEscFrequency, setNewEscFrequency] = useState<EscalationFrequency>("annual");

  // New option form
  const [newOptType, setNewOptType] = useState<OptionType>("renewal");
  const [newOptDeadline, setNewOptDeadline] = useState("");
  const [newOptNoticeDays, setNewOptNoticeDays] = useState("");
  const [newOptTermMonths, setNewOptTermMonths] = useState("");
  const [newOptRentTerms, setNewOptRentTerms] = useState("");
  const [newOptPrice, setNewOptPrice] = useState("");
  const [newOptPenalty, setNewOptPenalty] = useState("");
  const [newOptReasonablyCertain, setNewOptReasonablyCertain] = useState(false);

  // New critical date form
  const [newDateType, setNewDateType] = useState<CriticalDateType>("lease_expiration");
  const [newDateDate, setNewDateDate] = useState("");
  const [newDateAlertDays, setNewDateAlertDays] = useState("90");
  const [newDateDescription, setNewDateDescription] = useState("");

  // ASC 842 tab state
  const [asc842ShowJournalEntries, setAsc842ShowJournalEntries] = useState(false);
  const [discountRateInput, setDiscountRateInput] = useState("");
  const [savingDiscountRate, setSavingDiscountRate] = useState(false);

  // Document upload & AI extraction state
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [extracting, setExtracting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [extractedData, setExtractedData] = useState<Record<string, any> | null>(null);

  // Editable summary fields
  const [editingDetails, setEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [editNickname, setEditNickname] = useState("");
  const [editLessorName, setEditLessorName] = useState("");
  const [editMaintenanceType, setEditMaintenanceType] = useState<MaintenanceType>("triple_net");
  const [editRentableSf, setEditRentableSf] = useState("");
  const [editLotSf, setEditLotSf] = useState("");
  const [editRentPerSf, setEditRentPerSf] = useState("");
  const [editSecurityDeposit, setEditSecurityDeposit] = useState("");
  const [editTiAllowance, setEditTiAllowance] = useState("");
  const [editNotes, setEditNotes] = useState("");
  // Lease financial term fields
  const [editBaseRent, setEditBaseRent] = useState("");
  const [editCamMonthly, setEditCamMonthly] = useState("");
  const [editInsuranceMonthly, setEditInsuranceMonthly] = useState("");
  const [editPropertyTaxAnnual, setEditPropertyTaxAnnual] = useState("");
  const [editPropertyTaxFrequency, setEditPropertyTaxFrequency] = useState<PropertyTaxFrequency>("monthly");
  const [editUtilitiesMonthly, setEditUtilitiesMonthly] = useState("");
  const [editOtherMonthlyCosts, setEditOtherMonthlyCosts] = useState("");
  const [editOtherDescription, setEditOtherDescription] = useState("");
  const [editAbatementMonths, setEditAbatementMonths] = useState("");
  const [editAbatementAmount, setEditAbatementAmount] = useState("");
  // Lease date fields
  const [editCommencementDate, setEditCommencementDate] = useState("");
  const [editRentCommencementDate, setEditRentCommencementDate] = useState("");
  const [editExpirationDate, setEditExpirationDate] = useState("");
  const [editLeaseTermMonths, setEditLeaseTermMonths] = useState("");
  const [editStatus, setEditStatus] = useState<LeaseStatus>("active");
  const [editLeaseType, setEditLeaseType] = useState<LeaseType>("operating");
  const [deleting, setDeleting] = useState(false);

  // Cost split state
  const [costSplits, setCostSplits] = useState<CostSplitRow[]>([]);
  const [siblingEntities, setSiblingEntities] = useState<SiblingEntity[]>([]);
  const [splitSheetOpen, setSplitSheetOpen] = useState(false);
  const [editingSplitId, setEditingSplitId] = useState<string | null>(null);
  const [splitDestEntity, setSplitDestEntity] = useState("");
  const [splitType, setSplitType] = useState<SplitType>("percentage");
  const [splitPercentage, setSplitPercentage] = useState("");
  const [splitFixedAmount, setSplitFixedAmount] = useState("");
  const [splitDescription, setSplitDescription] = useState("");
  const [savingSplit, setSavingSplit] = useState(false);

  const years = Array.from({ length: 10 }, (_, i) => current.year - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const loadData = useCallback(async () => {
    // Fetch each query separately to avoid TS "excessively deep" type error with Promise.all + Supabase
    const leaseResult = await supabase
      .from("leases")
      .select(
        `id, entity_id, property_id, lease_name, nickname, lessor_name, lessor_contact_info,
        lease_type, status, commencement_date, rent_commencement_date, expiration_date,
        lease_term_months, base_rent_monthly, base_rent_annual, rent_per_sf,
        security_deposit, tenant_improvement_allowance, rent_abatement_months,
        rent_abatement_amount, discount_rate, initial_direct_costs, lease_incentives_received,
        prepaid_rent, fair_value_of_asset, remaining_economic_life_months,
        cam_monthly, insurance_monthly, property_tax_annual, property_tax_frequency,
        utilities_monthly, other_monthly_costs, other_monthly_costs_description,
        maintenance_type, permitted_use, notes,
        rou_asset_account_id, lease_liability_account_id, lease_expense_account_id,
        interest_expense_account_id, cam_expense_account_id,
        asc842_adjustment_account_id, cash_ap_account_id,
        properties(property_name, address_line1, city, state, rentable_square_footage, lot_square_footage)`
      )
      .eq("id", leaseId)
      .single();

    const paymentsResult = await supabase
      .from("lease_payments")
      .select("*")
      .eq("lease_id", leaseId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .order("payment_type");

    const allPaymentsResult = await supabase
      .from("lease_payments")
      .select("*")
      .eq("lease_id", leaseId)
      .order("period_year")
      .order("period_month")
      .order("payment_type");

    const escalationsResult = await supabase
      .from("lease_escalations")
      .select("*")
      .eq("lease_id", leaseId)
      .order("effective_date");

    const optionsResult = await supabase
      .from("lease_options")
      .select("*")
      .eq("lease_id", leaseId)
      .order("exercise_deadline");

    const criticalDatesResult = await supabase
      .from("lease_critical_dates")
      .select("*")
      .eq("lease_id", leaseId)
      .order("critical_date");

    const documentsResult = await supabase
      .from("lease_documents")
      .select("*")
      .eq("lease_id", leaseId)
      .order("created_at", { ascending: false });

    const amendmentsResult = await supabase
      .from("lease_amendments")
      .select("*")
      .eq("lease_id", leaseId)
      .order("amendment_number");

    const accountsResult = await supabase
      .from("accounts")
      .select("id, name, account_number, classification")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number")
      .order("name");

    const subleasesResult = await supabase
      .from("subleases")
      .select(
        `id, sublease_name, subtenant_name, status,
        commencement_date, expiration_date, sublease_term_months,
        base_rent_monthly, cam_recovery_monthly, insurance_recovery_monthly,
        property_tax_recovery_monthly, utilities_recovery_monthly, other_recovery_monthly,
        subleased_square_footage, floor_suite`
      )
      .eq("lease_id", leaseId)
      .order("sublease_name");

    // Fetch sublease payments for all subleases of this lease
    const subleaseIds = ((subleasesResult.data as unknown as SubleaseListItem[]) ?? []).map((s) => s.id);
    let subleasePaymentsData: SubleasePaymentRow[] = [];
    if (subleaseIds.length > 0) {
      const spResult = await supabase
        .from("sublease_payments")
        .select("*")
        .in("sublease_id", subleaseIds)
        .order("period_year")
        .order("period_month")
        .order("payment_type");
      subleasePaymentsData = (spResult.data as unknown as SubleasePaymentRow[]) ?? [];
    }

    // Fetch sublease escalations for all subleases (needed for current income calc)
    const subleaseEscsMap: Record<string, SubleaseEscalationRow[]> = {};
    if (subleaseIds.length > 0) {
      const seResult = await supabase
        .from("sublease_escalations")
        .select("id, sublease_id, escalation_type, effective_date, percentage_increase, amount_increase, frequency")
        .in("sublease_id", subleaseIds)
        .order("effective_date");
      const allSubEscs = (seResult.data as unknown as (SubleaseEscalationRow & { sublease_id: string })[]) ?? [];
      for (const e of allSubEscs) {
        if (!subleaseEscsMap[e.sublease_id]) subleaseEscsMap[e.sublease_id] = [];
        subleaseEscsMap[e.sublease_id].push(e);
      }
    }

    if (leaseResult.data) {
      const l = leaseResult.data as unknown as LeaseData;
      setLease(l);
      setRouAssetAccountId(l.rou_asset_account_id ?? "");
      setLeaseLiabilityAccountId(l.lease_liability_account_id ?? "");
      setLeaseExpenseAccountId(l.lease_expense_account_id ?? "");
      setInterestExpenseAccountId(l.interest_expense_account_id ?? "");
      setCamExpenseAccountId(l.cam_expense_account_id ?? "");
      setAsc842AdjustmentAccountId(l.asc842_adjustment_account_id ?? "");
      setCashApAccountId(l.cash_ap_account_id ?? "");
      setDiscountRateInput(l.discount_rate > 0 ? String(l.discount_rate * 100) : "");
      // Init editable summary fields
      setEditNickname(l.nickname ?? "");
      setEditLessorName(l.lessor_name ?? "");
      setEditMaintenanceType(l.maintenance_type);
      setEditRentableSf(l.properties?.rentable_square_footage != null ? String(l.properties.rentable_square_footage) : "");
      setEditLotSf(l.properties?.lot_square_footage != null ? String(l.properties.lot_square_footage) : "");
      setEditRentPerSf(l.rent_per_sf != null ? String(l.rent_per_sf) : "");
      setEditSecurityDeposit(String(l.security_deposit));
      setEditTiAllowance(String(l.tenant_improvement_allowance));
      setEditNotes(l.notes ?? "");
      // Init date/term fields
      setEditCommencementDate(l.commencement_date);
      setEditRentCommencementDate(l.rent_commencement_date ?? "");
      setEditExpirationDate(l.expiration_date);
      setEditLeaseTermMonths(String(l.lease_term_months));
      setEditStatus(l.status);
      setEditLeaseType(l.lease_type);
      // Init lease financial term fields
      setEditBaseRent(String(l.base_rent_monthly));
      setEditCamMonthly(String(l.cam_monthly));
      setEditInsuranceMonthly(String(l.insurance_monthly));
      setEditPropertyTaxAnnual(String(l.property_tax_annual));
      setEditPropertyTaxFrequency(l.property_tax_frequency);
      setEditUtilitiesMonthly(String(l.utilities_monthly));
      setEditOtherMonthlyCosts(String(l.other_monthly_costs));
      setEditOtherDescription(l.other_monthly_costs_description ?? "");
      setEditAbatementMonths(String(l.rent_abatement_months));
      setEditAbatementAmount(String(l.rent_abatement_amount));
    }

    setPayments((paymentsResult.data as unknown as PaymentRow[]) ?? []);
    setAllPayments((allPaymentsResult.data as unknown as PaymentRow[]) ?? []);
    setAllSubleasePayments(subleasePaymentsData);
    setSubleaseEscalationsMap(subleaseEscsMap);
    setEscalations((escalationsResult.data as unknown as EscalationRow[]) ?? []);
    setOptions((optionsResult.data as unknown as OptionRow[]) ?? []);
    setCriticalDates((criticalDatesResult.data as unknown as CriticalDateRow[]) ?? []);
    setDocuments((documentsResult.data as unknown as DocumentRow[]) ?? []);
    setAmendments((amendmentsResult.data as unknown as AmendmentRow[]) ?? []);
    setSubleases((subleasesResult.data as unknown as SubleaseListItem[]) ?? []);
    setAccounts((accountsResult.data as Account[]) ?? []);

    // Cost splits for this lease
    const splitsResult = await supabase
      .from("lease_cost_splits")
      .select("id, lease_id, source_entity_id, destination_entity_id, split_type, split_percentage, split_fixed_amount, description, is_active")
      .eq("lease_id", leaseId)
      .eq("is_active", true);
    setCostSplits((splitsResult.data as unknown as CostSplitRow[]) ?? []);

    // Sibling entities (same org, different entity)
    if (leaseResult.data) {
      const entityResult = await supabase
        .from("entities")
        .select("id, organization_id")
        .eq("id", entityId)
        .single();
      if (entityResult.data) {
        const siblingsResult = await supabase
          .from("entities")
          .select("id, name, code")
          .eq("organization_id", (entityResult.data as { id: string; organization_id: string }).organization_id)
          .neq("id", entityId)
          .eq("is_active", true)
          .order("name");
        setSiblingEntities((siblingsResult.data as unknown as SiblingEntity[]) ?? []);
      }
    }

    setLoading(false);
  }, [supabase, leaseId, entityId, periodYear, periodMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // --- Handlers ---

  async function handleSaveAccounts() {
    setSaving(true);
    const { error } = await supabase
      .from("leases")
      .update({
        rou_asset_account_id: rouAssetAccountId || null,
        lease_liability_account_id: leaseLiabilityAccountId || null,
        lease_expense_account_id: leaseExpenseAccountId || null,
        interest_expense_account_id: interestExpenseAccountId || null,
        cam_expense_account_id: camExpenseAccountId || null,
        asc842_adjustment_account_id: asc842AdjustmentAccountId || null,
        cash_ap_account_id: cashApAccountId || null,
      })
      .eq("id", leaseId);

    if (error) toast.error(error.message);
    else toast.success("GL accounts updated");
    setSaving(false);
  }

  async function handleSaveDetails() {
    setSavingDetails(true);
    const rentableSf = editRentableSf ? parseFloat(editRentableSf) : null;
    const lotSf = editLotSf ? parseFloat(editLotSf) : null;
    const rentPerSf = editRentPerSf ? parseFloat(editRentPerSf) : null;
    const securityDeposit = parseFloat(editSecurityDeposit) || 0;
    const tiAllowance = parseFloat(editTiAllowance) || 0;
    const baseRent = parseFloat(editBaseRent) || 0;
    const camMonthly = parseFloat(editCamMonthly) || 0;
    const insuranceMonthly = parseFloat(editInsuranceMonthly) || 0;
    const propertyTaxAnnual = parseFloat(editPropertyTaxAnnual) || 0;
    const utilitiesMonthly = parseFloat(editUtilitiesMonthly) || 0;
    const otherMonthlyCosts = parseFloat(editOtherMonthlyCosts) || 0;
    const abatementMonths = parseInt(editAbatementMonths) || 0;
    const abatementAmount = parseFloat(editAbatementAmount) || 0;

    const leaseTermMonths = parseInt(editLeaseTermMonths) || 0;

    const { error } = await supabase
      .from("leases")
      .update({
        nickname: editNickname.trim() || null,
        lessor_name: editLessorName.trim() || null,
        maintenance_type: editMaintenanceType,
        rent_per_sf: rentPerSf,
        security_deposit: securityDeposit,
        tenant_improvement_allowance: tiAllowance,
        notes: editNotes.trim() || null,
        base_rent_monthly: baseRent,
        cam_monthly: camMonthly,
        insurance_monthly: insuranceMonthly,
        property_tax_annual: propertyTaxAnnual,
        property_tax_frequency: editPropertyTaxFrequency,
        utilities_monthly: utilitiesMonthly,
        other_monthly_costs: otherMonthlyCosts,
        other_monthly_costs_description: editOtherDescription.trim() || null,
        rent_abatement_months: abatementMonths,
        rent_abatement_amount: abatementAmount,
        commencement_date: editCommencementDate,
        rent_commencement_date: editRentCommencementDate || null,
        expiration_date: editExpirationDate,
        lease_term_months: leaseTermMonths,
        status: editStatus,
        lease_type: editLeaseType,
      })
      .eq("id", leaseId);

    if (error) {
      toast.error(error.message);
      setSavingDetails(false);
      return;
    }

    if (lease?.property_id) {
      const { error: propError } = await supabase
        .from("properties")
        .update({ rentable_square_footage: rentableSf, lot_square_footage: lotSf })
        .eq("id", lease.property_id);
      if (propError) {
        toast.error(propError.message);
        setSavingDetails(false);
        return;
      }
    }

    toast.success("Lease details updated");
    setEditingDetails(false);
    loadData();
    setSavingDetails(false);
  }

  function handleCancelEditDetails() {
    if (lease) {
      setEditNickname(lease.nickname ?? "");
      setEditLessorName(lease.lessor_name ?? "");
      setEditMaintenanceType(lease.maintenance_type);
      setEditRentableSf(lease.properties?.rentable_square_footage != null ? String(lease.properties.rentable_square_footage) : "");
      setEditLotSf(lease.properties?.lot_square_footage != null ? String(lease.properties.lot_square_footage) : "");
      setEditRentPerSf(lease.rent_per_sf != null ? String(lease.rent_per_sf) : "");
      setEditSecurityDeposit(String(lease.security_deposit));
      setEditTiAllowance(String(lease.tenant_improvement_allowance));
      setEditNotes(lease.notes ?? "");
      // Reset financial term fields
      setEditBaseRent(String(lease.base_rent_monthly));
      setEditCamMonthly(String(lease.cam_monthly));
      setEditInsuranceMonthly(String(lease.insurance_monthly));
      setEditPropertyTaxAnnual(String(lease.property_tax_annual));
      setEditPropertyTaxFrequency(lease.property_tax_frequency);
      setEditUtilitiesMonthly(String(lease.utilities_monthly));
      setEditOtherMonthlyCosts(String(lease.other_monthly_costs));
      setEditOtherDescription(lease.other_monthly_costs_description ?? "");
      setEditAbatementMonths(String(lease.rent_abatement_months));
      setEditAbatementAmount(String(lease.rent_abatement_amount));
      // Reset date/term fields
      setEditCommencementDate(lease.commencement_date);
      setEditRentCommencementDate(lease.rent_commencement_date ?? "");
      setEditExpirationDate(lease.expiration_date);
      setEditLeaseTermMonths(String(lease.lease_term_months));
      setEditStatus(lease.status);
      setEditLeaseType(lease.lease_type);
    }
    setEditingDetails(false);
  }

  async function handleDeleteLease() {
    setDeleting(true);
    // Delete child records first (FK cascade may handle this, but be explicit)
    await supabase.from("lease_payments").delete().eq("lease_id", leaseId);
    await supabase.from("lease_escalations").delete().eq("lease_id", leaseId);
    await supabase.from("lease_options").delete().eq("lease_id", leaseId);
    await supabase.from("lease_critical_dates").delete().eq("lease_id", leaseId);
    await supabase.from("lease_documents").delete().eq("lease_id", leaseId);
    await supabase.from("lease_amendments").delete().eq("lease_id", leaseId);
    // Delete sublease child records then subleases
    const { data: subs } = await supabase.from("subleases").select("id").eq("lease_id", leaseId);
    if (subs) {
      for (const sub of subs) {
        await supabase.from("sublease_payments").delete().eq("sublease_id", sub.id);
        await supabase.from("sublease_escalations").delete().eq("sublease_id", sub.id);
        await supabase.from("sublease_options").delete().eq("sublease_id", sub.id);
        await supabase.from("sublease_critical_dates").delete().eq("sublease_id", sub.id);
        await supabase.from("sublease_documents").delete().eq("sublease_id", sub.id);
      }
    }
    await supabase.from("subleases").delete().eq("lease_id", leaseId);

    const { error } = await supabase.from("leases").delete().eq("id", leaseId);
    if (error) {
      toast.error("Failed to delete lease: " + error.message);
      setDeleting(false);
    } else {
      toast.success("Lease deleted");
      router.push(`/${entityId}/real-estate`);
    }
  }

  async function handleSaveDiscountRate() {
    const pct = parseFloat(discountRateInput);
    if (isNaN(pct) || pct <= 0) {
      toast.error("Enter a valid discount rate (e.g. 5.5 for 5.5%)");
      return;
    }
    setSavingDiscountRate(true);
    const decimalRate = pct / 100;
    const { error } = await supabase
      .from("leases")
      .update({ discount_rate: decimalRate })
      .eq("id", leaseId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Discount rate updated");
      loadData();
    }
    setSavingDiscountRate(false);
  }

  async function handleTogglePaid(paymentId: string, isPaid: boolean) {
    const { error } = await supabase
      .from("lease_payments")
      .update({
        is_paid: isPaid,
        payment_date: isPaid ? new Date().toISOString().split("T")[0] : null,
      })
      .eq("id", paymentId);

    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleRegenerateSchedule() {
    if (!lease) return;
    // Delete existing and regenerate
    await supabase.from("lease_payments").delete().eq("lease_id", leaseId);

    const schedule = generateLeasePaymentSchedule(
      {
        commencement_date: lease.commencement_date,
        rent_commencement_date: lease.rent_commencement_date,
        expiration_date: lease.expiration_date,
        base_rent_monthly: lease.base_rent_monthly,
        cam_monthly: lease.cam_monthly,
        insurance_monthly: lease.insurance_monthly,
        property_tax_annual: lease.property_tax_annual,
        property_tax_frequency: lease.property_tax_frequency,
        utilities_monthly: lease.utilities_monthly,
        other_monthly_costs: lease.other_monthly_costs,
        rent_abatement_months: lease.rent_abatement_months,
        rent_abatement_amount: lease.rent_abatement_amount,
      },
      escalations.map((e) => ({
        escalation_type: e.escalation_type,
        effective_date: e.effective_date,
        percentage_increase: e.percentage_increase,
        amount_increase: e.amount_increase,
        frequency: e.frequency,
      }))
    );

    if (schedule.length > 0) {
      const rows = schedule.map((entry) => ({
        lease_id: leaseId,
        period_year: entry.period_year,
        period_month: entry.period_month,
        payment_type: entry.payment_type,
        scheduled_amount: entry.scheduled_amount,
      }));

      for (let i = 0; i < rows.length; i += 500) {
        await supabase.from("lease_payments").insert(rows.slice(i, i + 500));
      }
    }

    toast.success("Payment schedule regenerated");
    loadData();
  }

  async function handleRegenerateSubleaseSchedules() {
    if (subleases.length === 0) return;

    for (const sub of subleases) {
      // Delete existing sublease payments
      await supabase.from("sublease_payments").delete().eq("sublease_id", sub.id);

      // Fetch sublease escalations
      const { data: subEscs } = await supabase
        .from("sublease_escalations")
        .select("*")
        .eq("sublease_id", sub.id)
        .order("effective_date");

      const schedule = generateSubleasePaymentSchedule(
        {
          commencement_date: sub.commencement_date,
          rent_commencement_date: null,
          expiration_date: sub.expiration_date,
          base_rent_monthly: sub.base_rent_monthly,
          cam_recovery_monthly: sub.cam_recovery_monthly,
          insurance_recovery_monthly: sub.insurance_recovery_monthly,
          property_tax_recovery_monthly: sub.property_tax_recovery_monthly,
          utilities_recovery_monthly: sub.utilities_recovery_monthly,
          other_recovery_monthly: sub.other_recovery_monthly,
          rent_abatement_months: 0,
          rent_abatement_amount: 0,
        },
        ((subEscs as unknown as SubleaseEscalationRow[]) ?? []).map((e) => ({
          escalation_type: e.escalation_type,
          effective_date: e.effective_date,
          percentage_increase: e.percentage_increase,
          amount_increase: e.amount_increase,
          frequency: e.frequency,
        }))
      );

      if (schedule.length > 0) {
        const rows = schedule.map((entry) => ({
          sublease_id: sub.id,
          period_year: entry.period_year,
          period_month: entry.period_month,
          payment_type: entry.payment_type,
          scheduled_amount: entry.scheduled_amount,
        }));
        for (let i = 0; i < rows.length; i += 500) {
          await supabase.from("sublease_payments").insert(rows.slice(i, i + 500));
        }
      }
    }

    toast.success("Sublease income schedules regenerated");
    loadData();
  }

  function resetEscForm() {
    setEditingEscId(null);
    setNewEscType("fixed_percentage");
    setNewEscDate("");
    setNewEscPercent("");
    setNewEscAmount("");
    setNewEscNewRent("");
    setNewEscFrequency("annual");
  }

  function openEditEscalation(esc: EscalationRow) {
    setEditingEscId(esc.id);
    setNewEscType(esc.escalation_type);
    setNewEscDate(esc.effective_date);
    setNewEscPercent(esc.percentage_increase != null ? String(esc.percentage_increase) : "");
    setNewEscAmount(esc.amount_increase != null ? String(esc.amount_increase) : "");
    setNewEscNewRent("");
    setNewEscFrequency(esc.frequency);
    setEscalationSheetOpen(true);
  }

  /** Walk prior escalations to get the effective rent just before a given date */
  function getEffectiveRentAt(effectiveDate: string): number {
    if (!lease) return 0;
    let rent = lease.base_rent_monthly;
    // Apply all existing escalations (sorted by date) that precede this date
    const sorted = [...escalations]
      .filter((e) => e.id !== editingEscId) // exclude the one being edited
      .sort((a, b) => a.effective_date.localeCompare(b.effective_date));
    for (const esc of sorted) {
      if (esc.effective_date >= effectiveDate) break;
      if (esc.escalation_type === "fixed_percentage" && esc.percentage_increase != null) {
        rent = rent * (1 + esc.percentage_increase);
      } else if (esc.escalation_type === "fixed_amount" && esc.amount_increase != null) {
        rent = rent + esc.amount_increase;
      }
    }
    return rent;
  }

  /** Compute percentage & amount from a new rent target, based on effective rent at that date */
  function handleNewRentChange(val: string) {
    setNewEscNewRent(val);
    if (!val || !lease) return;
    const newRent = parseFloat(val);
    const currentMonthly = newEscDate
      ? getEffectiveRentAt(newEscDate)
      : lease.base_rent_monthly;
    if (currentMonthly > 0 && !isNaN(newRent)) {
      const diff = newRent - currentMonthly;
      const pct = diff / currentMonthly;
      setNewEscAmount(String(Math.round(diff * 100) / 100));
      setNewEscPercent(String(Math.round(pct * 1000000) / 1000000));
      if (diff >= 0) {
        setNewEscType("fixed_amount");
      }
    }
  }

  async function handleSaveEscalation() {
    const payload = {
      escalation_type: newEscType,
      effective_date: newEscDate,
      percentage_increase: newEscPercent ? parseFloat(newEscPercent) : null,
      amount_increase: newEscAmount ? parseFloat(newEscAmount) : null,
      frequency: newEscFrequency,
    };

    if (editingEscId) {
      const { error } = await supabase
        .from("lease_escalations")
        .update(payload)
        .eq("id", editingEscId);
      if (error) { toast.error(error.message); return; }
      toast.success("Escalation updated");
    } else {
      const { error } = await supabase
        .from("lease_escalations")
        .insert({ ...payload, lease_id: leaseId });
      if (error) { toast.error(error.message); return; }
      toast.success("Escalation added");
    }

    setEscalationSheetOpen(false);
    resetEscForm();
    loadData();
  }

  async function handleAddOption() {
    const { error } = await supabase.from("lease_options").insert({
      lease_id: leaseId,
      option_type: newOptType,
      exercise_deadline: newOptDeadline || null,
      notice_required_days: newOptNoticeDays ? parseInt(newOptNoticeDays) : null,
      option_term_months: newOptTermMonths ? parseInt(newOptTermMonths) : null,
      option_rent_terms: newOptRentTerms || null,
      option_price: newOptPrice ? parseFloat(newOptPrice) : null,
      penalty_amount: newOptPenalty ? parseFloat(newOptPenalty) : null,
      is_reasonably_certain: newOptReasonablyCertain,
    });

    if (error) toast.error(error.message);
    else {
      toast.success("Option added");
      setOptionSheetOpen(false);
      setNewOptDeadline("");
      setNewOptNoticeDays("");
      setNewOptTermMonths("");
      setNewOptRentTerms("");
      setNewOptPrice("");
      setNewOptPenalty("");
      setNewOptReasonablyCertain(false);
      loadData();
    }
  }

  async function handleAddCriticalDate() {
    const { error } = await supabase.from("lease_critical_dates").insert({
      lease_id: leaseId,
      date_type: newDateType,
      critical_date: newDateDate,
      alert_days_before: parseInt(newDateAlertDays) || 90,
      description: newDateDescription || null,
    });

    if (error) toast.error(error.message);
    else {
      toast.success("Critical date added");
      setDateSheetOpen(false);
      setNewDateDate("");
      setNewDateDescription("");
      loadData();
    }
  }

  async function handleResolveCriticalDate(dateId: string) {
    const { error } = await supabase
      .from("lease_critical_dates")
      .update({
        is_resolved: true,
        resolved_date: new Date().toISOString().split("T")[0],
      })
      .eq("id", dateId);

    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleDeleteEscalation(id: string) {
    const { error } = await supabase.from("lease_escalations").delete().eq("id", id);
    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleDeleteOption(id: string) {
    const { error } = await supabase.from("lease_options").delete().eq("id", id);
    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleDocumentDownload(filePath: string, fileName: string) {
    try {
      const res = await fetch("/api/storage/signed-download-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: "lease-documents", path: filePath }),
      });
      if (!res.ok) throw new Error("Failed to get download URL");
      const { signedUrl } = await res.json();
      const link = document.createElement("a");
      link.href = signedUrl;
      link.download = fileName;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      toast.error("Failed to download document");
    }
  }

  async function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(true);

    const timestamp = Date.now();
    const storagePath = `${entityId}/leases/${leaseId}/${timestamp}_${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("lease-documents")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      toast.error(`Upload failed: ${uploadError.message}`);
      setUploadingDoc(false);
      e.target.value = "";
      return;
    }

    const { error: dbError } = await supabase.from("lease_documents").insert({
      lease_id: leaseId,
      document_type: "other" as const,
      file_name: file.name,
      file_path: storagePath,
      file_size_bytes: file.size,
    });

    if (dbError) toast.error(dbError.message);
    else toast.success("Document uploaded");
    setUploadingDoc(false);
    e.target.value = "";
    loadData();
  }

  async function handleAIExtract(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error("AI extraction requires a PDF file");
      e.target.value = "";
      return;
    }

    setExtracting(true);
    setExtractedData(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("entityId", entityId);

    try {
      const res = await fetch("/api/leases/abstract", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Extraction failed");
        setExtracting(false);
        e.target.value = "";
        return;
      }

      setExtractedData(data.extracted);

      // Also save the document record
      if (data.file_path) {
        await supabase.from("lease_documents").insert({
          lease_id: leaseId,
          document_type: "original_lease" as const,
          file_name: data.file_name,
          file_path: data.file_path,
          file_size_bytes: data.file_size_bytes,
        });
        loadData();
      }

      toast.success("AI extraction complete — review the results below");
    } catch (err) {
      toast.error("Network error during extraction");
    }
    setExtracting(false);
    e.target.value = "";
  }

  async function handleApplyExtraction() {
    if (!extractedData || !lease) return;
    setSaving(true);

    // Build update object with only non-null extracted values
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: Record<string, any> = {};
    const fieldMap: Record<string, string> = {
      lease_name: "lease_name",
      lessor_name: "lessor_name",
      lessor_contact_info: "lessor_contact_info",
      lease_type: "lease_type",
      commencement_date: "commencement_date",
      rent_commencement_date: "rent_commencement_date",
      expiration_date: "expiration_date",
      lease_term_months: "lease_term_months",
      base_rent_monthly: "base_rent_monthly",
      rent_per_sf: "rent_per_sf",
      security_deposit: "security_deposit",
      tenant_improvement_allowance: "tenant_improvement_allowance",
      rent_abatement_months: "rent_abatement_months",
      rent_abatement_amount: "rent_abatement_amount",
      cam_monthly: "cam_monthly",
      insurance_monthly: "insurance_monthly",
      property_tax_annual: "property_tax_annual",
      property_tax_frequency: "property_tax_frequency",
      utilities_monthly: "utilities_monthly",
      other_monthly_costs: "other_monthly_costs",
      other_monthly_costs_description: "other_monthly_costs_description",
      maintenance_type: "maintenance_type",
      permitted_use: "permitted_use",
      discount_rate: "discount_rate",
      initial_direct_costs: "initial_direct_costs",
      notes: "notes",
    };

    for (const [extKey, dbKey] of Object.entries(fieldMap)) {
      if (extractedData[extKey] != null) {
        update[dbKey] = extractedData[extKey];
      }
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from("leases")
        .update(update)
        .eq("id", leaseId);

      if (error) {
        toast.error(`Failed to update lease: ${error.message}`);
        setSaving(false);
        return;
      }
    }

    // Insert extracted escalations
    if (extractedData.escalations?.length > 0) {
      for (const esc of extractedData.escalations) {
        await supabase.from("lease_escalations").insert({
          lease_id: leaseId,
          escalation_type: esc.escalation_type,
          effective_date: esc.effective_date,
          percentage_increase: esc.percentage_increase,
          amount_increase: esc.amount_increase,
          frequency: esc.frequency || "annual",
        });
      }
    }

    // Insert extracted options
    if (extractedData.options?.length > 0) {
      for (const opt of extractedData.options) {
        await supabase.from("lease_options").insert({
          lease_id: leaseId,
          option_type: opt.option_type,
          exercise_deadline: opt.exercise_deadline,
          notice_required_days: opt.notice_required_days,
          option_term_months: opt.option_term_months,
          option_rent_terms: opt.option_rent_terms,
          option_price: opt.option_price,
          penalty_amount: opt.penalty_amount,
          is_reasonably_certain: false,
        });
      }
    }

    // Insert extracted critical dates
    if (extractedData.critical_dates?.length > 0) {
      for (const cd of extractedData.critical_dates) {
        await supabase.from("lease_critical_dates").insert({
          lease_id: leaseId,
          date_type: cd.date_type,
          critical_date: cd.critical_date,
          description: cd.description,
          alert_days_before: 90,
        });
      }
    }

    // Update property if extracted
    if (
      extractedData.property_name ||
      extractedData.address_line1 ||
      extractedData.city
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const propUpdate: Record<string, any> = {};
      if (extractedData.property_name) propUpdate.property_name = extractedData.property_name;
      if (extractedData.address_line1) propUpdate.address_line1 = extractedData.address_line1;
      if (extractedData.address_line2) propUpdate.address_line2 = extractedData.address_line2;
      if (extractedData.city) propUpdate.city = extractedData.city;
      if (extractedData.state) propUpdate.state = extractedData.state;
      if (extractedData.zip_code) propUpdate.zip_code = extractedData.zip_code;
      if (extractedData.property_type) propUpdate.property_type = extractedData.property_type;
      if (extractedData.total_square_footage) propUpdate.total_square_footage = extractedData.total_square_footage;
      if (extractedData.rentable_square_footage) propUpdate.rentable_square_footage = extractedData.rentable_square_footage;
      if (extractedData.usable_square_footage) propUpdate.usable_square_footage = extractedData.usable_square_footage;

      if (Object.keys(propUpdate).length > 0) {
        await supabase
          .from("properties")
          .update(propUpdate)
          .eq("id", lease.property_id);
      }
    }

    toast.success("Extracted data applied to lease");
    setExtractedData(null);
    setSaving(false);
    loadData();
  }

  // --- Helpers ---

  // Current rent after applying all escalations effective on or before today
  const currentBaseRent = lease
    ? getCurrentRent(
        lease.base_rent_monthly,
        escalations.map((e) => ({
          escalation_type: e.escalation_type,
          effective_date: e.effective_date,
          percentage_increase: e.percentage_increase,
          amount_increase: e.amount_increase,
          frequency: e.frequency,
        }))
      )
    : 0;

  const totalMonthly = lease
    ? currentBaseRent +
      lease.cam_monthly +
      lease.insurance_monthly +
      lease.property_tax_annual / 12 +
      lease.utilities_monthly +
      lease.other_monthly_costs
    : 0;

  // Active sublease income total (current, after escalations)
  const activeSubleases = subleases.filter((s) => s.status === "active");
  const hasActiveSubleases = activeSubleases.length > 0;

  // Current sublease income after applying sublease escalations
  function currentSubleaseBaseRent(s: SubleaseListItem): number {
    const escs = subleaseEscalationsMap[s.id] ?? [];
    return getCurrentRent(
      s.base_rent_monthly,
      escs.map((e) => ({
        escalation_type: e.escalation_type,
        effective_date: e.effective_date,
        percentage_increase: e.percentage_increase,
        amount_increase: e.amount_increase,
        frequency: e.frequency,
      }))
    );
  }

  function currentSubleaseMonthlyIncome(s: SubleaseListItem): number {
    return (
      currentSubleaseBaseRent(s) +
      s.cam_recovery_monthly +
      s.insurance_recovery_monthly +
      s.property_tax_recovery_monthly +
      s.utilities_recovery_monthly +
      s.other_recovery_monthly
    );
  }

  const totalSubleaseIncome = activeSubleases.reduce(
    (sum, s) => sum + currentSubleaseMonthlyIncome(s),
    0
  );
  const netMonthly = totalMonthly - totalSubleaseIncome;

  const assetAccounts = accounts.filter((a) => a.classification === "Asset");
  const liabilityAccounts = accounts.filter((a) => a.classification === "Liability");
  const expenseAccounts = accounts.filter((a) => a.classification === "Expense");
  const cashApAccounts = accounts.filter(
    (a) => a.classification === "Asset" || a.classification === "Liability"
  );

  // ASC 842 computed schedule
  const asc842Data = (() => {
    if (!lease || lease.discount_rate <= 0 || lease.lease_term_months <= 0) {
      return null;
    }

    // Build variable payment array from actual payment schedule if escalations exist
    // For now, use base rent; when escalations exist, generate the array from the payment schedule
    let monthlyPayments: number[] | undefined;
    if (escalations.length > 0) {
      const paymentSchedule = generateLeasePaymentSchedule(
        {
          commencement_date: lease.commencement_date,
          rent_commencement_date: lease.rent_commencement_date,
          expiration_date: lease.expiration_date,
          base_rent_monthly: lease.base_rent_monthly,
          cam_monthly: 0, // Only base rent for ASC 842 liability
          insurance_monthly: 0,
          property_tax_annual: 0,
          property_tax_frequency: lease.property_tax_frequency,
          utilities_monthly: 0,
          other_monthly_costs: 0,
          rent_abatement_months: lease.rent_abatement_months,
          rent_abatement_amount: lease.rent_abatement_amount,
        },
        escalations.map((e) => ({
          escalation_type: e.escalation_type,
          effective_date: e.effective_date,
          percentage_increase: e.percentage_increase,
          amount_increase: e.amount_increase,
          frequency: e.frequency,
        }))
      );
      // Extract monthly base_rent amounts in order
      const baseRentByPeriod = new Map<string, number>();
      for (const entry of paymentSchedule) {
        if (entry.payment_type === "base_rent") {
          baseRentByPeriod.set(
            `${entry.period_year}-${entry.period_month}`,
            entry.scheduled_amount
          );
        }
      }
      // Build array matching lease term months from commencement
      const start = new Date(lease.commencement_date + "T00:00:00");
      monthlyPayments = [];
      for (let i = 0; i < lease.lease_term_months; i++) {
        const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
        monthlyPayments.push(baseRentByPeriod.get(key) ?? lease.base_rent_monthly);
      }
    }

    return generateASC842Schedule({
      lease_type: lease.lease_type as LeaseClassification,
      lease_term_months: lease.lease_term_months,
      discount_rate: lease.discount_rate,
      commencement_date: lease.commencement_date,
      initial_direct_costs: lease.initial_direct_costs,
      lease_incentives_received: lease.lease_incentives_received,
      prepaid_rent: lease.prepaid_rent,
      base_rent_monthly: lease.base_rent_monthly,
      monthly_payments: monthlyPayments,
    });
  })();

  const asc842InitialJE = (() => {
    if (!lease || lease.discount_rate <= 0 || lease.lease_term_months <= 0) {
      return [];
    }
    return generateInitialJournalEntries(
      {
        lease_type: lease.lease_type as LeaseClassification,
        lease_term_months: lease.lease_term_months,
        discount_rate: lease.discount_rate,
        commencement_date: lease.commencement_date,
        initial_direct_costs: lease.initial_direct_costs,
        lease_incentives_received: lease.lease_incentives_received,
        prepaid_rent: lease.prepaid_rent,
        base_rent_monthly: lease.base_rent_monthly,
      },
      {
        rouAssetAccountId: lease.rou_asset_account_id ?? undefined,
        leaseLiabilityAccountId: lease.lease_liability_account_id ?? undefined,
        leaseExpenseAccountId: lease.lease_expense_account_id ?? undefined,
        interestExpenseAccountId: lease.interest_expense_account_id ?? undefined,
        asc842AdjustmentAccountId: lease.asc842_adjustment_account_id ?? undefined,
        cashApAccountId: lease.cash_ap_account_id ?? undefined,
      }
    );
  })();

  function renderAccountSelect(
    label: string,
    id: string,
    value: string,
    onChange: (v: string) => void,
    accountList: Account[]
  ) {
    const selected = accountList.find((a) => a.id === value);
    const open = glPopoverOpen[id] ?? false;
    const setOpen = (v: boolean) =>
      setGlPopoverOpen((prev) => ({ ...prev, [id]: v }));
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between font-normal"
            >
              {selected
                ? selected.account_number
                  ? `${selected.account_number} - ${selected.name}`
                  : selected.name
                : "Select account..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search accounts..." />
              <CommandList>
                <CommandEmpty>No account found.</CommandEmpty>
                <CommandGroup>
                  {accountList.map((account) => {
                    const display = account.account_number
                      ? `${account.account_number} - ${account.name}`
                      : account.name;
                    return (
                      <CommandItem
                        key={account.id}
                        value={display}
                        onSelect={() => {
                          onChange(account.id === value ? "" : account.id);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value === account.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {display}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  function getCriticalDateUrgency(dateStr: string, isResolved: boolean): string {
    if (isResolved) return "";
    const today = new Date();
    const date = new Date(dateStr + "T00:00:00");
    const daysUntil = Math.ceil(
      (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntil < 0) return "text-red-600 font-semibold";
    if (daysUntil <= 30) return "text-red-500";
    if (daysUntil <= 90) return "text-yellow-600";
    return "";
  }

  // --- Cost Split Handlers ---

  function resetSplitForm() {
    setEditingSplitId(null);
    setSplitDestEntity("");
    setSplitType("percentage");
    setSplitPercentage("");
    setSplitFixedAmount("");
    setSplitDescription("");
  }

  function openEditSplit(split: CostSplitRow) {
    setEditingSplitId(split.id);
    setSplitDestEntity(split.destination_entity_id);
    setSplitType(split.split_type);
    setSplitPercentage(split.split_percentage != null ? String(split.split_percentage * 100) : "");
    setSplitFixedAmount(split.split_fixed_amount != null ? String(split.split_fixed_amount) : "");
    setSplitDescription(split.description ?? "");
    setSplitSheetOpen(true);
  }

  async function handleSaveSplit() {
    if (!splitDestEntity) {
      toast.error("Select a destination entity");
      return;
    }
    setSavingSplit(true);
    const pct = splitType === "percentage" ? parseFloat(splitPercentage) / 100 : null;
    const amt = splitType === "fixed_amount" ? parseFloat(splitFixedAmount) : null;
    if (splitType === "percentage" && (pct == null || isNaN(pct) || pct <= 0 || pct >= 1)) {
      toast.error("Percentage must be between 0% and 100% (exclusive)");
      setSavingSplit(false);
      return;
    }
    if (splitType === "fixed_amount" && (amt == null || isNaN(amt) || amt <= 0)) {
      toast.error("Fixed amount must be greater than 0");
      setSavingSplit(false);
      return;
    }

    const payload = {
      lease_id: leaseId,
      source_entity_id: entityId,
      destination_entity_id: splitDestEntity,
      split_type: splitType,
      split_percentage: pct,
      split_fixed_amount: amt,
      description: splitDescription.trim() || null,
      is_active: true,
    };

    if (editingSplitId) {
      const { error } = await supabase
        .from("lease_cost_splits")
        .update(payload)
        .eq("id", editingSplitId);
      if (error) toast.error(error.message);
      else toast.success("Cost split updated");
    } else {
      const { error } = await supabase
        .from("lease_cost_splits")
        .insert(payload);
      if (error) toast.error(error.message);
      else toast.success("Cost split added");
    }
    setSavingSplit(false);
    setSplitSheetOpen(false);
    resetSplitForm();
    loadData();
  }

  async function handleDeleteSplit(splitId: string) {
    const { error } = await supabase
      .from("lease_cost_splits")
      .delete()
      .eq("id", splitId);
    if (error) toast.error(error.message);
    else {
      toast.success("Cost split removed");
      loadData();
    }
  }

  // --- Render ---

  if (loading) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Loading lease...</p>
      </div>
    );
  }

  if (!lease) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Lease not found.</p>
      </div>
    );
  }

  const paymentScheduledTotal = payments.reduce(
    (s, p) => s + p.scheduled_amount,
    0
  );

  // Build full payment grid: year → month → total scheduled
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const paymentGrid: Record<number, Record<number, number>> = {};
  for (const p of allPayments) {
    if (!paymentGrid[p.period_year]) paymentGrid[p.period_year] = {};
    paymentGrid[p.period_year][p.period_month] =
      (paymentGrid[p.period_year][p.period_month] || 0) + p.scheduled_amount;
  }
  const gridYears = Object.keys(paymentGrid)
    .map(Number)
    .sort((a, b) => a - b);

  // Build sublease income grid: year → month → total income
  const subleaseGrid: Record<number, Record<number, number>> = {};
  for (const p of allSubleasePayments) {
    if (!subleaseGrid[p.period_year]) subleaseGrid[p.period_year] = {};
    subleaseGrid[p.period_year][p.period_month] =
      (subleaseGrid[p.period_year][p.period_month] || 0) + p.scheduled_amount;
  }
  const subleaseGridYears = Object.keys(subleaseGrid)
    .map(Number)
    .sort((a, b) => a - b);
  const hasSubleasePayments = allSubleasePayments.length > 0;

  // Build net payment grid: lease cost - sublease income
  const netGrid: Record<number, Record<number, number>> = {};
  const allNetYears = new Set([...gridYears, ...subleaseGridYears]);
  for (const year of allNetYears) {
    netGrid[year] = {};
    for (let month = 1; month <= 12; month++) {
      const leaseCost = paymentGrid[year]?.[month] || 0;
      const subleaseIncome = subleaseGrid[year]?.[month] || 0;
      const net = leaseCost - subleaseIncome;
      if (leaseCost > 0 || subleaseIncome > 0) {
        netGrid[year][month] = net;
      }
    }
  }
  const netGridYears = Object.keys(netGrid)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/real-estate`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {lease.nickname || lease.lease_name}
          </h1>
          <Badge variant={STATUS_VARIANTS[lease.status]}>
            {STATUS_LABELS[lease.status]}
          </Badge>
          <Badge variant="outline">{TYPE_LABELS[lease.lease_type]}</Badge>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={deleting}>
              <Trash2 className="mr-2 h-4 w-4" />
              {deleting ? "Deleting..." : "Delete Lease"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this lease?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete{" "}
                <span className="font-semibold">{lease.nickname || lease.lease_name}</span>{" "}
                and all associated data including payments, escalations, options,
                critical dates, documents, amendments, and any subleases. This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteLease}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Summary Bar */}
      <div className="rounded-lg border bg-muted/40 p-4">
        <div className={cn("grid gap-4", hasActiveSubleases ? "grid-cols-8" : "grid-cols-6")}>
          <div>
            <p className="text-xs text-muted-foreground">Base Rent</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatCurrency(currentBaseRent)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Monthly</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatCurrency(totalMonthly)}
            </p>
          </div>
          {hasActiveSubleases && (
            <div>
              <p className="text-xs text-muted-foreground">Sublease Income</p>
              <p className="text-lg font-semibold tabular-nums text-green-600">
                {formatCurrency(totalSubleaseIncome)}
              </p>
            </div>
          )}
          {hasActiveSubleases && (
            <div>
              <p className="text-xs text-muted-foreground">Net Monthly</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(netMonthly)}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">Lease Term</p>
            <p className="text-lg font-semibold">{lease.lease_term_months} mo</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Commencement</p>
            <p className="text-lg font-semibold">
              {new Date(lease.commencement_date + "T00:00:00").toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expiration</p>
            <p className="text-lg font-semibold">
              {new Date(lease.expiration_date + "T00:00:00").toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Discount Rate</p>
            <p className="text-lg font-semibold">
              {lease.discount_rate
                ? formatPercentage(lease.discount_rate)
                : "---"}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="summary" className="space-y-6">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="escalations">Escalations</TabsTrigger>
          <TabsTrigger value="options">Options</TabsTrigger>
          <TabsTrigger value="dates">Critical Dates</TabsTrigger>
          <TabsTrigger value="subleases">
            <Users className="mr-1 h-3.5 w-3.5" />
            Subleases
          </TabsTrigger>
          <TabsTrigger value="asc842">ASC 842</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="amendments">Amendments</TabsTrigger>
        </TabsList>

        {/* === Summary Tab === */}
        <TabsContent value="summary">
          <div className="grid grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Property & Lease Details</CardTitle>
                <CardAction>
                  {!editingDetails ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingDetails(true)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelEditDetails}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveDetails}
                        disabled={savingDetails}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {savingDetails ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  )}
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {editingDetails ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 items-center">
                      <Label className="text-muted-foreground">Nickname</Label>
                      <Input
                        value={editNickname}
                        onChange={(e) => setEditNickname(e.target.value)}
                        placeholder="Display name (optional)"
                      />
                      <Label className="text-muted-foreground">Property</Label>
                      <span>{lease.properties?.property_name ?? "---"}</span>
                      <Label className="text-muted-foreground">Address</Label>
                      <span>
                        {[
                          lease.properties?.address_line1,
                          lease.properties?.city,
                          lease.properties?.state,
                        ]
                          .filter(Boolean)
                          .join(", ") || "---"}
                      </span>
                      <Label className="text-muted-foreground">Lessor</Label>
                      <Input
                        value={editLessorName}
                        onChange={(e) => setEditLessorName(e.target.value)}
                      />
                      <Label className="text-muted-foreground">Maintenance</Label>
                      <Select
                        value={editMaintenanceType}
                        onValueChange={(v) => setEditMaintenanceType(v as MaintenanceType)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="triple_net">Triple Net (NNN)</SelectItem>
                          <SelectItem value="gross">Gross</SelectItem>
                          <SelectItem value="modified_gross">Modified Gross</SelectItem>
                        </SelectContent>
                      </Select>
                      <Label className="text-muted-foreground">Building SF</Label>
                      <Input
                        type="number"
                        step="1"
                        value={editRentableSf}
                        onChange={(e) => setEditRentableSf(e.target.value)}
                        placeholder="---"
                      />
                      <Label className="text-muted-foreground">Lot SF</Label>
                      <Input
                        type="number"
                        step="1"
                        value={editLotSf}
                        onChange={(e) => setEditLotSf(e.target.value)}
                        placeholder="---"
                      />
                      <Label className="text-muted-foreground">Rent / SF</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={editRentPerSf}
                        onChange={(e) => setEditRentPerSf(e.target.value)}
                        placeholder="---"
                      />
                      <Label className="text-muted-foreground">Security Deposit</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={editSecurityDeposit}
                        onChange={(e) => setEditSecurityDeposit(e.target.value)}
                      />
                      <Label className="text-muted-foreground">TI Allowance</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={editTiAllowance}
                        onChange={(e) => setEditTiAllowance(e.target.value)}
                      />
                    </div>
                    <div className="pt-3 border-t">
                      <p className="text-sm font-medium mb-3">Lease Dates & Classification</p>
                      <div className="grid grid-cols-2 gap-3 items-center">
                        <Label className="text-muted-foreground">Status</Label>
                        <Select
                          value={editStatus}
                          onValueChange={(v) => setEditStatus(v as LeaseStatus)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="active_non_operational">Active (Non-Operational)</SelectItem>
                            <SelectItem value="expired">Expired</SelectItem>
                            <SelectItem value="terminated">Terminated</SelectItem>
                          </SelectContent>
                        </Select>
                        <Label className="text-muted-foreground">Lease Type</Label>
                        <Select
                          value={editLeaseType}
                          onValueChange={(v) => setEditLeaseType(v as LeaseType)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="operating">Operating</SelectItem>
                            <SelectItem value="finance">Finance</SelectItem>
                          </SelectContent>
                        </Select>
                        <Label className="text-muted-foreground">Commencement Date</Label>
                        <Input
                          type="date"
                          value={editCommencementDate}
                          onChange={(e) => setEditCommencementDate(e.target.value)}
                        />
                        <Label className="text-muted-foreground">Rent Commencement</Label>
                        <Input
                          type="date"
                          value={editRentCommencementDate}
                          onChange={(e) => setEditRentCommencementDate(e.target.value)}
                          placeholder="Same as commencement if blank"
                        />
                        <Label className="text-muted-foreground">Expiration Date</Label>
                        <Input
                          type="date"
                          value={editExpirationDate}
                          onChange={(e) => setEditExpirationDate(e.target.value)}
                        />
                        <Label className="text-muted-foreground">Lease Term (months)</Label>
                        <Input
                          type="number"
                          value={editLeaseTermMonths}
                          onChange={(e) => setEditLeaseTermMonths(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="pt-3 border-t">
                      <Label className="text-muted-foreground mb-2 block">Notes</Label>
                      <Textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={4}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {lease.nickname && (
                        <>
                          <span className="text-muted-foreground">Nickname</span>
                          <span className="font-medium">{lease.nickname}</span>
                        </>
                      )}
                      <span className="text-muted-foreground">Property</span>
                      <span>{lease.properties?.property_name ?? "---"}</span>
                      <span className="text-muted-foreground">Address</span>
                      <span>
                        {[
                          lease.properties?.address_line1,
                          lease.properties?.city,
                          lease.properties?.state,
                        ]
                          .filter(Boolean)
                          .join(", ") || "---"}
                      </span>
                      <span className="text-muted-foreground">Lessor</span>
                      <span>{lease.lessor_name ?? "---"}</span>
                      <span className="text-muted-foreground">Maintenance</span>
                      <span>{MAINTENANCE_LABELS[lease.maintenance_type]}</span>
                      <span className="text-muted-foreground">Building SF</span>
                      <span>
                        {lease.properties?.rentable_square_footage
                          ? lease.properties.rentable_square_footage.toLocaleString()
                          : "---"}
                      </span>
                      <span className="text-muted-foreground">Lot SF</span>
                      <span>
                        {lease.properties?.lot_square_footage
                          ? lease.properties.lot_square_footage.toLocaleString()
                          : "---"}
                      </span>
                      <span className="text-muted-foreground">Rent / SF</span>
                      <span>
                        {lease.rent_per_sf
                          ? formatCurrency(lease.rent_per_sf)
                          : "---"}
                      </span>
                      <span className="text-muted-foreground">Security Deposit</span>
                      <span>{formatCurrency(lease.security_deposit)}</span>
                      <span className="text-muted-foreground">TI Allowance</span>
                      <span>
                        {formatCurrency(lease.tenant_improvement_allowance)}
                      </span>
                    </div>

                    <div className="pt-3 border-t">
                      <div className="grid grid-cols-2 gap-2">
                        <span className="text-muted-foreground">Status</span>
                        <span>
                          <Badge variant={STATUS_VARIANTS[lease.status]}>
                            {STATUS_LABELS[lease.status]}
                          </Badge>
                        </span>
                        <span className="text-muted-foreground">Lease Type</span>
                        <span>{TYPE_LABELS[lease.lease_type]}</span>
                        <span className="text-muted-foreground">Commencement</span>
                        <span>{new Date(lease.commencement_date + "T00:00:00").toLocaleDateString()}</span>
                        {lease.rent_commencement_date && (
                          <>
                            <span className="text-muted-foreground">Rent Commencement</span>
                            <span>{new Date(lease.rent_commencement_date + "T00:00:00").toLocaleDateString()}</span>
                          </>
                        )}
                        <span className="text-muted-foreground">Expiration</span>
                        <span>{new Date(lease.expiration_date + "T00:00:00").toLocaleDateString()}</span>
                        <span className="text-muted-foreground">Lease Term</span>
                        <span>{lease.lease_term_months} months</span>
                      </div>
                    </div>

                    {lease.notes && (
                      <div className="pt-3 border-t">
                        <p className="text-muted-foreground mb-1">Notes</p>
                        <p className="whitespace-pre-wrap">{lease.notes}</p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Lease Terms Card */}
            <Card>
              <CardHeader>
                <CardTitle>Lease Terms</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {editingDetails ? (
                  <div className="grid grid-cols-2 gap-3 items-center">
                    <Label className="text-muted-foreground">Base Rent (Monthly)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editBaseRent}
                      onChange={(e) => setEditBaseRent(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Base Rent (Annual)</Label>
                    <span className="text-muted-foreground tabular-nums">
                      {formatCurrency((parseFloat(editBaseRent) || 0) * 12)}
                    </span>
                    <Label className="text-muted-foreground">Rent Abatement Months</Label>
                    <Input
                      type="number"
                      value={editAbatementMonths}
                      onChange={(e) => setEditAbatementMonths(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Rent Abatement Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editAbatementAmount}
                      onChange={(e) => setEditAbatementAmount(e.target.value)}
                    />
                    <Label className="text-muted-foreground">CAM (Monthly)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editCamMonthly}
                      onChange={(e) => setEditCamMonthly(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Insurance (Monthly)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editInsuranceMonthly}
                      onChange={(e) => setEditInsuranceMonthly(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Property Tax (Annual)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editPropertyTaxAnnual}
                      onChange={(e) => setEditPropertyTaxAnnual(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Property Tax Frequency</Label>
                    <Select
                      value={editPropertyTaxFrequency}
                      onValueChange={(v) => setEditPropertyTaxFrequency(v as PropertyTaxFrequency)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                        <SelectItem value="annual">Annual</SelectItem>
                      </SelectContent>
                    </Select>
                    <Label className="text-muted-foreground">Utilities (Monthly)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editUtilitiesMonthly}
                      onChange={(e) => setEditUtilitiesMonthly(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Other Costs (Monthly)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editOtherMonthlyCosts}
                      onChange={(e) => setEditOtherMonthlyCosts(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Other Description</Label>
                    <Input
                      value={editOtherDescription}
                      onChange={(e) => setEditOtherDescription(e.target.value)}
                      placeholder="Description of other costs"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <span className="text-muted-foreground">Base Rent (Monthly)</span>
                    <span className="tabular-nums">{formatCurrency(lease.base_rent_monthly)}</span>
                    <span className="text-muted-foreground">Base Rent (Annual)</span>
                    <span className="tabular-nums">{formatCurrency(lease.base_rent_annual)}</span>
                    <span className="text-muted-foreground">Rent Abatement Months</span>
                    <span>{lease.rent_abatement_months}</span>
                    <span className="text-muted-foreground">Rent Abatement Amount</span>
                    <span className="tabular-nums">{formatCurrency(lease.rent_abatement_amount)}</span>
                    <span className="text-muted-foreground">CAM (Monthly)</span>
                    <span className="tabular-nums">{formatCurrency(lease.cam_monthly)}</span>
                    <span className="text-muted-foreground">Insurance (Monthly)</span>
                    <span className="tabular-nums">{formatCurrency(lease.insurance_monthly)}</span>
                    <span className="text-muted-foreground">Property Tax (Annual)</span>
                    <span className="tabular-nums">{formatCurrency(lease.property_tax_annual)}</span>
                    <span className="text-muted-foreground">Property Tax Frequency</span>
                    <span className="capitalize">{lease.property_tax_frequency.replace("_", " ")}</span>
                    <span className="text-muted-foreground">Utilities (Monthly)</span>
                    <span className="tabular-nums">{formatCurrency(lease.utilities_monthly)}</span>
                    <span className="text-muted-foreground">Other Costs (Monthly)</span>
                    <span className="tabular-nums">{formatCurrency(lease.other_monthly_costs)}</span>
                    {lease.other_monthly_costs_description && (
                      <>
                        <span className="text-muted-foreground">Other Description</span>
                        <span className="whitespace-pre-wrap">{lease.other_monthly_costs_description}</span>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cost Splits */}
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>Cost Splits</CardTitle>
                <CardDescription>
                  Allocate a portion of this lease cost to other entities in your organization
                </CardDescription>
                <CardAction>
                  <Sheet open={splitSheetOpen} onOpenChange={(open) => {
                    setSplitSheetOpen(open);
                    if (!open) resetSplitForm();
                  }}>
                    <SheetTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          resetSplitForm();
                          setSplitSheetOpen(true);
                        }}
                        disabled={siblingEntities.length === 0}
                      >
                        <Plus className="mr-2 h-4 w-4" /> Add Split
                      </Button>
                    </SheetTrigger>
                    <SheetContent>
                      <SheetHeader>
                        <SheetTitle>{editingSplitId ? "Edit Cost Split" : "Add Cost Split"}</SheetTitle>
                        <SheetDescription>
                          Allocate part of this lease cost to another entity
                        </SheetDescription>
                      </SheetHeader>
                      <div className="space-y-4 mt-6">
                        <div className="space-y-2">
                          <Label>Destination Entity</Label>
                          <Select value={splitDestEntity} onValueChange={setSplitDestEntity}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select entity..." />
                            </SelectTrigger>
                            <SelectContent>
                              {siblingEntities.map((e) => (
                                <SelectItem key={e.id} value={e.id}>
                                  {e.name} ({e.code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Split Type</Label>
                          <Select value={splitType} onValueChange={(v) => setSplitType(v as SplitType)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="percentage">Percentage</SelectItem>
                              <SelectItem value="fixed_amount">Fixed Amount</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {splitType === "percentage" ? (
                          <div className="space-y-2">
                            <Label>Percentage (%)</Label>
                            <Input
                              type="number"
                              step="0.1"
                              min="0.1"
                              max="99.9"
                              placeholder="e.g. 50"
                              value={splitPercentage}
                              onChange={(e) => setSplitPercentage(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                              Percentage of net cost allocated to the destination entity (0-100%)
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <Label>Fixed Amount ($/month)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0.01"
                              placeholder="e.g. 1500.00"
                              value={splitFixedAmount}
                              onChange={(e) => setSplitFixedAmount(e.target.value)}
                            />
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label>Description (optional)</Label>
                          <Textarea
                            placeholder="e.g. Shared warehouse space"
                            value={splitDescription}
                            onChange={(e) => setSplitDescription(e.target.value)}
                          />
                        </div>
                        <Button className="w-full" onClick={handleSaveSplit} disabled={savingSplit}>
                          <Save className="mr-2 h-4 w-4" />
                          {savingSplit ? "Saving..." : editingSplitId ? "Update Split" : "Add Split"}
                        </Button>
                      </div>
                    </SheetContent>
                  </Sheet>
                </CardAction>
              </CardHeader>
              <CardContent>
                {siblingEntities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No sibling entities found in your organization. Cost splits require multiple entities.
                  </p>
                ) : costSplits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No cost splits configured. Click &ldquo;Add Split&rdquo; to allocate part of this lease cost to another entity.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Partner Entity</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="text-right">Allocated Amount</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {costSplits.map((split) => {
                        const destEntity = siblingEntities.find((e) => e.id === split.destination_entity_id);
                        const leaseNet = lease
                          ? (currentBaseRent + lease.cam_monthly + lease.insurance_monthly +
                             lease.property_tax_annual / 12 + lease.utilities_monthly + lease.other_monthly_costs) -
                            subleases.filter((s) => s.status === "active").reduce(
                              (sum, s) => sum + currentSubleaseMonthlyIncome(s), 0
                            )
                          : 0;
                        const allocatedAmt =
                          split.split_type === "percentage"
                            ? leaseNet * (split.split_percentage ?? 0)
                            : (split.split_fixed_amount ?? 0);
                        return (
                          <TableRow key={split.id}>
                            <TableCell className="font-medium">
                              {destEntity?.name ?? "Unknown"} ({destEntity?.code ?? "?"})
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {split.split_type === "percentage" ? "%" : "$"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {split.split_type === "percentage"
                                ? `${((split.split_percentage ?? 0) * 100).toFixed(1)}%`
                                : formatCurrency(split.split_fixed_amount ?? 0)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatCurrency(allocatedAmt)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {split.description ?? "---"}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditSplit(split)}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="sm">
                                      <Trash2 className="h-3 w-3 text-red-500" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Remove Cost Split</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This will remove the cost allocation to{" "}
                                        {destEntity?.name ?? "this entity"}. This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDeleteSplit(split.id)}>
                                        Remove
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>GL Accounts</CardTitle>
                <CardAction>
                  <Button
                    size="sm"
                    onClick={handleSaveAccounts}
                    disabled={saving}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-4">
                {renderAccountSelect(
                  "ROU Asset",
                  "rouAsset",
                  rouAssetAccountId,
                  setRouAssetAccountId,
                  assetAccounts
                )}
                {renderAccountSelect(
                  "Lease Liability",
                  "leaseLiability",
                  leaseLiabilityAccountId,
                  setLeaseLiabilityAccountId,
                  liabilityAccounts
                )}
                {renderAccountSelect(
                  "Lease Expense",
                  "leaseExpense",
                  leaseExpenseAccountId,
                  setLeaseExpenseAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "Interest Expense",
                  "interestExpense",
                  interestExpenseAccountId,
                  setInterestExpenseAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "CAM / OpEx",
                  "camExpense",
                  camExpenseAccountId,
                  setCamExpenseAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "ASC 842 Adjustment",
                  "asc842Adjustment",
                  asc842AdjustmentAccountId,
                  setAsc842AdjustmentAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "Cash / AP",
                  "cashAp",
                  cashApAccountId,
                  setCashApAccountId,
                  cashApAccounts
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* === Payments Tab === */}
        <TabsContent value="payments" className="space-y-6">
          {/* Full Schedule Grid */}
          <Card>
            <CardHeader>
              <CardTitle>Payment Schedule</CardTitle>
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerateSchedule}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerate
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {gridYears.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No payment schedule generated yet. Click Regenerate to create one.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background z-10 w-16">Year</TableHead>
                        {MONTH_SHORT.map((m) => (
                          <TableHead key={m} className="text-right text-xs min-w-[90px]">
                            {m}
                          </TableHead>
                        ))}
                        <TableHead className="text-right text-xs font-semibold min-w-[100px]">
                          Annual
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {gridYears.map((year) => {
                        const monthData = paymentGrid[year] || {};
                        const annualTotal = Object.values(monthData).reduce(
                          (s, v) => s + v,
                          0
                        );
                        return (
                          <TableRow key={year}>
                            <TableCell className="sticky left-0 bg-background z-10 font-medium tabular-nums">
                              {year}
                            </TableCell>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(
                              (month) => {
                                const amt = monthData[month];
                                const isSelected =
                                  year === periodYear && month === periodMonth;
                                return (
                                  <TableCell
                                    key={month}
                                    className={cn(
                                      "text-right tabular-nums text-sm cursor-pointer transition-colors hover:bg-muted/50",
                                      isSelected && "bg-primary/10 font-medium ring-1 ring-primary/30 rounded"
                                    )}
                                    onClick={() => {
                                      setPeriodYear(year);
                                      setPeriodMonth(month);
                                    }}
                                  >
                                    {amt != null
                                      ? formatCurrency(amt)
                                      : <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                );
                              }
                            )}
                            <TableCell className="text-right tabular-nums font-semibold text-sm">
                              {formatCurrency(annualTotal)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {/* Grand total row */}
                      {gridYears.length > 1 && (
                        <TableRow className="border-t-2 font-semibold">
                          <TableCell className="sticky left-0 bg-background z-10">
                            Total
                          </TableCell>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(
                            (month) => {
                              const colTotal = gridYears.reduce(
                                (s, y) => s + (paymentGrid[y]?.[month] || 0),
                                0
                              );
                              return (
                                <TableCell
                                  key={month}
                                  className="text-right tabular-nums text-sm"
                                >
                                  {colTotal > 0 ? formatCurrency(colTotal) : "—"}
                                </TableCell>
                              );
                            }
                          )}
                          <TableCell className="text-right tabular-nums text-sm">
                            {formatCurrency(
                              allPayments.reduce((s, p) => s + p.scheduled_amount, 0)
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sublease Income Schedule */}
          {subleases.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Sublease Income Schedule</CardTitle>
                <CardAction>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateSubleaseSchedules}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Regenerate
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {!hasSubleasePayments ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No sublease income schedule generated yet. Click Regenerate to create one.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky left-0 bg-background z-10 w-16">Year</TableHead>
                          {MONTH_SHORT.map((m) => (
                            <TableHead key={m} className="text-right text-xs min-w-[90px]">
                              {m}
                            </TableHead>
                          ))}
                          <TableHead className="text-right text-xs font-semibold min-w-[100px]">
                            Annual
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {subleaseGridYears.map((year) => {
                          const monthData = subleaseGrid[year] || {};
                          const annualTotal = Object.values(monthData).reduce(
                            (s, v) => s + v,
                            0
                          );
                          return (
                            <TableRow key={year}>
                              <TableCell className="sticky left-0 bg-background z-10 font-medium tabular-nums">
                                {year}
                              </TableCell>
                              {Array.from({ length: 12 }, (_, i) => i + 1).map(
                                (month) => {
                                  const amt = monthData[month];
                                  const isSelected =
                                    year === periodYear && month === periodMonth;
                                  return (
                                    <TableCell
                                      key={month}
                                      className={cn(
                                        "text-right tabular-nums text-sm text-green-600 cursor-pointer transition-colors hover:bg-muted/50",
                                        isSelected && "bg-green-50 dark:bg-green-950/30 font-medium ring-1 ring-green-400/40 rounded"
                                      )}
                                      onClick={() => {
                                        setPeriodYear(year);
                                        setPeriodMonth(month);
                                      }}
                                    >
                                      {amt != null
                                        ? formatCurrency(amt)
                                        : <span className="text-muted-foreground">—</span>}
                                    </TableCell>
                                  );
                                }
                              )}
                              <TableCell className="text-right tabular-nums font-semibold text-sm text-green-600">
                                {formatCurrency(annualTotal)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {subleaseGridYears.length > 1 && (
                          <TableRow className="border-t-2 font-semibold">
                            <TableCell className="sticky left-0 bg-background z-10">
                              Total
                            </TableCell>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(
                              (month) => {
                                const colTotal = subleaseGridYears.reduce(
                                  (s, y) => s + (subleaseGrid[y]?.[month] || 0),
                                  0
                                );
                                return (
                                  <TableCell
                                    key={month}
                                    className="text-right tabular-nums text-sm text-green-600"
                                  >
                                    {colTotal > 0 ? formatCurrency(colTotal) : "—"}
                                  </TableCell>
                                );
                              }
                            )}
                            <TableCell className="text-right tabular-nums text-sm text-green-600">
                              {formatCurrency(
                                allSubleasePayments.reduce((s, p) => s + p.scheduled_amount, 0)
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Net Payment Schedule (Lease Cost - Sublease Income) */}
          {hasSubleasePayments && gridYears.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Net Payment Schedule</CardTitle>
                <CardDescription>
                  Lease costs minus sublease income recoveries
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background z-10 w-16">Year</TableHead>
                        {MONTH_SHORT.map((m) => (
                          <TableHead key={m} className="text-right text-xs min-w-[90px]">
                            {m}
                          </TableHead>
                        ))}
                        <TableHead className="text-right text-xs font-semibold min-w-[100px]">
                          Annual
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {netGridYears.map((year) => {
                        const monthData = netGrid[year] || {};
                        const annualTotal = Object.values(monthData).reduce(
                          (s, v) => s + v,
                          0
                        );
                        return (
                          <TableRow key={year}>
                            <TableCell className="sticky left-0 bg-background z-10 font-medium tabular-nums">
                              {year}
                            </TableCell>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(
                              (month) => {
                                const amt = monthData[month];
                                const hasData =
                                  (paymentGrid[year]?.[month] || 0) > 0 ||
                                  (subleaseGrid[year]?.[month] || 0) > 0;
                                return (
                                  <TableCell
                                    key={month}
                                    className={cn(
                                      "text-right tabular-nums text-sm",
                                      amt != null && amt < 0 && "text-green-600"
                                    )}
                                  >
                                    {hasData
                                      ? formatCurrency(amt ?? 0)
                                      : <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                );
                              }
                            )}
                            <TableCell className={cn(
                              "text-right tabular-nums font-semibold text-sm",
                              annualTotal < 0 && "text-green-600"
                            )}>
                              {formatCurrency(annualTotal)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {netGridYears.length > 1 && (
                        <TableRow className="border-t-2 font-semibold">
                          <TableCell className="sticky left-0 bg-background z-10">
                            Total
                          </TableCell>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(
                            (month) => {
                              const colTotal = netGridYears.reduce(
                                (s, y) => s + (netGrid[y]?.[month] || 0),
                                0
                              );
                              return (
                                <TableCell
                                  key={month}
                                  className={cn(
                                    "text-right tabular-nums text-sm",
                                    colTotal < 0 && "text-green-600"
                                  )}
                                >
                                  {colTotal !== 0 ? formatCurrency(colTotal) : "—"}
                                </TableCell>
                              );
                            }
                          )}
                          <TableCell className={cn(
                            "text-right tabular-nums text-sm",
                            (() => {
                              const grandTotal = allPayments.reduce((s, p) => s + p.scheduled_amount, 0) -
                                allSubleasePayments.reduce((s, p) => s + p.scheduled_amount, 0);
                              return grandTotal < 0;
                            })() && "text-green-600"
                          )}>
                            {formatCurrency(
                              allPayments.reduce((s, p) => s + p.scheduled_amount, 0) -
                                allSubleasePayments.reduce((s, p) => s + p.scheduled_amount, 0)
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

          {/* Selected Month Detail */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {getPeriodLabel(periodYear, periodMonth)}
              </CardTitle>
              <CardDescription>
                Click any cell above to view that month
              </CardDescription>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No payments scheduled for this period.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment Type</TableHead>
                      <TableHead className="text-right">Scheduled</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-center">Paid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          {PAYMENT_TYPE_LABELS[p.payment_type]}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(p.scheduled_amount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.actual_amount != null
                            ? formatCurrency(p.actual_amount)
                            : "---"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={p.is_paid}
                            onCheckedChange={(checked) =>
                              handleTogglePaid(p.id, checked === true)
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold border-t-2">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(paymentScheduledTotal)}
                      </TableCell>
                      <TableCell />
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === Escalations Tab === */}
        <TabsContent value="escalations">
          <Card>
            <CardHeader>
              <CardTitle>Rent Escalations</CardTitle>
              <CardAction>
                <Sheet
                  open={escalationSheetOpen}
                  onOpenChange={(open) => {
                    setEscalationSheetOpen(open);
                    if (!open) resetEscForm();
                  }}
                >
                  <SheetTrigger asChild>
                    <Button size="sm" onClick={() => resetEscForm()}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Escalation
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="px-6 pt-6 overflow-y-auto">
                    <SheetHeader>
                      <SheetTitle>
                        {editingEscId ? "Edit Escalation" : "Add Escalation"}
                      </SheetTitle>
                      <SheetDescription>
                        {editingEscId
                          ? "Update this escalation rule"
                          : "Define a rent escalation rule"}
                      </SheetDescription>
                    </SheetHeader>
                    <div className="space-y-4 mt-6 pb-6">
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                          value={newEscType}
                          onValueChange={(v) =>
                            setNewEscType(v as EscalationType)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fixed_percentage">
                              Fixed Percentage
                            </SelectItem>
                            <SelectItem value="fixed_amount">
                              Fixed Amount
                            </SelectItem>
                            <SelectItem value="cpi">CPI-Linked</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Effective Date</Label>
                        <Input
                          type="date"
                          value={newEscDate}
                          onChange={(e) => {
                            setNewEscDate(e.target.value);
                            // Recalculate if new rent is already entered
                            if (newEscNewRent && e.target.value) {
                              const eff = getEffectiveRentAt(e.target.value);
                              const nr = parseFloat(newEscNewRent);
                              if (eff > 0 && !isNaN(nr)) {
                                const diff = nr - eff;
                                const pct = diff / eff;
                                setNewEscAmount(String(Math.round(diff * 100) / 100));
                                setNewEscPercent(String(Math.round(pct * 1000000) / 1000000));
                              }
                            }
                          }}
                        />
                      </div>

                      {/* New Monthly Rent — back-calculates increase from effective rent at date */}
                      {newEscType !== "cpi" && lease && lease.base_rent_monthly > 0 && (() => {
                        const effectiveRent = newEscDate
                          ? getEffectiveRentAt(newEscDate)
                          : lease.base_rent_monthly;
                        return (
                          <div className="space-y-2">
                            <Label>New Monthly Rent</Label>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={`Current: ${formatCurrency(effectiveRent)}`}
                              value={newEscNewRent}
                              onChange={(e) => handleNewRentChange(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                              {newEscDate && effectiveRent !== lease.base_rent_monthly
                                ? `Effective rent at ${newEscDate}: ${formatCurrency(effectiveRent)}`
                                : "Enter the new monthly amount — increase & percentage will be calculated automatically."}
                            </p>
                          </div>
                        );
                      })()}

                      <div className="relative flex items-center gap-2 py-1">
                        <div className="flex-1 border-t" />
                        <span className="text-xs text-muted-foreground">or enter directly</span>
                        <div className="flex-1 border-t" />
                      </div>

                      {newEscType === "fixed_percentage" && (
                        <div className="space-y-2">
                          <Label>Percentage Increase (decimal)</Label>
                          <Input
                            type="number"
                            step="0.000001"
                            placeholder="e.g., 0.03 for 3%"
                            value={newEscPercent}
                            onChange={(e) => {
                              setNewEscPercent(e.target.value);
                              setNewEscNewRent("");
                            }}
                          />
                        </div>
                      )}
                      {newEscType === "fixed_amount" && (
                        <div className="space-y-2">
                          <Label>Amount Increase (monthly)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={newEscAmount}
                            onChange={(e) => {
                              setNewEscAmount(e.target.value);
                              setNewEscNewRent("");
                            }}
                          />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label>Frequency</Label>
                        <Select
                          value={newEscFrequency}
                          onValueChange={(v) =>
                            setNewEscFrequency(v as EscalationFrequency)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="annual">Annual</SelectItem>
                            <SelectItem value="biennial">Biennial</SelectItem>
                            <SelectItem value="at_renewal">At Renewal</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handleSaveEscalation} className="w-full">
                        {editingEscId ? "Save Changes" : "Add Escalation"}
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
              </CardAction>
            </CardHeader>
            <CardContent>
              {escalations.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No escalation rules defined.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Effective Date</TableHead>
                      <TableHead>Increase</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {escalations.map((esc) => (
                      <TableRow key={esc.id}>
                        <TableCell className="capitalize">
                          {esc.escalation_type.replace("_", " ")}
                        </TableCell>
                        <TableCell>
                          {new Date(
                            esc.effective_date + "T00:00:00"
                          ).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {esc.percentage_increase != null
                            ? formatPercentage(esc.percentage_increase)
                            : esc.amount_increase != null
                            ? formatCurrency(esc.amount_increase)
                            : "CPI"}
                        </TableCell>
                        <TableCell className="capitalize">
                          {esc.frequency.replace("_", " ")}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openEditEscalation(esc)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteEscalation(esc.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
        </TabsContent>

        {/* === Options Tab === */}
        <TabsContent value="options">
          <Card>
            <CardHeader>
              <CardTitle>Lease Options</CardTitle>
              <CardAction>
                <Sheet open={optionSheetOpen} onOpenChange={setOptionSheetOpen}>
                  <SheetTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Option
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Add Option</SheetTitle>
                      <SheetDescription>
                        Define a lease option (renewal, termination, etc.)
                      </SheetDescription>
                    </SheetHeader>
                    <div className="space-y-4 mt-6">
                      <div className="space-y-2">
                        <Label>Option Type</Label>
                        <Select
                          value={newOptType}
                          onValueChange={(v) =>
                            setNewOptType(v as OptionType)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="renewal">Renewal</SelectItem>
                            <SelectItem value="termination">
                              Termination
                            </SelectItem>
                            <SelectItem value="purchase">Purchase</SelectItem>
                            <SelectItem value="expansion">Expansion</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Exercise Deadline</Label>
                        <Input
                          type="date"
                          value={newOptDeadline}
                          onChange={(e) => setNewOptDeadline(e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Notice (days)</Label>
                          <Input
                            type="number"
                            value={newOptNoticeDays}
                            onChange={(e) =>
                              setNewOptNoticeDays(e.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Term (months)</Label>
                          <Input
                            type="number"
                            value={newOptTermMonths}
                            onChange={(e) =>
                              setNewOptTermMonths(e.target.value)
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Rent Terms</Label>
                        <Textarea
                          placeholder="Description of rent during option period"
                          value={newOptRentTerms}
                          onChange={(e) => setNewOptRentTerms(e.target.value)}
                          rows={2}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Price / Amount</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={newOptPrice}
                            onChange={(e) => setNewOptPrice(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Penalty</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={newOptPenalty}
                            onChange={(e) => setNewOptPenalty(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="reasonablyCertain"
                          checked={newOptReasonablyCertain}
                          onCheckedChange={(c) =>
                            setNewOptReasonablyCertain(c === true)
                          }
                        />
                        <Label htmlFor="reasonablyCertain">
                          Reasonably certain to exercise (ASC 842)
                        </Label>
                      </div>
                      <Button onClick={handleAddOption} className="w-full">
                        Add Option
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
              </CardAction>
            </CardHeader>
            <CardContent>
              {options.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No lease options defined.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Deadline</TableHead>
                      <TableHead>Notice</TableHead>
                      <TableHead>Term</TableHead>
                      <TableHead>Certain</TableHead>
                      <TableHead>Exercised</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {options.map((opt) => (
                      <TableRow key={opt.id}>
                        <TableCell>
                          {OPTION_TYPE_LABELS[opt.option_type]}
                        </TableCell>
                        <TableCell>
                          {opt.exercise_deadline
                            ? new Date(
                                opt.exercise_deadline + "T00:00:00"
                              ).toLocaleDateString()
                            : "---"}
                        </TableCell>
                        <TableCell>
                          {opt.notice_required_days
                            ? `${opt.notice_required_days} days`
                            : "---"}
                        </TableCell>
                        <TableCell>
                          {opt.option_term_months
                            ? `${opt.option_term_months} mo`
                            : "---"}
                        </TableCell>
                        <TableCell>
                          {opt.is_reasonably_certain ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            "---"
                          )}
                        </TableCell>
                        <TableCell>
                          {opt.is_exercised ? (
                            <Badge variant="default">Exercised</Badge>
                          ) : (
                            <Badge variant="outline">Open</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteOption(opt.id)}
                          >
                            &times;
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === Critical Dates Tab === */}
        <TabsContent value="dates">
          <Card>
            <CardHeader>
              <CardTitle>Critical Dates</CardTitle>
              <CardAction>
                <Sheet open={dateSheetOpen} onOpenChange={setDateSheetOpen}>
                  <SheetTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Date
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Add Critical Date</SheetTitle>
                      <SheetDescription>
                        Track an important lease milestone
                      </SheetDescription>
                    </SheetHeader>
                    <div className="space-y-4 mt-6">
                      <div className="space-y-2">
                        <Label>Date Type</Label>
                        <Select
                          value={newDateType}
                          onValueChange={(v) =>
                            setNewDateType(v as CriticalDateType)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              Object.entries(DATE_TYPE_LABELS) as [
                                CriticalDateType,
                                string,
                              ][]
                            ).map(([key, label]) => (
                              <SelectItem key={key} value={key}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Date</Label>
                        <Input
                          type="date"
                          value={newDateDate}
                          onChange={(e) => setNewDateDate(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Alert Days Before</Label>
                        <Input
                          type="number"
                          value={newDateAlertDays}
                          onChange={(e) => setNewDateAlertDays(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                          value={newDateDescription}
                          onChange={(e) =>
                            setNewDateDescription(e.target.value)
                          }
                          rows={2}
                        />
                      </div>
                      <Button
                        onClick={handleAddCriticalDate}
                        className="w-full"
                      >
                        Add Date
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
              </CardAction>
            </CardHeader>
            <CardContent>
              {criticalDates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No critical dates tracked.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Alert</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {criticalDates.map((cd) => (
                      <TableRow key={cd.id}>
                        <TableCell>
                          {DATE_TYPE_LABELS[cd.date_type]}
                        </TableCell>
                        <TableCell
                          className={getCriticalDateUrgency(
                            cd.critical_date,
                            cd.is_resolved
                          )}
                        >
                          {new Date(
                            cd.critical_date + "T00:00:00"
                          ).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {cd.alert_days_before} days
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {cd.description ?? "---"}
                        </TableCell>
                        <TableCell>
                          {cd.is_resolved ? (
                            <Badge variant="secondary">Resolved</Badge>
                          ) : (
                            <Badge variant="outline">Open</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {!cd.is_resolved && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleResolveCriticalDate(cd.id)
                              }
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === Subleases Tab === */}
        <TabsContent value="subleases">
          <Card>
            <CardHeader>
              <CardTitle>Subleases</CardTitle>
              <CardDescription>
                Subtenants renting space under this lease — track income, escalations, and critical dates
              </CardDescription>
              <CardAction>
                <div className="flex items-center gap-2">
                  <Link href={`/${entityId}/real-estate/${leaseId}/subleases/from-pdf`}>
                    <Button size="sm" variant="outline">
                      <Upload className="mr-2 h-4 w-4" />
                      Create from PDF
                    </Button>
                  </Link>
                  <Link href={`/${entityId}/real-estate/${leaseId}/subleases/new`}>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      New Sublease
                    </Button>
                  </Link>
                </div>
              </CardAction>
            </CardHeader>
            <CardContent>
              {subleases.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="mx-auto h-12 w-12 text-muted-foreground/40" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    No subleases yet. Add a sublease to track rental income from subtenants.
                  </p>
                </div>
              ) : (
                <>
                  {/* Sublease income summary */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Active Subleases</p>
                      <p className="text-2xl font-bold">
                        {subleases.filter((s) => s.status === "active").length}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Current Monthly Income</p>
                      <p className="text-2xl font-bold text-green-600">
                        {formatCurrency(totalSubleaseIncome)}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Subleased SF</p>
                      <p className="text-2xl font-bold">
                        {subleases
                          .filter((s) => s.status === "active")
                          .reduce((sum, s) => sum + (s.subleased_square_footage ?? 0), 0)
                          .toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sublease</TableHead>
                        <TableHead>Subtenant</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Space</TableHead>
                        <TableHead className="text-right">Current Rent</TableHead>
                        <TableHead className="text-right">Current Total</TableHead>
                        <TableHead>Expiration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subleases.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>
                            <Link
                              href={`/${entityId}/real-estate/${leaseId}/subleases/${s.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {s.sublease_name}
                            </Link>
                          </TableCell>
                          <TableCell>{s.subtenant_name}</TableCell>
                          <TableCell>
                            <Badge variant={SUBLEASE_STATUS_VARIANTS[s.status]}>
                              {SUBLEASE_STATUS_LABELS[s.status]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {s.floor_suite ?? "---"}
                            {s.subleased_square_footage
                              ? ` (${s.subleased_square_footage.toLocaleString()} SF)`
                              : ""}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(currentSubleaseBaseRent(s))}
                          </TableCell>
                          <TableCell className="text-right font-medium text-green-600">
                            {formatCurrency(currentSubleaseMonthlyIncome(s))}
                          </TableCell>
                          <TableCell>
                            {new Date(s.expiration_date + "T00:00:00").toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === ASC 842 Tab === */}
        <TabsContent value="asc842">
          {!asc842Data ? (
            <Card>
              <CardHeader>
                <CardTitle>Set Discount Rate (IBR)</CardTitle>
                <CardDescription>
                  ASC 842 calculations require a discount rate to generate the
                  amortization schedule. Enter your incremental borrowing rate below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-3 max-w-sm">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="discountRateSetup">Discount Rate (%)</Label>
                    <Input
                      id="discountRateSetup"
                      type="number"
                      step="0.01"
                      placeholder="e.g. 5.5"
                      value={discountRateInput}
                      onChange={(e) => setDiscountRateInput(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={handleSaveDiscountRate}
                    disabled={savingDiscountRate || !discountRateInput}
                  >
                    {savingDiscountRate ? "Saving..." : "Generate Schedule"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Discount Rate adjuster */}
              <div className="flex items-end gap-3">
                <div className="space-y-2">
                  <Label htmlFor="discountRateEdit">Discount Rate / IBR (%)</Label>
                  <Input
                    id="discountRateEdit"
                    type="number"
                    step="0.01"
                    className="w-40"
                    value={discountRateInput}
                    onChange={(e) => setDiscountRateInput(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleSaveDiscountRate}
                  disabled={savingDiscountRate || !discountRateInput || parseFloat(discountRateInput) === lease.discount_rate * 100}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {savingDiscountRate ? "Recalculating..." : "Recalculate"}
                </Button>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Initial Lease Liability</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatCurrency(asc842Data.summary.initial_lease_liability)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Initial ROU Asset</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatCurrency(asc842Data.summary.initial_rou_asset)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total Lease Cost</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatCurrency(asc842Data.summary.total_lease_cost)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>
                      {lease.lease_type === "operating"
                        ? "Monthly Straight-Line Expense"
                        : "Total Interest Expense"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatCurrency(
                        lease.lease_type === "operating"
                          ? asc842Data.summary.monthly_straight_line_expense
                          : asc842Data.summary.total_interest_expense
                      )}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Classification info */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    {lease.lease_type === "operating"
                      ? "Operating Lease"
                      : "Finance Lease"}{" "}
                    — ASC 842 Amortization Schedule
                  </CardTitle>
                  <CardDescription>
                    {lease.lease_type === "operating"
                      ? "Single straight-line lease expense with liability effective-interest amortization. ROU amortization is the plug."
                      : "Separate interest expense (effective interest) and ROU amortization (straight-line). Front-loaded total expense."}
                  </CardDescription>
                  <CardAction>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setAsc842ShowJournalEntries(!asc842ShowJournalEntries)
                      }
                    >
                      {asc842ShowJournalEntries
                        ? "Hide Journal Entries"
                        : "Show Journal Entries"}
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[60px]">#</TableHead>
                          <TableHead>Period</TableHead>
                          <TableHead className="text-right">
                            Liability Beg.
                          </TableHead>
                          <TableHead className="text-right">Payment</TableHead>
                          <TableHead className="text-right">
                            Interest
                          </TableHead>
                          <TableHead className="text-right">
                            Principal
                          </TableHead>
                          <TableHead className="text-right">
                            Liability End.
                          </TableHead>
                          <TableHead className="text-right">
                            ROU Beg.
                          </TableHead>
                          <TableHead className="text-right">
                            ROU Amort.
                          </TableHead>
                          <TableHead className="text-right">
                            ROU End.
                          </TableHead>
                          <TableHead className="text-right font-semibold">
                            Total Expense
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {asc842Data.schedule.map((row) => (
                          <TableRow key={row.period}>
                            <TableCell className="tabular-nums text-muted-foreground">
                              {row.period}
                            </TableCell>
                            <TableCell>
                              {getPeriodLabel(
                                row.period_year,
                                row.period_month
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.lease_liability_beginning)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.lease_payment)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.interest_expense)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.principal_reduction)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.lease_liability_ending)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.rou_asset_beginning)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.amortization_expense)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.rou_asset_ending)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">
                              {formatCurrency(row.total_expense)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals row */}
                        <TableRow className="font-semibold border-t-2">
                          <TableCell />
                          <TableCell>Total</TableCell>
                          <TableCell />
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(
                              asc842Data.schedule.reduce(
                                (s, r) => s + r.lease_payment,
                                0
                              )
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(
                              asc842Data.summary.total_interest_expense
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(
                              asc842Data.schedule.reduce(
                                (s, r) => s + r.principal_reduction,
                                0
                              )
                            )}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(
                              asc842Data.summary.total_amortization_expense
                            )}
                          </TableCell>
                          <TableCell />
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(
                              asc842Data.schedule.reduce(
                                (s, r) => s + r.total_expense,
                                0
                              )
                            )}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Journal Entries */}
              {asc842ShowJournalEntries && (
                <Card>
                  <CardHeader>
                    <CardTitle>Journal Entries</CardTitle>
                    <CardDescription>
                      Initial recognition and sample monthly entries per ASC 842
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Initial Recognition */}
                    {asc842InitialJE.map((je, idx) => (
                      <div key={idx} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {new Date(
                              je.date + "T00:00:00"
                            ).toLocaleDateString()}
                          </Badge>
                          <span className="text-sm font-medium">
                            {je.description}
                          </span>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Account</TableHead>
                              <TableHead className="text-right">
                                Debit
                              </TableHead>
                              <TableHead className="text-right">
                                Credit
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {je.debits.map((d, di) => (
                              <TableRow key={`d-${di}`}>
                                <TableCell>{d.account}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(d.amount)}
                                </TableCell>
                                <TableCell />
                              </TableRow>
                            ))}
                            {je.credits.map((c, ci) => (
                              <TableRow key={`c-${ci}`}>
                                <TableCell className="pl-8">
                                  {c.account}
                                </TableCell>
                                <TableCell />
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(c.amount)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}

                    {/* Monthly entries starting from current month */}
                    {(() => {
                      const idx = asc842Data.schedule.findIndex(
                        (r) => r.period_year === current.year && r.period_month === current.month
                      );
                      const start = idx >= 0 ? idx : 0;
                      return asc842Data.schedule.slice(start, start + 3);
                    })().map((row) => {
                      const monthlyJE = generateMonthlyJournalEntry(
                        row,
                        lease.lease_type as LeaseClassification,
                        {
                          rouAssetAccountId: lease.rou_asset_account_id ?? undefined,
                          leaseLiabilityAccountId: lease.lease_liability_account_id ?? undefined,
                          leaseExpenseAccountId: lease.lease_expense_account_id ?? undefined,
                          interestExpenseAccountId: lease.interest_expense_account_id ?? undefined,
                          asc842AdjustmentAccountId: lease.asc842_adjustment_account_id ?? undefined,
                          cashApAccountId: lease.cash_ap_account_id ?? undefined,
                        }
                      );
                      return (
                        <div key={row.period} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              {getPeriodLabel(
                                row.period_year,
                                row.period_month
                              )}
                            </Badge>
                            <span className="text-sm font-medium">
                              {monthlyJE.description}
                            </span>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Account</TableHead>
                                <TableHead className="text-right">
                                  Debit
                                </TableHead>
                                <TableHead className="text-right">
                                  Credit
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {monthlyJE.debits.map((d, di) => (
                                <TableRow key={`d-${di}`}>
                                  <TableCell>{d.account}</TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatCurrency(d.amount)}
                                  </TableCell>
                                  <TableCell />
                                </TableRow>
                              ))}
                              {monthlyJE.credits.map((c, ci) => (
                                <TableRow key={`c-${ci}`}>
                                  <TableCell className="pl-8">
                                    {c.account}
                                  </TableCell>
                                  <TableCell />
                                  <TableCell className="text-right tabular-nums">
                                    {formatCurrency(c.amount)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      );
                    })}

                    {asc842Data.schedule.length > 3 && (
                      <p className="text-sm text-muted-foreground text-center pt-2">
                        Showing current and next 2 months of {asc842Data.schedule.length} total
                        periods.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* === Documents Tab === */}
        <TabsContent value="documents">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
                <CardDescription>
                  Upload lease documents. Use AI Extract to auto-fill lease fields from a PDF.
                </CardDescription>
                <CardAction>
                  <div className="flex items-center gap-2">
                    <label htmlFor="doc-upload">
                      <Button
                        size="sm"
                        variant="outline"
                        asChild
                        className="cursor-pointer"
                      >
                        <span>
                          <Upload className="mr-2 h-4 w-4" />
                          Upload File
                        </span>
                      </Button>
                    </label>
                    <input
                      id="doc-upload"
                      type="file"
                      className="hidden"
                      accept=".pdf,.doc,.docx,.jpg,.png"
                      onChange={handleDocumentUpload}
                    />
                    <label htmlFor="ai-extract-upload">
                      <Button
                        size="sm"
                        asChild
                        className="cursor-pointer"
                        disabled={extracting}
                      >
                        <span>
                          {extracting ? (
                            <>
                              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                              Extracting...
                            </>
                          ) : (
                            <>
                              <FileText className="mr-2 h-4 w-4" />
                              AI Extract from PDF
                            </>
                          )}
                        </span>
                      </Button>
                    </label>
                    <input
                      id="ai-extract-upload"
                      type="file"
                      className="hidden"
                      accept=".pdf"
                      onChange={handleAIExtract}
                      disabled={extracting}
                    />
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                {uploadingDoc && (
                  <p className="text-sm text-muted-foreground py-2">
                    Uploading document...
                  </p>
                )}
                {documents.length === 0 && !uploadingDoc ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No documents uploaded yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Uploaded</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell>
                            <button
                              type="button"
                              className="font-medium text-primary hover:underline cursor-pointer text-left"
                              onClick={() => handleDocumentDownload(doc.file_path, doc.file_name)}
                            >
                              {doc.file_name}
                            </button>
                          </TableCell>
                          <TableCell>
                            {DOC_TYPE_LABELS[doc.document_type]}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {doc.file_size_bytes
                              ? `${(doc.file_size_bytes / 1024).toFixed(0)} KB`
                              : "---"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(doc.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleDocumentDownload(doc.file_path, doc.file_name)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* AI Extraction Review */}
            {extractedData && (
              <Card className="border-blue-200 bg-blue-50/30">
                <CardHeader>
                  <CardTitle>AI Extracted Fields</CardTitle>
                  <CardDescription>
                    Review the extracted data below. Click &quot;Apply to
                    Lease&quot; to update this lease with the extracted
                    values, or dismiss to ignore.
                    {extractedData.confidence_notes && (
                      <span className="block mt-1 text-yellow-700">
                        AI Notes: {extractedData.confidence_notes}
                      </span>
                    )}
                  </CardDescription>
                  <CardAction>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleApplyExtraction}
                        disabled={saving}
                      >
                        <Check className="mr-2 h-4 w-4" />
                        Apply to Lease
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExtractedData(null)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                    {Object.entries(extractedData)
                      .filter(
                        ([k]) =>
                          k !== "escalations" &&
                          k !== "options" &&
                          k !== "critical_dates" &&
                          k !== "confidence_notes"
                      )
                      .map(([key, value]) => (
                        <div key={key} className="grid grid-cols-2 gap-2">
                          <span className="text-muted-foreground">
                            {key.replace(/_/g, " ")}
                          </span>
                          <span className="font-mono text-xs">
                            {value === null
                              ? "—"
                              : typeof value === "number"
                              ? value.toLocaleString()
                              : String(value)}
                          </span>
                        </div>
                      ))}
                  </div>

                  {extractedData.escalations?.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm font-medium mb-2">
                        Escalations ({extractedData.escalations.length})
                      </p>
                      <div className="text-xs space-y-1">
                        {extractedData.escalations.map(
                          (esc: Record<string, unknown>, i: number) => (
                            <p key={i} className="font-mono">
                              {esc.effective_date as string} —{" "}
                              {esc.escalation_type as string}:{" "}
                              {esc.percentage_increase != null
                                ? `${((esc.percentage_increase as number) * 100).toFixed(1)}%`
                                : esc.amount_increase != null
                                ? formatCurrency(esc.amount_increase as number)
                                : "CPI"}
                            </p>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {extractedData.options?.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm font-medium mb-2">
                        Options ({extractedData.options.length})
                      </p>
                      <div className="text-xs space-y-1">
                        {extractedData.options.map(
                          (opt: Record<string, unknown>, i: number) => (
                            <p key={i} className="font-mono">
                              {opt.option_type as string}
                              {opt.exercise_deadline
                                ? ` — deadline: ${opt.exercise_deadline as string}`
                                : ""}
                              {opt.option_term_months
                                ? ` — ${opt.option_term_months as number} mo`
                                : ""}
                            </p>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* === Amendments Tab === */}
        <TabsContent value="amendments">
          <Card>
            <CardHeader>
              <CardTitle>Amendments</CardTitle>
              <CardDescription>
                Modification history for this lease
              </CardDescription>
            </CardHeader>
            <CardContent>
              {amendments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No amendments recorded.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Effective Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {amendments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">
                          {a.amendment_number}
                        </TableCell>
                        <TableCell>
                          {new Date(
                            a.effective_date + "T00:00:00"
                          ).toLocaleDateString()}
                        </TableCell>
                        <TableCell>{a.description ?? "---"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(a.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
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

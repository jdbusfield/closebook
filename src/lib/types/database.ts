// Re-export Database from auto-generated types
export type { Database } from "./database.types";

// Convenience type aliases used throughout the app
export type UserRole = "admin" | "controller" | "preparer" | "reviewer" | "viewer";

export type InviteStatus = "pending" | "accepted" | "cancelled" | "expired";

export type CloseStatus =
  | "open"
  | "in_progress"
  | "review"
  | "soft_closed"
  | "closed"
  | "locked";

export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "pending_review"
  | "approved"
  | "rejected"
  | "na";

export type AccountClassification =
  | "Asset"
  | "Liability"
  | "Equity"
  | "Revenue"
  | "Expense";

export type ScheduleType =
  | "prepaid"
  | "fixed_asset"
  | "debt"
  | "accrual"
  | "custom";

export type ScheduleStatus = "draft" | "finalized";

export type SyncStatus = "idle" | "syncing" | "error";

export type AssetStatus = "active" | "disposed" | "fully_depreciated" | "inactive";

export type BookDepreciationMethod = "straight_line" | "declining_balance" | "none";

export type TaxDepreciationMethod =
  | "macrs_5"
  | "macrs_7"
  | "macrs_10"
  | "section_179"
  | "bonus_100"
  | "bonus_80"
  | "bonus_60"
  | "straight_line_tax"
  | "none";

export type VehicleMasterType = "Vehicle" | "Trailer";

export type VehicleReportingGroup =
  | "Car"
  | "Cargo Van"
  | "Passenger Van"
  | "Box Truck"
  | "Studio Box Truck"
  | "Stakebed"
  | "Cast Trailer"
  | "Makeup Trailer";

export type VehicleClass =
  | "1R" | "2" | "2R" | "3" | "3R" | "4" | "5" | "6" | "7" | "8" | "8MU" | "9"
  | "11" | "12" | "13" | "13T" | "14" | "15" | "15I" | "15L" | "16" | "17" | "18"
  | "20" | "20T" | "21" | "22" | "23" | "24" | "26" | "27" | "28" | "28P" | "28S"
  | "29" | "30" | "31" | "32" | "33" | "34" | "40" | "51" | "52"
  | "ADJ";

export type DispositionMethod =
  | "sale"
  | "trade_in"
  | "scrap"
  | "theft"
  | "casualty"
  | "donation";

export type PayrollAccrualType = "wages" | "payroll_tax" | "pto" | "benefits";

export type AccrualSource = "paylocity_sync" | "manual";

export type AccrualStatus = "draft" | "posted" | "reversed";

// -- Close Management V2 --

export type ClosePhase = 1 | 2 | 3 | 4;

export type CloseSourceModule =
  | "debt"
  | "assets"
  | "leases"
  | "payroll"
  | "intercompany"
  | "schedules"
  | "tb"
  | "financial_statements";

export type GateCheckType =
  | "balance_sheet_balance"
  | "trial_balance_footing"
  | "intercompany_net_zero"
  | "debt_reconciliation"
  | "asset_reconciliation";

export type GateCheckStatus = "pending" | "passed" | "failed" | "warning" | "skipped";

// -- Close Management V3 --

export type WorkpaperStatus = "draft" | "submitted" | "reviewed" | "approved";

export interface ReconciliationFieldDef {
  fieldName: string;
  fieldLabel: string;
  fieldType: "text" | "number" | "currency" | "date" | "select";
  required: boolean;
  options?: string[];
}

export type PaylocityEnvironment = "testing" | "production";

export type NormalBalance = "debit" | "credit";

export type DebtType = "term_loan" | "line_of_credit";

export type DebtStatus = "active" | "paid_off" | "inactive";

export type CommissionAccountRole = "revenue" | "expense";

export type ClassFilterMode = "all" | "include" | "exclude";

export type BudgetStatus = "draft" | "approved" | "archived";

// -- Real Estate Lease Management --

export type PropertyType =
  | "office"
  | "retail"
  | "warehouse"
  | "industrial"
  | "mixed_use"
  | "land"
  | "other";

export type LeaseType = "operating" | "finance";

export type LeaseStatus =
  | "draft"
  | "active"
  | "active_non_operational"
  | "expired"
  | "terminated";

// A lease counts as financially active (rent still owed, schedules generated,
// counted in cost rollups) whether it is fully operational or marked
// non-operational. The distinction is for operational reporting only.
export function isActiveLeaseStatus(status: LeaseStatus | string): boolean {
  return status === "active" || status === "active_non_operational";
}

export type MaintenanceType = "triple_net" | "gross" | "modified_gross";

export type PropertyTaxFrequency = "monthly" | "semi_annual" | "annual";

export type PaymentType =
  | "base_rent"
  | "cam"
  | "property_tax"
  | "insurance"
  | "utilities"
  | "other";

export type EscalationType = "fixed_percentage" | "fixed_amount" | "cpi";

export type EscalationFrequency = "annual" | "biennial" | "at_renewal";

export type OptionType = "renewal" | "termination" | "purchase" | "expansion";

export type CriticalDateType =
  | "lease_expiration"
  | "renewal_deadline"
  | "termination_notice"
  | "rent_escalation"
  | "rent_review"
  | "cam_reconciliation"
  | "insurance_renewal"
  | "custom";

export type LeaseDocumentType =
  | "original_lease"
  | "amendment"
  | "addendum"
  | "correspondence"
  | "insurance_cert"
  | "other";

// -- Sublease Management --

export type SubleaseStatus = "draft" | "active" | "expired" | "terminated";

export type SubleasePaymentType =
  | "base_rent"
  | "cam_recovery"
  | "property_tax_recovery"
  | "insurance_recovery"
  | "utilities_recovery"
  | "other_recovery";

export type SubleaseOptionType = "renewal" | "termination" | "expansion" | "contraction";

export type SubleaseCriticalDateType =
  | "sublease_expiration"
  | "renewal_deadline"
  | "termination_notice"
  | "rent_escalation"
  | "rent_review"
  | "insurance_renewal"
  | "custom";

export type SubleaseDocumentType =
  | "sublease_agreement"
  | "amendment"
  | "addendum"
  | "correspondence"
  | "insurance_cert"
  | "other";

// -- Lease Cost Splits --

export type SplitType = "percentage" | "fixed_amount";

// -- Rebate Tracker --

export type AgreementType = "commercial" | "freelancer";

export type RebateCustomerStatus = "active" | "inactive";

export type EquipmentType = "pro_supplies" | "vehicle" | "grip_lighting" | "studio";

// -- Insurance Module --

export type InsurancePolicyType =
  | "auto_liability"
  | "auto_physical_damage"
  | "general_liability"
  | "property"
  | "excess_liability"
  | "pollution"
  | "management_liability"
  | "workers_comp"
  | "umbrella"
  | "inland_marine"
  | "cyber"
  | "epli"
  | "crime"
  | "fiduciary"
  | "side_a_dic"
  | "renters_liability"
  | "garagekeepers"
  | "hired_non_owned_auto"
  | "package"
  | "other";

export type InsurancePolicyStatus =
  | "active"
  | "expired"
  | "cancelled"
  | "non_renewed"
  | "pending_renewal"
  | "draft";

export type InsurancePaymentTerms =
  | "annual"
  | "monthly_reporting"
  | "installment"
  | "daily_rate"
  | "other";

export type InsuranceCoverageForm = "occurrence" | "claims_made" | "other";

export type InsurancePaymentStatus =
  | "scheduled"
  | "paid"
  | "overdue"
  | "partial"
  | "waived";

export type InsuranceLocationType =
  | "operating"
  | "subleased"
  | "parking"
  | "storage"
  | "other";

export type InsuranceExposureType =
  | "vehicle_count"
  | "square_footage"
  | "payroll"
  | "revenue"
  | "daily_rate"
  | "headcount"
  | "other";

export type InsuranceAllocationMethod =
  | "fixed_amount"
  | "percentage"
  | "pro_rata_revenue"
  | "pro_rata_headcount"
  | "pro_rata_sqft"
  | "manual";

export type InsuranceClaimStatus =
  | "open"
  | "closed"
  | "reopened"
  | "denied"
  | "reserved"
  | "subrogation";

export type InsuranceDocumentType =
  | "proposal"
  | "policy"
  | "endorsement"
  | "certificate"
  | "invoice"
  | "claim"
  | "renewal"
  | "binder"
  | "dec_page"
  | "other";

export type InsuranceSubjectivityStatus =
  | "pending"
  | "completed"
  | "waived"
  | "overdue";

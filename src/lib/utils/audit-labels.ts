export const ACTION_LABELS: Record<string, string> = {
  create: "Added",
  update: "Edited",
  delete: "Deleted",
  transition: "Status Changed",
  import: "Imported",
  sync: "Synced",
};

// Keys are the resource_type values written to audit_log. Since the
// 20260908_audit_triggers migration that is the table name; the older
// singular keys are kept so historical rows still read well.
export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  // legacy (app-layer) keys
  organization: "Organization",
  entity: "Entity",
  organization_member: "Team Member",
  close_period: "Close Period",
  close_task: "Close Task",
  workpaper: "Workpaper",
  debt_instrument: "Debt Instrument",
  debt_transaction: "Debt Transaction",
  fixed_asset: "Fixed Asset",
  lease: "Lease",
  sublease: "Sublease",
  insurance_policy: "Insurance Policy",
  insurance_claim: "Insurance Claim",
  budget: "Budget",
  schedule: "Schedule",
  master_account: "Master GL Account",
  account_mapping: "Account Mapping",
  reporting_entity: "Reporting Entity",
  commission_rule: "Commission Rule",
  intercompany_elimination: "IC Elimination",
  paylocity_connection: "Paylocity Connection",
  qbo_connection: "QuickBooks Connection",
  reconciliation_template: "Recon Template",

  // organization + settings
  organizations: "Organization",
  organization_members: "Team Member",
  organization_invites: "Team Invite",
  organization_integrations: "Integration",
  profiles: "User Profile",
  entities: "Entity",
  entity_access: "Entity Access",
  custom_vehicle_classes: "Vehicle Class",
  kpi_definitions: "KPI Definition",
  materiality_thresholds: "Materiality Threshold",
  materiality_overrides: "Materiality Override",
  report_definitions: "Report Definition",
  reporting_entities: "Reporting Entity",
  reporting_entity_members: "Reporting Entity Member",
  uploaded_reports: "Uploaded Report",

  // close
  close_periods: "Close Period",
  close_tasks: "Close Task",
  close_task_templates: "Close Task Template",
  close_task_attachments: "Close Task Attachment",
  close_task_comments: "Close Task Comment",
  reconciliation_templates: "Recon Template",
  reconciliation_workpapers: "Workpaper",
  schedule_templates: "Schedule Template",
  schedules: "Schedule",
  schedule_line_items: "Schedule Line",
  accrual_close_periods: "Accrual Close Period",
  entity_accrual_config: "Accrual Settings",

  // chart of accounts + reporting
  master_charts: "Master Chart",
  master_accounts: "Master GL Account",
  master_account_mappings: "Account Mapping",
  master_account_bridge_links: "Bridge Link",
  master_account_year_adjustments: "Year Adjustment",
  pro_forma_adjustments: "Pro Forma Adjustment",
  allocation_adjustments: "Allocation Adjustment",
  financial_model_templates: "Financial Model Template",
  budget_versions: "Budget Version",
  budget_amounts: "Budget Amount",
  drift_monitored_accounts: "Drift Monitored Account",

  // debt
  debt_instruments: "Debt Instrument",
  debt_transactions: "Debt Transaction",
  debt_transaction_documents: "Debt Document",
  debt_covenants: "Debt Covenant",
  debt_rate_history: "Debt Rate Change",
  debt_reconciliations: "Debt Reconciliation",
  debt_reconciliation_accounts: "Debt Recon Account",

  // fixed assets
  fixed_assets: "Fixed Asset",
  asset_depreciation_rules: "Depreciation Rule",
  asset_reconciliations: "Asset Reconciliation",
  asset_recon_gl_links: "Asset Recon GL Link",
  fixed_asset_cf_entries: "Asset Cash Flow Entry",

  // leases + real estate
  properties: "Property",
  leases: "Lease",
  lease_amendments: "Lease Amendment",
  lease_cost_splits: "Lease Cost Split",
  lease_critical_dates: "Lease Critical Date",
  lease_documents: "Lease Document",
  lease_escalations: "Lease Escalation",
  lease_options: "Lease Option",
  subleases: "Sublease",
  sublease_critical_dates: "Sublease Critical Date",
  sublease_documents: "Sublease Document",
  sublease_escalations: "Sublease Escalation",
  sublease_options: "Sublease Option",

  // insurance
  insurance_policies: "Insurance Policy",
  insurance_claims: "Insurance Claim",
  insurance_brokers: "Insurance Broker",
  insurance_carriers: "Insurance Carrier",
  insurance_coverages: "Insurance Coverage",
  insurance_exclusions: "Insurance Exclusion",
  insurance_exposures: "Insurance Exposure",
  insurance_locations: "Insurance Location",
  insurance_documents: "Insurance Document",
  insurance_payment_schedules: "Insurance Payment Schedule",
  insurance_subjectivities: "Insurance Subjectivity",
  insurance_allocations: "Insurance Allocation",

  // revenue, commissions, rebates
  revenue_schedules: "Revenue Schedule",
  revenue_line_items: "Revenue Line",
  revenue_projections: "Revenue Projection",
  commission_profiles: "Commission Profile",
  commission_account_assignments: "Commission Account",
  sales_commission_plans: "Sales Commission Plan",
  sales_commission_rate_types: "Sales Commission Rate",
  sales_commission_customer_assignments: "Sales Commission Customer",
  sales_commission_runs: "Sales Commission Run",
  rebate_customers: "Rebate Customer",
  rebate_tiers: "Rebate Tier",
  rebate_excluded_icodes: "Rebate Excluded Item",

  // payroll + integrations
  payroll_accruals: "Payroll Accrual",
  payroll_preview_inputs: "Payroll Preview Input",
  employee_allocations: "Employee Allocation",
  paylocity_connections: "Paylocity Connection",
  qbo_connections: "QuickBooks Connection",

  // sales inquiries
  rental_inquiries: "Inquiry",
  rental_inquiry_quotes: "Quote",
  rental_inquiry_tasks: "Inquiry Task",
  rental_inquiry_funnels: "Follow-up Funnel",
  rental_inquiry_funnel_steps: "Funnel Step",
  rental_inquiry_funnel_enrollments: "Funnel Enrollment",
  rental_inquiry_templates: "Email Template",
  rental_inquiry_faqs: "FAQ",
  rental_inquiry_resources: "Resource File",
  rental_inquiry_resource_folders: "Resource Folder",
  rental_inquiry_fleet_rates: "Fleet Rate",
  rental_inquiry_ad_spend: "Ad Spend",

  // CRM
  crm_contacts: "CRM Contact",
  crm_companies: "CRM Company",
  crm_productions: "CRM Production",
  crm_production_aliases: "CRM Production Alias",
  crm_production_reports: "CRM Production Report",
  crm_production_entity_assignments: "CRM Production Entity",
  crm_opportunities: "CRM Opportunity",
  crm_opportunity_comments: "CRM Opportunity Comment",
  crm_communications: "CRM Communication",
  crm_contact_productions: "CRM Contact Production",
  crm_commercial_companies: "CRM Commercial Company",
  crm_commercial_opportunities: "CRM Commercial Opportunity",
  crm_contact_commercial_companies: "CRM Contact Commercial Company",
  crm_contact_commercial_opportunities: "CRM Contact Commercial Opportunity",
  crm_corporate_opportunities: "CRM Corporate Opportunity",
  crm_entertainment_events: "CRM Event",
  crm_event_bookings: "CRM Event Booking",
  crm_equipment: "CRM Equipment",
  crm_bookings: "CRM Booking",

  // diligence
  diligence_deals: "Diligence Deal",
  diligence_items: "Diligence Item",
  diligence_documents: "Diligence Document",
};

function prettify(key: string): string {
  return key
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function resourceTypeLabel(resourceType: string): string {
  return RESOURCE_TYPE_LABELS[resourceType] ?? prettify(resourceType);
}

export function describeAuditEvent(
  action: string,
  resourceType: string,
  newValues?: Record<string, unknown> | null,
  oldValues?: Record<string, unknown> | null,
  resourceLabel?: string | null
): string {
  const actionLabel = ACTION_LABELS[action] ?? action;
  const resourceName = resourceTypeLabel(resourceType);

  const name =
    resourceLabel ??
    ((newValues?.instrument_name ??
      newValues?.name ??
      newValues?.lease_name ??
      newValues?.policy_name ??
      oldValues?.instrument_name ??
      oldValues?.name ??
      oldValues?.lease_name ??
      oldValues?.policy_name) as string | undefined);

  const oldStatus = oldValues?.status;
  const newStatus = newValues?.status;
  if (
    (action === "transition" || action === "update") &&
    typeof oldStatus === "string" &&
    typeof newStatus === "string" &&
    oldStatus !== newStatus
  ) {
    return `${resourceName} status changed from "${oldStatus}" to "${newStatus}"${name ? ` (${name})` : ""}`;
  }

  if (action === "update" && newValues) {
    const fields = Object.keys(newValues);
    if (fields.length > 0 && fields.length <= 4) {
      return `${actionLabel} ${resourceName}${name ? ` "${name}"` : ""}: ${fields.join(", ")}`;
    }
    if (fields.length > 4) {
      return `${actionLabel} ${resourceName}${name ? ` "${name}"` : ""}: ${fields.length} fields`;
    }
  }

  return `${actionLabel} ${resourceName}${name ? `: ${name}` : ""}`;
}

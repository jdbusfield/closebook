// Standard M&A due-diligence request list. Seeded into a new deal when
// "Start from standard checklist" is selected. Ordering here drives display
// order (categories and items within a category).

export const DILIGENCE_CATEGORIES = [
  "Corporate & Legal",
  "Financial",
  "Tax",
  "Debt & Financing",
  "Assets & Fleet",
  "Commercial & Customers",
  "Operations",
  "HR & People",
  "Real Estate & Facilities",
  "Insurance & Risk",
  "IT & Systems",
  "Regulatory & Compliance",
] as const;

export type DiligenceCategory = (typeof DILIGENCE_CATEGORIES)[number];

export interface TemplateItem {
  category: DiligenceCategory;
  title: string;
  details?: string;
  priority?: "high" | "medium" | "low";
}

export const DEFAULT_REQUEST_LIST: TemplateItem[] = [
  // Corporate & Legal
  { category: "Corporate & Legal", title: "Organizational documents & cap table", details: "Articles, operating/shareholder agreements, ownership structure, subsidiaries." },
  { category: "Corporate & Legal", title: "NDA / confidentiality agreements in place", priority: "high" },
  { category: "Corporate & Legal", title: "Material contracts", details: "Top customer/vendor agreements, partnership or franchise agreements, change-of-control clauses.", priority: "high" },
  { category: "Corporate & Legal", title: "Litigation, claims & disputes", details: "Pending or threatened litigation, judgments, settlements in last 5 years." },
  { category: "Corporate & Legal", title: "UCC / lien searches on target and assets", priority: "high" },
  { category: "Corporate & Legal", title: "Required consents & approvals", details: "Lender, landlord, sponsor/board, and counterparty consents needed to transact.", priority: "high" },

  // Financial
  { category: "Financial", title: "P&L by location / division, last 3 fiscal years + YTD", priority: "high" },
  { category: "Financial", title: "Balance sheets & cash flow statements, last 3 years" },
  { category: "Financial", title: "Monthly revenue detail, trailing 24 months", details: "By location and product line if available.", priority: "high" },
  { category: "Financial", title: "Quality of earnings adjustments", details: "One-time items, owner add-backs, intercompany allocations, off-book support." },
  { category: "Financial", title: "AR / AP aging & deferred revenue" },
  { category: "Financial", title: "Budget / forecast vs. actuals" },

  // Tax
  { category: "Tax", title: "Federal & state income tax returns, last 3 years" },
  { category: "Tax", title: "Sales/use & property tax filings and open audits" },
  { category: "Tax", title: "Payroll tax compliance & 1099 practices", details: "Contractor classification exposure." },

  // Debt & Financing
  { category: "Debt & Financing", title: "Credit agreements & ABL facility terms", details: "Covenants, events of default, restrictions on asset transfer, use, or rebranding.", priority: "high" },
  { category: "Debt & Financing", title: "Per-asset debt payoff schedule", details: "Serialized payoff amounts vs. estimated market value per unit.", priority: "high" },
  { category: "Debt & Financing", title: "Refinancing status & timeline", priority: "high" },
  { category: "Debt & Financing", title: "Lender consent requirements for contemplated structure", priority: "high" },

  // Assets & Fleet
  { category: "Assets & Fleet", title: "Complete serialized asset list", details: "Make/model/year, VIN or serial, location, condition, book value.", priority: "high" },
  { category: "Assets & Fleet", title: "Utilization by asset and region, trailing 24 months", priority: "high" },
  { category: "Assets & Fleet", title: "Maintenance records & known deferred maintenance" },
  { category: "Assets & Fleet", title: "Titles, registrations & DOT compliance", details: "IRP apportioned plates, ELD status, inspection currency." },
  { category: "Assets & Fleet", title: "Parts & shop equipment inventory by location" },
  { category: "Assets & Fleet", title: "Third-party or sub-rented equipment on hand" },

  // Commercial & Customers
  { category: "Commercial & Customers", title: "Customer list with revenue concentration", details: "Top 20 customers by revenue, contract status, churn risk.", priority: "high" },
  { category: "Commercial & Customers", title: "Revenue mix & geographic distribution" },
  { category: "Commercial & Customers", title: "Pipeline / booked orders & seasonality" },
  { category: "Commercial & Customers", title: "Pricing structure & rate cards" },
  { category: "Commercial & Customers", title: "Conflict check vs. our existing operations", details: "Overlapping customers, markets, or channel relationships.", priority: "high" },

  // Operations
  { category: "Operations", title: "Org chart & location staffing model" },
  { category: "Operations", title: "Standard operating procedures & dispatch workflow" },
  { category: "Operations", title: "Vendor & sub-hauler relationships" },
  { category: "Operations", title: "Transition plan for day-one operations", priority: "high" },

  // HR & People
  { category: "HR & People", title: "Employee census", details: "Role, location, tenure, comp, classification (W-2 vs 1099)." },
  { category: "HR & People", title: "Commission / retainer arrangements", details: "Sales reps, coordinators, referral fees — names, amounts, terms.", priority: "high" },
  { category: "HR & People", title: "Benefit plans & accrued obligations" },
  { category: "HR & People", title: "Pending layoffs / WARN Act exposure", details: "Confirm which side bears severance and notice obligations." },

  // Real Estate & Facilities
  { category: "Real Estate & Facilities", title: "Facility leases & terms", details: "Rent, expiry, sublease/assignment rights, guarantees.", priority: "high" },
  { category: "Real Estate & Facilities", title: "Yard / storage capacity & condition by location" },
  { category: "Real Estate & Facilities", title: "Utility, access & permit constraints" },

  // Insurance & Risk
  { category: "Insurance & Risk", title: "Current insurance policies & certificates", details: "Auto/fleet, GL, property, umbrella — coverage, carriers, expiry.", priority: "high" },
  { category: "Insurance & Risk", title: "Loss runs, last 5 years" },
  { category: "Insurance & Risk", title: "Owner vs. operator coverage split for go-forward structure", priority: "high" },

  // IT & Systems
  { category: "IT & Systems", title: "Rental / inventory management system & data export" },
  { category: "IT & Systems", title: "Telematics / GPS / ELD platforms and contracts" },
  { category: "IT & Systems", title: "Accounting system & chart of accounts" },

  // Regulatory & Compliance
  { category: "Regulatory & Compliance", title: "Operating authority & DOT numbers" },
  { category: "Regulatory & Compliance", title: "Environmental exposure", details: "Fuel storage, generator emissions (CARB), spill history." },
  { category: "Regulatory & Compliance", title: "Open regulatory actions, fines, or investigations" },
];

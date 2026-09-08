import type { LucideIcon } from "lucide-react";
import type { ModuleKey } from "@/lib/access/modules";
import {
  LayoutDashboard,
  CheckSquare,
  BookOpenCheck,
  BookOpen,
  TableProperties,
  Car,
  Landmark,
  Receipt,
  Users,
  BarChart3,
  Building,
  Building2,
  LibraryBig,
  RefreshCw,
  Scale,
  AlertTriangle,
  Percent,
  FileText,
  ClipboardList,
  Wallet,
  Layers,
  HandCoins,
  ArrowLeftRight,
  TrendingUp,
  Shield,
  History,
  Settings,
  Clapperboard,
  Inbox,
  Send,
  Handshake,
} from "lucide-react";

export type EntityFeatureFlag = "rebates" | "revenue_projection" | "inquiries";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Access-scope module that owns this item (see lib/access/modules.ts). */
  module?: ModuleKey;
  feature?: EntityFeatureFlag;
  children?: NavSubItem[];
}

export interface NavSubItem {
  title: string;
  href: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export function getOrgNavGroups(): NavGroup[] {
  return [
    {
      label: "Consolidated Reporting",
      items: [
        { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "org_dashboard" },
        { title: "Close Dashboard", href: "/close-dashboard", icon: CheckSquare, module: "close_dashboard" },
        { title: "Financial Model", href: "/reports/financial-model", icon: FileText, module: "financial_model" },
        { title: "Monthly Summary", href: "/monthly-summary", icon: ClipboardList, module: "monthly_summary" },
        { title: "Debt Dashboard", href: "/debt", icon: Landmark, module: "debt_dashboard" },
        { title: "Rental Assets", href: "/rental-assets", icon: Car, module: "rental_assets_dashboard" },
        { title: "TB Variance", href: "/tb-variance", icon: AlertTriangle, module: "tb_variance" },
        { title: "IC Eliminations", href: "/ic-eliminations", icon: ArrowLeftRight, module: "ic_eliminations" },
        { title: "Payroll", href: "/payroll", icon: Users, module: "payroll" },
        { title: "Real Estate", href: "/real-estate", icon: Building, module: "real_estate" },
        { title: "QBO Sync", href: "/sync", icon: RefreshCw, module: "qbo_sync" },
        { title: "Diligence", href: "/diligence", icon: Handshake, module: "diligence" },
      ],
    },
    {
      label: "CRM",
      items: [
        {
          title: "CRM",
          href: "/crm",
          icon: Clapperboard,
          module: "crm",
          children: [
            { title: "Dashboard", href: "/crm" },
            { title: "Clients & Productions", href: "/crm/clients" },
            { title: "Revenue by Production", href: "/crm/revenue" },
            { title: "My Open Tasks", href: "/crm/tasks" },
            { title: "Import Weekly Report", href: "/crm/import" },
            { title: "Productions (list)", href: "/crm/productions" },
            { title: "Companies", href: "/crm/companies" },
            { title: "Contacts", href: "/crm/contacts" },
            { title: "Opportunities", href: "/crm/opportunities" },
            { title: "Communications", href: "/crm/communications" },
            { title: "Commercial", href: "/crm/commercial-companies" },
          ],
        },
      ],
    },
    {
      label: "Administration",
      items: [
        { title: "Master GL", href: "/settings/master-gl", icon: LibraryBig, module: "administration" },
        { title: "Reporting Entities", href: "/settings/reporting-entities", icon: Layers, module: "administration" },
        { title: "Close Templates", href: "/settings/templates/tasks", icon: CheckSquare, module: "administration" },
        { title: "Members", href: "/settings/members", icon: Users, module: "administration" },
        { title: "Audit Log", href: "/settings/audit-log", icon: History, module: "administration" },
        { title: "Wiki", href: "/settings/wiki", icon: BookOpen, module: "administration" },
        { title: "Organization", href: "/settings", icon: Building2, module: "administration" },
      ],
    },
  ];
}

// Silverco Enterprises entity id (operates as Avon Rents). Mirrors
// SILVERCO_ENTITY_ID in lib/inquiries/shared.ts — duplicated as a literal
// here rather than imported so nav-config stays free of the inquiries lib's
// server-only dependencies.
const SILVERCO_ENTITY_ID = "b664a9c1-3817-4df4-9261-f51b3403a5de";
// Hollywood Depot Rentals — same duplication rationale as above.
const HDR_ENTITY_ID = "7529580d-3b44-4a9b-91f4-bc2db25f5211";

export function getEntityNavGroups(entityId: string): NavGroup[] {
  const prefix = `/${entityId}`;
  return [
    {
      label: "Overview",
      items: [
        { title: "Dashboard", href: `${prefix}/dashboard`, icon: LayoutDashboard, module: "entity_dashboard" },
        { title: "Close Management", href: `${prefix}/close`, icon: CheckSquare, module: "close" },
        { title: "Reports & KPIs", href: `${prefix}/reports`, icon: BarChart3, module: "reports" },
        { title: "Budget", href: `${prefix}/reports/budget`, icon: Wallet, module: "reports" },
      ],
    },
    {
      label: "Accounting",
      items: [
        { title: "Chart of Accounts", href: `${prefix}/accounts`, icon: BookOpenCheck, module: "accounts" },
        { title: "Trial Balance", href: `${prefix}/trial-balance`, icon: Scale, module: "trial_balance" },
        { title: "Schedules", href: `${prefix}/schedules`, icon: TableProperties, module: "schedules" },
      ],
    },
    {
      label: "Sales",
      items: [
        {
          title: "Inquiries",
          href: `${prefix}/inquiries`,
          icon: Inbox,
          module: "inquiries",
          feature: "inquiries",
          children: [
            { title: "Dashboard", href: `${prefix}/inquiries/dashboard` },
            { title: "Pipeline", href: `${prefix}/inquiries` },
            { title: "Calendar", href: `${prefix}/inquiries/calendar` },
            { title: "Customers", href: `${prefix}/inquiries/customers` },
            { title: "Templates", href: `${prefix}/inquiries/templates` },
            { title: "Inbox Activity", href: `${prefix}/inquiries/inbox` },
            // Rate card drives trucks.avonrents.com's live pricing/photos —
            // only meaningful for Avon Trucks (Silverco).
            ...(entityId === SILVERCO_ENTITY_ID
              ? [{ title: "Rate Card", href: `${prefix}/inquiries/rate-card` }]
              : []),
          ],
        },
        // Joe's preferred-vendor outreach pipeline — HDR only, and kept apart
        // from Inquiries so cold cards never enter the inbound funnels.
        ...(entityId === HDR_ENTITY_ID
          ? [
              {
                title: "Cold outreach",
                href: `${prefix}/cold-outreach`,
                icon: Send,
                module: "inquiries" as const,
                feature: "inquiries" as const,
              },
            ]
          : []),
      ],
    },
    {
      label: "Resources",
      items: [
        { title: "Rental Assets", href: `${prefix}/assets`, icon: Car, module: "assets" },
        { title: "Debt Schedule", href: `${prefix}/debt`, icon: Landmark, module: "debt" },
        { title: "Real Estate", href: `${prefix}/real-estate`, icon: Building, module: "real_estate" },
        { title: "Insurance", href: `${prefix}/insurance`, icon: Shield, module: "insurance" },
      ],
    },
    {
      label: "Operations",
      items: [
        {
          title: "Employees",
          href: `${prefix}/employees`,
          icon: Users,
          module: "payroll",
          children: [
            { title: "Roster", href: `${prefix}/employees` },
            { title: "Payroll Accruals", href: `${prefix}/employees/accruals` },
            { title: "Details", href: `${prefix}/employees/details` },
          ],
        },
        { title: "Revenue Accruals", href: `${prefix}/revenue`, icon: Receipt, module: "revenue_accruals" },
        { title: "Commissions", href: `${prefix}/commissions`, icon: Percent, module: "commissions" },
        {
          title: "Rebate Tracker",
          href: `${prefix}/rebates`,
          icon: HandCoins,
          module: "rebates",
          feature: "rebates",
        },
        {
          title: "Revenue Projection",
          href: `${prefix}/revenue-projection`,
          icon: TrendingUp,
          module: "revenue_projection",
          feature: "revenue_projection",
        },
      ],
    },
    {
      label: "Entity Settings",
      items: [
        { title: "Settings", href: `${prefix}/settings`, icon: Settings, module: "entity_settings" },
      ],
    },
  ];
}

export function getEntityFeatures(entityName: string | undefined): Set<EntityFeatureFlag> {
  const features = new Set<EntityFeatureFlag>();
  if (entityName?.includes("Versatile")) {
    features.add("rebates");
    features.add("revenue_projection");
    features.add("inquiries");
  }
  if (entityName?.includes("Silverco")) {
    features.add("revenue_projection");
    features.add("inquiries");
  }
  if (entityName?.includes("Hollywood")) {
    features.add("inquiries");
  }
  return features;
}

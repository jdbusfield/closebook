import type { LucideIcon } from "lucide-react";
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
  Wallet,
  Layers,
  HandCoins,
  ArrowLeftRight,
  TrendingUp,
  Shield,
  History,
  Settings,
} from "lucide-react";

export type EntityFeatureFlag = "rebates" | "revenue_projection";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
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
        { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { title: "Close Dashboard", href: "/close-dashboard", icon: CheckSquare },
        { title: "Financial Model", href: "/reports/financial-model", icon: FileText },
        { title: "Debt Dashboard", href: "/debt", icon: Landmark },
        { title: "Rental Assets", href: "/rental-assets", icon: Car },
        { title: "TB Variance", href: "/tb-variance", icon: AlertTriangle },
        { title: "IC Eliminations", href: "/ic-eliminations", icon: ArrowLeftRight },
        { title: "Payroll", href: "/payroll", icon: Users },
        { title: "Real Estate", href: "/real-estate", icon: Building },
        { title: "QBO Sync", href: "/sync", icon: RefreshCw },
      ],
    },
    {
      label: "Administration",
      items: [
        { title: "Master GL", href: "/settings/master-gl", icon: LibraryBig },
        { title: "Reporting Entities", href: "/settings/reporting-entities", icon: Layers },
        { title: "Close Templates", href: "/settings/templates/tasks", icon: CheckSquare },
        { title: "Members", href: "/settings/members", icon: Users },
        { title: "Audit Log", href: "/settings/audit-log", icon: History },
        { title: "Wiki", href: "/settings/wiki", icon: BookOpen },
        { title: "Organization", href: "/settings", icon: Building2 },
      ],
    },
  ];
}

export function getEntityNavGroups(entityId: string): NavGroup[] {
  const prefix = `/${entityId}`;
  return [
    {
      label: "Overview",
      items: [
        { title: "Dashboard", href: `${prefix}/dashboard`, icon: LayoutDashboard },
        { title: "Close Management", href: `${prefix}/close`, icon: CheckSquare },
        { title: "Reports & KPIs", href: `${prefix}/reports`, icon: BarChart3 },
        { title: "Budget", href: `${prefix}/reports/budget`, icon: Wallet },
      ],
    },
    {
      label: "Accounting",
      items: [
        { title: "Chart of Accounts", href: `${prefix}/accounts`, icon: BookOpenCheck },
        { title: "Trial Balance", href: `${prefix}/trial-balance`, icon: Scale },
        { title: "Schedules", href: `${prefix}/schedules`, icon: TableProperties },
      ],
    },
    {
      label: "Resources",
      items: [
        { title: "Rental Assets", href: `${prefix}/assets`, icon: Car },
        { title: "Debt Schedule", href: `${prefix}/debt`, icon: Landmark },
        { title: "Real Estate", href: `${prefix}/real-estate`, icon: Building },
        { title: "Insurance", href: `${prefix}/insurance`, icon: Shield },
      ],
    },
    {
      label: "Operations",
      items: [
        {
          title: "Employees",
          href: `${prefix}/employees`,
          icon: Users,
          children: [
            { title: "Roster", href: `${prefix}/employees` },
            { title: "Payroll Accruals", href: `${prefix}/employees/accruals` },
            { title: "Details", href: `${prefix}/employees/details` },
          ],
        },
        { title: "Revenue Accruals", href: `${prefix}/revenue`, icon: Receipt },
        { title: "Commissions", href: `${prefix}/commissions`, icon: Percent },
        {
          title: "Rebate Tracker",
          href: `${prefix}/rebates`,
          icon: HandCoins,
          feature: "rebates",
        },
        {
          title: "Revenue Projection",
          href: `${prefix}/revenue-projection`,
          icon: TrendingUp,
          feature: "revenue_projection",
        },
      ],
    },
    {
      label: "Entity Settings",
      items: [
        { title: "Settings", href: `${prefix}/settings`, icon: Settings },
      ],
    },
  ];
}

export function getEntityFeatures(entityName: string | undefined): Set<EntityFeatureFlag> {
  const features = new Set<EntityFeatureFlag>();
  if (entityName?.includes("Versatile")) {
    features.add("rebates");
    features.add("revenue_projection");
  }
  if (entityName?.includes("Silverco")) {
    features.add("revenue_projection");
  }
  return features;
}

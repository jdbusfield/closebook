"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { detectEntityId } from "@/lib/utils/entity-context";
import { createClient } from "@/lib/supabase/client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Entity {
  id: string;
  name: string;
  code: string;
}

interface HeaderProps {
  entities: Entity[];
}

const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  close: "Close Management",
  "close-dashboard": "Close Dashboard",
  accounts: "Chart of Accounts",
  "trial-balance": "Trial Balance",
  schedules: "Schedules",
  assets: "Rental Assets",
  debt: "Debt Schedule",
  revenue: "Revenue Accruals",
  "revenue-projection": "Revenue Projection",
  payroll: "Payroll",
  employees: "Employees",
  accruals: "Payroll Accruals",
  details: "Details",
  commissions: "Commissions",
  rebates: "Rebate Tracker",
  insurance: "Insurance",
  "real-estate": "Real Estate",
  "ic-eliminations": "IC Eliminations",
  "financial-model": "Financial Model",
  budget: "Budget",
  reports: "Reports & KPIs",
  settings: "Settings",
  sync: "QBO Sync",
  "tb-variance": "TB Variance",
  "master-gl": "Master GL",
  "reporting-entities": "Reporting Entities",
  members: "Members",
  "audit-log": "Audit Log",
  templates: "Templates",
  tasks: "Close Tasks",
  reconciliations: "Reconciliations",
  materiality: "Materiality",
};

function labelFor(segment: string): string {
  return routeLabels[segment] ?? segment.replace(/-/g, " ");
}

export function Header({ entities }: HeaderProps) {
  const pathname = usePathname();
  const entityId = detectEntityId(pathname);
  const segments = pathname.split("/").filter(Boolean);

  const currentEntity = entityId
    ? entities.find((e) => e.id === entityId)
    : null;

  const trailSegments = entityId ? segments.slice(1) : segments;

  const contextRoot = entityId
    ? {
        label: currentEntity?.name ?? "Entity",
        href: `/${entityId}/dashboard`,
      }
    : { label: "Organization", href: "/dashboard" };

  const lastSegment =
    trailSegments.length > 0 ? trailSegments[trailSegments.length - 1] : null;

  // Detail pages where the URL ends in a UUID — map the section to the
  // Supabase table + columns to fetch so the breadcrumb shows a human
  // label instead of the raw ID. Extend this map as new detail pages
  // are added.
  const DETAIL_LOOKUPS: Record<
    string,
    { table: string; columns: string; format: (row: Record<string, unknown>) => string }
  > = {
    assets: {
      table: "fixed_assets",
      columns: "asset_name, asset_tag",
      format: (r) =>
        r.asset_tag
          ? `${r.asset_tag} — ${r.asset_name}`
          : (r.asset_name as string),
    },
    debt: {
      table: "debt_instruments",
      columns: "instrument_name",
      format: (r) => r.instrument_name as string,
    },
    rebates: {
      table: "rebate_customers",
      columns: "customer_name, rw_customer_number",
      format: (r) =>
        r.rw_customer_number
          ? `${r.customer_name} — #${r.rw_customer_number}`
          : (r.customer_name as string),
    },
  };

  const detail =
    entityId &&
    trailSegments.length === 2 &&
    lastSegment &&
    UUID_PATTERN.test(lastSegment) &&
    DETAIL_LOOKUPS[trailSegments[0]]
      ? {
          section: trailSegments[0],
          id: lastSegment,
          lookup: DETAIL_LOOKUPS[trailSegments[0]],
        }
      : null;
  const [detailLabel, setDetailLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!detail) {
      setDetailLabel(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from(detail.lookup.table)
      .select(detail.lookup.columns)
      .eq("id", detail.id)
      .single()
      .then(({ data }: { data: Record<string, unknown> | null }) => {
        if (cancelled || !data) return;
        setDetailLabel(detail.lookup.format(data));
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.section, detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageLabel = detail
    ? detailLabel ?? labelFor(detail.section)
    : lastSegment
      ? labelFor(lastSegment)
      : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            {pageLabel ? (
              <BreadcrumbLink asChild>
                <Link href={contextRoot.href}>{contextRoot.label}</Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>{contextRoot.label}</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {pageLabel && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="capitalize">{pageLabel}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}

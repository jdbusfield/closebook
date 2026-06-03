"use client";

// Horizontal sub-nav across the HDR Sales CRM views, mirroring the design's
// sidebar groups (Overview / Sales / Resources). Highlights the active view and
// surfaces the open-inquiry and overdue-task counts as badges.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  KanbanSquare,
  CalendarDays,
  Users,
  Inbox,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";

interface Tab {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
  badgeTone?: "default" | "alert";
}

export function SectionTabs({
  entityId,
  openCount,
  overdueCount,
}: {
  entityId: string;
  openCount?: number;
  overdueCount?: number;
}) {
  const pathname = usePathname();
  const base = `/${entityId}/inquiries`;
  const tabs: Tab[] = [
    { key: "dashboard", label: "Dashboard", href: `${base}/dashboard`, icon: LayoutDashboard },
    {
      key: "pipeline",
      label: "Pipeline",
      href: base,
      icon: KanbanSquare,
      badge: openCount,
    },
    { key: "calendar", label: "Calendar", href: `${base}/calendar`, icon: CalendarDays },
    { key: "customers", label: "Customers", href: `${base}/customers`, icon: Users },
    { key: "templates", label: "Templates", href: `${base}/templates`, icon: MessageSquareText },
    { key: "inbox", label: "Inbox", href: `${base}/inbox`, icon: Inbox },
  ];

  const isActive = (href: string) =>
    href === base ? pathname === base : pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b pb-px">
      {tabs.map((t) => {
        const active = isActive(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`flex items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors ${
              active
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-4" />
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums">
                {t.badge}
              </span>
            )}
          </Link>
        );
      })}
      {overdueCount != null && overdueCount > 0 && (
        <Link
          href={`${base}/dashboard`}
          className="ml-auto flex items-center gap-1.5 whitespace-nowrap rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700"
        >
          {overdueCount} overdue follow-up{overdueCount === 1 ? "" : "s"}
        </Link>
      )}
    </div>
  );
}

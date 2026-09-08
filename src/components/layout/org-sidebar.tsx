"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { EntitySwitcher } from "./entity-switcher";
import { SidebarNavSection } from "./sidebar-nav-section";
import { SidebarUserFooter } from "./sidebar-user-footer";
import { OrgSummaryCard } from "./org-summary-card";
import { getOrgNavGroups } from "./nav-config";
import type { OrgSummary } from "@/lib/db/queries/org-summary";
import type { MemberAccess } from "@/lib/access/modules";

interface Entity {
  id: string;
  name: string;
  code: string;
  currency?: string;
  fiscal_year_end_month?: number;
}

interface OrgSidebarProps {
  user: {
    id: string;
    email: string;
    fullName: string;
  };
  entities: Entity[];
  orgSummary: OrgSummary;
  access?: MemberAccess | null;
}

export function OrgSidebar({ user, entities, orgSummary, access }: OrgSidebarProps) {
  const navGroups = getOrgNavGroups();

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                  <BookOpen className="h-4 w-4 text-primary-foreground" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">CloseBook</span>
                  <span className="text-xs text-muted-foreground">
                    Organization
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="px-2 pt-1 pb-2">
          <OrgSummaryCard summary={orgSummary} />
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <EntitySwitcher entities={entities} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarNavSection key={group.label} group={group} access={access} />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarUserFooter user={user} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

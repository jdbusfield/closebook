"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
import { getEntityNavGroups, getEntityFeatures } from "./nav-config";

interface Entity {
  id: string;
  name: string;
  code: string;
  currency?: string;
  fiscal_year_end_month?: number;
}

interface EntitySidebarProps {
  user: {
    id: string;
    email: string;
    fullName: string;
  };
  entities: Entity[];
  entityId: string;
}

const ENTITY_LOGOS: Record<string, { src: string; alt: string }> = {
  "Versatile Studios": {
    src: "/logos/versatile-studios.svg",
    alt: "Versatile Studios",
  },
  "Silverco Enterprises, LLC": {
    src: "/logos/silverco.svg",
    alt: "Silverco Enterprises, LLC",
  },
  "Hollywood Depot Rentals": {
    src: "/logos/hollywood-depot-rentals.jpg",
    alt: "Hollywood Depot Rentals",
  },
};

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function EntitySidebar({ user, entities, entityId }: EntitySidebarProps) {
  const currentEntity = entities.find((e) => e.id === entityId);
  const entityLogo = currentEntity ? ENTITY_LOGOS[currentEntity.name] : null;
  const enabledFeatures = getEntityFeatures(currentEntity?.name);
  const navGroups = getEntityNavGroups(entityId);

  const fyeLabel =
    currentEntity?.fiscal_year_end_month != null
      ? `FYE ${MONTH_LABELS[currentEntity.fiscal_year_end_month - 1]}`
      : null;

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Back to Organization">
              <Link
                href="/dashboard"
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                <span>Back to Organization</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {entityLogo && (
          <div className="flex items-center justify-center px-2 py-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entityLogo.src}
              alt={entityLogo.alt}
              className="h-9 w-auto max-w-[180px] object-contain"
              style={{ background: "transparent" }}
            />
          </div>
        )}

        <SidebarMenu>
          <SidebarMenuItem>
            <EntitySwitcher entities={entities} currentEntityId={entityId} />
          </SidebarMenuItem>
        </SidebarMenu>

        {currentEntity && fyeLabel && (
          <div className="px-3 pb-1 text-xs text-muted-foreground">
            {fyeLabel}
          </div>
        )}
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarNavSection
            key={group.label}
            group={group}
            enabledFeatures={enabledFeatures}
          />
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


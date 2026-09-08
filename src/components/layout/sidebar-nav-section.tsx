"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import type { NavGroup, NavItem, EntityFeatureFlag } from "./nav-config";
import { canOpenModule, type MemberAccess } from "@/lib/access/modules";

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(href + "/");
}

interface SidebarNavSectionProps {
  group: NavGroup;
  enabledFeatures?: Set<EntityFeatureFlag>;
  access?: MemberAccess | null;
}

export function SidebarNavSection({
  group,
  enabledFeatures,
  access,
}: SidebarNavSectionProps) {
  const pathname = usePathname();
  const items = group.items.filter((item) => {
    if (!canOpenModule(access, item.module)) return false;
    if (!item.feature) return true;
    return enabledFeatures?.has(item.feature) ?? false;
  });

  if (items.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <NavItemRow key={item.href} item={item} pathname={pathname} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function NavItemRow({ item, pathname }: { item: NavItem; pathname: string }) {
  if (item.children && item.children.length > 0) {
    const parentActive = isActive(pathname, item.href);
    return (
      <Collapsible defaultOpen={parentActive} className="group/collapsible">
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton isActive={parentActive}>
              <item.icon />
              <span>{item.title}</span>
              <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {item.children.map((child) => (
                <SidebarMenuSubItem key={child.href}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={
                      child.href === item.href
                        ? pathname === child.href
                        : isActive(pathname, child.href)
                    }
                  >
                    <Link href={child.href}>{child.title}</Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive(pathname, item.href)}>
        <Link href={item.href}>
          <item.icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

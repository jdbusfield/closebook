import { redirect } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { getUserProfile, getUserEntities } from "@/lib/db/queries/organizations";
import { getOrgSummary } from "@/lib/db/queries/org-summary";
import { getMemberAccess } from "@/lib/access/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getUserProfile();

  if (!profile) {
    redirect("/login");
  }

  const [entities, orgSummary, access] = await Promise.all([
    getUserEntities(),
    getOrgSummary(),
    getMemberAccess(),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar
        user={{
          id: profile.id,
          email: profile.email,
          fullName: profile.full_name,
        }}
        entities={entities}
        orgSummary={orgSummary}
        access={access}
      />
      <SidebarInset>
        <Header entities={entities} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

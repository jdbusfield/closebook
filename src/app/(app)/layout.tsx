import { redirect } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { AskCloseBookProvider } from "@/components/ai/ask-closebook-context";
import { AskCloseBookRail } from "@/components/ai/ask-closebook-rail";
import { getUserProfile, getUserEntities } from "@/lib/db/queries/organizations";
import { getOrgSummary } from "@/lib/db/queries/org-summary";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getUserProfile();

  if (!profile) {
    redirect("/login");
  }

  const [entities, orgSummary] = await Promise.all([
    getUserEntities(),
    getOrgSummary(),
  ]);

  return (
    <SidebarProvider>
      <AskCloseBookProvider>
        <AppSidebar
          user={{
            id: profile.id,
            email: profile.email,
            fullName: profile.full_name,
          }}
          entities={entities}
          orgSummary={orgSummary}
        />
        <SidebarInset>
          <Header entities={entities} />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <main className="flex-1 overflow-auto p-6">{children}</main>
            <AskCloseBookRail />
          </div>
        </SidebarInset>
      </AskCloseBookProvider>
    </SidebarProvider>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { Building2, ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  getCrmCompany,
  getCrmCompanyProductions,
  getCrmCompanyContacts,
} from "@/lib/db/queries/crm";
import { getOrgMembers } from "@/lib/db/queries/crm-owners";
import { getCrmTasksForEntity } from "@/lib/db/queries/crm-tasks";
import { getCrmNotesForEntity } from "@/lib/db/queries/crm-notes";
import {
  ProductionStatusBadge,
  formatDate,
} from "../../_components/crm-shared";
import { OwnerCombobox } from "../../_components/owner-combobox";
import { TasksTab } from "../../_components/tasks-tab";
import { NotesTab } from "../../_components/notes-tab";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CompanyDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [companyRaw, productions, contacts, members, tasks, notes, currentUser] = await Promise.all([
    getCrmCompany(id),
    getCrmCompanyProductions(id),
    getCrmCompanyContacts(id),
    getOrgMembers(),
    getCrmTasksForEntity("company", id),
    getCrmNotesForEntity("company", id),
    (async () => {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    })(),
  ]);
  if (!companyRaw) notFound();
  const company = companyRaw as { id: string; name: string; type: string; parent_studio_id: string | null; created_at: string; owner_id?: string | null };
  const ownerName = company.owner_id ? (members.find(m => m.id === company.owner_id)?.full_name ?? null) : null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/crm/companies" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ArrowLeft className="h-3 w-3" /> Back to companies
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Building2 className="h-6 w-6" /> {company.name}
            </h1>
            <Badge variant="outline" className="mt-1 text-xs">{company.type}</Badge>
          </div>
          <OwnerCombobox
            entityType="company"
            entityId={id}
            currentOwnerId={company.owner_id ?? null}
            currentOwnerName={ownerName}
            members={members}
          />
        </div>
      </div>

      <Tabs defaultValue="productions">
        <TabsList>
          <TabsTrigger value="productions">Productions ({productions.length})</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({tasks.filter(t => t.status !== "done" && t.status !== "cancelled").length})</TabsTrigger>
          <TabsTrigger value="notes">Notes ({notes.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks">
          <TasksTab entityType="company" entityId={id} tasks={tasks} members={members} currentUserId={currentUser?.id ?? ""} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab entityType="company" entityId={id} notes={notes} />
        </TabsContent>

        <TabsContent value="productions">
          <Card>
            <CardContent className="p-0">
              {productions.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground">No productions linked to this company.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Production</th>
                      <th className="px-4 py-2 text-left">Type</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-left">Start</th>
                      <th className="px-4 py-2 text-left">End</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productions.map(p => (
                      <tr key={p.id} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-2 font-medium">
                          <Link href={`/crm/productions/${p.id}`} className="hover:underline">{p.name}</Link>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{p.production_type ?? "—"}</td>
                        <td className="px-4 py-2"><ProductionStatusBadge status={p.status} /></td>
                        <td className="px-4 py-2 text-muted-foreground">{formatDate(p.start_date)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{formatDate(p.end_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <CardContent className="p-0">
              {contacts.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground">No contacts at this company.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-left">Role</th>
                      <th className="px-4 py-2 text-left">Email</th>
                      <th className="px-4 py-2 text-left">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map(c => (
                      <tr key={c.id} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-2 font-medium">
                          <Link href={`/crm/contacts/${c.id}`} className="hover:underline">{c.name}</Link>
                        </td>
                        <td className="px-4 py-2">{c.role}</td>
                        <td className="px-4 py-2 text-muted-foreground">{c.email ?? "—"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{c.phone ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

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
import {
  ProductionStatusBadge,
  formatDate,
} from "../../_components/crm-shared";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CompanyDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [company, productions, contacts] = await Promise.all([
    getCrmCompany(id),
    getCrmCompanyProductions(id),
    getCrmCompanyContacts(id),
  ]);
  if (!company) notFound();

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/crm/companies" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ArrowLeft className="h-3 w-3" /> Back to companies
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Building2 className="h-6 w-6" /> {company.name}
        </h1>
        <Badge variant="outline" className="mt-1 text-xs">{company.type}</Badge>
      </div>

      <Tabs defaultValue="productions">
        <TabsList>
          <TabsTrigger value="productions">Productions ({productions.length})</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>
        </TabsList>

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

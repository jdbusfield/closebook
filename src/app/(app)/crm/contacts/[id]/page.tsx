import { notFound } from "next/navigation";
import Link from "next/link";
import { User, ArrowLeft, Mail, Phone } from "lucide-react";
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
  getCrmContact,
  getCrmContactProductions,
  getCrmContactOpportunities,
  getCrmContactCommunications,
} from "@/lib/db/queries/crm";
import {
  ProductionStatusBadge,
  OpportunityStatusBadge,
  COMMUNICATION_TYPE_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
  segmentLabel,
} from "../../_components/crm-shared";

interface PageProps { params: Promise<{ id: string }> }

interface ContactRecord {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
  status: string;
  salesperson: string | null;
  avon_source_code: string | null;
  last_contact_date: string | null;
  last_contact_type: string | null;
  company: { id: string; name: string; type: string } | null;
}

export default async function ContactDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [contactRaw, productions, opportunities, communications] = await Promise.all([
    getCrmContact(id),
    getCrmContactProductions(id),
    getCrmContactOpportunities(id),
    getCrmContactCommunications(id),
  ]);
  const contact = contactRaw as unknown as ContactRecord | null;
  if (!contact) notFound();

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/crm/contacts" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ArrowLeft className="h-3 w-3" /> Back to contacts
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <User className="h-6 w-6" /> {contact.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{contact.role}</span>
              {contact.company && (
                <>
                  <span>·</span>
                  <Link href={`/crm/companies/${contact.company.id}`} className="hover:underline">
                    {contact.company.name}
                  </Link>
                </>
              )}
              <Badge variant={contact.status === "active" ? "secondary" : "outline"} className="ml-1 text-xs">
                {contact.status}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-2">
          <div className="flex items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-muted-foreground" />
            {contact.email ? <a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a> : <span className="text-muted-foreground">No email</span>}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4 text-muted-foreground" />
            {contact.phone ? <a href={`tel:${contact.phone}`} className="hover:underline">{contact.phone}</a> : <span className="text-muted-foreground">No phone</span>}
          </div>
          {contact.salesperson && (
            <div className="text-sm"><span className="text-muted-foreground">Salesperson:</span> {contact.salesperson}</div>
          )}
          {contact.avon_source_code && (
            <div className="text-sm"><span className="text-muted-foreground">Avon source code:</span> {contact.avon_source_code}</div>
          )}
          {contact.last_contact_date && (
            <div className="text-sm">
              <span className="text-muted-foreground">Last contact:</span> {formatDate(contact.last_contact_date)}
              {contact.last_contact_type && ` · ${contact.last_contact_type}`}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="productions">
        <TabsList>
          <TabsTrigger value="productions">Productions ({productions.length})</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities ({opportunities.length})</TabsTrigger>
          <TabsTrigger value="communications">Communications ({communications.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="productions">
          <Card>
            <CardContent className="p-0">
              {productions.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground">Not linked to any productions.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Production</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-left">Type</th>
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
                        <td className="px-4 py-2"><ProductionStatusBadge status={p.status} /></td>
                        <td className="px-4 py-2 text-muted-foreground">{p.production_type ?? "—"}</td>
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

        <TabsContent value="opportunities">
          <Card>
            <CardContent className="p-0">
              {opportunities.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground">No opportunities tied to this contact.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Description</th>
                      <th className="px-4 py-2 text-left">Production</th>
                      <th className="px-4 py-2 text-left">Segment</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.map(o => (
                      <tr key={o.id} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-2 font-medium">
                          <Link href={`/crm/opportunities/${o.id}`} className="hover:underline">{o.description}</Link>
                        </td>
                        <td className="px-4 py-2">
                          {o.production ? (
                            <Link href={`/crm/productions/${o.production.id}`} className="hover:underline">{o.production.name}</Link>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{segmentLabel(o.current_segment)}</td>
                        <td className="px-4 py-2"><OpportunityStatusBadge status={o.status} /></td>
                        <td className="px-4 py-2 text-right">{formatMoney(o.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications">
          <Card>
            <CardContent className="space-y-2 p-4">
              {communications.length === 0 ? (
                <p className="text-center text-muted-foreground">No communications logged.</p>
              ) : (
                communications.map(c => (
                  <div key={c.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {COMMUNICATION_TYPE_LABEL[c.type] ?? c.type}
                        {c.production?.name && ` · ${c.production.name}`}
                        {c.commercial_company?.name && ` · ${c.commercial_company.name}`}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDateTime(c.date)}</span>
                    </div>
                    {c.notes && <p className="mt-1 text-sm">{c.notes}</p>}
                    {c.salesperson && <p className="mt-1 text-xs text-muted-foreground">— {c.salesperson}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { Clapperboard, ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
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
  getCrmProduction,
  getCrmProductionContacts,
  getCrmProductionAliases,
  getCrmProductionStatusHistory,
  getCrmProductionOpportunities,
  getCrmProductionCommunications,
} from "@/lib/db/queries/crm";
import {
  getProductionRevenueSummary,
  getProductionRevenueByMonth,
  getProductionInvoices,
  getProductionRwCustomerLinks,
  getProductionExternalCustomerLinks,
} from "@/lib/db/queries/crm-revenue";
import { getOrgMembers } from "@/lib/db/queries/crm-owners";
import { RevenueTab } from "./_components/revenue-tab";
import { OwnerCombobox } from "../../_components/owner-combobox";
import { TasksTab } from "../../_components/tasks-tab";
import { NotesTab } from "../../_components/notes-tab";
import { getCrmTasksForEntity } from "@/lib/db/queries/crm-tasks";
import { getCrmNotesForEntity } from "@/lib/db/queries/crm-notes";
import {
  ProductionStatusBadge,
  OpportunityStatusBadge,
  PRODUCTION_STATUS_LABEL,
  COMMUNICATION_TYPE_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
  segmentLabel,
} from "../../_components/crm-shared";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface ProductionRecord {
  id: string;
  name: string;
  status: string;
  production_type: string | null;
  production_category: string | null;
  start_date: string | null;
  end_date: string | null;
  state: string | null;
  status_changed_at: string | null;
  is_399_production: boolean | null;
  ca_spend_level: number | null;
  avon_customer_number: string | null;
  estimated_trailers_needed: number | null;
  estimated_vehicles_needed: number | null;
  avon_trailers_on_production: number | null;
  avon_vehicles_on_production: number | null;
  avon_vehicle_revenue: number | null;
  avon_trailer_revenue: number | null;
  total_hdr_revenue: number | null;
  location_services_revenue: number | null;
  honeywagon_revenue: number | null;
  bathroom_trailer_revenue: number | null;
  power_distribution_revenue: number | null;
  camera_trucks_revenue: number | null;
  production_trucks_revenue: number | null;
  ac_equipment_revenue: number | null;
  production_supplies_revenue: number | null;
  grip_lighting_revenue: number | null;
  rental_opportunities: string[] | null;
  rental_vehicles_vendor: string | null;
  rental_trailers_vendor: string | null;
  honeywagon_vendor: string | null;
  location_services_vendor: string | null;
  power_distribution_vendor: string | null;
  camera_trucks_vendor: string | null;
  production_trucks_vendor: string | null;
  ac_equipment_vendor: string | null;
  production_supplies_vendor: string | null;
  grip_lighting_vendor: string | null;
  date_first_appearing_on_report: string | null;
  created_at: string;
  company: { id: string; name: string; type: string } | null;
  studio: { id: string; name: string; type: string } | null;
  primary_transportation_contact: { id: string; name: string; role: string; email: string | null; phone: string | null } | null;
  primary_locations_contact: { id: string; name: string; role: string; email: string | null; phone: string | null } | null;
  owner_id: string | null;
  owner: { id: string; full_name: string } | null;
}

const VENDOR_CATEGORIES: Array<{ label: string; vendor: keyof ProductionRecord; revenue: keyof ProductionRecord }> = [
  { label: "Rental Vehicles", vendor: "rental_vehicles_vendor", revenue: "avon_vehicle_revenue" },
  { label: "Rental Trailers", vendor: "rental_trailers_vendor", revenue: "avon_trailer_revenue" },
  { label: "Honeywagon", vendor: "honeywagon_vendor", revenue: "honeywagon_revenue" },
  { label: "Location Services", vendor: "location_services_vendor", revenue: "location_services_revenue" },
  { label: "Power Distribution", vendor: "power_distribution_vendor", revenue: "power_distribution_revenue" },
  { label: "Camera Trucks", vendor: "camera_trucks_vendor", revenue: "camera_trucks_revenue" },
  { label: "Production Trucks", vendor: "production_trucks_vendor", revenue: "production_trucks_revenue" },
  { label: "A/C Equipment", vendor: "ac_equipment_vendor", revenue: "ac_equipment_revenue" },
  { label: "Production Supplies", vendor: "production_supplies_vendor", revenue: "production_supplies_revenue" },
  { label: "Grip & Lighting", vendor: "grip_lighting_vendor", revenue: "grip_lighting_revenue" },
];

function vendorLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default async function ProductionDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [
    productionRaw, contacts, aliases, statusHistory, opportunities, communications,
    revenueSummary, revenueMonthly, revenueInvoices, rwLinks, externalLinks,
    members, tasks, notes, currentUser,
  ] = await Promise.all([
    getCrmProduction(id),
    getCrmProductionContacts(id),
    getCrmProductionAliases(id),
    getCrmProductionStatusHistory(id),
    getCrmProductionOpportunities(id),
    getCrmProductionCommunications(id),
    getProductionRevenueSummary(id),
    getProductionRevenueByMonth(id, 12),
    getProductionInvoices(id),
    getProductionRwCustomerLinks(id),
    getProductionExternalCustomerLinks(id),
    getOrgMembers(),
    getCrmTasksForEntity("production", id),
    getCrmNotesForEntity("production", id),
    (async () => {
      const { createClient } = await import("@/lib/supabase/server");
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    })(),
  ]);
  const production = productionRaw as unknown as ProductionRecord | null;
  if (!production) notFound();
  const ownerName = production.owner_id ? (members.find(m => m.id === production.owner_id)?.full_name ?? null) : null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/crm/productions" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ArrowLeft className="h-3 w-3" /> Back to productions
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Clapperboard className="h-6 w-6" /> {production.name}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <ProductionStatusBadge status={production.status} />
              {production.is_399_production && <Badge variant="outline" className="text-xs">399</Badge>}
              {production.production_type && (
                <span className="text-sm text-muted-foreground">{production.production_type}</span>
              )}
              {production.state && (
                <span className="text-sm text-muted-foreground">· {production.state}</span>
              )}
            </div>
          </div>
          <OwnerCombobox
            entityType="production"
            entityId={id}
            currentOwnerId={production.owner_id}
            currentOwnerName={ownerName}
            members={members}
          />
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="revenue">Revenue ({revenueSummary.invoice_count})</TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({tasks.filter(t => t.status !== "done" && t.status !== "cancelled").length})</TabsTrigger>
          <TabsTrigger value="notes">Notes ({notes.length})</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>
          <TabsTrigger value="communications">Communications ({communications.length})</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities ({opportunities.length})</TabsTrigger>
          <TabsTrigger value="history">Status History ({statusHistory.length})</TabsTrigger>
          <TabsTrigger value="aliases">Aliases ({aliases.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue">
          <RevenueTab
            productionId={id}
            initialSummary={revenueSummary}
            initialMonthly={revenueMonthly}
            initialInvoices={revenueInvoices}
            initialRwLinks={rwLinks}
            initialExternalLinks={externalLinks}
          />
        </TabsContent>

        <TabsContent value="tasks">
          <TasksTab
            entityType="production"
            entityId={id}
            tasks={tasks}
            members={members}
            currentUserId={currentUser?.id ?? ""}
          />
        </TabsContent>

        <TabsContent value="notes">
          <NotesTab entityType="production" entityId={id} notes={notes} />
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Production details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-y-3 text-sm">
                  <dt className="text-muted-foreground">Production company</dt>
                  <dd>
                    {production.company ? (
                      <Link href={`/crm/companies/${production.company.id}`} className="hover:underline">
                        {production.company.name}
                      </Link>
                    ) : "—"}
                  </dd>
                  <dt className="text-muted-foreground">Studio</dt>
                  <dd>
                    {production.studio ? (
                      <Link href={`/crm/companies/${production.studio.id}`} className="hover:underline">
                        {production.studio.name}
                      </Link>
                    ) : "—"}
                  </dd>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd>{production.production_type ?? "—"}</dd>
                  <dt className="text-muted-foreground">Category</dt>
                  <dd>{production.production_category ?? "—"}</dd>
                  <dt className="text-muted-foreground">Start date</dt>
                  <dd>{formatDate(production.start_date)}</dd>
                  <dt className="text-muted-foreground">End date</dt>
                  <dd>{formatDate(production.end_date)}</dd>
                  <dt className="text-muted-foreground">State</dt>
                  <dd>{production.state ?? "—"}</dd>
                  <dt className="text-muted-foreground">Avon customer #</dt>
                  <dd>{production.avon_customer_number ?? "—"}</dd>
                  <dt className="text-muted-foreground">CA spend level</dt>
                  <dd>{production.ca_spend_level ?? "—"}</dd>
                  <dt className="text-muted-foreground">First on report</dt>
                  <dd>{formatDate(production.date_first_appearing_on_report)}</dd>
                  <dt className="text-muted-foreground">Status changed</dt>
                  <dd>{formatDate(production.status_changed_at)}</dd>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Estimates & revenue</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-y-3 text-sm">
                  <dt className="text-muted-foreground">Est. trailers needed</dt>
                  <dd>{production.estimated_trailers_needed ?? "—"}</dd>
                  <dt className="text-muted-foreground">Est. vehicles needed</dt>
                  <dd>{production.estimated_vehicles_needed ?? "—"}</dd>
                  <dt className="text-muted-foreground">Avon trailers on prod.</dt>
                  <dd>{production.avon_trailers_on_production ?? "—"}</dd>
                  <dt className="text-muted-foreground">Avon vehicles on prod.</dt>
                  <dd>{production.avon_vehicles_on_production ?? "—"}</dd>
                  <dt className="text-muted-foreground">Avon vehicle revenue</dt>
                  <dd>{formatMoney(production.avon_vehicle_revenue)}</dd>
                  <dt className="text-muted-foreground">Avon trailer revenue</dt>
                  <dd>{formatMoney(production.avon_trailer_revenue)}</dd>
                  <dt className="text-muted-foreground">Total HDR revenue</dt>
                  <dd>{formatMoney(production.total_hdr_revenue)}</dd>
                </dl>
              </CardContent>
            </Card>
          </div>

          {production.rental_opportunities && production.rental_opportunities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Rental opportunities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {production.rental_opportunities.map(opp => (
                    <Badge key={opp} variant="secondary">{segmentLabel(opp)}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Vendor matrix</CardTitle>
              <CardDescription>Who supplies each service category for this production</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Category</th>
                    <th className="px-4 py-2 text-left">Vendor</th>
                    <th className="px-4 py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {VENDOR_CATEGORIES.map(({ label, vendor, revenue }) => {
                    const vendorVal = production[vendor] as string | null;
                    const revenueVal = production[revenue] as number | null;
                    if (!vendorVal && !revenueVal) return null;
                    return (
                      <tr key={label} className="border-t">
                        <td className="px-4 py-2 font-medium">{label}</td>
                        <td className="px-4 py-2 text-muted-foreground">{vendorLabel(vendorVal)}</td>
                        <td className="px-4 py-2 text-right">{formatMoney(revenueVal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {(production.primary_transportation_contact || production.primary_locations_contact) && (
            <Card>
              <CardHeader>
                <CardTitle>Primary contacts</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {production.primary_transportation_contact && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Transportation</p>
                    <Link href={`/crm/contacts/${production.primary_transportation_contact.id}`} className="text-sm font-medium hover:underline">
                      {production.primary_transportation_contact.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{production.primary_transportation_contact.role}</p>
                  </div>
                )}
                {production.primary_locations_contact && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Locations</p>
                    <Link href={`/crm/contacts/${production.primary_locations_contact.id}`} className="text-sm font-medium hover:underline">
                      {production.primary_locations_contact.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{production.primary_locations_contact.role}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <CardContent className="p-0">
              {contacts.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground">No contacts linked to this production.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-left">Role</th>
                      <th className="px-4 py-2 text-left">Email</th>
                      <th className="px-4 py-2 text-left">Phone</th>
                      <th className="px-4 py-2 text-left">Salesperson</th>
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
                        <td className="px-4 py-2 text-muted-foreground">{c.salesperson ?? "—"}</td>
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
                        {c.contact?.name ? ` · ${c.contact.name}` : ""}
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

        <TabsContent value="opportunities">
          <Card>
            <CardContent className="p-0">
              {opportunities.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground">No opportunities on this production.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Description</th>
                      <th className="px-4 py-2 text-left">Segment</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2 text-left">Salesperson</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.map(o => (
                      <tr key={o.id} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-2 font-medium">
                          <Link href={`/crm/opportunities/${o.id}`} className="hover:underline">
                            {o.description}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{segmentLabel(o.current_segment)}</td>
                        <td className="px-4 py-2"><OpportunityStatusBadge status={o.status} /></td>
                        <td className="px-4 py-2 text-right">{formatMoney(o.amount)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{o.salesperson ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="space-y-2 p-4">
              {statusHistory.length === 0 ? (
                <p className="text-center text-muted-foreground">No status changes recorded.</p>
              ) : (
                statusHistory.map(h => (
                  <div key={h.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      {h.old_status && (
                        <>
                          <Badge variant="outline">{PRODUCTION_STATUS_LABEL[h.old_status] ?? h.old_status}</Badge>
                          <span className="text-muted-foreground">→</span>
                        </>
                      )}
                      <ProductionStatusBadge status={h.new_status} />
                      {h.notes && <span className="text-muted-foreground">· {h.notes}</span>}
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDateTime(h.changed_at)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aliases">
          <Card>
            <CardContent className="space-y-2 p-4">
              {aliases.length === 0 ? (
                <p className="text-center text-muted-foreground">No aliases recorded. Add a working title when this production was known by another name.</p>
              ) : (
                aliases.map(a => (
                  <div key={a.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <span className="font-medium">{a.alias_name}</span>
                    <span className="text-xs text-muted-foreground">added {formatDate(a.created_at)}</span>
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

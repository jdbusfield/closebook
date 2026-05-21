import Link from "next/link";
import {
  Clapperboard,
  Building2,
  Users,
  Briefcase,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getCrmStatusCounts,
  getCrmContactCount,
  getCrmCompanyCount,
  getCrmOpportunityCount,
  getCrmCommunications,
  getCrmOpportunities,
} from "@/lib/db/queries/crm";
import {
  PRODUCTION_STATUS_ORDER,
  PRODUCTION_STATUS_LABEL,
  ProductionStatusBadge,
  OpportunityStatusBadge,
  formatDate,
  formatMoney,
  COMMUNICATION_TYPE_LABEL,
} from "./_components/crm-shared";

const PIPELINE_BADGE: Record<string, string> = {
  "pre-prepping": "bg-slate-100 text-slate-700",
  prepping: "bg-amber-100 text-amber-800",
  shooting: "bg-emerald-100 text-emerald-800",
  reshoots: "bg-sky-100 text-sky-800",
  wrapping: "bg-purple-100 text-purple-800",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-rose-100 text-rose-700",
  archived: "bg-slate-200 text-slate-500",
};

export default async function CrmDashboardPage() {
  const [statusCounts, contactCount, companyCount, openOppCount, recentComms, recentOpps] = await Promise.all([
    getCrmStatusCounts(),
    getCrmContactCount(),
    getCrmCompanyCount(),
    getCrmOpportunityCount({ status: "open" }),
    getCrmCommunications({}).then(rows => rows.slice(0, 8)),
    getCrmOpportunities({}).then(rows => rows.slice(0, 6)),
  ]);

  const totalProductions = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const activeProductions = PRODUCTION_STATUS_ORDER
    .filter(s => s !== "completed" && s !== "archived" && s !== "cancelled")
    .reduce((sum, s) => sum + (statusCounts[s] ?? 0), 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Clapperboard className="h-6 w-6" /> CRM
          </h1>
          <p className="text-sm text-muted-foreground">
            Productions, contacts, opportunities, and communications across all reporting entities.
          </p>
        </div>
      </div>

      {/* Quick-jump tiles */}
      <div className="grid gap-4 md:grid-cols-4">
        <Link href="/crm/productions" className="group">
          <Card className="transition hover:border-primary">
            <CardHeader className="pb-2">
              <CardDescription>Active productions</CardDescription>
              <CardTitle className="text-3xl">{activeProductions}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{totalProductions} total</span>
              <ArrowRight className="h-3 w-3 transition group-hover:translate-x-1" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/crm/contacts" className="group">
          <Card className="transition hover:border-primary">
            <CardHeader className="pb-2">
              <CardDescription>Contacts</CardDescription>
              <CardTitle className="text-3xl">{contactCount}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
              <span><Users className="mr-1 inline h-3 w-3" /> All contacts</span>
              <ArrowRight className="h-3 w-3 transition group-hover:translate-x-1" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/crm/companies" className="group">
          <Card className="transition hover:border-primary">
            <CardHeader className="pb-2">
              <CardDescription>Companies & Studios</CardDescription>
              <CardTitle className="text-3xl">{companyCount}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
              <span><Building2 className="mr-1 inline h-3 w-3" /> Production cos + studios</span>
              <ArrowRight className="h-3 w-3 transition group-hover:translate-x-1" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/crm/opportunities" className="group">
          <Card className="transition hover:border-primary">
            <CardHeader className="pb-2">
              <CardDescription>Open opportunities</CardDescription>
              <CardTitle className="text-3xl">{openOppCount}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
              <span><Briefcase className="mr-1 inline h-3 w-3" /> Pipeline</span>
              <ArrowRight className="h-3 w-3 transition group-hover:translate-x-1" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Production pipeline</CardTitle>
            <CardDescription>Counts by status across all productions</CardDescription>
          </div>
          <Link href="/crm/clients" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
            Open Clients board →
          </Link>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {PRODUCTION_STATUS_ORDER.map(status => (
              <Link
                key={status}
                href={`/crm/productions?status=${status}`}
                className="inline-block"
              >
                <Badge className={`${PIPELINE_BADGE[status]} cursor-pointer px-3 py-1 hover:opacity-80`} variant="secondary">
                  {PRODUCTION_STATUS_LABEL[status]}: {statusCounts[status] ?? 0}
                </Badge>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>Recent opportunities</CardTitle>
              <CardDescription>Most recent across all segments</CardDescription>
            </div>
            <Link href="/crm/opportunities" className="text-xs text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentOpps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No opportunities yet.</p>
            ) : (
              recentOpps.map(o => (
                <Link
                  key={o.id}
                  href={`/crm/opportunities/${o.id}`}
                  className="block rounded-md border p-3 hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{o.description}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {o.production?.name ?? "—"} · {o.contact?.name ?? "—"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <OpportunityStatusBadge status={o.status} />
                      <span className="text-xs text-muted-foreground">{formatMoney(o.amount)}</span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>Recent communications</CardTitle>
              <CardDescription>Activity feed across the CRM</CardDescription>
            </div>
            <Link href="/crm/communications" className="text-xs text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentComms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No communications yet.</p>
            ) : (
              recentComms.map(c => (
                <div key={c.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {COMMUNICATION_TYPE_LABEL[c.type] ?? c.type}
                      {c.contact?.name ? ` · ${c.contact.name}` : ""}
                    </p>
                    {c.notes && <p className="line-clamp-2 text-sm">{c.notes}</p>}
                    {(c.production?.name || c.commercial_company?.name) && (
                      <p className="text-xs text-muted-foreground">
                        {c.production?.name ?? c.commercial_company?.name}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end whitespace-nowrap">
                    <MessageSquare className="h-3 w-3 text-muted-foreground" />
                    <span className="mt-1 text-xs text-muted-foreground">{formatDate(c.date)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

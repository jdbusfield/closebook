import Link from "next/link";
import { Briefcase } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCrmOpportunities } from "@/lib/db/queries/crm";
import {
  OpportunityStatusBadge,
  PriorityBadge,
  OPPORTUNITY_SEGMENTS,
  segmentLabel,
  formatDate,
  formatMoney,
  OPPORTUNITY_STATUS_LABEL,
} from "../_components/crm-shared";

interface PageProps {
  searchParams: Promise<{ status?: string; segment?: string; priority?: string }>;
}

const STATUS_VALUES = ["open", "reservation_made", "won", "lost"] as const;
const PRIORITY_VALUES = ["high", "medium", "low"] as const;

export default async function OpportunitiesListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const opportunities = await getCrmOpportunities({
    status: sp.status,
    segment: sp.segment,
    priority: sp.priority,
  });
  const totalAmount = opportunities.reduce((sum, o) => sum + (o.amount ?? 0), 0);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Briefcase className="h-6 w-6" /> Opportunities
        </h1>
        <p className="text-sm text-muted-foreground">
          {opportunities.length} opportunities · {formatMoney(totalAmount)} pipeline
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardDescription>Filters</CardDescription>
          <form className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
              <select name="status" defaultValue={sp.status ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
                <option value="">All</option>
                {STATUS_VALUES.map(s => <option key={s} value={s}>{OPPORTUNITY_STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Segment</label>
              <select name="segment" defaultValue={sp.segment ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
                <option value="">All</option>
                {OPPORTUNITY_SEGMENTS.map(s => <option key={s} value={s}>{segmentLabel(s)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Priority</label>
              <select name="priority" defaultValue={sp.priority ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
                <option value="">All</option>
                {PRIORITY_VALUES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <Button type="submit" size="sm">Apply</Button>
            {(sp.status || sp.segment || sp.priority) && (
              <Button asChild type="button" variant="ghost" size="sm">
                <Link href="/crm/opportunities">Clear</Link>
              </Button>
            )}
          </form>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Description</th>
                  <th className="px-4 py-2 text-left">Production</th>
                  <th className="px-4 py-2 text-left">Contact</th>
                  <th className="px-4 py-2 text-left">Segment</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Priority</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-left">Salesperson</th>
                  <th className="px-4 py-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No opportunities match those filters.</td></tr>
                ) : (
                  opportunities.map(o => (
                    <tr key={o.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/crm/opportunities/${o.id}`} className="hover:underline">{o.description}</Link>
                      </td>
                      <td className="px-4 py-2">
                        {o.production ? (
                          <Link href={`/crm/productions/${o.production.id}`} className="text-muted-foreground hover:underline">{o.production.name}</Link>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        {o.contact ? (
                          <Link href={`/crm/contacts/${o.contact.id}`} className="text-muted-foreground hover:underline">{o.contact.name}</Link>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{segmentLabel(o.current_segment)}</td>
                      <td className="px-4 py-2"><OpportunityStatusBadge status={o.status} /></td>
                      <td className="px-4 py-2"><PriorityBadge priority={o.priority} /></td>
                      <td className="px-4 py-2 text-right">{formatMoney(o.amount)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{o.salesperson ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{formatDate(o.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCrmCommunications } from "@/lib/db/queries/crm";
import {
  COMMUNICATION_TYPE_LABEL,
  formatDateTime,
} from "../_components/crm-shared";

interface PageProps {
  searchParams: Promise<{ type?: string; from?: string; to?: string; salesperson?: string }>;
}

const COMM_TYPES = ["call", "email", "meeting", "text", "other"];

export default async function CommunicationsListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const communications = await getCrmCommunications({
    type: sp.type,
    from: sp.from || undefined,
    to: sp.to || undefined,
    salesperson: sp.salesperson || undefined,
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <MessageSquare className="h-6 w-6" /> Communications
        </h1>
        <p className="text-sm text-muted-foreground">{communications.length} entries (last 500 shown)</p>
      </div>

      <Card>
        <CardHeader>
          <CardDescription>Filters</CardDescription>
          <form className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
              <select name="type" defaultValue={sp.type ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
                <option value="">All</option>
                {COMM_TYPES.map(t => <option key={t} value={t}>{COMMUNICATION_TYPE_LABEL[t] ?? t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">From date</label>
              <input type="date" name="from" defaultValue={sp.from ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">To date</label>
              <input type="date" name="to" defaultValue={sp.to ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Salesperson</label>
              <input name="salesperson" defaultValue={sp.salesperson ?? ""} placeholder="exact match" className="h-9 rounded-md border bg-background px-3 text-sm" />
            </div>
            <Button type="submit" size="sm">Apply</Button>
            {(sp.type || sp.from || sp.to || sp.salesperson) && (
              <Button asChild type="button" variant="ghost" size="sm">
                <Link href="/crm/communications">Clear</Link>
              </Button>
            )}
          </form>
        </CardHeader>
        <CardContent className="space-y-2 p-4">
          {communications.length === 0 ? (
            <p className="text-center text-muted-foreground">No communications match those filters.</p>
          ) : (
            communications.map(c => (
              <div key={c.id} className="rounded-md border p-3 hover:bg-muted/30">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {COMMUNICATION_TYPE_LABEL[c.type] ?? c.type}
                    {c.contact?.name && (
                      <> · <Link href={`/crm/contacts/${c.contact.id}`} className="text-foreground hover:underline">{c.contact.name}</Link></>
                    )}
                    {c.production?.name && (
                      <> · <Link href={`/crm/productions/${c.production.id}`} className="text-foreground hover:underline">{c.production.name}</Link></>
                    )}
                    {c.commercial_company?.name && (
                      <> · <Link href={`/crm/commercial-companies/${c.commercial_company.id}`} className="text-foreground hover:underline">{c.commercial_company.name}</Link></>
                    )}
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(c.date)}</span>
                </div>
                {c.notes && <p className="mt-1 text-sm">{c.notes}</p>}
                {c.salesperson && <p className="mt-1 text-xs text-muted-foreground">— {c.salesperson}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

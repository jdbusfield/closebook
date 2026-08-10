import Link from "next/link";
import { Handshake, Flag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getDiligenceDeals } from "@/lib/db/queries/diligence";
import { DealStageBadge, formatDate } from "./_components/diligence-shared";
import { NewDealDialog } from "./_components/new-deal-dialog";

export const dynamic = "force-dynamic";

export default async function DiligencePage() {
  const deals = await getDiligenceDeals();
  const active = deals.filter(d => !["closed", "passed"].includes(d.stage));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Handshake className="h-6 w-6" /> Diligence Tracker
          </h1>
          <p className="text-sm text-muted-foreground">
            {deals.length} {deals.length === 1 ? "deal" : "deals"} · {active.length} active
          </p>
        </div>
        <NewDealDialog />
      </div>

      <Card>
        <CardContent className="p-0">
          {deals.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground">
              No deals yet. Create one to start a diligence checklist.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Deal</th>
                  <th className="px-4 py-2 text-left">Counterparty</th>
                  <th className="px-4 py-2 text-left">Stage</th>
                  <th className="px-4 py-2 text-left">Progress</th>
                  <th className="px-4 py-2 text-left">Red Flags</th>
                  <th className="px-4 py-2 text-left">Target Close</th>
                  <th className="px-4 py-2 text-left">Updated</th>
                </tr>
              </thead>
              <tbody>
                {deals.map(deal => {
                  const pct = deal.progress.total
                    ? Math.round((deal.progress.complete / deal.progress.total) * 100)
                    : 0;
                  return (
                    <tr key={deal.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/diligence/${deal.id}`} className="hover:underline">
                          {deal.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{deal.counterparty ?? "—"}</td>
                      <td className="px-4 py-2"><DealStageBadge stage={deal.stage} /></td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {deal.progress.complete}/{deal.progress.total}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {deal.progress.redFlags > 0 ? (
                          <span className="inline-flex items-center gap-1 text-rose-600">
                            <Flag className="h-3.5 w-3.5" /> {deal.progress.redFlags}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">{formatDate(deal.target_close_date)}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(deal.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

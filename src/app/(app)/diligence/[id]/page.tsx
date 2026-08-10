import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Flag, CircleAlert, ListChecks } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getDiligenceDeal, getDiligenceItems, summarizeItems } from "@/lib/db/queries/diligence";
import { DealStageBadge, formatDate } from "../_components/diligence-shared";
import { DealHeaderControls } from "../_components/deal-header-controls";
import { Checklist } from "../_components/checklist";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DealDetailPage({ params }: PageProps) {
  const { id } = await params;
  const deal = await getDiligenceDeal(id);
  if (!deal) notFound();
  const items = await getDiligenceItems(id);
  const progress = summarizeItems(items);
  const pct = progress.total ? Math.round((progress.complete / progress.total) * 100) : 0;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/diligence" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All deals
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-semibold">
              {deal.name} <DealStageBadge stage={deal.stage} />
            </h1>
            <p className="text-sm text-muted-foreground">
              {deal.counterparty && <>{deal.counterparty} · </>}
              {deal.deal_type.replace(/_/g, " ")}
              {deal.target_close_date && <> · target close {formatDate(deal.target_close_date)}</>}
            </p>
            {deal.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{deal.description}</p>}
          </div>
          <DealHeaderControls dealId={deal.id} stage={deal.stage} dealName={deal.name} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ListChecks className="h-8 w-8 text-emerald-600" />
            <div>
              <p className="text-2xl font-semibold">{pct}%</p>
              <p className="text-xs text-muted-foreground">{progress.complete} of {progress.total} items complete</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Flag className="h-8 w-8 text-rose-600" />
            <div>
              <p className="text-2xl font-semibold">{progress.redFlags}</p>
              <p className="text-xs text-muted-foreground">red flags raised</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CircleAlert className="h-8 w-8 text-amber-600" />
            <div>
              <p className="text-2xl font-semibold">{progress.openFollowUps}</p>
              <p className="text-xs text-muted-foreground">open follow-ups</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Checklist dealId={deal.id} items={items} />
    </div>
  );
}

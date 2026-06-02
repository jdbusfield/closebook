"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import RevenueProjectionPage from "@/app/(app)/[entityId]/revenue-projection/page";
import { SILVERCO_REVENUE_FILTER } from "@/lib/utils/revenue-projection";

function EmbedInner({
  entityId,
  entityLabel,
}: {
  entityId: string;
  entityLabel: string;
}) {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || undefined;
  return (
    <RevenueProjectionPage
      entityId={entityId}
      isEmbed
      defaultTab={tab}
      revenueFilter={SILVERCO_REVENUE_FILTER}
      entityLabel={entityLabel}
    />
  );
}

export default function RevenueProjectionEmbed({
  entityId,
  entityLabel,
}: {
  entityId: string;
  entityLabel: string;
}) {
  return (
    <Suspense>
      <EmbedInner entityId={entityId} entityLabel={entityLabel} />
    </Suspense>
  );
}

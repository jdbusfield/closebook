"use client";

// Inquiries → AI Price Table. HDR only (see section-tabs.tsx and
// nav-config.ts): the rates the AI callback agent quotes restroom trailers from.

import { useParams } from "next/navigation";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { AiPriceTable } from "@/components/inquiries/ai-price-table";

export default function InquiriesAiPricingPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Price Table</h1>
        <p className="text-sm text-muted-foreground">
          What the AI callback agent quotes for restroom trailers
        </p>
      </div>
      <SectionTabs entityId={entityId} />
      <AiPriceTable entityId={entityId} />
    </div>
  );
}

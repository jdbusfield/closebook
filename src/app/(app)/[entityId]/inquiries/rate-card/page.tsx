"use client";

// Inquiries → Rate Card. Currently only meaningful for the Silverco entity
// (Avon Trucks) — see nav-config.ts, which only surfaces this tab for that
// entity — but reads by entityId like every other Inquiries view so nothing
// here is Avon-specific.

import { useParams } from "next/navigation";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { FleetRateCard } from "@/components/inquiries/fleet-rate-card";

export default function InquiriesRateCardPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rate card</h1>
        <p className="text-sm text-muted-foreground">
          Day / week / month rates and photos, live on the website
        </p>
      </div>
      <SectionTabs entityId={entityId} />
      <FleetRateCard entityId={entityId} />
    </div>
  );
}

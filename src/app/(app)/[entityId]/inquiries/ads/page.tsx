"use client";

import { useParams } from "next/navigation";
import { useInquiries } from "@/lib/inquiries/use-inquiries";
import { useAdPlatform } from "@/lib/inquiries/use-ad-platform";
import { useAdSpend } from "@/lib/inquiries/use-ad-spend";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { AdsReport } from "@/components/inquiries/ads-report";
import { EmailHealth } from "@/components/inquiries/email-health";
import { HDR_ENTITY_ID, isOpenStatus } from "@/lib/inquiries/shared";
import { useEmbed } from "@/lib/inquiries/embed-context";
import { RestroomAdRoi } from "@/components/inquiries/restroom-ad-roi";

// Ads tab: spend and results for every paid platform, joined to the pipeline.
export default function InquiriesAdsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const data = useInquiries(entityId);
  const ads = useAdPlatform(entityId);
  const manual = useAdSpend(entityId);
  const embed = useEmbed();
  const openCount = data.inquiries.filter((i) => isOpenStatus(i.status)).length;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ads</h1>
        <p className="text-sm text-muted-foreground">
          What Meta, Google Ads and ChatGPT Ads cost, and what each one turned into in the pipeline.
        </p>
      </div>
      <SectionTabs entityId={entityId} openCount={openCount} />
      {data.loading || ads.loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading ad data…</div>
      ) : (
        <AdsReport inquiries={data.inquiries} ads={ads} manualSpend={manual.rows} entityId={entityId} />
      )}
      {/* Restroom ad ROI reads QuickBooks, so it needs a signed-in session (not the embed). */}
      {entityId === HDR_ENTITY_ID && !embed?.embedKey && !data.loading && (
        <RestroomAdRoi entityId={entityId} inquiries={data.inquiries} />
      )}
      {/* Email deliverability: renders nothing for entities without a mapped sending domain. */}
      <EmailHealth entityId={entityId} />
    </div>
  );
}

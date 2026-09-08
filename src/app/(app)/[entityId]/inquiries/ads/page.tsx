"use client";

import { useParams } from "next/navigation";
import { useInquiries } from "@/lib/inquiries/use-inquiries";
import { useAdPlatform } from "@/lib/inquiries/use-ad-platform";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { AdsReport } from "@/components/inquiries/ads-report";
import { isOpenStatus } from "@/lib/inquiries/shared";

// Ads tab: spend and results for every paid platform, joined to the pipeline.
export default function InquiriesAdsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const data = useInquiries(entityId);
  const ads = useAdPlatform(entityId);
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
        <AdsReport inquiries={data.inquiries} ads={ads} />
      )}
    </div>
  );
}

"use client";

import CustomerDetailPage from "@/app/(app)/[entityId]/rebates/[customerId]/page";

export default function RebateCustomerDetailEmbed({
  entityId,
  customerId,
  embedKey,
}: {
  entityId: string;
  customerId: string;
  embedKey: string;
}) {
  return (
    <CustomerDetailPage
      entityId={entityId}
      customerId={customerId}
      isEmbed
      embedKey={embedKey}
    />
  );
}

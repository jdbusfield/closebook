import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import RebateCustomerDetailEmbed from "./embed-client";

export default async function VersatileRebateCustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const supabase = createAdminClient();

  // Resolve Versatile entity
  const { data: entities } = await supabase
    .from("entities")
    .select("id, name")
    .ilike("name", "%versatile%")
    .eq("is_active", true)
    .limit(1);

  const versatile = entities?.[0];
  if (!versatile) {
    redirect("/login");
  }

  // Confirm the requested customer belongs to Versatile — otherwise this
  // route would expose other entities' rebate customers via the embed key.
  const { data: customer } = await supabase
    .from("rebate_customers")
    .select("id")
    .eq("id", customerId)
    .eq("entity_id", versatile.id)
    .single();

  if (!customer) {
    redirect("/embed/versatile/rebates");
  }

  return (
    <RebateCustomerDetailEmbed
      entityId={versatile.id}
      customerId={customerId}
      embedKey={process.env.EMBED_API_KEY || ""}
    />
  );
}

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import RevenueProjectionEmbed from "./embed-client";

export default async function SilvercoRevenueProjectionPage() {
  const supabase = createAdminClient();
  const { data: entities } = await supabase
    .from("entities")
    .select("id, name")
    .ilike("name", "%silverco%")
    .eq("is_active", true)
    .limit(1);

  const silverco = entities?.[0];
  if (!silverco) {
    redirect("/login");
  }

  return (
    <RevenueProjectionEmbed entityId={silverco.id} entityLabel={silverco.name} />
  );
}

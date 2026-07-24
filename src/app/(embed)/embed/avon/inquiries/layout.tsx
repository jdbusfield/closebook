import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { SILVERCO_ENTITY_ID } from "@/lib/inquiries/shared";
import { EmbedProvider } from "@/lib/inquiries/embed-context";

export const dynamic = "force-dynamic";

// Wraps the full Avon (Silverco entity) inquiries CRM for embedding into the
// avon-trucks admin portal iframe. Mirrors the HDR/Versatile embeds: provides
// the embed context — the Silverco entity id, the Avon embed key, and the
// in-section URL base — so the reused app pages/hooks take their
// key-authenticated, Avon-scoped data path instead of the (absent) Supabase
// session. There is no login here: the static EMBED_API_KEY_AVON is the
// credential, and CSP `frame-ancestors` restricts which sites may frame it.
export default async function AvonInquiriesEmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const embedKey = process.env.EMBED_API_KEY_AVON || "";
  // Defensive: make sure the Silverco entity actually exists before exposing the UI.
  const admin = createAdminClient();
  const { data: entity } = await admin
    .from("entities")
    .select("id")
    .eq("id", SILVERCO_ENTITY_ID)
    .maybeSingle();
  if (!entity) redirect("/login");

  return (
    <EmbedProvider
      value={{
        entityId: SILVERCO_ENTITY_ID,
        embedKey,
        basePath: "/embed/avon/inquiries",
      }}
    >
      {children}
    </EmbedProvider>
  );
}

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { VERSATILE_ENTITY_ID } from "@/lib/inquiries/shared";
import { EmbedProvider } from "@/lib/inquiries/embed-context";

export const dynamic = "force-dynamic";

// Wraps the full Versatile inquiries CRM for embedding into the Versatile admin
// portal iframe. Mirrors the HDR embed: provides the embed context — the Versatile
// entity id, the Versatile embed key, and the in-section URL base — so the reused
// app pages/hooks take their key-authenticated, Versatile-scoped data path instead
// of the (absent) Supabase session. There is no login here: the static
// EMBED_API_KEY_VERSATILE is the credential, and CSP `frame-ancestors` restricts
// which sites may frame it.
export default async function VersatileInquiriesEmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const embedKey = process.env.EMBED_API_KEY_VERSATILE || "";
  // Defensive: make sure the Versatile entity actually exists before exposing the UI.
  const admin = createAdminClient();
  const { data: entity } = await admin
    .from("entities")
    .select("id")
    .eq("id", VERSATILE_ENTITY_ID)
    .maybeSingle();
  if (!entity) redirect("/login");

  return (
    <EmbedProvider
      value={{
        entityId: VERSATILE_ENTITY_ID,
        embedKey,
        basePath: "/embed/versatile/inquiries",
      }}
    >
      {children}
    </EmbedProvider>
  );
}

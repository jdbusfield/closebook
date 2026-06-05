import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { HDR_ENTITY_ID } from "@/lib/inquiries/shared";
import { EmbedProvider } from "@/lib/inquiries/embed-context";

export const dynamic = "force-dynamic";

// Wraps the full HDR inquiries CRM for embedding into an external site (the HDR
// admin portal iframe). Provides the embed context — the HDR entity id, the
// EMBED_API_KEY, and the in-section URL base — so the reused app pages/hooks take
// their key-authenticated, HDR-scoped data path instead of the (absent) Supabase
// session. There is no login here: the static EMBED_API_KEY is the credential,
// and CSP `frame-ancestors` restricts which sites may frame it.
export default async function HdrInquiriesEmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const embedKey = process.env.EMBED_API_KEY || "";
  // Defensive: make sure the HDR entity actually exists before exposing the UI.
  const admin = createAdminClient();
  const { data: entity } = await admin
    .from("entities")
    .select("id")
    .eq("id", HDR_ENTITY_ID)
    .maybeSingle();
  if (!entity) redirect("/login");

  return (
    <EmbedProvider
      value={{
        entityId: HDR_ENTITY_ID,
        embedKey,
        basePath: "/embed/hdr/inquiries",
      }}
    >
      {children}
    </EmbedProvider>
  );
}

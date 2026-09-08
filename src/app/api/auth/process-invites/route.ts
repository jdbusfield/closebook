import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: pendingInvites } = await admin
    .from("organization_invites")
    .select("*")
    .eq("email", user.email.toLowerCase())
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());

  if (!pendingInvites || pendingInvites.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processed = 0;

  for (const invite of pendingInvites) {
    const { data: existing } = await admin
      .from("organization_members")
      .select("id")
      .eq("organization_id", invite.organization_id)
      .eq("user_id", user.id)
      .single();

    if (!existing) {
      await admin.from("organization_members").insert({
        organization_id: invite.organization_id,
        user_id: user.id,
        role: invite.role,
        ...(invite.modules ? { modules: invite.modules } : {}),
        ...(invite.entity_ids ? { entity_ids: invite.entity_ids } : {}),
      });
    }

    await admin
      .from("organization_invites")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invite.id);

    processed++;
  }

  return NextResponse.json({ processed });
}

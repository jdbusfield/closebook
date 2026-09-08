import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Ensure profile exists (fallback if DB trigger doesn't exist)
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles").upsert({
          id: user.id,
          full_name: user.user_metadata?.full_name || user.email || "User",
        }, { onConflict: "id" });

        // Process pending organization invites
        const hadPendingInvites = await processPendingInvites(user.id, user.email ?? "");

        // Redirect invited users who haven't completed onboarding to welcome page
        if (hadPendingInvites && !user.user_metadata?.onboarding_complete) {
          return NextResponse.redirect(`${origin}/welcome`);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Return to login on error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}

async function processPendingInvites(userId: string, email: string): Promise<boolean> {
  if (!email) return false;

  try {
    const admin = createAdminClient();

    const { data: pendingInvites } = await admin
      .from("organization_invites")
      .select("*")
      .eq("email", email.toLowerCase())
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString());

    if (!pendingInvites || pendingInvites.length === 0) return false;

    for (const invite of pendingInvites) {
      // Check if user is already a member of this org
      const { data: existing } = await admin
        .from("organization_members")
        .select("id")
        .eq("organization_id", invite.organization_id)
        .eq("user_id", userId)
        .single();

      if (!existing) {
        await admin.from("organization_members").insert({
          organization_id: invite.organization_id,
          user_id: userId,
          role: invite.role,
          ...(invite.modules ? { modules: invite.modules } : {}),
          ...(invite.entity_ids ? { entity_ids: invite.entity_ids } : {}),
        });
      }

      // Mark invite as accepted
      await admin
        .from("organization_invites")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .eq("id", invite.id);
    }

    return true;
  } catch (err) {
    console.error("[auth/callback] Error processing invites:", err);
    return false;
  }
}

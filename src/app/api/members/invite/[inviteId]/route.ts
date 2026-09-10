import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .single();

  if (!membership || membership.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can cancel invites" },
      { status: 403 }
    );
  }

  const { inviteId } = await params;
  const admin = createAdminClient();

  // Verify invite belongs to this org and is pending
  const { data: invite } = await admin
    .from("organization_invites")
    .select("*")
    .eq("id", inviteId)
    .eq("organization_id", membership.organization_id)
    .eq("status", "pending")
    .single();

  if (!invite) {
    return NextResponse.json(
      { error: "Pending invite not found" },
      { status: 404 }
    );
  }

  const { error } = await admin
    .from("organization_invites")
    .update({ status: "cancelled" })
    .eq("id", inviteId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

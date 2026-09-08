import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId } = await request.json();

  if (!entityId) {
    return NextResponse.json(
      { error: "entityId is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Look up the entity to find its organization_id
  const { data: entity, error: entityError } = await admin
    .from("entities")
    .select("id, name, organization_id")
    .eq("id", entityId)
    .single();

  if (entityError || !entity) {
    return NextResponse.json(
      { error: "Entity not found" },
      { status: 404 }
    );
  }

  // Verify the user is an admin of the parent organization
  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", entity.organization_id)
    .eq("user_id", user.id)
    .single();

  if (!membership || membership.role !== "admin") {
    return NextResponse.json(
      { error: "Only organization admins can delete entities" },
      { status: 403 }
    );
  }

  // Delete the entity (cascades to accounts, GL balances, assets, schedules, etc.)
  const { error } = await admin
    .from("entities")
    .delete()
    .eq("id", entityId);

  if (error) {
    console.error("Failed to delete entity:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

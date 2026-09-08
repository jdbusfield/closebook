import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  // Verify the user is authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await request.json();

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "Organization name is required" },
      { status: 400 }
    );
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  // Use admin client to bypass RLS for the bootstrap operation
  const admin = createAdminClient();

  // Create the organization
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: name.trim(), slug })
    .select()
    .single();

  if (orgError) {
    console.error("Failed to create organization:", orgError);
    return NextResponse.json(
      { error: orgError.message },
      { status: 500 }
    );
  }

  // Add the creating user as admin
  const { error: memberError } = await admin
    .from("organization_members")
    .insert({
      organization_id: org.id,
      user_id: user.id,
      role: "admin",
    });

  if (memberError) {
    // Rollback: delete the org if we couldn't add the member
    await admin.from("organizations").delete().eq("id", org.id);
    console.error("Failed to add member:", memberError);
    return NextResponse.json(
      { error: memberError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ organization: org });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = await request.json();

  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Verify the user is an admin of this organization
  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .single();

  if (!membership || membership.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can delete an organization" },
      { status: 403 }
    );
  }


  // Delete the organization (cascades to entities, members, etc.)
  const { error } = await admin
    .from("organizations")
    .delete()
    .eq("id", organizationId);

  if (error) {
    console.error("Failed to delete organization:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

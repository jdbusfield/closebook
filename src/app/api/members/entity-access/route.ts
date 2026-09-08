import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasMinRole } from "@/lib/utils/permissions";
import type { UserRole } from "@/lib/types/database";

/**
 * GET /api/members/entity-access?entityId=xxx or ?userId=xxx
 * List entity access overrides.
 */
export async function GET(request: NextRequest) {
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

  if (
    !membership ||
    !hasMinRole(membership.role as UserRole, "controller")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const entityId = request.nextUrl.searchParams.get("entityId");
  const userId = request.nextUrl.searchParams.get("userId");

  // Get all entities in this org for filtering
  const { data: orgEntities } = await admin
    .from("entities")
    .select("id")
    .eq("organization_id", membership.organization_id);

  const entityIds = (orgEntities ?? []).map((e) => e.id);

  let query = admin
    .from("entity_access")
    .select("*, profiles(full_name), entities(name)")
    .in("entity_id", entityIds);

  if (entityId) query = query.eq("entity_id", entityId);
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query.order("created_at");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

/**
 * POST /api/members/entity-access
 * Set an entity-level role override.
 * Body: { entityId, userId, role }
 */
export async function POST(request: Request) {
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

  if (
    !membership ||
    !hasMinRole(membership.role as UserRole, "controller")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { entityId, userId, role } = (await request.json()) as {
    entityId: string;
    userId: string;
    role: UserRole;
  };

  if (!entityId || !userId || !role) {
    return NextResponse.json(
      { error: "entityId, userId, and role are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Verify entity belongs to this org
  const { data: entity } = await admin
    .from("entities")
    .select("id, name, organization_id")
    .eq("id", entityId)
    .single();

  if (!entity || entity.organization_id !== membership.organization_id) {
    return NextResponse.json(
      { error: "Entity not found in your organization" },
      { status: 404 }
    );
  }

  // Upsert the entity access override
  const { data, error } = await admin
    .from("entity_access")
    .upsert(
      { entity_id: entityId, user_id: userId, role },
      { onConflict: "entity_id,user_id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/**
 * DELETE /api/members/entity-access
 * Remove an entity-level role override.
 * Body: { entityId, userId }
 */
export async function DELETE(request: Request) {
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

  if (
    !membership ||
    !hasMinRole(membership.role as UserRole, "controller")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { entityId, userId } = (await request.json()) as {
    entityId: string;
    userId: string;
  };

  if (!entityId || !userId) {
    return NextResponse.json(
      { error: "entityId and userId are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("entity_access")
    .delete()
    .eq("entity_id", entityId)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

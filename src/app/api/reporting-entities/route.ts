import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// GET — List reporting entities for an organization (with members)
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");

  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required" },
      { status: 400 }
    );
  }

  // Verify membership
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: reportingEntities, error } = await (admin as any)
    .from("reporting_entities")
    .select("id, name, code, is_active, exclude_from_breakdown")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch members for all reporting entities
  const reIds = (reportingEntities ?? []).map(
    (re: { id: string }) => re.id
  );

  let members: Array<{
    reporting_entity_id: string;
    entity_id: string;
    entities: { id: string; name: string; code: string };
  }> = [];

  if (reIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: memberRows } = await (admin as any)
      .from("reporting_entity_members")
      .select("reporting_entity_id, entity_id, entities:entity_id(id, name, code)")
      .in("reporting_entity_id", reIds);

    members = memberRows ?? [];
  }

  // Group members by reporting entity
  const membersByRE = new Map<
    string,
    Array<{ entityId: string; entityName: string; entityCode: string }>
  >();

  for (const m of members) {
    const list = membersByRE.get(m.reporting_entity_id) ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entity = m.entities as any;
    if (entity) {
      list.push({
        entityId: entity.id,
        entityName: entity.name,
        entityCode: entity.code,
      });
    }
    membersByRE.set(m.reporting_entity_id, list);
  }

  const result = (reportingEntities ?? []).map(
    (re: {
      id: string;
      name: string;
      code: string;
      exclude_from_breakdown?: boolean;
    }) => ({
      id: re.id,
      name: re.name,
      code: re.code,
      excludeFromBreakdown: re.exclude_from_breakdown ?? false,
      members: membersByRE.get(re.id) ?? [],
    })
  );

  return NextResponse.json({ reportingEntities: result });
}

// ---------------------------------------------------------------------------
// POST — Create a reporting entity with members
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId, name, code, memberEntityIds, excludeFromBreakdown } =
    await request.json();

  if (!organizationId || !name || !code) {
    return NextResponse.json(
      { error: "organizationId, name, and code are required" },
      { status: 400 }
    );
  }

  if (
    !Array.isArray(memberEntityIds) ||
    memberEntityIds.length === 0
  ) {
    return NextResponse.json(
      { error: "At least one member entity is required" },
      { status: 400 }
    );
  }

  // Verify admin/controller role
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .single();

  if (
    !membership ||
    !["admin", "controller"].includes(membership.role)
  ) {
    return NextResponse.json(
      { error: "Only admins and controllers can create reporting entities" },
      { status: 403 }
    );
  }

  // Create reporting entity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: created, error: createError } = await (admin as any)
    .from("reporting_entities")
    .insert({
      organization_id: organizationId,
      name,
      code,
      exclude_from_breakdown: excludeFromBreakdown === true,
    })
    .select("id, name, code")
    .single();

  if (createError) {
    return NextResponse.json(
      { error: createError.message },
      { status: 500 }
    );
  }

  // Insert members
  const memberRows = memberEntityIds.map((entityId: string) => ({
    reporting_entity_id: created.id,
    entity_id: entityId,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: memberError } = await (admin as any)
    .from("reporting_entity_members")
    .insert(memberRows);

  if (memberError) {
    // Rollback: delete the reporting entity
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("reporting_entities")
      .delete()
      .eq("id", created.id);
    return NextResponse.json(
      { error: memberError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    reportingEntity: {
      id: created.id,
      name: created.name,
      code: created.code,
      memberEntityIds,
    },
  });
}

// ---------------------------------------------------------------------------
// PUT — Update a reporting entity (name, code, members)
// ---------------------------------------------------------------------------

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    reportingEntityId,
    name,
    code,
    memberEntityIds,
    excludeFromBreakdown,
  } = await request.json();

  if (!reportingEntityId) {
    return NextResponse.json(
      { error: "reportingEntityId is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Look up reporting entity to find its organization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: re } = await (admin as any)
    .from("reporting_entities")
    .select("id, organization_id")
    .eq("id", reportingEntityId)
    .single();

  if (!re) {
    return NextResponse.json(
      { error: "Reporting entity not found" },
      { status: 404 }
    );
  }

  // Verify admin/controller role
  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", re.organization_id)
    .eq("user_id", user.id)
    .single();

  if (
    !membership ||
    !["admin", "controller"].includes(membership.role)
  ) {
    return NextResponse.json(
      { error: "Only admins and controllers can update reporting entities" },
      { status: 403 }
    );
  }

  // Update fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: any = {};
  if (name !== undefined) updates.name = name;
  if (code !== undefined) updates.code = code;
  if (excludeFromBreakdown !== undefined) {
    updates.exclude_from_breakdown = excludeFromBreakdown === true;
  }

  if (Object.keys(updates).length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from("reporting_entities")
      .update(updates)
      .eq("id", reportingEntityId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Replace members if provided
  if (Array.isArray(memberEntityIds)) {
    if (memberEntityIds.length === 0) {
      return NextResponse.json(
        { error: "At least one member entity is required" },
        { status: 400 }
      );
    }

    // Delete existing members
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("reporting_entity_members")
      .delete()
      .eq("reporting_entity_id", reportingEntityId);

    // Insert new members
    const memberRows = memberEntityIds.map((entityId: string) => ({
      reporting_entity_id: reportingEntityId,
      entity_id: entityId,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: memberError } = await (admin as any)
      .from("reporting_entity_members")
      .insert(memberRows);

    if (memberError) {
      return NextResponse.json(
        { error: memberError.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true });
}

// ---------------------------------------------------------------------------
// DELETE — Delete a reporting entity
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const reportingEntityId = searchParams.get("reportingEntityId");

  if (!reportingEntityId) {
    return NextResponse.json(
      { error: "reportingEntityId is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Look up to verify organization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: re } = await (admin as any)
    .from("reporting_entities")
    .select("id, organization_id")
    .eq("id", reportingEntityId)
    .single();

  if (!re) {
    return NextResponse.json(
      { error: "Reporting entity not found" },
      { status: 404 }
    );
  }

  // Verify admin/controller role
  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", re.organization_id)
    .eq("user_id", user.id)
    .single();

  if (
    !membership ||
    !["admin", "controller"].includes(membership.role)
  ) {
    return NextResponse.json(
      { error: "Only admins and controllers can delete reporting entities" },
      { status: 403 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("reporting_entities")
    .delete()
    .eq("id", reportingEntityId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// POST — bulk update display_order on a list of templates.
// Body: { organizationId, orderedIds: string[] } where orderedIds is the
// desired order (index 0 = first). Writes display_order = index for each.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId, orderedIds } = (await request.json()) as {
    organizationId?: string;
    orderedIds?: string[];
  };

  if (!organizationId || !Array.isArray(orderedIds) || orderedIds.length === 0) {
    return NextResponse.json(
      { error: "organizationId and a non-empty orderedIds array are required" },
      { status: 400 }
    );
  }

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

  // Validate that all referenced templates belong to this org before
  // mutating anything.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (admin as any)
    .from("financial_model_templates")
    .select("id")
    .eq("organization_id", organizationId)
    .in("id", orderedIds);

  const validIds = new Set((rows ?? []).map((r: { id: string }) => r.id));
  for (const id of orderedIds) {
    if (!validIds.has(id)) {
      return NextResponse.json(
        { error: `Template ${id} not in organization` },
        { status: 400 }
      );
    }
  }

  // Apply updates sequentially — small N, so no need for a stored procedure.
  for (let i = 0; i < orderedIds.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from("financial_model_templates")
      .update({ display_order: i })
      .eq("id", orderedIds[i]);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

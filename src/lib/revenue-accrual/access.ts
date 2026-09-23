import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMemberAccess } from "@/lib/access/server";
import { canOpenModule } from "@/lib/access/modules";

const EDIT_ROLES = ["admin", "controller", "preparer"];

/**
 * The signed-in member must see the entity (RLS) and hold the Revenue
 * Accruals module; writes also need an editing role.
 */
export async function requireAccrualAccess(entityId: string | null, write: boolean) {
  if (!entityId) return { error: NextResponse.json({ error: "entityId is required" }, { status: 400 }) } as const;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const { data: entity } = await supabase.from("entities").select("id, name").eq("id", entityId).maybeSingle();
  if (!entity) return { error: NextResponse.json({ error: "Entity not found" }, { status: 404 }) } as const;
  const access = await getMemberAccess();
  if (access) {
    if (access.entityIds && !access.entityIds.includes(entityId))
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
    if (!canOpenModule(access, "revenue_accruals"))
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
    if (write && !EDIT_ROLES.includes(access.role))
      return { error: NextResponse.json({ error: "Your role can view this page but not change it." }, { status: 403 }) } as const;
  }
  return { user, entity: entity as { id: string; name: string }, admin: createAdminClient() } as const;
}

export function parsePeriod(year: unknown, month: unknown) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < 2000) return null;
  return { year: y, month: m };
}

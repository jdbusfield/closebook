import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../_lib/org";

const ALLOWED_LINK_FIELDS = ["production_id", "company_id", "contact_id", "opportunity_id"] as const;

export async function POST(req: NextRequest) {
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    body?: string;
    production_id?: string;
    company_id?: string;
    contact_id?: string;
    opportunity_id?: string;
  } | null;
  const noteBody = body?.body?.trim();
  if (!noteBody) return NextResponse.json({ error: "body required" }, { status: 400 });

  const insert: Record<string, unknown> = {
    organization_id: ctx.organizationId,
    body: noteBody,
    created_by: ctx.userId,
  };
  for (const f of ALLOWED_LINK_FIELDS) {
    if (body?.[f]) insert[f] = body[f];
  }

  const { data, error } = await ctx.supabase.from("crm_notes").insert(insert).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ note: data });
}

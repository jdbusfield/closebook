import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildEmailHealth } from "@/lib/email-health/report";

export const runtime = "nodejs";
export const maxDuration = 60;

// Email deliverability report for the Ads tab (in-app path). Requires a
// signed-in user who can see the entity; RLS on `entities` decides. The
// embed gets the same report through the key-authenticated
// /api/inquiries/embed route (action "email_health").
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entityId = new URL(request.url).searchParams.get("entityId")?.trim();
  if (!entityId) return NextResponse.json({ error: "entityId required" }, { status: 400 });

  const { data: entity } = await supabase.from("entities").select("id").eq("id", entityId).maybeSingle();
  if (!entity) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    return NextResponse.json(await buildEmailHealth(entityId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

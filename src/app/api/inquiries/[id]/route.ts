import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { INQUIRY_STATUSES, HDR_ENTITY_ID } from "@/lib/inquiries/shared";

export const runtime = "nodejs";

// In-app status / triage updates from the Inquiries dashboard. Normally uses the
// user's session client so RLS enforces that only members of the HDR entity can
// edit. The embedded HDR CRM (no session) authenticates with the EMBED_API_KEY
// via an `x-embed-key` header; when valid we use the admin client but HARD-SCOPE
// every query to HDR_ENTITY_ID, which replaces the RLS guard.

function validEmbedKey(request: Request): boolean {
  const k = request.headers.get("x-embed-key");
  return !!k && !!process.env.EMBED_API_KEY && k === process.env.EMBED_API_KEY;
}

const UpdateSchema = z.object({
  status: z.enum(INQUIRY_STATUSES).optional(),
  internal_notes: z.string().max(10_000).optional().nullable(),
  rw_quote_number: z.string().max(64).optional().nullable(),
  rw_order_number: z.string().max(64).optional().nullable(),
  unit_id: z.string().max(64).optional().nullable(),
  estimated_value: z.number().nonnegative().max(100_000_000).optional().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const isEmbed = validEmbedKey(request);
  const supabase = isEmbed ? createAdminClient() : await createClient();

  if (!isEmbed) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let patch: z.infer<typeof UpdateSchema>;
  try {
    patch = UpdateSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid payload", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // For session users, RLS restricts the update to their entities. For the embed
  // (admin client, RLS bypassed) we explicitly scope to HDR so a valid key can
  // only ever touch HDR inquiries. Either way a disallowed row matches nothing.
  let query = supabase
    .from("rental_inquiries")
    .update({ ...patch, last_activity_at: new Date().toISOString() })
    .eq("id", id);
  if (isEmbed) query = query.eq("entity_id", HDR_ENTITY_ID);
  const { data, error } = await query
    .select(
      "id, status, internal_notes, rw_quote_number, rw_order_number, unit_id, estimated_value"
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found or not permitted" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, inquiry: data });
}

// Delete an inquiry (e.g. to clear out test/junk cards). Uses the user's session
// client so RLS enforces that only members of the inquiry's entity can delete it.
// The inquiry's messages and email events cascade via their FK ON DELETE CASCADE.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const isEmbed = validEmbedKey(request);
  const supabase = isEmbed ? createAdminClient() : await createClient();

  if (!isEmbed) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // RLS restricts the delete to the user's entities; the embed is hard-scoped to
  // HDR. A disallowed row simply matches nothing. We .select() the deleted row so
  // we can tell the difference between "deleted" and "not found / not permitted".
  let query = supabase.from("rental_inquiries").delete().eq("id", id);
  if (isEmbed) query = query.eq("entity_id", HDR_ENTITY_ID);
  const { data, error } = await query.select("id").maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found or not permitted" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}

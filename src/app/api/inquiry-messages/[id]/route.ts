import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HDR_ENTITY_ID } from "@/lib/inquiries/shared";

export const runtime = "nodejs";

// Assign an inbox message to an inquiry (or detach it). Normally uses the user's
// session client so RLS enforces that only members of the message's entity can
// edit. The embedded HDR CRM authenticates with the EMBED_API_KEY; when valid we
// use the admin client but hard-scope every query to HDR_ENTITY_ID.

function validEmbedKey(request: Request): boolean {
  const k = request.headers.get("x-embed-key");
  return !!k && !!process.env.EMBED_API_KEY && k === process.env.EMBED_API_KEY;
}

const UpdateSchema = z.object({
  inquiry_id: z.string().uuid().nullable(),
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

  // If assigning to an inquiry, confirm it's visible (RLS for sessions; explicit
  // HDR scope for the embed) before linking — otherwise you could attach a
  // message to an inquiry you can't see.
  if (patch.inquiry_id) {
    let inqQuery = supabase
      .from("rental_inquiries")
      .select("id")
      .eq("id", patch.inquiry_id);
    if (isEmbed) inqQuery = inqQuery.eq("entity_id", HDR_ENTITY_ID);
    const { data: inq } = await inqQuery.maybeSingle();
    if (!inq) {
      return NextResponse.json({ error: "Inquiry not found or not permitted" }, { status: 404 });
    }
  }

  let updateQuery = supabase
    .from("rental_inquiry_messages")
    .update({ inquiry_id: patch.inquiry_id })
    .eq("id", id);
  if (isEmbed) updateQuery = updateQuery.eq("entity_id", HDR_ENTITY_ID);
  const { data, error } = await updateQuery
    .select("id, inquiry_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found or not permitted" }, { status: 404 });
  }

  // Bump the inquiry's activity so a newly-attached message surfaces it.
  if (patch.inquiry_id) {
    await supabase
      .from("rental_inquiries")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", patch.inquiry_id);
  }

  return NextResponse.json({ ok: true, message: data });
}

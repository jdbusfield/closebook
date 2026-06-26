import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEmbedEntity } from "@/lib/inquiries/embed-auth";

export const runtime = "nodejs";

// Assign an inbox message to an inquiry (or detach it). Normally uses the user's
// session client so RLS enforces that only members of the message's entity can
// edit. An embedded CRM authenticates with a per-brand embed key; when valid we
// use the admin client but hard-scope every query to the entity that key resolves to.

const UpdateSchema = z.object({
  inquiry_id: z.string().uuid().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const embedEntity = resolveEmbedEntity(request);
  const isEmbed = embedEntity !== null;
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
    if (embedEntity) inqQuery = inqQuery.eq("entity_id", embedEntity);
    const { data: inq } = await inqQuery.maybeSingle();
    if (!inq) {
      return NextResponse.json({ error: "Inquiry not found or not permitted" }, { status: 404 });
    }
  }

  let updateQuery = supabase
    .from("rental_inquiry_messages")
    .update({ inquiry_id: patch.inquiry_id })
    .eq("id", id);
  if (embedEntity) updateQuery = updateQuery.eq("entity_id", embedEntity);
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

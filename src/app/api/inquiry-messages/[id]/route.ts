import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Assign an inbox message to an inquiry (or detach it). Uses the user's session
// client so RLS enforces that only members of the message's entity can edit, and
// that the target inquiry is in one of their entities.

const UpdateSchema = z.object({
  inquiry_id: z.string().uuid().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  // If assigning to an inquiry, confirm it's visible to this user (RLS) before
  // linking — otherwise you could attach a message to an inquiry you can't see.
  if (patch.inquiry_id) {
    const { data: inq } = await supabase
      .from("rental_inquiries")
      .select("id")
      .eq("id", patch.inquiry_id)
      .maybeSingle();
    if (!inq) {
      return NextResponse.json({ error: "Inquiry not found or not permitted" }, { status: 404 });
    }
  }

  const { data, error } = await supabase
    .from("rental_inquiry_messages")
    .update({ inquiry_id: patch.inquiry_id })
    .eq("id", id)
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

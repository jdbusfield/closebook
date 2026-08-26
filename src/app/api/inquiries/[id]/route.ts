import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { INQUIRY_STATUSES } from "@/lib/inquiries/shared";
import { resolveEmbedEntity } from "@/lib/inquiries/embed-auth";

export const runtime = "nodejs";

// In-app status / triage updates from the Inquiries dashboard. Normally uses the
// user's session client so RLS enforces that only members of the entity can edit.
// An embedded CRM (no session) authenticates with a per-brand embed key via an
// `x-embed-key` header; when valid we use the admin client but HARD-SCOPE every
// query to the entity that key resolves to, which replaces the RLS guard.

const UpdateSchema = z.object({
  status: z.enum(INQUIRY_STATUSES).optional(),
  internal_notes: z.string().max(10_000).optional().nullable(),
  // Reason a quote was marked lost (preset or free-text "Other").
  lost_reason: z.string().max(500).optional().nullable(),
  rw_quote_number: z.string().max(64).optional().nullable(),
  rw_order_number: z.string().max(64).optional().nullable(),
  unit_id: z.string().max(64).optional().nullable(),
  estimated_value: z.number().nonnegative().max(100_000_000).optional().nullable(),
  // Bill-to override for the quote/invoice document.
  billing_name: z.string().max(256).optional().nullable(),
  billing_address: z.string().max(1_000).optional().nullable(),
  // Free-form note printed on the quote / invoice PDF, per the two toggles.
  document_note: z.string().max(2_000).optional().nullable(),
  note_on_quote: z.boolean().optional(),
  note_on_invoice: z.boolean().optional(),
  // Event & contact fields — editable from the inquiry drawer.
  name: z.string().max(256).optional().nullable(),
  // Verbatim "Hi ___," greeting override for the {first} merge token.
  greeting_name: z.string().max(128).optional().nullable(),
  email: z.string().max(256).optional().nullable(),
  phone: z.string().max(64).optional().nullable(),
  use_case: z.string().max(256).optional().nullable(),
  start_date: z.string().max(64).optional().nullable(),
  end_date: z.string().max(64).optional().nullable(),
  duration: z.string().max(128).optional().nullable(),
  units: z.number().int().nonnegative().max(1000).optional().nullable(),
  guests: z.string().max(64).optional().nullable(),
  location: z.string().max(512).optional().nullable(),
  attendant: z.string().max(128).optional().nullable(),
  // source is NOT NULL in the schema — string only.
  source: z.string().max(128).optional(),
  // Cold-outreach card fields (lane='cold'). `lane` itself is set at creation
  // and deliberately not patchable.
  company: z.string().max(256).optional().nullable(),
  contact_title: z.string().max(128).optional().nullable(),
  website: z.string().max(512).optional().nullable(),
  vertical: z.string().max(64).optional().nullable(),
  outreach_source: z.string().max(64).optional().nullable(),
  sequence: z.string().max(32).optional().nullable(),
  last_touch_at: z.string().max(10).optional().nullable(),
  next_follow_up: z.string().max(10).optional().nullable(),
  // Free-form prospect notes (the website form's message on inbound rows).
  notes: z.string().max(10_000).optional().nullable(),
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
  if (embedEntity) query = query.eq("entity_id", embedEntity);
  const { data, error } = await query
    .select(
      "id, status, lane, lost_reason, internal_notes, rw_quote_number, rw_order_number, unit_id, estimated_value, billing_name, billing_address, document_note, note_on_quote, note_on_invoice, name, greeting_name, email, phone, use_case, start_date, end_date, duration, units, guests, location, attendant, source, notes, company, contact_title, website, vertical, outreach_source, sequence, last_touch_at, next_follow_up"
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

  // RLS restricts the delete to the user's entities; the embed is hard-scoped to
  // HDR. A disallowed row simply matches nothing. We .select() the deleted row so
  // we can tell the difference between "deleted" and "not found / not permitted".
  let query = supabase.from("rental_inquiries").delete().eq("id", id);
  if (embedEntity) query = query.eq("entity_id", embedEntity);
  const { data, error } = await query.select("id").maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found or not permitted" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}

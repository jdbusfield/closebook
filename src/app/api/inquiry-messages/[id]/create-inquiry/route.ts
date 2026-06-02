import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { messageSide, isStaffAddress, messageSnippet } from "@/lib/inquiries/shared";

export const runtime = "nodejs";

// Create a brand-new inquiry from an unmatched inbox message (e.g. mail that
// came in without an HDR-XXXXX reference, so it never auto-matched), and link
// the message to it.
//
// App users have no INSERT policy on rental_inquiries (inserts normally come
// from the website ingest via the service role). We authorize by reading the
// message through the user's SESSION client first — RLS guarantees they can only
// see messages in their own entities — then create the inquiry in that same
// entity with the admin client.

// Reference like "HDR-AB12C". Ambiguous characters (0/O, 1/I) are excluded.
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genReference(): string {
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `HDR-${s}`;
}

export async function POST(
  _request: Request,
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

  // Read the message via the session client — RLS confirms the user may access
  // this message's entity.
  const { data: msg } = await supabase
    .from("rental_inquiry_messages")
    .select(
      "id, entity_id, inquiry_id, direction, from_addr, to_addrs, cc_addrs, subject, body_text, body_html"
    )
    .eq("id", id)
    .maybeSingle();

  if (!msg) {
    return NextResponse.json({ error: "Not found or not permitted" }, { status: 404 });
  }
  if (msg.inquiry_id) {
    return NextResponse.json(
      { error: "This email is already linked to an inquiry", inquiryId: msg.inquiry_id },
      { status: 409 }
    );
  }
  if (!msg.entity_id) {
    return NextResponse.json({ error: "Message has no entity" }, { status: 400 });
  }

  // Best-guess the customer's email + name from the message.
  let customerEmail: string | null = null;
  if (messageSide(msg) === "customer") {
    customerEmail = msg.from_addr ?? null;
  } else {
    const recipients = [...(msg.to_addrs ?? []), ...(msg.cc_addrs ?? [])];
    customerEmail = recipients.find((r) => !isStaffAddress(r)) ?? recipients[0] ?? null;
  }
  const name = customerEmail ? customerEmail.split("@")[0] : null;

  const snippet = messageSnippet(msg, 1000);
  const notes = [
    "Created from an inbox email.",
    msg.subject ? `Subject: ${msg.subject}` : null,
    snippet ? `\n${snippet}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // Insert the inquiry, regenerating the reference on the rare (entity, reference)
  // collision.
  let inquiry: { id: string; reference: string } | null = null;
  for (let attempt = 0; attempt < 6 && !inquiry; attempt++) {
    const reference = genReference();
    const { data, error } = await admin
      .from("rental_inquiries")
      .insert({
        entity_id: msg.entity_id,
        reference,
        source: "email",
        status: "new",
        name,
        email: customerEmail,
        notes,
        last_activity_at: nowIso,
      })
      .select("id, reference")
      .single();

    if (!error && data) {
      inquiry = data;
      break;
    }
    // 23505 = unique_violation on (entity_id, reference); retry with a new code.
    if (error && error.code !== "23505") {
      console.error("[create-inquiry] insert failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (!inquiry) {
    return NextResponse.json(
      { error: "Could not allocate an inquiry reference, please retry" },
      { status: 500 }
    );
  }

  // Link the originating message to the new inquiry.
  const { error: linkErr } = await admin
    .from("rental_inquiry_messages")
    .update({ inquiry_id: inquiry.id })
    .eq("id", id);
  if (linkErr) {
    console.error("[create-inquiry] link failed", linkErr);
    // The inquiry exists; surface success with a warning rather than orphaning.
  }

  return NextResponse.json({
    ok: true,
    inquiryId: inquiry.id,
    reference: inquiry.reference,
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEmbedEntity } from "@/lib/inquiries/embed-auth";
import {
  COLD_SEQUENCES,
  COLD_SOURCES,
  COLD_VERTICALS,
  HDR_ENTITY_ID,
} from "@/lib/inquiries/shared";

export const runtime = "nodejs";

// Create a cold-outreach card (lane='cold') for an entity. App users need a
// session and membership in the entity (checked through the entities RLS
// policy); an agent can present the entity's embed key instead, in which case
// the entity is derived from the key and never from the body. Cold cards are
// only ever created here — never by the website ingest or from an email.

const CreateSchema = z.object({
  entityId: z.string().uuid().optional(),
  company: z.string().trim().min(1).max(256),
  email: z.string().trim().email().max(256),
  vertical: z.enum(COLD_VERTICALS),
  name: z.string().trim().max(256).optional().nullable(),
  contact_title: z.string().trim().max(128).optional().nullable(),
  phone: z.string().trim().max(64).optional().nullable(),
  website: z.string().trim().max(512).optional().nullable(),
  notes: z.string().max(10_000).optional().nullable(),
  outreach_source: z.enum(COLD_SOURCES).optional().nullable(),
  sequence: z.enum(COLD_SEQUENCES).optional().nullable(),
  last_touch_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  next_follow_up: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

// "CO-AB12C" — its own prefix so the subject-line reference matcher (HDR-/VS-)
// never mistakes a cold card for an inquiry. Ambiguous characters excluded.
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genReference(): string {
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `CO-${s}`;
}

export async function POST(request: Request) {
  const embedEntity = resolveEmbedEntity(request);

  let body: z.infer<typeof CreateSchema>;
  try {
    body = CreateSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid payload", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  let entityId: string;
  let createdBy: string | null = null;
  if (embedEntity) {
    entityId = embedEntity;
    createdBy = "embed";
  } else {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    entityId = body.entityId ?? HDR_ENTITY_ID;
    // Entities are RLS-scoped to the caller's memberships, so a hit proves access.
    const { data: entity } = await supabase
      .from("entities")
      .select("id")
      .eq("id", entityId)
      .maybeSingle();
    if (!entity) return NextResponse.json({ error: "Not found or not permitted" }, { status: 404 });
    createdBy = user.email ?? user.id;
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const row = {
    entity_id: entityId,
    lane: "cold",
    source: "outreach",
    status: "not_contacted",
    company: body.company,
    email: body.email.toLowerCase(),
    vertical: body.vertical,
    name: body.name || null,
    contact_title: body.contact_title || null,
    phone: body.phone || null,
    website: body.website || null,
    notes: body.notes || null,
    outreach_source: body.outreach_source ?? null,
    sequence: body.sequence ?? null,
    last_touch_at: body.last_touch_at ?? null,
    next_follow_up: body.next_follow_up ?? null,
    last_activity_at: now,
    created_by: createdBy,
  };

  // Retry on the rare (entity, reference) collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await admin
      .from("rental_inquiries")
      .insert({ ...row, reference: genReference() })
      .select("id, reference")
      .single();
    if (!error && data) {
      return NextResponse.json({ ok: true, id: data.id, reference: data.reference });
    }
    if (error?.code !== "23505") {
      return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
    }
  }
  return NextResponse.json(
    { error: "Could not allocate a card reference, please retry" },
    { status: 500 }
  );
}

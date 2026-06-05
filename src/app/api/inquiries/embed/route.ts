import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HDR_ENTITY_ID } from "@/lib/inquiries/shared";
import type { Database } from "@/lib/types/database.types";

export const runtime = "nodejs";

type TemplateInsert = Database["public"]["Tables"]["rental_inquiry_templates"]["Insert"];

// Key-authenticated data endpoint for the embedded HDR inquiries CRM. The embed
// runs with NO Supabase session (it's iframed into an external site), so the
// inquiries data hooks can't read/write Supabase directly. Instead they POST
// here with the static EMBED_API_KEY in an `x-embed-key` header; we serve every
// read/write with the service-role (admin) client, HARD-SCOPED to the HDR entity.
//
// SECURITY: the admin client bypasses RLS, so the entity id is ALWAYS forced to
// HDR_ENTITY_ID server-side and never taken from the request body. Every mutation
// also verifies the target row belongs to HDR before touching it. The valid key
// can therefore only ever read/write HDR inquiry data, nothing else.

const INQUIRY_COLUMNS =
  "id, reference, status, name, email, phone, use_case, start_date, end_date, duration, units, attendant, guests, location, notes, internal_notes, rw_quote_number, rw_order_number, source, unit_id, estimated_value, last_activity_at, created_at";

const TEMPLATE_COLUMNS =
  "id, template_key, label, channel, track, stages, cadence, subject, body, sort_order, archived";

function validKey(request: Request): boolean {
  const k = request.headers.get("x-embed-key");
  return !!k && !!process.env.EMBED_API_KEY && k === process.env.EMBED_API_KEY;
}

type Admin = ReturnType<typeof createAdminClient>;

// Confirm an inquiry belongs to HDR before we mutate it or anything hanging off
// it. Guards against a valid embed key reaching across entities via a foreign id.
async function inquiryIsHDR(admin: Admin, id: string): Promise<boolean> {
  if (!id) return false;
  const { data } = await admin
    .from("rental_inquiries")
    .select("entity_id")
    .eq("id", id)
    .maybeSingle();
  return !!data && data.entity_id === HDR_ENTITY_ID;
}

export async function POST(request: Request) {
  if (!validKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const entityId = HDR_ENTITY_ID; // forced â€” never from the request
  const body = await request.json().catch(() => ({}));
  const { action } = body as { action?: string };

  switch (action) {
    // --- Reads --------------------------------------------------------------
    case "list_pipeline": {
      // The four datasets use-inquiries.load() assembles (same columns/ordering).
      const [inqs, tasks, activity, messages] = await Promise.all([
        admin
          .from("rental_inquiries")
          .select(INQUIRY_COLUMNS)
          .eq("entity_id", entityId)
          .order("last_activity_at", { ascending: false })
          .limit(1000),
        admin
          .from("rental_inquiry_tasks")
          .select("id, inquiry_id, title, due_date, done, kind, created_at")
          .eq("entity_id", entityId)
          .limit(2000),
        admin
          .from("rental_inquiry_activity")
          .select("id, inquiry_id, type, body, actor, occurred_at")
          .eq("entity_id", entityId)
          .order("occurred_at", { ascending: false })
          .limit(2000),
        admin
          .from("rental_inquiry_messages")
          .select(
            "id, inquiry_id, direction, kind, from_addr, to_addrs, cc_addrs, subject, body_text, body_html, sent_at, received_at, created_at"
          )
          .eq("entity_id", entityId)
          .order("created_at", { ascending: true })
          .limit(3000),
      ]);
      return NextResponse.json({
        inquiries: inqs.data ?? [],
        tasks: tasks.data ?? [],
        activity: activity.data ?? [],
        messages: messages.data ?? [],
      });
    }

    case "inbox_feed": {
      const [msgs, inqs] = await Promise.all([
        admin
          .from("rental_inquiry_messages")
          .select(
            "id, inquiry_id, direction, kind, from_addr, to_addrs, cc_addrs, subject, body_text, body_html, sent_at, received_at, created_at"
          )
          .eq("entity_id", entityId)
          .order("created_at", { ascending: false })
          .limit(300),
        admin
          .from("rental_inquiries")
          .select("id, reference, name")
          .eq("entity_id", entityId)
          .order("last_activity_at", { ascending: false })
          .limit(500),
      ]);
      return NextResponse.json({
        messages: msgs.data ?? [],
        inquiries: inqs.data ?? [],
      });
    }

    case "inquiry_detail": {
      const { inquiryId } = body as { inquiryId?: string };
      if (!inquiryId) {
        return NextResponse.json({ error: "inquiryId required" }, { status: 400 });
      }
      const { data: inquiry } = await admin
        .from("rental_inquiries")
        .select("*")
        .eq("id", inquiryId)
        .eq("entity_id", entityId)
        .maybeSingle();
      if (!inquiry) {
        return NextResponse.json({ inquiry: null, messages: [], events: [] });
      }
      const { data: messages } = await admin
        .from("rental_inquiry_messages")
        .select(
          "id, direction, kind, from_addr, to_addrs, cc_addrs, subject, body_text, body_html, resend_email_id, sent_at, received_at, created_at"
        )
        .eq("inquiry_id", inquiryId)
        .order("created_at", { ascending: true });
      const ids = (messages ?? []).map((m) => m.id);
      let events: unknown[] = [];
      if (ids.length > 0) {
        const { data: evs } = await admin
          .from("rental_inquiry_email_events")
          .select("id, message_id, event_type, occurred_at")
          .in("message_id", ids)
          .order("occurred_at", { ascending: true });
        events = evs ?? [];
      }
      return NextResponse.json({ inquiry, messages: messages ?? [], events });
    }

    case "list_templates": {
      const { data } = await admin
        .from("rental_inquiry_templates")
        .select(TEMPLATE_COLUMNS)
        .eq("entity_id", entityId)
        .order("sort_order", { ascending: true });
      return NextResponse.json({ rows: data ?? [] });
    }

    // --- Writes (each forced/verified to HDR) -------------------------------
    case "bump_activity_clock": {
      const { id } = body as { id: string };
      if (!(await inquiryIsHDR(admin, id))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      await admin
        .from("rental_inquiries")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", id)
        .eq("entity_id", entityId);
      return NextResponse.json({ ok: true });
    }

    case "insert_activity": {
      // Covers both the stage-move log and an explicitly logged call/email/note.
      const { id, type, activityBody, actor } = body as {
        id: string;
        type: string;
        activityBody: string;
        actor: string | null;
      };
      if (!(await inquiryIsHDR(admin, id))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { error } = await admin.from("rental_inquiry_activity").insert({
        inquiry_id: id,
        entity_id: entityId,
        type,
        body: activityBody,
        actor,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "delete_activity": {
      const { activityId } = body as { activityId: string };
      const { error } = await admin
        .from("rental_inquiry_activity")
        .delete()
        .eq("id", activityId)
        .eq("entity_id", entityId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "add_task": {
      const { id, title, kind, due_date } = body as {
        id: string;
        title: string;
        kind: string;
        due_date: string;
      };
      if (!(await inquiryIsHDR(admin, id))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { error } = await admin.from("rental_inquiry_tasks").insert({
        inquiry_id: id,
        entity_id: entityId,
        title,
        kind,
        due_date,
        done: false,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "toggle_task": {
      const { taskId, done } = body as { taskId: string; done: boolean };
      const { error } = await admin
        .from("rental_inquiry_tasks")
        .update({ done, completed_at: done ? new Date().toISOString() : null })
        .eq("id", taskId)
        .eq("entity_id", entityId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // --- Template writes ----------------------------------------------------
    case "save_template": {
      const { template } = body as { template: Omit<TemplateInsert, "entity_id"> };
      const { error } = await admin.from("rental_inquiry_templates").upsert(
        { ...template, entity_id: entityId },
        { onConflict: "entity_id,template_key" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "delete_template": {
      const { templateKey } = body as { templateKey: string };
      const { error } = await admin
        .from("rental_inquiry_templates")
        .delete()
        .eq("entity_id", entityId)
        .eq("template_key", templateKey);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

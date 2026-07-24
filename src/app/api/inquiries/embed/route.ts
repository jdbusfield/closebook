import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HDR_ENTITY_ID } from "@/lib/inquiries/shared";
import { resolveEmbedEntity } from "@/lib/inquiries/embed-auth";
import type { Database } from "@/lib/types/database.types";

export const runtime = "nodejs";

type TemplateInsert = Database["public"]["Tables"]["rental_inquiry_templates"]["Insert"];

// Key-authenticated data endpoint for the embedded inquiries CRM (HDR + Versatile).
// The embed runs with NO Supabase session (it's iframed into an external site), so
// the inquiries data hooks can't read/write Supabase directly. Instead they POST
// here with a static per-brand embed key in an `x-embed-key` header; we serve every
// read/write with the service-role (admin) client, HARD-SCOPED to the entity the
// key unlocks.
//
// SECURITY: the admin client bypasses RLS, so the entity id is ALWAYS derived
// server-side from WHICH key was presented (EMBED_API_KEY => HDR,
// EMBED_API_KEY_VERSATILE => Versatile) and never taken from the request body.
// Each key maps to exactly one entity, so a given key can only ever read/write
// that brand's inquiry data — there is no cross-tenant path. Every mutation is
// additionally filtered by entity_id (and id-bearing mutations verify the target
// row belongs to the resolved entity first).

const INQUIRY_COLUMNS =
  "id, reference, status, name, email, phone, use_case, start_date, end_date, duration, units, attendant, guests, location, notes, request_type, deposit, billing_name, billing_address, document_note, note_on_quote, note_on_invoice, internal_notes, rw_quote_number, rw_order_number, source, unit_id, estimated_value, last_activity_at, created_at";

const TEMPLATE_COLUMNS =
  "id, template_key, label, channel, track, stages, cadence, subject, body, sort_order, archived";

const QUOTE_COLUMNS =
  "id, inquiry_id, quote_number, status, lines, subtotal, tax_rate, tax, total, valid_until, terms, accepted_at, created_by, created_at, updated_at";

type Admin = ReturnType<typeof createAdminClient>;

// Confirm an inquiry belongs to the resolved entity before we mutate it or
// anything hanging off it. Guards against a valid embed key reaching across
// entities via a foreign id.
async function inquiryBelongsTo(admin: Admin, id: string, entityId: string): Promise<boolean> {
  if (!id) return false;
  const { data } = await admin
    .from("rental_inquiries")
    .select("entity_id")
    .eq("id", id)
    .maybeSingle();
  return !!data && data.entity_id === entityId;
}

export async function POST(request: Request) {
  const entityId = resolveEmbedEntity(request); // derived from the key — never from the body
  if (!entityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const body = await request.json().catch(() => ({}));
  const { action } = body as { action?: string };

  switch (action) {
    // --- Reads --------------------------------------------------------------
    case "list_pipeline": {
      // The four datasets use-inquiries.load() assembles (same columns/ordering).
      const [inqs, tasks, activity, messages, quotes] = await Promise.all([
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
        admin
          .from("rental_inquiry_quotes")
          .select(QUOTE_COLUMNS)
          .eq("entity_id", entityId)
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);
      return NextResponse.json({
        inquiries: inqs.data ?? [],
        tasks: tasks.data ?? [],
        activity: activity.data ?? [],
        messages: messages.data ?? [],
        quotes: quotes.data ?? [],
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
      const { data: quotes } = await admin
        .from("rental_inquiry_quotes")
        .select(QUOTE_COLUMNS)
        .eq("inquiry_id", inquiryId)
        .order("created_at", { ascending: false });
      return NextResponse.json({
        inquiry,
        messages: messages ?? [],
        events,
        quotes: quotes ?? [],
      });
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
      if (!(await inquiryBelongsTo(admin, id, entityId))) {
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
      if (!(await inquiryBelongsTo(admin, id, entityId))) {
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
      if (!(await inquiryBelongsTo(admin, id, entityId))) {
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

    // --- Email funnels (definitions + live enrollments) -----------------------
    // Enrollment MUTATIONS (enroll/stop/resume) go through /api/inquiries/funnels
    // in both modes — sending happens server-side there. These are just reads +
    // funnel/step editing for the Templates page.
    case "list_funnels": {
      const [funnels, steps, enrollments] = await Promise.all([
        admin
          .from("rental_inquiry_funnels")
          .select("id, name, description, archived, sort_order")
          .eq("entity_id", entityId)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        admin
          .from("rental_inquiry_funnel_steps")
          .select("id, funnel_id, day_offset, subject, body, resource_ids, sort_order")
          .eq("entity_id", entityId)
          .order("day_offset", { ascending: true })
          .order("sort_order", { ascending: true }),
        admin
          .from("rental_inquiry_funnel_enrollments")
          .select(
            "id, inquiry_id, funnel_id, quote_id, status, enrolled_at, enrolled_by, steps_sent, next_send_at, replied_at, stopped_reason"
          )
          .eq("entity_id", entityId)
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);
      return NextResponse.json({
        funnels: funnels.data ?? [],
        steps: steps.data ?? [],
        enrollments: enrollments.data ?? [],
      });
    }

    case "save_funnel": {
      const { funnel } = body as {
        funnel: {
          id?: string;
          name: string;
          description?: string | null;
          archived?: boolean;
          sort_order?: number;
        };
      };
      if (funnel.id) {
        const { id, ...patch } = funnel;
        const { error } = await admin
          .from("rental_inquiry_funnels")
          .update(patch)
          .eq("id", id)
          .eq("entity_id", entityId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, id });
      }
      const { data, error } = await admin
        .from("rental_inquiry_funnels")
        .insert({ ...funnel, entity_id: entityId })
        .select("id")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, id: data.id });
    }

    case "delete_funnel": {
      const { funnelId } = body as { funnelId: string };
      const { error } = await admin
        .from("rental_inquiry_funnels")
        .delete()
        .eq("id", funnelId)
        .eq("entity_id", entityId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "save_funnel_step": {
      const { step } = body as {
        step: {
          id?: string;
          funnel_id: string;
          day_offset?: number;
          subject?: string;
          body?: string;
          resource_ids?: string[];
          sort_order?: number;
        };
      };
      // The parent funnel must belong to this entity.
      const { data: funnel } = await admin
        .from("rental_inquiry_funnels")
        .select("id")
        .eq("id", step.funnel_id)
        .eq("entity_id", entityId)
        .maybeSingle();
      if (!funnel) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (step.id) {
        const { id, ...patch } = step;
        const { error } = await admin
          .from("rental_inquiry_funnel_steps")
          .update(patch)
          .eq("id", id)
          .eq("entity_id", entityId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { error } = await admin
          .from("rental_inquiry_funnel_steps")
          .insert({ ...step, entity_id: entityId });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    case "delete_funnel_step": {
      const { stepId } = body as { stepId: string };
      const { error } = await admin
        .from("rental_inquiry_funnel_steps")
        .delete()
        .eq("id", stepId)
        .eq("entity_id", entityId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // --- Resource library (folders + files in the inquiry-resources bucket) --
    case "list_resources": {
      const [folders, resources] = await Promise.all([
        admin
          .from("rental_inquiry_resource_folders")
          .select("id, name, sort_order")
          .eq("entity_id", entityId)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        admin
          .from("rental_inquiry_resources")
          .select(
            "id, folder_id, label, file_path, mime_type, size_bytes, sort_order, created_at"
          )
          .eq("entity_id", entityId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);
      return NextResponse.json({
        folders: folders.data ?? [],
        resources: resources.data ?? [],
      });
    }

    case "save_resource_folder": {
      const { folder } = body as { folder: { id?: string; name: string; sort_order?: number } };
      if (folder.id) {
        const { error } = await admin
          .from("rental_inquiry_resource_folders")
          .update({ name: folder.name, ...(folder.sort_order != null ? { sort_order: folder.sort_order } : {}) })
          .eq("id", folder.id)
          .eq("entity_id", entityId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { error } = await admin
          .from("rental_inquiry_resource_folders")
          .insert({ entity_id: entityId, name: folder.name, sort_order: folder.sort_order ?? 0 });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    case "delete_resource_folder": {
      const { folderId } = body as { folderId: string };
      const { error } = await admin
        .from("rental_inquiry_resource_folders")
        .delete()
        .eq("id", folderId)
        .eq("entity_id", entityId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "save_resource": {
      const { resource } = body as {
        resource: {
          id?: string;
          folder_id?: string | null;
          label?: string;
          file_path?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          sort_order?: number;
        };
      };
      if (resource.id) {
        const { id, ...patch } = resource;
        const { error } = await admin
          .from("rental_inquiry_resources")
          .update(patch)
          .eq("id", id)
          .eq("entity_id", entityId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        if (!resource.label || !resource.file_path) {
          return NextResponse.json({ error: "label and file_path required" }, { status: 400 });
        }
        // The upload route only signs paths under this entity's prefix, but
        // re-assert it here so a crafted row can't point at another brand's file.
        if (!resource.file_path.startsWith(`${entityId}/`)) {
          return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
        }
        const { error } = await admin.from("rental_inquiry_resources").insert({
          entity_id: entityId,
          folder_id: resource.folder_id ?? null,
          label: resource.label,
          file_path: resource.file_path,
          mime_type: resource.mime_type ?? null,
          size_bytes: resource.size_bytes ?? null,
          sort_order: resource.sort_order ?? 0,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    case "delete_resource": {
      const { resourceId } = body as { resourceId: string };
      const { data: row } = await admin
        .from("rental_inquiry_resources")
        .select("id, file_path")
        .eq("id", resourceId)
        .eq("entity_id", entityId)
        .maybeSingle();
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const { error } = await admin
        .from("rental_inquiry_resources")
        .delete()
        .eq("id", resourceId)
        .eq("entity_id", entityId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      // Best-effort storage cleanup; an orphaned public file is harmless.
      await admin.storage.from("inquiry-resources").remove([row.file_path]);
      return NextResponse.json({ ok: true });
    }

    // --- Fleet rate card (Avon Trucks day/week/month rates + photos) --------
    case "list_fleet_rates": {
      const { data } = await admin
        .from("rental_inquiry_fleet_rates")
        .select(
          "id, vehicle_id, vehicle_name, class_slug, class_name, day_rate, week_rate, month_rate, photo_path, sort_order, updated_at"
        )
        .eq("entity_id", entityId)
        .order("sort_order", { ascending: true });
      return NextResponse.json({ rows: data ?? [] });
    }

    case "save_fleet_rate": {
      const { id, patch } = body as {
        id: string;
        patch: {
          day_rate?: number | null;
          week_rate?: number | null;
          month_rate?: number | null;
          photo_path?: string | null;
        };
      };
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      // Photo paths are only ever written by the upload flow, which signs
      // paths under this entity's prefix — re-assert it here too.
      if (patch.photo_path && !patch.photo_path.startsWith(`${entityId}/`)) {
        return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
      }
      const { error } = await admin
        .from("rental_inquiry_fleet_rates")
        .update(patch)
        .eq("id", id)
        .eq("entity_id", entityId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // --- FAQ reference (the FAQ tab of the resource library) ------------------
    case "list_faqs": {
      const { data } = await admin
        .from("rental_inquiry_faqs")
        .select("id, question, answer, sort_order, created_at")
        .eq("entity_id", entityId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      return NextResponse.json({ faqs: data ?? [] });
    }

    case "save_faq": {
      const { faq } = body as {
        faq: { id?: string; question?: string; answer?: string; sort_order?: number };
      };
      if (faq.id) {
        const { id, ...patch } = faq;
        const { error } = await admin
          .from("rental_inquiry_faqs")
          .update(patch)
          .eq("id", id)
          .eq("entity_id", entityId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        if (!faq.question?.trim() || !faq.answer?.trim()) {
          return NextResponse.json({ error: "question and answer required" }, { status: 400 });
        }
        const { error } = await admin.from("rental_inquiry_faqs").insert({
          entity_id: entityId,
          question: faq.question.trim(),
          answer: faq.answer.trim(),
          sort_order: faq.sort_order ?? 0,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    case "delete_faq": {
      const { faqId } = body as { faqId: string };
      const { error } = await admin
        .from("rental_inquiry_faqs")
        .delete()
        .eq("id", faqId)
        .eq("entity_id", entityId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // --- Quote writes -------------------------------------------------------
    case "create_quote": {
      const { id, draft } = body as {
        id: string;
        draft: {
          lines: { description: string; qty: number; rate: number }[];
          subtotal: number;
          tax_rate: number;
          tax: number;
          total: number;
          valid_until?: string | null;
          terms?: string | null;
        };
      };
      if (!(await inquiryBelongsTo(admin, id, entityId))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { data, error } = await admin
        .from("rental_inquiry_quotes")
        .insert({
          inquiry_id: id,
          entity_id: entityId,
          lines: draft.lines,
          subtotal: draft.subtotal,
          tax_rate: draft.tax_rate,
          tax: draft.tax,
          total: draft.total,
          valid_until: draft.valid_until ?? null,
          terms: draft.terms ?? null,
          created_by: entityId === HDR_ENTITY_ID ? "HDR Team" : "Versatile Team",
        })
        .select(QUOTE_COLUMNS)
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, quote: data });
    }

    case "update_quote": {
      const { quoteId, status } = body as { quoteId: string; status: string };
      const { error } = await admin
        .from("rental_inquiry_quotes")
        .update({
          status,
          accepted_at: status === "accepted" ? new Date().toISOString() : null,
        })
        .eq("id", quoteId)
        .eq("entity_id", entityId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "delete_quote": {
      const { quoteId } = body as { quoteId: string };
      const { error } = await admin
        .from("rental_inquiry_quotes")
        .delete()
        .eq("id", quoteId)
        .eq("entity_id", entityId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

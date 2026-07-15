import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEmbedEntity } from "@/lib/inquiries/embed-auth";
import { isOpenStatus } from "@/lib/inquiries/shared";
import {
  ENROLLMENT_COLUMNS,
  enrollmentQuote,
  funnelUsesQuote,
  processEnrollment,
  stepDueAt,
  type EnrollmentRow,
  type FunnelStepRow,
  FUNNEL_STEP_COLUMNS,
} from "@/lib/inquiries/funnel-send";

export const runtime = "nodejs";

// Enrollment control for the automated email funnels: put an inquiry on a
// funnel, stop it, or resume a broken chain. Sending has to happen server-side
// (the Resend key never reaches the browser), so unlike the other inquiry
// mutations BOTH modes go through this route:
//   * app: Supabase session — we verify the caller can see the inquiry via an
//     RLS-scoped read before doing anything with the admin client;
//   * embed: the x-embed-key header, hard-scoped to its entity as everywhere.
//
// Day-0 steps send inline on enroll; later steps are picked up by
// /api/cron/funnel-tick.

export async function POST(request: Request) {
  const admin = createAdminClient();
  const body = await request.json().catch(() => ({}));
  const { action } = body as { action?: string };

  // --- Resolve who's calling and which entity they may touch ---------------
  const embedEntityId = resolveEmbedEntity(request);
  let sessionUser = false;
  if (!embedEntityId) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    sessionUser = true;
  }

  // Load the inquiry the action targets, enforcing visibility: embed keys are
  // checked against their entity; sessions read through RLS.
  async function loadInquiry(inquiryId: string) {
    if (embedEntityId) {
      const { data } = await admin
        .from("rental_inquiries")
        .select("id, entity_id, status, email")
        .eq("id", inquiryId)
        .eq("entity_id", embedEntityId)
        .maybeSingle();
      return data;
    }
    const supabase = await createClient();
    const { data } = await supabase
      .from("rental_inquiries")
      .select("id, entity_id, status, email")
      .eq("id", inquiryId)
      .maybeSingle();
    return data;
  }

  async function loadEnrollment(enrollmentId: string) {
    const { data } = await admin
      .from("rental_inquiry_funnel_enrollments")
      .select(ENROLLMENT_COLUMNS)
      .eq("id", enrollmentId)
      .maybeSingle();
    if (!data) return null;
    if (embedEntityId && data.entity_id !== embedEntityId) return null;
    if (sessionUser) {
      // Session callers must be able to see the enrollment's inquiry via RLS.
      const supabase = await createClient();
      const { data: inq } = await supabase
        .from("rental_inquiries")
        .select("id")
        .eq("id", data.inquiry_id)
        .maybeSingle();
      if (!inq) return null;
    }
    return data as EnrollmentRow & { enrolled_by: string | null };
  }

  switch (action) {
    case "enroll": {
      const { inquiryId, funnelId, actor, quoteId } = body as {
        inquiryId: string;
        funnelId: string;
        actor?: string | null;
        quoteId?: string | null;
      };
      if (!inquiryId || !funnelId) {
        return NextResponse.json({ error: "inquiryId and funnelId required" }, { status: 400 });
      }
      const inquiry = await loadInquiry(inquiryId);
      if (!inquiry) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (!inquiry.email) {
        return NextResponse.json(
          { error: "This inquiry has no email address on file" },
          { status: 400 }
        );
      }
      if (!isOpenStatus(inquiry.status ?? "new")) {
        return NextResponse.json(
          { error: "Funnels only run on open inquiries (New / Quoted / Follow-Up)" },
          { status: 400 }
        );
      }
      const { data: funnel } = await admin
        .from("rental_inquiry_funnels")
        .select("id, entity_id, name, archived")
        .eq("id", funnelId)
        .eq("entity_id", inquiry.entity_id)
        .maybeSingle();
      if (!funnel || funnel.archived) {
        return NextResponse.json({ error: "Funnel not found" }, { status: 404 });
      }
      const { data: steps } = await admin
        .from("rental_inquiry_funnel_steps")
        .select(FUNNEL_STEP_COLUMNS)
        .eq("funnel_id", funnelId)
        .order("day_offset", { ascending: true })
        .order("sort_order", { ascending: true });
      const ordered = (steps ?? []) as FunnelStepRow[];
      if (ordered.length === 0) {
        return NextResponse.json({ error: "This funnel has no steps yet" }, { status: 400 });
      }

      // A picked quote must be one of THIS inquiry's saved quotes.
      if (quoteId) {
        const { data: q } = await admin
          .from("rental_inquiry_quotes")
          .select("id")
          .eq("id", quoteId)
          .eq("inquiry_id", inquiryId)
          .eq("entity_id", inquiry.entity_id)
          .maybeSingle();
        if (!q) {
          return NextResponse.json(
            { error: "That quote doesn't belong to this inquiry" },
            { status: 400 }
          );
        }
      }

      // Quote-led funnels ({quote} in a step) refuse to start without a quote —
      // better a clear error now than a customer email with a hole in it.
      if (funnelUsesQuote(ordered) && !quoteId) {
        const fallback = await enrollmentQuote(admin, {
          inquiry_id: inquiryId,
          quote_id: null,
        });
        if (!fallback) {
          return NextResponse.json(
            { error: "This funnel sends your quote — draft a quote on the inquiry first" },
            { status: 400 }
          );
        }
      }

      // Switching funnels replaces the live one — a lead should never be on two.
      await admin
        .from("rental_inquiry_funnel_enrollments")
        .update({ status: "stopped", stopped_reason: "manual:replaced" })
        .eq("inquiry_id", inquiryId)
        .eq("status", "active");

      const enrolledAt = new Date().toISOString();
      const { data: enrollment, error } = await admin
        .from("rental_inquiry_funnel_enrollments")
        .insert({
          entity_id: inquiry.entity_id,
          inquiry_id: inquiryId,
          funnel_id: funnelId,
          quote_id: quoteId ?? null,
          status: "active",
          enrolled_at: enrolledAt,
          enrolled_by: actor ?? null,
          steps_sent: 0,
          next_send_at: stepDueAt(enrolledAt, ordered[0].day_offset),
        })
        .select(ENROLLMENT_COLUMNS)
        .single();
      if (error || !enrollment) {
        return NextResponse.json(
          { error: error?.message ?? "Enroll failed" },
          { status: 500 }
        );
      }

      // Day-0 step goes out immediately; anything later waits for the cron.
      let sendResult = null;
      if (ordered[0].day_offset === 0) {
        sendResult = await processEnrollment(admin, enrollment as EnrollmentRow);
        if (sendResult.outcome === "error") {
          // Roll the enrollment back so a rep isn't left with a silent dud
          // (most likely cause: RESEND_API_KEY missing).
          await admin
            .from("rental_inquiry_funnel_enrollments")
            .delete()
            .eq("id", enrollment.id);
          return NextResponse.json(
            { error: `Couldn't send the first email: ${sendResult.error}` },
            { status: 502 }
          );
        }
      }

      const { data: fresh } = await admin
        .from("rental_inquiry_funnel_enrollments")
        .select(ENROLLMENT_COLUMNS)
        .eq("id", enrollment.id)
        .maybeSingle();
      return NextResponse.json({ ok: true, enrollment: fresh, sendResult });
    }

    case "stop": {
      const { enrollmentId } = body as { enrollmentId: string };
      const enrollment = await loadEnrollment(enrollmentId);
      if (!enrollment) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const { error } = await admin
        .from("rental_inquiry_funnel_enrollments")
        .update({ status: "stopped", stopped_reason: "manual" })
        .eq("id", enrollmentId)
        .in("status", ["active", "paused_replied"]);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "resume": {
      // Re-arm a paused/stopped chain, continuing from the next unsent step.
      // Anything already overdue goes out on the next cron tick (within the
      // hour), not instantly — resuming shouldn't surprise-blast a customer.
      const { enrollmentId } = body as { enrollmentId: string };
      const enrollment = await loadEnrollment(enrollmentId);
      if (!enrollment) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (enrollment.status === "completed") {
        return NextResponse.json({ error: "This funnel already finished" }, { status: 400 });
      }
      const { data: steps } = await admin
        .from("rental_inquiry_funnel_steps")
        .select(FUNNEL_STEP_COLUMNS)
        .eq("funnel_id", enrollment.funnel_id)
        .order("day_offset", { ascending: true })
        .order("sort_order", { ascending: true });
      const ordered = (steps ?? []) as FunnelStepRow[];
      const next = ordered[enrollment.steps_sent];
      if (!next) {
        await admin
          .from("rental_inquiry_funnel_enrollments")
          .update({ status: "completed", next_send_at: null })
          .eq("id", enrollmentId);
        return NextResponse.json({ ok: true, completed: true });
      }
      const due = stepDueAt(enrollment.enrolled_at, next.day_offset);
      const nextSendAt = new Date(due) < new Date() ? new Date().toISOString() : due;
      const { error } = await admin
        .from("rental_inquiry_funnel_enrollments")
        .update({ status: "active", next_send_at: nextSendAt, replied_at: null })
        .eq("id", enrollmentId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

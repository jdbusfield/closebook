import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ENROLLMENT_COLUMNS,
  processEnrollment,
  type EnrollmentRow,
} from "@/lib/inquiries/funnel-send";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================================
// Hourly funnel tick: send every due funnel step.
//
// Finds active enrollments whose next_send_at has passed and runs each through
// processEnrollment(), which re-verifies the chain is unbroken (inquiry still
// open, no inbound reply since enrollment) before sending — so even if a DB
// trigger was somehow missed, an email never goes to a customer who already
// replied or booked. Failures are reported per-enrollment and never stall the
// batch; a failed send stays due and is retried on the next tick.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
// ============================================================================

const BATCH_LIMIT = 100;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: due, error } = await admin
    .from("rental_inquiry_funnel_enrollments")
    .select(ENROLLMENT_COLUMNS)
    .eq("status", "active")
    .lte("next_send_at", new Date().toISOString())
    .order("next_send_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const enrollment of (due ?? []) as EnrollmentRow[]) {
    const result = await processEnrollment(admin, enrollment);
    results.push({ enrollment: enrollment.id, inquiry: enrollment.inquiry_id, ...result });
    if (result.outcome === "error") {
      console.error("[cron/funnel-tick] send failed", enrollment.id, result.error);
    }
  }

  return NextResponse.json({
    ok: true,
    due: due?.length ?? 0,
    sent: results.filter((r) => r.outcome === "sent").length,
    results,
  });
}

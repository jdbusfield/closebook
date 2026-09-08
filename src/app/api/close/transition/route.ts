import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CloseStatus } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// POST /api/close/transition
// Body: { periodId, targetStatus }
// Transitions a close period through the state machine:
//   open → in_progress → review → soft_closed → closed → locked
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<CloseStatus, CloseStatus[]> = {
  open: ["in_progress"],
  in_progress: ["review"],
  review: ["soft_closed", "in_progress"], // can revert to in_progress
  soft_closed: ["closed", "review"],       // can revert to review
  closed: ["locked", "soft_closed"],       // can revert to soft_closed
  locked: [],                              // terminal state
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { periodId, targetStatus } = body as {
    periodId: string;
    targetStatus: CloseStatus;
  };

  if (!periodId || !targetStatus) {
    return NextResponse.json(
      { error: "periodId and targetStatus are required" },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Fetch current period
  const { data: period, error: fetchError } = await admin
    .from("close_periods")
    .select("*")
    .eq("id", periodId)
    .single();

  if (fetchError || !period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }

  const currentStatus = period.status as CloseStatus;
  const allowedTargets = VALID_TRANSITIONS[currentStatus] ?? [];

  if (!allowedTargets.includes(targetStatus)) {
    return NextResponse.json(
      {
        error: `Cannot transition from "${currentStatus}" to "${targetStatus}". Allowed: ${allowedTargets.join(", ") || "none"}`,
      },
      { status: 400 }
    );
  }

  // Validation checks for forward transitions
  if (targetStatus === "review" && currentStatus === "in_progress") {
    // All phase 1-3 tasks must be approved/na before going to review
    const { data: tasks } = await admin
      .from("close_tasks")
      .select("phase, status, is_immaterial")
      .eq("close_period_id", periodId);

    const incompletePreReview = (tasks ?? []).filter(
      (t: { phase: number; status: string; is_immaterial: boolean }) =>
        t.phase <= 3 &&
        t.status !== "approved" &&
        t.status !== "na" &&
        !t.is_immaterial
    );

    if (incompletePreReview.length > 0) {
      return NextResponse.json(
        {
          error: `${incompletePreReview.length} task(s) in phases 1-3 are not yet approved. Complete or waive them before moving to review.`,
        },
        { status: 400 }
      );
    }
  }

  if (targetStatus === "soft_closed") {
    // All tasks must be approved/na/immaterial
    const { data: tasks } = await admin
      .from("close_tasks")
      .select("status, is_immaterial")
      .eq("close_period_id", periodId);

    const incomplete = (tasks ?? []).filter(
      (t: { status: string; is_immaterial: boolean }) =>
        t.status !== "approved" &&
        t.status !== "na" &&
        !t.is_immaterial
    );

    if (incomplete.length > 0) {
      return NextResponse.json(
        {
          error: `${incomplete.length} task(s) are not yet approved. Complete or waive them before soft close.`,
        },
        { status: 400 }
      );
    }

    // All critical gate checks must pass
    const { data: gateChecks } = await admin
      .from("close_gate_checks")
      .select("check_type, status, is_critical")
      .eq("close_period_id", periodId);

    const criticalFailed = (gateChecks ?? []).filter(
      (gc: { is_critical: boolean; status: string }) =>
        gc.is_critical && gc.status !== "passed"
    );

    if (criticalFailed.length > 0) {
      return NextResponse.json(
        {
          error: `${criticalFailed.length} critical gate check(s) have not passed. Run gate checks and resolve failures before soft close.`,
        },
        { status: 400 }
      );
    }
  }

  // Build the update payload
  const updateData: Record<string, unknown> = {
    status: targetStatus,
  };

  if (targetStatus === "soft_closed") {
    updateData.soft_closed_at = new Date().toISOString();
    updateData.soft_closed_by = user.id;
  } else if (targetStatus === "closed") {
    updateData.hard_closed_at = new Date().toISOString();
    updateData.hard_closed_by = user.id;
    updateData.closed_at = new Date().toISOString();
    updateData.closed_by = user.id;
  } else if (targetStatus === "locked") {
    // locked is permanent
  } else if (targetStatus === "review") {
    // Clear soft close fields if reverting
    if (currentStatus === "soft_closed") {
      updateData.soft_closed_at = null;
      updateData.soft_closed_by = null;
    }
  } else if (targetStatus === "in_progress") {
    // Reverting from review
  }

  const { error: updateError } = await admin
    .from("close_periods")
    .update(updateData)
    .eq("id", periodId);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    previousStatus: currentStatus,
    newStatus: targetStatus,
  });
}

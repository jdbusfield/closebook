import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayLA } from "@/lib/rewards/run";
import { previousMonthEnd, sendMonthlyStatements } from "@/lib/rewards/portal/statements";

// ============================================================================
// Versatile Rewards monthly statement emails, on the 5th of each month for the
// month just ended. Sends nothing unless the program's Statement Emails switch
// is on (Rewards > Settings), and never twice for the same month.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
// ============================================================================

export const maxDuration = 600;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: programs, error } = await admin.from("rewards_programs").select("entity_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const monthEnd = previousMonthEnd(todayLA());
  const runs = [];
  for (const p of programs ?? []) {
    try {
      runs.push(await sendMonthlyStatements(admin, p.entity_id, monthEnd));
    } catch (err) {
      runs.push({ entityId: p.entity_id, error: err instanceof Error ? err.message : "Statement run failed" });
    }
  }
  return NextResponse.json({ monthEnd, runs });
}

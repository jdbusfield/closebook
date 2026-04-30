import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncRwInvoiceItems } from "@/lib/rentalworks/sync-invoice-items";

// Long-running sync: cron or manual backfill.
export const maxDuration = 600;

export async function POST(request: Request) {
  // Allow either a cron secret OR a logged-in user (for manual backfill from the UI)
  const cronSecret = request.headers.get("x-cron-secret");
  const validCron = cronSecret && cronSecret === process.env.CRON_SECRET;

  if (!validCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: { monthsBack?: number; force?: boolean; maxInvoices?: number } = {};
  try {
    body = await request.json();
  } catch {
    // No body — use defaults
  }

  try {
    const result = await syncRwInvoiceItems({
      monthsBack: body.monthsBack,
      force: body.force,
      maxInvoices: body.maxInvoices,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}

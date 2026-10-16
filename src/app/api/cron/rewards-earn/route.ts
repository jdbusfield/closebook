import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncRwInvoiceItems } from "@/lib/rentalworks/sync-invoice-items";
import { isRewardsEntity, runRewards } from "@/lib/rewards/run";

// ============================================================================
// Versatile Rewards nightly earn run.
//
// Refreshes the RentalWorks invoice cache first (unchanged invoices are
// skipped, so the daily delta is small) and then posts points for every
// entity with a rewards program. It refreshes the cache itself rather than
// relying on /api/sync/cron, so status changes (an invoice getting paid) reach
// the ledger even on nights the long QBO sync runs out of time.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
// ============================================================================

export const maxDuration = 600;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let cacheSync: Record<string, unknown>;
  try {
    const r = await syncRwInvoiceItems();
    cacheSync = { ok: true, scanned: r.invoicesScanned, updated: r.invoicesUpdated, errors: r.errors.length, ms: r.durationMs };
  } catch (err) {
    // A failed refresh still lets points post from what the cache has.
    cacheSync = { ok: false, error: err instanceof Error ? err.message : "Cache sync failed" };
  }

  const admin = createAdminClient();
  const { data: programs, error } = await admin.from("rewards_programs").select("entity_id");
  if (error) return NextResponse.json({ error: error.message, cacheSync }, { status: 500 });

  const runs: Record<string, unknown>[] = [];
  for (const p of programs ?? []) {
    if (!(await isRewardsEntity(admin, p.entity_id))) {
      runs.push({ entityId: p.entity_id, skipped: "rewards feature is off for this entity" });
      continue;
    }
    try {
      runs.push({ entityId: p.entity_id, ...(await runRewards(admin, p.entity_id)) });
    } catch (err) {
      runs.push({ entityId: p.entity_id, error: err instanceof Error ? err.message : "Run failed" });
    }
  }
  return NextResponse.json({ cacheSync, runs });
}

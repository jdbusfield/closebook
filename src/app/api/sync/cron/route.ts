import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300; // Syncing multiple entities × months needs extended timeout

const DELAY_BETWEEN_SYNCS_MS = 2000; // 2s stagger between sync calls to avoid rate limits

/**
 * Stop starting new period syncs after this much wall-clock time so the run
 * ends with a summary instead of being killed by the platform at maxDuration.
 * Whatever did not get synced is the stalest work tomorrow and runs first.
 */
const TIME_BUDGET_MS = 250_000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads an SSE stream from the sync endpoint and returns the final event.
 */
async function readSyncStream(
  response: Response
): Promise<Record<string, unknown>> {
  let lastEvent: Record<string, unknown> = {};
  if (!response.body) return lastEvent;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          lastEvent = JSON.parse(line.slice(6));
        } catch {
          /* skip malformed events */
        }
      }
    }
  }

  return lastEvent;
}

interface WorkItem {
  entityId: string;
  companyName: string | null;
  year: number;
  month: number;
  /** trial_balances.synced_at for this entity-period, null when never synced */
  syncedAt: string | null;
}

interface MonthResult {
  year: number;
  month: number;
  success: boolean;
  recordsSynced: number;
  dataChanged: boolean;
  error?: string;
  skipped?: boolean;
}

export async function GET(request: Request) {
  const startedAt = Date.now();

  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Reset connections stuck in "syncing" (timed-out) or "error" (failed last run)
  // so the cron can retry them. A connection stuck in "syncing" for >10 minutes
  // almost certainly timed out without hitting the catch block.
  await supabase
    .from("qbo_connections")
    .update({ sync_status: "idle", sync_error: null })
    .eq("sync_status", "error");

  await supabase
    .from("qbo_connections")
    .update({ sync_status: "idle", sync_error: null })
    .eq("sync_status", "syncing")
    .lt("last_sync_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

  // Get all active connections
  const { data: connections } = await supabase
    .from("qbo_connections")
    .select("entity_id, company_name")
    .eq("sync_status", "idle");

  if (!connections || connections.length === 0) {
    return NextResponse.json({ message: "No connections to sync" });
  }

  // Periods: previous December + January through current month
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-indexed
  const monthsToSync = Array.from({ length: currentMonth }, (_, i) => i + 1);
  const prevYear = currentYear - 1;
  const syncPrevDecember = true;

  const periodsToSync: { year: number; month: number }[] = [];
  if (syncPrevDecember) periodsToSync.push({ year: prevYear, month: 12 });
  for (const month of monthsToSync) periodsToSync.push({ year: currentYear, month });

  // Last sync time per entity-period, so the stalest work runs first. A run
  // that gets cut off by the time budget leaves the rest for tomorrow.
  const entityIds = connections.map((c) => c.entity_id);
  const { data: tbRows } = await supabase
    .from("trial_balances")
    .select("entity_id, period_year, period_month, synced_at")
    .in("entity_id", entityIds)
    .in("period_year", [prevYear, currentYear]);
  const syncedAt = new Map<string, string>();
  for (const r of tbRows ?? []) {
    const key = `${r.entity_id}|${r.period_year}|${r.period_month}`;
    const prev = syncedAt.get(key);
    if (!prev || (r.synced_at && r.synced_at > prev)) syncedAt.set(key, r.synced_at ?? "");
  }

  const work: WorkItem[] = [];
  for (const conn of connections) {
    for (const p of periodsToSync) {
      work.push({
        entityId: conn.entity_id,
        companyName: conn.company_name,
        year: p.year,
        month: p.month,
        syncedAt: syncedAt.get(`${conn.entity_id}|${p.year}|${p.month}`) ?? null,
      });
    }
  }
  // Never-synced first, then oldest sync first, then the newest month first.
  work.sort((a, b) => {
    if (a.syncedAt === null && b.syncedAt !== null) return -1;
    if (a.syncedAt !== null && b.syncedAt === null) return 1;
    if (a.syncedAt !== b.syncedAt) return (a.syncedAt ?? "") < (b.syncedAt ?? "") ? -1 : 1;
    return b.year * 100 + b.month - (a.year * 100 + a.month);
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET!;

  const resultsByEntity = new Map<string, { entityId: string; companyName: string | null; months: MonthResult[] }>();
  for (const conn of connections) {
    resultsByEntity.set(conn.entity_id, { entityId: conn.entity_id, companyName: conn.company_name, months: [] });
  }

  let skipped = 0;
  let timeBudgetHit = false;

  for (const item of work) {
    const entry = resultsByEntity.get(item.entityId)!;
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      timeBudgetHit = true;
      skipped++;
      entry.months.push({
        year: item.year,
        month: item.month,
        success: false,
        recordsSynced: 0,
        dataChanged: false,
        skipped: true,
        error: "Skipped: time budget reached; runs first tomorrow",
      });
      continue;
    }

    try {
      const response = await fetch(`${baseUrl}/api/qbo/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": cronSecret,
        },
        body: JSON.stringify({
          entityId: item.entityId,
          syncType: "incremental",
          periodYear: item.year,
          periodMonth: item.month,
        }),
      });

      const lastEvent = await readSyncStream(response);

      entry.months.push({
        year: item.year,
        month: item.month,
        success: !lastEvent.error,
        recordsSynced: (lastEvent.recordsSynced as number) ?? 0,
        dataChanged: (lastEvent.dataChanged as boolean) ?? false,
        error: lastEvent.error ? String(lastEvent.error) : undefined,
      });
    } catch (err) {
      entry.months.push({
        year: item.year,
        month: item.month,
        success: false,
        recordsSynced: 0,
        dataChanged: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // Stagger between syncs to stay well within QBO rate limits (100 req/min/realm)
    await delay(DELAY_BETWEEN_SYNCS_MS);
  }

  const results = [...resultsByEntity.values()];

  // Drift snapshots for every entity that synced at least one period this run
  for (const entityResult of results) {
    const synced = entityResult.months.filter((m) => m.success);
    if (synced.length === 0) continue;
    const byYear = new Map<number, number[]>();
    for (const m of synced) {
      const list = byYear.get(m.year) ?? [];
      list.push(m.month);
      byYear.set(m.year, list);
    }
    for (const [year, months] of byYear) {
      try {
        await fetch(`${baseUrl}/api/drift/snapshot`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": cronSecret,
          },
          body: JSON.stringify({ entityId: entityResult.entityId, year, months }),
        });
      } catch {
        // Drift snapshot failure should not block the sync summary
      }
    }
  }

  // Take RentalWorks revenue snapshots (Versatile + Silverco)
  let rwSnapshotResult: Record<string, unknown> | null = null;
  try {
    const rwResp = await fetch(`${baseUrl}/api/rw-revenue/snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({}),
    });
    rwSnapshotResult = await rwResp.json();
  } catch {
    // RW snapshot failure should not block the sync summary
  }

  // Refresh RentalWorks invoice + line-item cache (used for I-Code revenue analytics).
  // Skips invoices whose ModifiedDateTime is unchanged, so the daily delta is small.
  let rwInvoiceItemsSync: Record<string, unknown> | null = null;
  try {
    const itemsResp = await fetch(`${baseUrl}/api/rw-invoice-items/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({}),
    });
    rwInvoiceItemsSync = await itemsResp.json();
  } catch {
    // Invoice-item sync failure should not block the sync summary
  }

  // Summary stats
  const totalSyncs = results.reduce((sum, r) => sum + r.months.filter((m) => !m.skipped).length, 0);
  const successfulSyncs = results.reduce(
    (sum, r) => sum + r.months.filter((m) => m.success).length,
    0
  );
  const changedPeriods = results.reduce(
    (sum, r) => sum + r.months.filter((m) => m.dataChanged).length,
    0
  );
  const totalRecords = results.reduce(
    (sum, r) => sum + r.months.reduce((ms, m) => ms + m.recordsSynced, 0),
    0
  );

  return NextResponse.json({
    year: currentYear,
    previousDecemberIncluded: syncPrevDecember,
    monthsSynced: periodsToSync.length,
    entities: connections.length,
    totalSyncs,
    successfulSyncs,
    changedPeriods,
    totalRecords,
    skipped,
    timeBudgetHit,
    elapsedMs: Date.now() - startedAt,
    results,
    rwRevenueSnapshot: rwSnapshotResult,
    rwInvoiceItemsSync,
  });
}

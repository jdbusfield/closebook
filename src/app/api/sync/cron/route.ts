import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300; // Syncing multiple entities × months needs extended timeout

const DELAY_BETWEEN_SYNCS_MS = 2000; // 2s stagger between sync calls to avoid rate limits

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

export async function GET(request: Request) {
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

  // Determine months to sync: previous December + January through current month
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-indexed
  const monthsToSync = Array.from({ length: currentMonth }, (_, i) => i + 1);

  // Also sync previous year's December (adjustments may still land there)
  const prevYear = currentYear - 1;
  const syncPrevDecember = true;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET!;

  const results: {
    entityId: string;
    companyName: string | null;
    months: {
      year: number;
      month: number;
      success: boolean;
      recordsSynced: number;
      dataChanged: boolean;
      error?: string;
    }[];
  }[] = [];

  // Build full list of periods to sync: previous Dec + current year months
  const periodsToSync: { year: number; month: number }[] = [];
  if (syncPrevDecember) {
    periodsToSync.push({ year: prevYear, month: 12 });
  }
  for (const month of monthsToSync) {
    periodsToSync.push({ year: currentYear, month });
  }

  // Process each entity sequentially (avoids token refresh race conditions
  // within a single QBO realm). Months within an entity are also sequential
  // since they share the same access token.
  for (const conn of connections) {
    const entityResult: (typeof results)[0] = {
      entityId: conn.entity_id,
      companyName: conn.company_name,
      months: [],
    };

    for (const period of periodsToSync) {
      try {
        const response = await fetch(`${baseUrl}/api/qbo/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": cronSecret,
          },
          body: JSON.stringify({
            entityId: conn.entity_id,
            syncType: "incremental",
            periodYear: period.year,
            periodMonth: period.month,
          }),
        });

        const lastEvent = await readSyncStream(response);

        entityResult.months.push({
          year: period.year,
          month: period.month,
          success: !lastEvent.error,
          recordsSynced: (lastEvent.recordsSynced as number) ?? 0,
          dataChanged: (lastEvent.dataChanged as boolean) ?? false,
          error: lastEvent.error ? String(lastEvent.error) : undefined,
        });
      } catch (err) {
        entityResult.months.push({
          year: period.year,
          month: period.month,
          success: false,
          recordsSynced: 0,
          dataChanged: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }

      // Stagger between syncs to stay well within QBO rate limits (100 req/min/realm)
      await delay(DELAY_BETWEEN_SYNCS_MS);
    }

    results.push(entityResult);

    // Take drift snapshot for current year months
    try {
      await fetch(`${baseUrl}/api/drift/snapshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": cronSecret,
        },
        body: JSON.stringify({
          entityId: conn.entity_id,
          year: currentYear,
          months: monthsToSync,
        }),
      });
    } catch {
      // Drift snapshot failure should not block the sync summary
    }

    // Take drift snapshot for previous December
    if (syncPrevDecember) {
      try {
        await fetch(`${baseUrl}/api/drift/snapshot`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": cronSecret,
          },
          body: JSON.stringify({
            entityId: conn.entity_id,
            year: prevYear,
            months: [12],
          }),
        });
      } catch {
        // Drift snapshot failure should not block the sync summary
      }
    }
  }

  // Take RentalWorks revenue snapshot (Versatile Studios)
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
  const totalSyncs = results.reduce((sum, r) => sum + r.months.length, 0);
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
    results,
    rwRevenueSnapshot: rwSnapshotResult,
    rwInvoiceItemsSync,
  });
}

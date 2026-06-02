import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchRentalWorksRevenueData,
  type RentalWorksRevenueData,
} from "@/lib/rentalworks/fetch-revenue-data";
import {
  processRevenueData,
  getRevenueFilterForEntity,
} from "@/lib/utils/revenue-projection";
import type { Json } from "@/lib/types/database.types";

export const maxDuration = 120;

// Entities that get a daily RentalWorks revenue snapshot. Each is matched by a
// case-insensitive name fragment; the record-prefix filter is resolved from the
// entity name (Versatile "V" vs Silverco "AS"/"AC").
const SNAPSHOT_ENTITY_PATTERNS = ["%Versatile%", "%silverco%"];

// POST — daily cron snapshot of RentalWorks revenue data
// Called from /api/sync/cron with x-cron-secret header
export async function POST(request: Request) {
  const cronSecret = request.headers.get("x-cron-secret");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Look up every entity we snapshot (Versatile, Silverco, …)
    const entityRows: { id: string; name: string }[] = [];
    for (const pattern of SNAPSHOT_ENTITY_PATTERNS) {
      const { data: rows } = await supabase
        .from("entities")
        .select("id, name")
        .ilike("name", pattern)
        .eq("is_active", true)
        .limit(1);
      if (rows?.[0]) entityRows.push(rows[0]);
    }

    if (entityRows.length === 0) {
      return NextResponse.json(
        { error: "No snapshot entities found" },
        { status: 404 }
      );
    }

    // Fetch raw data from RentalWorks API once, then process per entity.
    const rwData = await fetchRentalWorksRevenueData();

    const summaries = [];
    for (const entity of entityRows) {
      const summary = await snapshotEntity(supabase, today, entity, rwData);
      summaries.push(summary);
      if ("error" in summary) {
        return NextResponse.json(summary, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, snapshotDate: today, entities: summaries });
  } catch (err) {
    console.error("POST /api/rw-revenue/snapshot error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

// Process and persist one entity's revenue snapshot for the given date.
async function snapshotEntity(
  supabase: ReturnType<typeof createAdminClient>,
  today: string,
  entity: { id: string; name: string },
  rwData: RentalWorksRevenueData,
) {
  const entityId = entity.id;
  const entityName = entity.name;
  const { invoices, orders, quotes } = rwData;

  // Process through the same pipeline as the dashboard, with this entity's filter
  const result = processRevenueData(
    invoices,
    orders,
    quotes,
    "invoice_date",
    getRevenueFilterForEntity(entityName),
  );

  try {
    // Upsert the main snapshot row
    const { data: snapshot, error: snapErr } = await supabase
      .from("rw_revenue_snapshots")
      .upsert(
        {
          entity_id: entityId,
          snapshot_date: today,
          ytd_revenue: result.ytdRevenue,
          current_month_actual: result.currentMonthActual,
          current_month_projected: result.currentMonthProjected,
          pipeline_value: result.pipelineValue,
          quote_opportunities: result.quoteOpportunities,
          pipeline_order_count: result.pipelineOrders.length,
          pipeline_quote_count: result.pipelineQuotes.length,
          closed_invoice_count: result.closedInvoices.length,
          full_payload: result as unknown as Json,
          date_mode: result.dateMode,
          data_as_of: result.dataAsOf,
        },
        { onConflict: "entity_id,snapshot_date,date_mode" }
      )
      .select("id")
      .single();

    if (snapErr) {
      return {
        error: "Failed to upsert snapshot",
        entity: entityName,
        detail: snapErr.message,
      };
    }

    // Delete existing month rows for this snapshot date (for idempotent upsert)
    await supabase
      .from("rw_revenue_snapshot_months")
      .delete()
      .eq("entity_id", entityId)
      .eq("snapshot_date", today);

    // Insert month-level breakdown rows
    const monthRows = result.monthlyData.map((m) => ({
      snapshot_id: snapshot.id,
      entity_id: entityId,
      snapshot_date: today,
      month_key: m.month,
      month_label: m.label,
      closed: m.closed,
      pending: m.pending,
      pipeline: m.pipeline,
      forecast: m.forecast,
      billed: m.billed,
      earned: m.earned,
      accrued: m.accrued,
      deferred: m.deferred,
    }));

    const { error: monthErr } = await supabase
      .from("rw_revenue_snapshot_months")
      .insert(monthRows);

    if (monthErr) {
      console.error("Month rows insert error:", monthErr.message);
      // Non-fatal — the main snapshot is already saved
    }

    // Mirror into revenue_projection_snapshots so the Revenue Projection page's
    // Trends chart picks up today's values without needing a manual Save Today click.
    const now = new Date();
    const periodYear = now.getFullYear();
    const periodMonth = now.getMonth() + 1;
    const projectionRows = [
      { section_id: "revenue", projected_amount: result.currentMonthProjected },
      { section_id: "pipeline", projected_amount: result.pipelineValue },
      { section_id: "ytd", projected_amount: result.ytdRevenue },
    ].map((r) => ({
      entity_id: entityId,
      period_year: periodYear,
      period_month: periodMonth,
      section_id: r.section_id,
      projected_amount: r.projected_amount,
      snapshot_date: today,
      source: "cron",
    }));

    const { error: projErr } = await (
      supabase as unknown as {
        from: (t: string) => {
          upsert: (
            rows: unknown,
            opts: { onConflict: string }
          ) => Promise<{ error: { message: string } | null }>;
        };
      }
    )
      .from("revenue_projection_snapshots")
      .upsert(projectionRows, {
        onConflict:
          "entity_id,period_year,period_month,section_id,snapshot_date",
      });

    if (projErr) {
      console.error("Projection snapshot insert error:", projErr.message);
      // Non-fatal — RW snapshot is already saved
    }

    return {
      entity: entityName,
      snapshotId: snapshot.id,
      kpis: {
        ytdRevenue: result.ytdRevenue,
        currentMonthActual: result.currentMonthActual,
        currentMonthProjected: result.currentMonthProjected,
        pipelineValue: result.pipelineValue,
        quoteOpportunities: result.quoteOpportunities,
      },
      monthsRecorded: monthRows.length,
    };
  } catch (err) {
    console.error(`Snapshot error for ${entityName}:`, err);
    return {
      error: err instanceof Error ? err.message : "Internal server error",
      entity: entityName,
    };
  }
}

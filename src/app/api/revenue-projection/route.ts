import { NextResponse } from "next/server";
import {
  processRevenueData,
  getRevenueFilterForEntity,
} from "@/lib/utils/revenue-projection";
import { fetchRentalWorksRevenueData } from "@/lib/rentalworks/fetch-revenue-data";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { entityId } = body as { entityId: string };

    if (!entityId) {
      return NextResponse.json(
        { error: "entityId is required" },
        { status: 400 },
      );
    }

    // Resolve the entity's record-prefix filter from its name
    const supabase = createAdminClient();
    const { data: entityRow } = await supabase
      .from("entities")
      .select("name")
      .eq("id", entityId)
      .single();
    const filter = getRevenueFilterForEntity(
      (entityRow as { name?: string } | null)?.name,
    );

    const { invoices, orders, quotes } = await fetchRentalWorksRevenueData();

    // Process with default invoice_date mode; client will re-process for other modes
    const result = processRevenueData(
      invoices,
      orders,
      quotes,
      "invoice_date",
      filter,
    );

    return NextResponse.json({
      ...result,
      // Include raw rows so the client can re-process without another API call
      _rawInvoices: invoices,
      _rawOrders: orders,
      _rawQuotes: quotes,
    });
  } catch (err) {
    console.error("POST /api/revenue-projection error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

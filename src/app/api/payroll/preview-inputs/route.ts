import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/payroll/preview-inputs?year=2026&month=4
 *
 * Returns the manually-entered Month Preview figures (revenue estimate/budget,
 * payroll budget) per entity for a month. Gracefully returns empty if the
 * table doesn't exist yet (migration 20260706_payroll_preview_inputs).
 */
export async function GET(req: NextRequest) {
  try {
    const year = Number(req.nextUrl.searchParams.get("year"));
    const month = Number(req.nextUrl.searchParams.get("month"));
    if (!year || !month) {
      return NextResponse.json({ error: "year and month are required" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("payroll_preview_inputs")
      .select("*")
      .eq("year", year)
      .eq("month", month);

    if (error && error.message?.includes("payroll_preview_inputs")) {
      return NextResponse.json({ inputs: [], tableExists: false });
    }
    if (error) throw error;

    return NextResponse.json({ inputs: data ?? [], tableExists: true });
  } catch (err) {
    console.error("Preview inputs GET error:", err);
    return NextResponse.json({ inputs: [], tableExists: false });
  }
}

/**
 * PUT /api/payroll/preview-inputs
 *
 * Body: { year, month, inputs: [{ entityId, revenueEstimate?, revenueBudget?,
 *          revenueDeduction?, payrollBudget? }] }
 * Upserts one row per entity for the month.
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { year, month, inputs } = body;
    if (!year || !month || !Array.isArray(inputs)) {
      return NextResponse.json(
        { error: "year, month, and inputs[] are required" },
        { status: 400 }
      );
    }

    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    };

    const rows = inputs
      .filter((i: { entityId?: unknown }) => typeof i?.entityId === "string" && i.entityId)
      .map((i: Record<string, unknown>) => ({
        year: Number(year),
        month: Number(month),
        entity_id: String(i.entityId),
        revenue_estimate: num(i.revenueEstimate),
        revenue_budget: num(i.revenueBudget),
        revenue_deduction: num(i.revenueDeduction),
        payroll_budget: num(i.payrollBudget),
        updated_at: new Date().toISOString(),
      }));

    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid input rows" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("payroll_preview_inputs")
      .upsert(rows, { onConflict: "year,month,entity_id" })
      .select();

    if (error && error.message?.includes("payroll_preview_inputs")) {
      return NextResponse.json(
        { error: "Run DB migration 20260706_payroll_preview_inputs.sql in Supabase Studio first." },
        { status: 400 }
      );
    }
    if (error) throw error;

    return NextResponse.json({ inputs: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save preview inputs" },
      { status: 500 }
    );
  }
}

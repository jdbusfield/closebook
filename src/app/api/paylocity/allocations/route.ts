import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/paylocity/allocations
 *
 * Returns all employee allocation overrides (department, class, company).
 * Optionally filter by ?companyId=132427
 *
 * Gracefully returns empty array if the table doesn't exist yet.
 */
export async function GET(req: NextRequest) {
  try {
    const companyId = req.nextUrl.searchParams.get("companyId");
    const supabase = createAdminClient();

    let query = supabase.from("employee_allocations").select("*");
    if (companyId) {
      query = query.eq("paylocity_company_id", companyId);
    }

    const { data, error } = await query;

    // If table doesn't exist yet, return empty (graceful degradation)
    if (error && error.message?.includes("employee_allocations")) {
      return NextResponse.json({ allocations: [], tableExists: false });
    }
    if (error) throw error;

    return NextResponse.json({ allocations: data ?? [] });
  } catch (err) {
    // Catch-all: return empty allocations rather than 500
    console.error("Allocations GET error:", err);
    return NextResponse.json({ allocations: [], tableExists: false });
  }
}

/**
 * PUT /api/paylocity/allocations
 *
 * Upsert an employee allocation override.
 * Body: { employeeId, paylocityCompanyId, effectiveDate?, department?, class?,
 *         classAllocations?, allocatedEntityId?, allocatedEntityName? }
 *
 * classAllocations is an array of { class, pct } whose percentages must sum
 * to 100 (single-class 100% is fine). When present it supersedes `class`;
 * `class` is kept in sync for single-class splits for backward compatibility.
 *
 * effectiveDate defaults to '2000-01-01' (the base/initial allocation).
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      employeeId,
      paylocityCompanyId,
      effectiveDate,
      department,
      class: classValue,
      classAllocations,
      allocatedEntityId,
      allocatedEntityName,
    } = body;

    if (!employeeId || !paylocityCompanyId) {
      return NextResponse.json(
        { error: "employeeId and paylocityCompanyId are required" },
        { status: 400 }
      );
    }

    // Validate + normalize multi-class splits
    let splits: { class: string; pct: number }[] | null = null;
    if (Array.isArray(classAllocations) && classAllocations.length > 0) {
      splits = classAllocations
        .map((s: { class?: unknown; pct?: unknown }) => ({
          class: String(s?.class ?? "").trim(),
          pct: Math.round(Number(s?.pct ?? 0) * 100) / 100,
        }))
        .filter((s) => s.class !== "" && s.pct > 0);
      if (splits.length === 0) {
        splits = null;
      } else {
        const sum = splits.reduce((t, s) => t + s.pct, 0);
        if (Math.abs(sum - 100) > 0.1) {
          return NextResponse.json(
            { error: `Class allocation percentages must sum to 100 (got ${sum.toFixed(2)})` },
            { status: 400 }
          );
        }
        const dupes = new Set(splits.map((s) => s.class.toLowerCase()));
        if (dupes.size !== splits.length) {
          return NextResponse.json(
            { error: "Each class may appear only once in the allocation" },
            { status: 400 }
          );
        }
      }
    }

    // Keep the legacy single-class column in sync: single split → its name,
    // multi split → null (readers must use class_allocations).
    const legacyClass =
      splits !== null
        ? splits.length === 1
          ? splits[0].class
          : null
        : classValue ?? null;

    const supabase = createAdminClient();

    const record = {
      employee_id: String(employeeId),
      paylocity_company_id: String(paylocityCompanyId),
      effective_date: (effectiveDate ?? "2000-01-01") as string,
      department: (department ?? null) as string | null,
      class: legacyClass as string | null,
      class_allocations: splits,
      allocated_entity_id: (allocatedEntityId ?? null) as string | null,
      allocated_entity_name: (allocatedEntityName ?? null) as string | null,
      updated_at: new Date().toISOString(),
    };

    let { data, error } = await supabase
      .from("employee_allocations")
      .upsert(record, { onConflict: "employee_id,paylocity_company_id,effective_date" })
      .select()
      .single();

    // Graceful degradation: if the class_allocations column doesn't exist yet
    // (migration 20260706 not applied), retry without it.
    if (error && /class_allocations/.test(error.message ?? "")) {
      if (splits && splits.length > 1) {
        return NextResponse.json(
          { error: "Multi-class splits require DB migration 20260706_employee_class_allocations.sql — run it in Supabase Studio first." },
          { status: 400 }
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { class_allocations: _omit, ...withoutSplits } = record;
      ({ data, error } = await supabase
        .from("employee_allocations")
        .upsert(withoutSplits, { onConflict: "employee_id,paylocity_company_id,effective_date" })
        .select()
        .single());
    }

    if (error) throw error;

    return NextResponse.json({ allocation: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save allocation" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/paylocity/allocations
 *
 * Delete a specific allocation period.
 * Body: { employeeId, paylocityCompanyId, effectiveDate }
 *
 * Cannot delete the base allocation ('2000-01-01') if it is the only one.
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { employeeId, paylocityCompanyId, effectiveDate } = body;

    if (!employeeId || !paylocityCompanyId || !effectiveDate) {
      return NextResponse.json(
        { error: "employeeId, paylocityCompanyId, and effectiveDate are required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Guard: don't delete the base allocation if it's the only one
    if (effectiveDate === "2000-01-01") {
      const { count } = await supabase
        .from("employee_allocations")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", employeeId)
        .eq("paylocity_company_id", paylocityCompanyId);

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Cannot delete the only allocation for this employee" },
          { status: 400 }
        );
      }
    }

    const { error } = await supabase
      .from("employee_allocations")
      .delete()
      .eq("employee_id", employeeId)
      .eq("paylocity_company_id", paylocityCompanyId)
      .eq("effective_date", effectiveDate);

    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete allocation" },
      { status: 500 }
    );
  }
}

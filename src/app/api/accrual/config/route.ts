import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/accrual/config?entityId= — fetch realization rate + notes
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const entityId = new URL(request.url).searchParams.get("entityId");
    if (!entityId) {
      return NextResponse.json({ error: "entityId is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Try the full shape first. If the account-link columns aren't present
    // yet (migration 20260420_accrual_je_account_links.sql not applied), fall
    // back to the basic shape so the core realization-rate flow still works.
    let row: Record<string, unknown> | null = null;
    let accountLinksAvailable = true;
    const fullResult = await admin
      .from("entity_accrual_config")
      .select(
        "entity_id, realization_rate, notes, updated_at, updated_by, unbilled_receivables_account_id, allowance_account_id, accrued_revenue_account_id, deferred_revenue_account_id, unbilled_revenue_account_id",
      )
      .eq("entity_id", entityId)
      .maybeSingle();
    if (fullResult.error) {
      // Most likely a missing-column error before the migration runs.
      accountLinksAvailable = false;
      const basic = await admin
        .from("entity_accrual_config")
        .select("entity_id, realization_rate, notes, updated_at, updated_by")
        .eq("entity_id", entityId)
        .maybeSingle();
      if (basic.error) {
        return NextResponse.json({ error: basic.error.message }, { status: 500 });
      }
      row = basic.data as Record<string, unknown> | null;
    } else {
      row = fullResult.data as Record<string, unknown> | null;
    }

    // Default: no rule set, rate = 1.0 (no discount expected)
    return NextResponse.json({
      entityId,
      realizationRate: (row?.realization_rate as number | null) ?? 1.0,
      notes: (row?.notes as string | null) ?? null,
      updatedAt: (row?.updated_at as string | null) ?? null,
      updatedBy: (row?.updated_by as string | null) ?? null,
      unbilledReceivablesAccountId:
        (row?.unbilled_receivables_account_id as string | null) ?? null,
      allowanceAccountId: (row?.allowance_account_id as string | null) ?? null,
      accruedRevenueAccountId:
        (row?.accrued_revenue_account_id as string | null) ?? null,
      deferredRevenueAccountId:
        (row?.deferred_revenue_account_id as string | null) ?? null,
      unbilledRevenueAccountId:
        (row?.unbilled_revenue_account_id as string | null) ?? null,
      accountLinksAvailable,
      hasRule: Boolean(row),
    });
  } catch (err) {
    console.error("GET /api/accrual/config error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT /api/accrual/config — upsert realization rate + notes
export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const {
      entityId,
      realizationRate,
      notes,
      unbilledReceivablesAccountId,
      allowanceAccountId,
      accruedRevenueAccountId,
      deferredRevenueAccountId,
      unbilledRevenueAccountId,
    } = body as {
      entityId: string;
      realizationRate: number;
      notes?: string | null;
      unbilledReceivablesAccountId?: string | null;
      allowanceAccountId?: string | null;
      accruedRevenueAccountId?: string | null;
      deferredRevenueAccountId?: string | null;
      unbilledRevenueAccountId?: string | null;
    };

    if (!entityId || typeof realizationRate !== "number") {
      return NextResponse.json(
        { error: "entityId and realizationRate (number) are required" },
        { status: 400 },
      );
    }
    if (realizationRate < 0 || realizationRate > 1) {
      return NextResponse.json(
        { error: "realizationRate must be between 0 and 1" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const baseFields = {
      entity_id: entityId,
      realization_rate: realizationRate,
      notes: notes ?? null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    const linkFields = {
      unbilled_receivables_account_id: unbilledReceivablesAccountId ?? null,
      allowance_account_id: allowanceAccountId ?? null,
      accrued_revenue_account_id: accruedRevenueAccountId ?? null,
      deferred_revenue_account_id: deferredRevenueAccountId ?? null,
      unbilled_revenue_account_id: unbilledRevenueAccountId ?? null,
    };

    // Try the full upsert first. If the link columns don't exist yet
    // (migration 20260420 not applied), fall back to a rate-only upsert so
    // the user's realization rate still saves. Surface a hint in the body
    // so the UI can tell them to apply the migration.
    let row: Record<string, unknown> | null = null;
    let accountLinksAvailable = true;
    let dbError: string | null = null;

    const full = await admin
      .from("entity_accrual_config")
      .upsert({ ...baseFields, ...linkFields }, { onConflict: "entity_id" })
      .select(
        "entity_id, realization_rate, notes, updated_at, updated_by, unbilled_receivables_account_id, allowance_account_id, accrued_revenue_account_id, deferred_revenue_account_id, unbilled_revenue_account_id",
      )
      .single();
    if (full.error) {
      accountLinksAvailable = false;
      const fallback = await admin
        .from("entity_accrual_config")
        .upsert(baseFields, { onConflict: "entity_id" })
        .select("entity_id, realization_rate, notes, updated_at, updated_by")
        .single();
      if (fallback.error) {
        return NextResponse.json({ error: fallback.error.message }, { status: 500 });
      }
      row = fallback.data as Record<string, unknown>;
      dbError = full.error.message;
    } else {
      row = full.data as Record<string, unknown>;
    }

    return NextResponse.json({
      entityId: row.entity_id as string,
      realizationRate: row.realization_rate as number,
      notes: (row.notes as string | null) ?? null,
      updatedAt: row.updated_at as string,
      updatedBy: (row.updated_by as string | null) ?? null,
      unbilledReceivablesAccountId:
        (row.unbilled_receivables_account_id as string | null) ?? null,
      allowanceAccountId: (row.allowance_account_id as string | null) ?? null,
      accruedRevenueAccountId:
        (row.accrued_revenue_account_id as string | null) ?? null,
      deferredRevenueAccountId:
        (row.deferred_revenue_account_id as string | null) ?? null,
      unbilledRevenueAccountId:
        (row.unbilled_revenue_account_id as string | null) ?? null,
      accountLinksAvailable,
      migrationHint: accountLinksAvailable
        ? null
        : `Account link columns not present in entity_accrual_config. Apply migrations 20260420_accrual_je_account_links.sql and 20260421_unbilled_revenue_catchall_account.sql before linking accounts. (DB message: ${dbError})`,
      hasRule: true,
    });
  } catch (err) {
    console.error("PUT /api/accrual/config error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

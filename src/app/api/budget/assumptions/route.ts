import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { ASSUMPTION_KEYS, ASSUMPTION_KEY_MAP } from "@/lib/budget/assumption-keys";
import { getEmployerTaxTable } from "@/lib/budget/tax-tables";

/** GET /api/budget/assumptions?versionId= : catalog + stored rows + effective defaults */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get("versionId");
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, false);
    const { data: rows, error } = await admin
      .from("budget_assumptions")
      .select("*")
      .eq("budget_version_id", owner.id)
      .order("key")
      .order("scope");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Year-specific defaults for the tax keys
    const tax = getEmployerTaxTable(owner.fiscalYear);
    const pct = (rate: number) => Math.round(rate * 100 * 10000) / 10000; // 0.0145 -> 1.45
    const yearDefaults: Record<string, number> = {
      fica_wage_base: tax.find((t) => t.key === "FICA_SS")!.cap,
      fica_rate: pct(tax.find((t) => t.key === "FICA_SS")!.rate),
      medicare_rate: pct(tax.find((t) => t.key === "MEDICARE")!.rate),
      futa_rate: pct(tax.find((t) => t.key === "FUTA")!.rate),
      futa_cap: tax.find((t) => t.key === "FUTA")!.cap,
      sui_rate: pct(tax.find((t) => t.key === "CA_SUI")!.rate),
      sui_cap: tax.find((t) => t.key === "CA_SUI")!.cap,
      ett_rate: pct(tax.find((t) => t.key === "CA_ETT")!.rate),
      ett_cap: tax.find((t) => t.key === "CA_ETT")!.cap,
    };
    const catalog = ASSUMPTION_KEYS.map((k) => ({ ...k, defaultValue: yearDefaults[k.key] ?? k.defaultValue }));

    return NextResponse.json({ version: owner, catalog, rows: rows ?? [] });
  } catch (err) {
    console.error("GET /api/budget/assumptions error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * PUT /api/budget/assumptions
 * Body: { versionId, rows: [{ scope, scopeId?, key, value|null, textValue?, sourceNote?, effectiveFrom?, effectiveTo? }] }
 * value null removes the row (falls back to the default).
 */
export async function PUT(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const versionId: string | undefined = body?.versionId;
    const rows: Array<{
      scope?: string;
      scopeId?: string | null;
      key: string;
      value: number | null;
      textValue?: string | null;
      sourceNote?: string | null;
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
    }> = Array.isArray(body?.rows) ? body.rows : [];
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });
    if (rows.length === 0) return NextResponse.json({ error: "rows is empty" }, { status: 400 });
    for (const r of rows) {
      if (!r.key || !ASSUMPTION_KEY_MAP.has(r.key)) {
        return NextResponse.json({ error: `Unknown assumption key: ${r.key}` }, { status: 400 });
      }
    }

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);

    let upserted = 0;
    let deleted = 0;
    for (const r of rows) {
      const scope = r.scope ?? "org";
      const scopeId = r.scopeId ?? null;
      if (r.value === null || r.value === undefined || Number.isNaN(Number(r.value))) {
        let q = admin
          .from("budget_assumptions")
          .delete({ count: "exact" })
          .eq("budget_version_id", owner.id)
          .eq("scope", scope)
          .eq("key", r.key);
        q = scopeId ? q.eq("scope_id", scopeId) : q.is("scope_id", null);
        const { error, count } = await q;
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        deleted += count ?? 0;
        continue;
      }
      // Manual upsert (unique index uses COALESCE expressions PostgREST cannot target)
      let find = admin
        .from("budget_assumptions")
        .select("id")
        .eq("budget_version_id", owner.id)
        .eq("scope", scope)
        .eq("key", r.key);
      find = scopeId ? find.eq("scope_id", scopeId) : find.is("scope_id", null);
      const { data: existing } = await find.limit(1);
      const payload = {
        budget_version_id: owner.id,
        scope,
        scope_id: scopeId,
        key: r.key,
        value: Number(r.value),
        text_value: r.textValue ?? null,
        unit: ASSUMPTION_KEY_MAP.get(r.key)?.unit ?? null,
        source_note: r.sourceNote ?? null,
        effective_from: r.effectiveFrom ?? null,
        effective_to: r.effectiveTo ?? null,
        created_by: actor.userId,
      };
      const res = existing && existing.length > 0
        ? await admin.from("budget_assumptions").update(payload).eq("id", existing[0].id)
        : await admin.from("budget_assumptions").insert(payload);
      if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
      upserted++;
    }
    return NextResponse.json({ success: true, upserted, deleted });
  } catch (err) {
    console.error("PUT /api/budget/assumptions error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

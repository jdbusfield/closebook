import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { findMasterForEntityAccount } from "@/lib/config/master-gl-template";
import { resolveChartIdOrDefault } from "@/lib/master-charts/resolve";

/**
 * POST /api/master-accounts/bulk-setup
 *
 * Auto-maps entity accounts to existing master GL accounts using
 * predefined mapping rules (matched by account number / name).
 *
 * Body: { entityId: string, chartId?: string }
 *
 * Defaults to the management chart if chartId is omitted. Idempotent:
 * existing mappings in the same chart are preserved via upsert.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { entityId, chartId: chartIdInput } = body;

  if (!entityId) {
    return NextResponse.json(
      { error: "entityId is required" },
      { status: 400 }
    );
  }

  // ── 1. Resolve organisation ──────────────────────────────────────────
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json(
      { error: "No organization found" },
      { status: 404 }
    );
  }

  const orgId = membership.organization_id;

  let chartId: string;
  try {
    chartId = await resolveChartIdOrDefault(supabase, orgId, chartIdInput);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }

  // Verify entity belongs to the org
  const { data: entity } = await supabase
    .from("entities")
    .select("id, name")
    .eq("id", entityId)
    .eq("organization_id", orgId)
    .single();

  if (!entity) {
    return NextResponse.json(
      { error: "Entity not found in your organization" },
      { status: 404 }
    );
  }

  // ── 2. Load existing master accounts in the selected chart ───────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const masterAccounts = await fetchAllPaginated<any>((offset, limit) =>
    supabase
      .from("master_accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("chart_id", chartId)
      .range(offset, offset + limit - 1)
  );

  if (masterAccounts.length === 0) {
    return NextResponse.json(
      { error: "No master accounts found in this chart. Create them first." },
      { status: 400 }
    );
  }

  // Build lookup by name (case-insensitive) for matching template results
  const masterByName = new Map(
    masterAccounts.map((m) => [m.name.toLowerCase(), m])
  );

  // ── 3. Load entity accounts ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entityAccounts = await fetchAllPaginated<any>((offset, limit) =>
    supabase
      .from("accounts")
      .select("id, account_number, name, account_type")
      .eq("entity_id", entityId)
      .range(offset, offset + limit - 1)
  );

  if (entityAccounts.length === 0) {
    return NextResponse.json({
      mappingsCreated: 0,
      unmapped: [],
      message: "Entity has no accounts to map.",
    });
  }

  // ── 4. Build mappings ────────────────────────────────────────────────
  const mappingsToInsert: {
    master_account_id: string;
    entity_id: string;
    account_id: string;
    created_by: string;
  }[] = [];
  const unmapped: { accountNumber: string | null; name: string }[] = [];
  const matched: { entityAccount: string; masterAccount: string }[] = [];

  for (const ea of entityAccounts) {
    const template = findMasterForEntityAccount(
      ea.account_number,
      ea.name,
      ea.account_type
    );

    if (template) {
      // Look up the actual master account by name
      const master = masterByName.get(template.name.toLowerCase());
      if (master) {
        mappingsToInsert.push({
          master_account_id: master.id,
          entity_id: entityId,
          account_id: ea.id,
          created_by: user.id,
        });
        matched.push({
          entityAccount: `${ea.account_number ?? ""} ${ea.name}`.trim(),
          masterAccount: master.name,
        });
      } else {
        // Template matched but master account doesn't exist in DB
        unmapped.push({
          accountNumber: ea.account_number,
          name: `${ea.name} (master "${template.name}" not found)`,
        });
      }
    } else {
      unmapped.push({
        accountNumber: ea.account_number,
        name: ea.name,
      });
    }
  }

  // ── 5. Insert mappings (skip existing via onConflict) ────────────────
  let mappingsCreated = 0;

  if (mappingsToInsert.length > 0) {
    // chart_id is set by the BEFORE-INSERT trigger from master_account.chart_id.
    // Conflict target matches the new (entity_id, account_id, chart_id) unique key.
    const { data: inserted, error: mapError } = await supabase
      .from("master_account_mappings")
      .upsert(mappingsToInsert, {
        onConflict: "entity_id,account_id,chart_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (mapError) {
      return NextResponse.json(
        { error: `Failed to insert mappings: ${mapError.message}` },
        { status: 500 }
      );
    }

    mappingsCreated = inserted?.length ?? 0;
  }

  return NextResponse.json({
    mappingsCreated,
    totalEntityAccounts: entityAccounts.length,
    matched,
    unmapped,
  });
}

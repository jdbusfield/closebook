import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveChartIdOrDefault } from "@/lib/master-charts/resolve";
import * as XLSX from "xlsx";

// ── Types ──────────────────────────────────────────────────────────────

export interface PreviewRow {
  rowNumber: number;
  entityAccountNumber: string | null;
  entityAccountName: string;
  masterGLInput: string;
  masterAccountId: string | null;
  masterAccountName: string | null;
  entityAccountId: string | null;
  status: "matched" | "unmatched" | "already_mapped" | "error";
  message: string;
}

interface Summary {
  total: number;
  matched: number;
  unmatched: number;
  alreadyMapped: number;
  errors: number;
}

// ── Flexible header map ────────────────────────────────────────────────

function buildHeaderMap(headers: string[]) {
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const find = (patterns: string[]) => {
    for (const h of headers) {
      const norm = normalise(h);
      for (const p of patterns) {
        if (norm.includes(p)) return h;
      }
    }
    return null;
  };

  return {
    entityAccountNumber: find([
      "entityaccountnumber",
      "accountnumber",
      "acctno",
      "acctnum",
      "number",
    ]),
    entityAccountName: find([
      "entityaccountname",
      "accountname",
      "entityaccount",
      "account",
    ]),
    masterGLAccount: find([
      "masterglaccount",
      "masteraccount",
      "mastergl",
      "glaccount",
      "master",
    ]),
  };
}

// ── POST handler ───────────────────────────────────────────────────────

/**
 * POST /api/master-accounts/mappings/import
 *
 * Parses an uploaded Excel file and matches entity accounts to master GL
 * accounts.  Supports two modes:
 *   mode=preview  →  dry-run, returns preview with per-row status
 *   mode=commit   →  preview + actually inserts the mappings
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse form data ──────────────────────────────────────────────────
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const entityId = formData.get("entityId") as string;
  const chartIdInput = (formData.get("chartId") as string | null) || null;
  const mode = (formData.get("mode") as string) ?? "preview";

  if (!file || !entityId) {
    return NextResponse.json(
      { error: "Missing required fields: file, entityId" },
      { status: 400 }
    );
  }

  if (mode !== "preview" && mode !== "commit") {
    return NextResponse.json(
      { error: 'mode must be "preview" or "commit"' },
      { status: 400 }
    );
  }

  // ── Resolve organisation ─────────────────────────────────────────────
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

  // ── Parse Excel ──────────────────────────────────────────────────────
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  if (rawRows.length === 0) {
    return NextResponse.json(
      { error: "Spreadsheet is empty" },
      { status: 400 }
    );
  }

  const headers = Object.keys(rawRows[0]);
  const hm = buildHeaderMap(headers);

  if (!hm.masterGLAccount) {
    return NextResponse.json(
      {
        error:
          'Could not find a "Master GL Account" column. ' +
          "Please ensure your spreadsheet has a column with that heading.",
      },
      { status: 400 }
    );
  }

  // ── Load reference data ──────────────────────────────────────────────

  // Entity accounts
  const { data: entityAccounts } = await supabase
    .from("accounts")
    .select("id, account_number, name")
    .eq("entity_id", entityId);

  const eaByNumber = new Map<string, { id: string; name: string }>();
  const eaByNameLower = new Map<
    string,
    { id: string; account_number: string | null }
  >();
  for (const ea of entityAccounts ?? []) {
    if (ea.account_number) {
      eaByNumber.set(ea.account_number, { id: ea.id, name: ea.name });
    }
    eaByNameLower.set(ea.name.toLowerCase(), {
      id: ea.id,
      account_number: ea.account_number,
    });
  }

  // Master accounts in the selected chart only
  const { data: masterAccounts } = await supabase
    .from("master_accounts")
    .select("id, account_number, name")
    .eq("organization_id", orgId)
    .eq("chart_id", chartId)
    .eq("is_active", true);

  const maByNameLower = new Map<
    string,
    { id: string; account_number: string; name: string }
  >();
  const maByNumber = new Map<
    string,
    { id: string; account_number: string; name: string }
  >();
  for (const ma of masterAccounts ?? []) {
    maByNameLower.set(ma.name.toLowerCase(), ma);
    maByNumber.set(ma.account_number, ma);
  }

  // Existing mappings for this entity in the selected chart. The same entity
  // account can be mapped in another chart; that doesn't count as already-mapped
  // for this import.
  const { data: existingMappings } = await supabase
    .from("master_account_mappings")
    .select("account_id, master_account_id")
    .eq("entity_id", entityId)
    .eq("chart_id", chartId);

  const existingByAccountId = new Map<string, string>();
  for (const m of existingMappings ?? []) {
    existingByAccountId.set(m.account_id, m.master_account_id);
  }

  // Build a reverse lookup: master account id → name
  const masterNameById = new Map<string, string>();
  for (const ma of masterAccounts ?? []) {
    masterNameById.set(ma.id, ma.name);
  }

  // ── Process rows ─────────────────────────────────────────────────────
  const preview: PreviewRow[] = [];
  const summary: Summary = {
    total: 0,
    matched: 0,
    unmatched: 0,
    alreadyMapped: 0,
    errors: 0,
  };

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowNumber = i + 2; // 1-indexed + header row
    summary.total++;

    const acctNum = String(
      raw[hm.entityAccountNumber ?? ""] ?? ""
    ).trim();
    const acctName = String(
      raw[hm.entityAccountName ?? ""] ?? ""
    ).trim();
    const masterInput = String(raw[hm.masterGLAccount] ?? "").trim();

    // Skip rows where Master GL Account column is blank
    if (!masterInput) {
      continue;
    }

    // Resolve entity account
    let entityAccountId: string | null = null;
    let resolvedEntityName = acctName;
    let resolvedEntityNumber: string | null = acctNum || null;

    if (acctNum && eaByNumber.has(acctNum)) {
      const match = eaByNumber.get(acctNum)!;
      entityAccountId = match.id;
      resolvedEntityName = match.name;
    } else if (acctName && eaByNameLower.has(acctName.toLowerCase())) {
      const match = eaByNameLower.get(acctName.toLowerCase())!;
      entityAccountId = match.id;
      resolvedEntityNumber = match.account_number;
    }

    if (!entityAccountId) {
      preview.push({
        rowNumber,
        entityAccountNumber: resolvedEntityNumber,
        entityAccountName: resolvedEntityName,
        masterGLInput: masterInput,
        masterAccountId: null,
        masterAccountName: null,
        entityAccountId: null,
        status: "error",
        message: `Entity account not found: "${acctNum || acctName}"`,
      });
      summary.errors++;
      continue;
    }

    // Resolve master GL account — try account number first, fall back to name
    let masterMatch: { id: string; name: string } | null = null;

    // 1. Exact account_number match
    const byNum = maByNumber.get(masterInput);
    if (byNum) {
      masterMatch = byNum;
    }

    // 2. Exact name match (case-insensitive) — used when account number
    //    is not available or the user enters a name instead
    if (!masterMatch) {
      const byName = maByNameLower.get(masterInput.toLowerCase());
      if (byName) {
        masterMatch = byName;
      }
    }

    // 3. Partial name match (only if exactly one result to avoid ambiguity)
    if (!masterMatch) {
      const lowerInput = masterInput.toLowerCase();
      const partials = (masterAccounts ?? []).filter((m) =>
        m.name.toLowerCase().includes(lowerInput)
      );
      if (partials.length === 1) {
        masterMatch = partials[0];
      }
    }

    if (!masterMatch) {
      preview.push({
        rowNumber,
        entityAccountNumber: resolvedEntityNumber,
        entityAccountName: resolvedEntityName,
        masterGLInput: masterInput,
        masterAccountId: null,
        masterAccountName: null,
        entityAccountId,
        status: "unmatched",
        message: `Master GL account not found: "${masterInput}"`,
      });
      summary.unmatched++;
      continue;
    }

    // Check if already mapped
    if (existingByAccountId.has(entityAccountId)) {
      const existingMasterId = existingByAccountId.get(entityAccountId)!;
      const existingName = masterNameById.get(existingMasterId) ?? "Unknown";
      preview.push({
        rowNumber,
        entityAccountNumber: resolvedEntityNumber,
        entityAccountName: resolvedEntityName,
        masterGLInput: masterInput,
        masterAccountId: masterMatch.id,
        masterAccountName: masterMatch.name,
        entityAccountId,
        status: "already_mapped",
        message: `Already mapped to "${existingName}"`,
      });
      summary.alreadyMapped++;
      continue;
    }

    // Matched — ready to create mapping
    preview.push({
      rowNumber,
      entityAccountNumber: resolvedEntityNumber,
      entityAccountName: resolvedEntityName,
      masterGLInput: masterInput,
      masterAccountId: masterMatch.id,
      masterAccountName: masterMatch.name,
      entityAccountId,
      status: "matched",
      message: `→ ${masterMatch.name}`,
    });
    summary.matched++;
  }

  // ── Commit if requested ──────────────────────────────────────────────
  let created = 0;

  if (mode === "commit") {
    const toInsert = preview
      .filter((r) => r.status === "matched" && r.masterAccountId && r.entityAccountId)
      .map((r) => ({
        master_account_id: r.masterAccountId!,
        entity_id: entityId,
        account_id: r.entityAccountId!,
        created_by: user.id,
      }));

    if (toInsert.length > 0) {
      // chart_id is set by the BEFORE-INSERT trigger; conflict target uses
      // the new (entity_id, account_id, chart_id) unique key.
      const { data: inserted, error: mapError } = await supabase
        .from("master_account_mappings")
        .upsert(toInsert, {
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

      created = inserted?.length ?? 0;
    }
  }

  return NextResponse.json({
    preview,
    summary,
    ...(mode === "commit" ? { created } : {}),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getCallerOrg } from "../../_lib/org";
import { parseSpreadsheet } from "@/lib/crm/spreadsheet-parse";
import type { DiffRow, RevenueImportDiff } from "@/lib/crm/revenue-import-types";

export const maxDuration = 120;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field is required" }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (max 20MB)" }, { status: 400 });
  }
  const buffer = await file.arrayBuffer();
  const parsed = parseSpreadsheet(buffer);

  if (parsed.errors.some(e => e.row === 0)) {
    return NextResponse.json({ error: parsed.errors[0].message }, { status: 422 });
  }

  const { supabase, organizationId } = ctx;

  // Look up existing links: source + external_customer_id -> production
  const extIds = Array.from(new Set(parsed.rows.map(r => r.external_customer_id)));
  const { data: linksRaw } = extIds.length
    ? await supabase
        .from("crm_production_external_customers")
        .select("source, external_customer_id, production:crm_productions ( id, name )")
        .eq("source", "cars_plus")
        .in("external_customer_id", extIds)
    : { data: [] };
  const linksByKey = new Map<string, { id: string; name: string }>();
  for (const l of (linksRaw ?? []) as unknown as Array<{ source: string; external_customer_id: string; production: { id: string; name: string } | null }>) {
    if (l.production) linksByKey.set(`${l.source}:${l.external_customer_id}`, l.production);
  }

  // Look up existing dedupe matches in crm_external_invoices
  const dedupeChecks = parsed.rows.map(r => ({
    key: `cars_plus|${r.invoice_number ?? ""}|${r.invoice_date}|${r.amount.toFixed(2)}`,
    row: r,
  }));
  const invNums = Array.from(new Set(parsed.rows.map(r => r.invoice_number).filter((x): x is string => !!x)));
  const existingDedupe = new Set<string>();
  if (invNums.length > 0) {
    const { data: dups } = await supabase
      .from("crm_external_invoices")
      .select("source, invoice_number, invoice_date, amount")
      .eq("source", "cars_plus")
      .in("invoice_number", invNums);
    for (const d of (dups ?? []) as Array<{ source: string; invoice_number: string | null; invoice_date: string; amount: string | number }>) {
      existingDedupe.add(`${d.source}|${d.invoice_number ?? ""}|${d.invoice_date}|${Number(d.amount).toFixed(2)}`);
    }
  }

  // Active candidate productions for unmapped-row picker
  const { data: prodOptionsRaw } = await supabase
    .from("crm_productions")
    .select("id, name, status")
    .order("name");
  const candidateProductions = (prodOptionsRaw ?? []) as Array<{ id: string; name: string; status: string }>;

  const rows: DiffRow[] = parsed.rows.map((r, i) => {
    const dedupeKey = `cars_plus|${r.invoice_number ?? ""}|${r.invoice_date}|${r.amount.toFixed(2)}`;
    if (existingDedupe.has(dedupeKey)) {
      return { bucket: "duplicate" as const, source_row_index: i, data: r, matched_production: null };
    }
    const linkKey = `cars_plus:${r.external_customer_id}`;
    const matched = linksByKey.get(linkKey) ?? null;
    if (matched) {
      return { bucket: "mapped" as const, source_row_index: i, data: r, matched_production: matched };
    }
    return {
      bucket: "unmapped" as const,
      source_row_index: i,
      data: r,
      matched_production: null,
      candidate_productions: candidateProductions,
    };
  });

  const counts = rows.reduce(
    (acc, r) => { acc[r.bucket] += 1; return acc; },
    { mapped: 0, unmapped: 0, duplicate: 0 },
  );

  const diff: RevenueImportDiff = {
    upload_batch_id: randomUUID(),
    file_name: file.name,
    detected_columns: parsed.detected_columns,
    total_rows: parsed.total_rows,
    parse_errors: parsed.errors,
    rows,
    counts,
  };
  void organizationId; // satisfy linter — used implicitly via RLS
  return NextResponse.json(diff);
}

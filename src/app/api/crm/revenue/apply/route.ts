import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../../_lib/org";
import type { RevenueImportApplyPayload } from "@/lib/crm/revenue-import-types";

export const maxDuration = 120;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { supabase, organizationId, userId } = ctx;

  const payload = (await req.json().catch(() => null)) as RevenueImportApplyPayload | null;
  if (!payload || !payload.upload_batch_id || !payload.rows) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const decisionsByIdx = new Map(payload.decisions.map(d => [d.source_row_index, d]));

  // 1. Collect new external-customer links to upsert (from unmapped rows the
  //    user chose to map). Multiple rows can share the same (production_id,
  //    external_customer_id) — dedupe before insert.
  const newLinkKeys = new Set<string>(); // production_id|external_id
  const newLinks: Array<{ production_id: string; external_customer_id: string; label: string | null }> = [];

  // 2. Collect invoice rows to insert.
  const invoiceInserts: Array<{
    organization_id: string;
    upload_batch_id: string;
    source: string;
    external_customer_id: string;
    customer_name: string | null;
    invoice_number: string | null;
    invoice_date: string;
    amount: number;
    description: string | null;
    raw: unknown;
    created_by: string;
  }> = [];

  for (const row of payload.rows) {
    if (row.bucket === "duplicate") continue;
    const decision = decisionsByIdx.get(row.source_row_index);
    let productionId: string | null = null;

    if (row.bucket === "mapped") {
      productionId = row.matched_production?.id ?? null;
    } else if (row.bucket === "unmapped") {
      if (decision?.skip) continue;
      productionId = decision?.production_id ?? null;
      if (!productionId) continue; // unmapped + no decision = skip
      const linkKey = `${productionId}|${row.data.external_customer_id}`;
      if (!newLinkKeys.has(linkKey)) {
        newLinkKeys.add(linkKey);
        newLinks.push({
          production_id: productionId,
          external_customer_id: row.data.external_customer_id,
          label: row.data.customer_name,
        });
      }
    }

    if (!productionId) continue;
    invoiceInserts.push({
      organization_id: organizationId,
      upload_batch_id: payload.upload_batch_id,
      source: "cars_plus",
      external_customer_id: row.data.external_customer_id,
      customer_name: row.data.customer_name,
      invoice_number: row.data.invoice_number,
      invoice_date: row.data.invoice_date,
      amount: row.data.amount,
      description: row.data.description,
      raw: row.data.raw,
      created_by: userId,
    });
  }

  // Insert links first so they exist before invoices reference them logically
  let linksCreated = 0;
  if (newLinks.length > 0) {
    const { error: linkErr, data: linksData } = await supabase
      .from("crm_production_external_customers")
      .upsert(
        newLinks.map(l => ({
          organization_id: organizationId,
          production_id: l.production_id,
          source: "cars_plus",
          external_customer_id: l.external_customer_id,
          label: l.label,
          created_by: userId,
        })),
        { onConflict: "organization_id,source,external_customer_id", ignoreDuplicates: true },
      )
      .select("id");
    if (linkErr) {
      return NextResponse.json({ error: `Linking failed: ${linkErr.message}` }, { status: 500 });
    }
    linksCreated = (linksData ?? []).length;
  }

  // Then insert invoices. Use upsert with the dedupe unique key to be safe in
  // case the user re-applies the same diff.
  let invoicesInserted = 0;
  if (invoiceInserts.length > 0) {
    const { error: invErr, data: invData } = await supabase
      .from("crm_external_invoices")
      .upsert(invoiceInserts, {
        onConflict: "organization_id,source,invoice_number,invoice_date,amount",
        ignoreDuplicates: true,
      })
      .select("id");
    if (invErr) {
      return NextResponse.json({ error: `Invoice insert failed: ${invErr.message}` }, { status: 500 });
    }
    invoicesInserted = (invData ?? []).length;
  }

  return NextResponse.json({
    ok: true,
    invoices_inserted: invoicesInserted,
    links_created: linksCreated,
  });
}

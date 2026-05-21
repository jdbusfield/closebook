import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { parseReportPdf } from "@/lib/crm/pdf-parse";
import { diffPdfRows } from "@/lib/crm/match";
import { researchNewProductions } from "@/lib/crm/research";
import type { ImportDiff } from "@/lib/crm/import-types";

// Web search + Claude PDF parse can be slow — give it generous headroom
export const maxDuration = 300;

/**
 * POST /api/crm/import-report
 * Accepts a PDF as multipart/form-data with field name "file".
 * Returns the four-bucket diff with research results filled in for new productions.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = (await createClient()) as unknown as SupabaseClient;

  // Resolve current user's organization
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const organizationId = (membership as { organization_id: string } | null)?.organization_id;
  if (!organizationId) return NextResponse.json({ error: "No organization for user" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field is required" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (max 10MB)" }, { status: 400 });
  }
  const fileBuffer = await file.arrayBuffer();
  const base64Pdf = Buffer.from(fileBuffer).toString("base64");

  // 1. Parse the PDF
  let parsedRows;
  try {
    parsedRows = await parseReportPdf(base64Pdf);
  } catch (err) {
    return NextResponse.json({ error: `PDF parse failed: ${(err as Error).message}` }, { status: 500 });
  }
  if (parsedRows.length === 0) {
    return NextResponse.json({ error: "No production rows found in the PDF" }, { status: 422 });
  }

  // 2. Build the diff
  const reportMetadata: ImportDiff["report_metadata"] = {
    file_name: file.name,
    file_size: file.size,
    parsed_at: new Date().toISOString(),
    total_rows: parsedRows.length,
  };
  const diff = await diffPdfRows(supabase, organizationId, parsedRows, reportMetadata);

  // 3. Research new productions (parallel, capped concurrency)
  if (diff.new_productions.length > 0) {
    await researchNewProductions(supabase, organizationId, diff.new_productions);
  }

  return NextResponse.json(diff);
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

// Allow up to 60 seconds for AI extraction (default is 10-15s on Vercel)
export const maxDuration = 300;

/**
 * POST /api/leases/abstract
 * Client uploads the PDF to Supabase Storage first, then sends the storage
 * path here. We download the file server-side and send it to Claude for
 * structured extraction. This avoids Vercel's serverless payload limit.
 *
 * JSON body: { entityId, storagePath, fileName, fileSize }
 */

const EXTRACTION_PROMPT = `You are a commercial real estate lease abstraction expert. Analyze the attached lease document and extract all relevant fields into a structured JSON object.

Return ONLY a valid JSON object (no markdown, no explanation) with the following fields. Use null for any field you cannot find or are uncertain about.

{
  "lease_name": "string — short identifier for this lease (e.g., 'Office Lease - 123 Main St')",
  "lessor_name": "string — landlord / lessor name",
  "lessor_contact_info": "string — landlord contact details if found",

  "property_name": "string — building or property name",
  "address_line1": "string — street address",
  "address_line2": "string or null — suite/unit",
  "city": "string",
  "state": "string — two-letter state code",
  "zip_code": "string",
  "property_type": "one of: office, retail, warehouse, industrial, mixed_use, land, other",
  "total_square_footage": "number or null",
  "rentable_square_footage": "number or null",
  "usable_square_footage": "number or null",

  "lease_type": "one of: operating, finance — default to operating if unclear",
  "commencement_date": "YYYY-MM-DD",
  "rent_commencement_date": "YYYY-MM-DD or null — if different from commencement",
  "expiration_date": "YYYY-MM-DD",
  "lease_term_months": "number — total months",

  "base_rent_monthly": "number — monthly base rent amount",
  "rent_per_sf": "number or null — annual rent per square foot if stated",
  "security_deposit": "number — 0 if not stated",
  "tenant_improvement_allowance": "number — 0 if not stated",
  "rent_abatement_months": "number — 0 if no free rent period",
  "rent_abatement_amount": "number — monthly amount during abatement, 0 if none",

  "cam_monthly": "number — common area maintenance per month, 0 if not stated",
  "insurance_monthly": "number — insurance per month, 0 if not stated",
  "property_tax_annual": "number — annual property tax, 0 if not stated",
  "property_tax_frequency": "one of: monthly, semi_annual, annual — default monthly",
  "utilities_monthly": "number — 0 if not stated or tenant-paid directly",
  "other_monthly_costs": "number — any other regular monthly charges, 0 if none",
  "other_monthly_costs_description": "string or null — description of other costs",

  "maintenance_type": "one of: triple_net, gross, modified_gross",
  "permitted_use": "string or null — permitted use clause",

  "discount_rate": "number or null — if an incremental borrowing rate is mentioned, as decimal (e.g., 0.065 for 6.5%)",
  "initial_direct_costs": "number — 0 if not stated",

  "escalations": [
    {
      "escalation_type": "one of: fixed_percentage, fixed_amount, cpi",
      "effective_date": "YYYY-MM-DD",
      "percentage_increase": "number or null — as decimal (0.03 for 3%)",
      "amount_increase": "number or null",
      "frequency": "one of: annual, biennial, at_renewal"
    }
  ],

  "options": [
    {
      "option_type": "one of: renewal, termination, purchase, expansion",
      "exercise_deadline": "YYYY-MM-DD or null",
      "notice_required_days": "number or null",
      "option_term_months": "number or null",
      "option_rent_terms": "string or null — description of rent during option",
      "option_price": "number or null",
      "penalty_amount": "number or null"
    }
  ],

  "critical_dates": [
    {
      "date_type": "one of: lease_expiration, renewal_deadline, termination_notice, rent_escalation, rent_review, cam_reconciliation, insurance_renewal, custom",
      "critical_date": "YYYY-MM-DD",
      "description": "string"
    }
  ],

  "notes": "string or null — any additional important terms, clauses, or observations",
  "confidence_notes": "string — brief note about extraction confidence and any fields you were uncertain about"
}

Important:
- All monetary amounts should be numbers (not strings), without dollar signs or commas.
- Dates must be in YYYY-MM-DD format.
- Percentages should be as decimals (3% = 0.03).
- If the lease has annual escalations, create one entry per escalation with the effective date.
- For triple net (NNN) leases, operating costs are typically estimated and reconciled annually.
- Include important critical dates like expiration, renewal deadlines, and escalation dates.`;

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured. Add it to .env.local." },
      { status: 500 }
    );
  }

  const body = await request.json();
  const { entityId, storagePath, fileName, fileSize } = body as {
    entityId: string;
    storagePath: string;
    fileName: string;
    fileSize: number;
  };

  if (!entityId || !storagePath) {
    return NextResponse.json(
      { error: "Missing required fields: entityId, storagePath" },
      { status: 400 }
    );
  }

  try {
    // Download the PDF from Supabase Storage (admin client bypasses RLS)
    const admin = createAdminClient();
    const { data: fileData, error: downloadError } = await admin.storage
      .from("lease-documents")
      .download(storagePath);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: `Failed to download PDF: ${downloadError?.message || "File not found"}` },
        { status: 500 }
      );
    }

    const buffer = await fileData.arrayBuffer();
    const base64Pdf = Buffer.from(buffer).toString("base64");

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-5-5",
      // Sonnet 5.5 thinks by default and the thinking counts against max_tokens.
      max_tokens: 16000,
      output_config: { effort: "medium" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64Pdf,
              },
            },
            {
              type: "text",
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });

    // Extract text response
    const textBlock = message.content.find((c) => c.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "No text response from AI" },
        { status: 500 }
      );
    }

    // Parse JSON from response (strip any markdown fences if present)
    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const extracted = JSON.parse(jsonStr);

    return NextResponse.json({
      extracted,
      file_name: fileName,
      file_path: storagePath,
      file_size_bytes: fileSize,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
      },
    });
  } catch (err: unknown) {
    console.error("Lease extraction error:", err);
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error during extraction";
    return NextResponse.json(
      { error: `AI extraction failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

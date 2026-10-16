import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

// Allow up to 300 seconds for AI extraction (requires Vercel Pro plan; Hobby caps at 10s)
export const maxDuration = 300;

/**
 * POST /api/subleases/abstract
 * Client uploads PDF to Supabase Storage first, then sends the storage
 * path here. We download the file server-side and send it to Claude for
 * structured extraction. This avoids Vercel's serverless payload limit.
 *
 * JSON body: { entityId, leaseId, storagePath, fileName, fileSize }
 */

const EXTRACTION_PROMPT = `You are a commercial real estate sublease abstraction expert. Analyze the attached sublease agreement and extract all relevant fields into a structured JSON object. This is a SUBLEASE — meaning the entity uploading this document is the sublessor (master tenant) and the other party is the subtenant.

Return ONLY a valid JSON object (no markdown, no explanation) with the following fields. Use null for any field you cannot find or are uncertain about.

{
  "sublease_name": "string — short identifier for this sublease (e.g., 'Suite 200 - Acme Corp')",
  "subtenant_name": "string — subtenant / sub-lessee name",
  "subtenant_contact_info": "string or null — subtenant contact details if found",

  "subleased_square_footage": "number or null — square footage of subleased space",
  "floor_suite": "string or null — floor number, suite, or unit identifier",

  "commencement_date": "YYYY-MM-DD",
  "rent_commencement_date": "YYYY-MM-DD or null — if different from commencement",
  "expiration_date": "YYYY-MM-DD",
  "sublease_term_months": "number — total months of sublease term",

  "base_rent_monthly": "number — monthly base rent the subtenant pays us",
  "rent_per_sf": "number or null — annual rent per square foot if stated",
  "security_deposit_held": "number — security deposit we hold from subtenant, 0 if not stated",
  "rent_abatement_months": "number — 0 if no free rent period for the subtenant",
  "rent_abatement_amount": "number — monthly amount during abatement, 0 if none",

  "cam_recovery_monthly": "number — CAM pass-through recovery per month, 0 if not stated",
  "insurance_recovery_monthly": "number — insurance pass-through per month, 0 if not stated",
  "property_tax_recovery_monthly": "number — property tax recovery per month, 0 if not stated",
  "utilities_recovery_monthly": "number — utilities recovery per month, 0 if not stated",
  "other_recovery_monthly": "number — any other monthly recovery charges, 0 if none",
  "other_recovery_description": "string or null — description of other recovery charges",

  "maintenance_type": "one of: triple_net, gross, modified_gross",
  "permitted_use": "string or null — permitted use clause for the subleased space",

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
      "option_type": "one of: renewal, termination, expansion, contraction",
      "exercise_deadline": "YYYY-MM-DD or null",
      "notice_required_days": "number or null",
      "option_term_months": "number or null",
      "option_rent_terms": "string or null — description of rent during option period",
      "option_price": "number or null",
      "penalty_amount": "number or null"
    }
  ],

  "critical_dates": [
    {
      "date_type": "one of: sublease_expiration, renewal_deadline, termination_notice, rent_escalation, rent_review, insurance_renewal, custom",
      "critical_date": "YYYY-MM-DD",
      "description": "string"
    }
  ],

  "notes": "string or null — any additional important terms, clauses, or observations about this sublease",
  "confidence_notes": "string — brief note about extraction confidence and any fields you were uncertain about"
}

Important:
- All monetary amounts should be numbers (not strings), without dollar signs or commas.
- Dates must be in YYYY-MM-DD format.
- Percentages should be as decimals (3% = 0.03).
- If the sublease has annual escalations, create one entry per escalation with the effective date.
- For triple net (NNN) subleases, operating cost recoveries are typically estimated and reconciled annually.
- Include important critical dates like expiration, renewal deadlines, and escalation dates.
- Remember: the amounts represent INCOME to us (we are the sublessor collecting from the subtenant).`;

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
  const { entityId, leaseId, storagePath, fileName, fileSize } = body as {
    entityId: string;
    leaseId: string;
    storagePath: string;
    fileName: string;
    fileSize: number;
  };

  if (!entityId || !leaseId || !storagePath) {
    return NextResponse.json(
      { error: "Missing required fields: entityId, leaseId, storagePath" },
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
    console.error("Sublease extraction error:", err);
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error during extraction";
    return NextResponse.json(
      { error: `AI extraction failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

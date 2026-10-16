import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

// Allow up to 60 seconds for AI extraction (default is 10-15s on Vercel)
export const maxDuration = 300;

/**
 * POST /api/insurance/extract
 * Client uploads the PDF to Supabase Storage first, then sends the storage
 * path here. We download the file server-side and send it to Claude for
 * structured extraction. This avoids Vercel's serverless payload limit.
 *
 * JSON body: { entityId, storagePath, fileName, fileSize }
 */

const EXTRACTION_PROMPT = `You are an insurance program analysis expert specializing in commercial insurance proposals and renewals. Analyze the attached insurance proposal/renewal document and extract all relevant fields into a structured JSON object.

Return ONLY a valid JSON object (no markdown, no explanation) with the following structure. Use null for any field you cannot find or are uncertain about.

{
  "program_summary": {
    "named_insured": "string — primary named insured entity",
    "broker_name": "string — insurance broker name",
    "broker_license": "string or null",
    "effective_date": "YYYY-MM-DD",
    "expiration_date": "YYYY-MM-DD",
    "total_annual_premium": number,
    "prior_year_premium": number or null,
    "premium_change_pct": number or null
  },
  "policies": [
    {
      "policy_type": "one of: auto_liability, auto_physical_damage, general_liability, property, excess_liability, pollution, management_liability, workers_comp, umbrella, inland_marine, cyber, epli, crime, fiduciary, side_a_dic, renters_liability, garagekeepers, hired_non_owned_auto, package, other",
      "line_of_business": "string — descriptive name like 'Rental Fleet Excess Auto Liability'",
      "carrier_name": "string — insurance carrier name",
      "named_insured": "string — named insured for this specific policy",
      "named_insured_entity": "string or null — entity abbreviation if identifiable",
      "annual_premium": number,
      "prior_year_premium": number or null,
      "premium_change_pct": number or null,
      "status": "one of: active, non_renewed, pending_renewal, draft",
      "payment_terms": "one of: annual, monthly_reporting, installment, daily_rate, other",
      "installment_description": "string or null — e.g. '25% Down & 9 installments'",
      "billing_company": "string or null",
      "deposit_held": number or 0,
      "is_auditable": boolean,
      "coverage_territory": "string or null",
      "coverages": [
        {
          "coverage_name": "string",
          "coverage_form": "one of: occurrence, claims_made, other",
          "limit_per_occurrence": number or null,
          "limit_aggregate": number or null,
          "limit_description": "string or null — for complex limits like 'Scheduled Limits per SOV'",
          "deductible": number or null,
          "deductible_description": "string or null",
          "self_insured_retention": number or null,
          "coinsurance_pct": number or null,
          "sub_limit": number or null,
          "sub_limit_description": "string or null",
          "is_included": boolean,
          "prior_year_limit": number or null,
          "prior_year_deductible": number or null,
          "notes": "string or null"
        }
      ],
      "locations": [
        {
          "location_code": "string or null — e.g. 'CA001'",
          "address": "string",
          "city": "string",
          "state": "string",
          "zip_code": "string or null",
          "occupancy_description": "string or null",
          "building_value": number or 0,
          "bpp_value": number or 0,
          "business_income_value": number or 0,
          "rental_income_value": number or 0,
          "is_active": boolean,
          "location_type": "one of: operating, subleased, parking, storage, other",
          "class_code": "string or null",
          "class_description": "string or null"
        }
      ],
      "exclusions": [
        {
          "exclusion_name": "string",
          "is_excluded": boolean
        }
      ],
      "subjectivities": [
        {
          "description": "string",
          "due_date": "YYYY-MM-DD or null"
        }
      ],
      "exposures": {
        "type": "one of: vehicle_count, square_footage, payroll, revenue, daily_rate, headcount, other",
        "current_value": number or null,
        "prior_year_value": number or null,
        "rate": number or null,
        "rate_description": "string or null — e.g. 'Monthly Rate (not annual rate)'"
      },
      "payment_schedule": [
        {
          "month_name": "string — e.g. 'May', 'June'",
          "amount": number
        }
      ],
      "notes": "string or null",
      "renewal_notes": "string or null"
    }
  ],
  "confidence_notes": "string — brief note about extraction confidence and any fields the AI was uncertain about"
}

Important:
- Extract ALL policies from the proposal, each as a separate entry in the policies array.
- All monetary amounts should be numbers (not strings), without dollar signs or commas.
- Dates must be in YYYY-MM-DD format.
- Use null for fields that cannot be determined from the document.
- Include coverage comparison data (expiring vs renewal) where available, using prior_year_limit and prior_year_deductible fields.
- Extract the payment schedule grid if present in the document.
- Extract the Statement of Values (locations) if present in the document.
- Extract exclusion matrices if present, with each exclusion as a separate entry.
- Extract subjectivities/binding conditions if present.
- Note any policies that are TBD, non-renewed, or transitioning between carriers in the notes or renewal_notes fields.
- For exposures, set to null if no exposure basis is described for a policy.
- For payment_schedule, set to null if no installment schedule is provided for a policy.`;

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
      .from("insurance-documents")
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
      max_tokens: 32000,
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
    console.error("Insurance extraction error:", err);
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error during extraction";
    return NextResponse.json(
      { error: `AI extraction failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

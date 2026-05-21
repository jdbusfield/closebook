import Anthropic from "@anthropic-ai/sdk";
import type { ParsedReportRow } from "./import-types";

const EXTRACTION_PROMPT = `You are parsing a Teamsters 399 weekly Daily Production Report PDF.

The PDF contains a table where each row represents one production. Columns are:
  Production Company | Production | Phone | Coordinator | Location Manager | Show Type | Rate | Shooting Location

The Shooting Location cell has a STATUS PREFIX before the city/state when the production is not actively shooting:
  - "PREPPING Los Angeles, CA"   → status: PREPPING
  - "WRAPPING Burbank, CA"        → status: WRAPPING
  - "PRODUCTION DOWN San Francisco, BA" → status: PRODUCTION DOWN
  - "REPOSITIONING ..."           → status: REPOSITIONING
  - "Los Angeles, CA"             → status: SHOOTING (no prefix means actively shooting)

Some production names contain "aka" (also-known-as) for working titles:
  "El Dorado aka Fallout S3"  → production_name: "El Dorado", alias_name: "Fallout S3"
  "Untitled Daniels Project Thasnagar" → production_name: "Untitled Daniels Project Thasnagar", alias_name: null
  "Funk City S2 aka Studio"   → production_name: "Funk City S2", alias_name: "Studio"

For each row, extract the values verbatim. If coordinator or location manager is "N / A" or "TBD" or "LOCAL HIRE", that's a literal value — keep it as-is (just trimmed). If empty, return null.

Return ONLY a JSON array (no markdown, no preamble) with this shape:

[
  {
    "production_company": "20th Television",
    "production_name": "Prison Break",
    "alias_name": null,
    "coordinator_name": "JOEY F SORIANO",
    "coordinator_phone": "818-655-8530",
    "location_manager_name": "DANIEL J COOLEY",
    "show_type": "High Budget New Media Series",
    "status_label": "PREPPING",
    "shooting_location_raw": "PREPPING Los Angeles, CA",
    "city": "Los Angeles",
    "state": "CA"
  },
  ...
]

Rules:
- show_type is the literal text from the Show Type column (e.g. "High Budget New Media Series", "Episodic TV Series", "Feature Film", "Pilot - TV", "Pilot - New Media", "Low Budget Film")
- state should be the 2-letter abbreviation when present in the PDF
- Skip the report header rows, the "Show Type Rates" legend at the bottom, and any disclaimer text. Return only production rows.
- Do not invent data. If a cell is missing, use null.`;

export async function parseReportPdf(base64Pdf: string): Promise<ParsedReportRow[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16384,
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
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  const textBlock = response.content.find(b => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content for PDF extraction");
  }
  const raw = textBlock.text.trim();
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Could not find JSON array in Claude response: ${raw.slice(0, 200)}`);
  }
  const rows = JSON.parse(jsonMatch[0]) as ParsedReportRow[];
  return rows.filter(r => r.production_name && r.production_name.trim().length > 0);
}

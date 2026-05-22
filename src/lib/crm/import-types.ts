/**
 * Shared types for the weekly production-report PDF import workflow.
 */

/** A single row extracted from the PDF by Claude. */
export interface ParsedReportRow {
  production_company: string | null;
  production_name: string;
  /** Alias detected from "Production X aka Y" — Y goes here if present */
  alias_name: string | null;
  coordinator_name: string | null;
  coordinator_phone: string | null;
  location_manager_name: string | null;
  show_type: string | null;
  /** "PREPPING" | "WRAPPING" | "PRODUCTION DOWN" | "SHOOTING" (default if no prefix) */
  status_label: "PREPPING" | "WRAPPING" | "PRODUCTION DOWN" | "SHOOTING" | "REPOSITIONING";
  /** Full shooting location text from the PDF (e.g. "PREPPING Los Angeles, CA") */
  shooting_location_raw: string | null;
  /** Parsed city + state (best effort) */
  city: string | null;
  state: string | null;
}

/** The four-bucket diff returned from /api/crm/import-report */
export interface ImportDiff {
  report_metadata: {
    file_name: string;
    file_size: number;
    parsed_at: string;
    total_rows: number;
  };
  status_changes: StatusChangeItem[];
  alias_suggestions: AliasSuggestionItem[];
  new_productions: NewProductionItem[];
  fell_off: FellOffItem[];
  unchanged: UnchangedItem[];
  /** All currently-active productions, used by the UI's "match to existing" combobox
      so the user can manually link a row that the matcher missed. */
  active_candidates: ActiveProductionCandidate[];
}

export interface ActiveProductionCandidate {
  id: string;
  name: string;
  status: string;
  company_name: string | null;
  aliases: string[];
}

export interface StatusChangeItem {
  production_id: string;
  production_name: string;
  current_status: string;
  /** Normalized status derived from PDF label (prepping / shooting / wrapping / production-down / etc.) */
  new_status: string;
  pdf_row: ParsedReportRow;
  notes?: string;
}

/** PDF row that looks like a new production, but the alias_name (from "aka X") matched an existing production. */
export interface AliasSuggestionItem {
  pdf_row: ParsedReportRow;
  /** The existing production we'd link the alias to */
  matched_production_id: string;
  matched_production_name: string;
  reason: string;
}

export interface NewProductionItem {
  pdf_row: ParsedReportRow;
  /** Auto-suggested existing company match if name is similar */
  suggested_company_id: string | null;
  suggested_company_name: string | null;
  /** Filled in by the research agent */
  research?: ProductionResearch;
}

export interface ProductionResearch {
  estimated_start_date: string | null;
  estimated_end_date: string | null;
  parent_studio_name: string | null;
  /** If parent_studio_name matches an existing crm_companies row of type=studio */
  matched_studio_id: string | null;
  confidence: "high" | "medium" | "low";
  source_note: string;
  source_url?: string;
  /** True if the agent failed or skipped this production */
  failed?: boolean;
}

export interface FellOffItem {
  production_id: string;
  production_name: string;
  current_status: string;
  weeks_active: number | null;
}

export interface UnchangedItem {
  production_id: string;
  production_name: string;
  status: string;
}

/** Payload sent to /api/crm/import-report/apply */
export interface ApplyDiffPayload {
  report_metadata: ImportDiff["report_metadata"];
  accept_status_changes: Array<{
    production_id: string;
    from_status: string;
    new_status: string;
  }>;
  accept_alias_suggestions: Array<{
    pdf_row: ParsedReportRow;
    matched_production_id: string;
  }>;
  accept_new_productions: Array<{
    pdf_row: ParsedReportRow;
    company_id: string | null;       // null means use company name to find/create
    studio_id: string | null;        // null = no studio
    start_date: string | null;
    end_date: string | null;
  }>;
  /** User-resolved matches: PDF rows that looked new but the user manually
      pointed at an existing production. Will create alias + apply status change. */
  manual_alias_matches: Array<{
    pdf_row: ParsedReportRow;
    matched_production_id: string;
  }>;
  /** production_ids to mark completed (user explicitly decided show wrapped) */
  mark_completed: string[];
}

export const PDF_STATUS_TO_CRM: Record<ParsedReportRow["status_label"], string> = {
  PREPPING: "prepping",
  SHOOTING: "shooting",
  WRAPPING: "wrapping",
  "PRODUCTION DOWN": "shooting",     // production-down is a temporary halt during shooting
  REPOSITIONING: "shooting",
};

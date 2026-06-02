import type { RawInvoiceRow } from "./spreadsheet-parse";

export type RowBucket = "mapped" | "unmapped" | "duplicate";

export interface DiffRow {
  bucket: RowBucket;
  source_row_index: number;
  data: RawInvoiceRow;
  matched_production: { id: string; name: string } | null;
  // For unmapped: the user can pick a production from this list
  candidate_productions?: Array<{ id: string; name: string; status: string }>;
}

export interface RevenueImportDiff {
  upload_batch_id: string;
  file_name: string;
  detected_columns: Record<string, string>;
  total_rows: number;
  parse_errors: Array<{ row: number; message: string }>;
  rows: DiffRow[];
  counts: { mapped: number; unmapped: number; duplicate: number };
}

export interface RevenueImportApplyPayload {
  upload_batch_id: string;
  file_name: string;
  // Per-row decisions. For unmapped rows the user must include a production_id
  // to commit, or set skip=true.
  decisions: Array<{
    source_row_index: number;
    production_id?: string;
    skip?: boolean;
  }>;
  rows: DiffRow[]; // echoed back from the diff
}

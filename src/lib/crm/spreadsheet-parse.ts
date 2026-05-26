import * as XLSX from "xlsx";

export interface RawInvoiceRow {
  external_customer_id: string;
  customer_name: string | null;
  invoice_number: string | null;
  invoice_date: string; // ISO yyyy-mm-dd
  amount: number;
  description: string | null;
  raw: Record<string, unknown>;
}

export interface SpreadsheetParseResult {
  rows: RawInvoiceRow[];
  detected_columns: Record<string, string>; // canonical -> header in file
  total_rows: number;
  errors: Array<{ row: number; message: string }>;
}

const COLUMN_ALIASES: Record<keyof Omit<RawInvoiceRow, "raw">, string[]> = {
  external_customer_id: ["customer_number", "cust_no", "customer_no", "customer_id", "cust_id", "account_number", "account_no"],
  customer_name: ["customer_name", "customer", "client", "client_name", "name"],
  invoice_number: ["invoice_number", "inv_no", "invoice_no", "invoice", "invoice#"],
  invoice_date: ["invoice_date", "inv_date", "date", "billing_date"],
  amount: ["amount", "total", "invoice_total", "gross_total", "extended", "amt"],
  description: ["description", "memo", "notes", "comment"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function findHeader(headers: string[], aliases: string[]): string | null {
  const normalized = headers.map(h => ({ original: h, norm: normalizeHeader(h) }));
  for (const alias of aliases) {
    const match = normalized.find(n => n.norm === alias);
    if (match) return match.original;
  }
  return null;
}

function coerceDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function coerceAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseSpreadsheet(buffer: ArrayBuffer): SpreadsheetParseResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) {
    return { rows: [], detected_columns: {}, total_rows: 0, errors: [{ row: 0, message: "Empty workbook" }] };
  }
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true, defval: null });
  if (json.length === 0) {
    return { rows: [], detected_columns: {}, total_rows: 0, errors: [{ row: 0, message: "No rows found" }] };
  }
  const headers = Object.keys(json[0]);
  const detected: Record<string, string> = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    const found = findHeader(headers, aliases);
    if (found) detected[canonical] = found;
  }

  const required: Array<keyof typeof COLUMN_ALIASES> = ["external_customer_id", "invoice_date", "amount"];
  const missing = required.filter(r => !detected[r]);
  if (missing.length > 0) {
    return {
      rows: [],
      detected_columns: detected,
      total_rows: json.length,
      errors: [{ row: 0, message: `Missing required columns: ${missing.join(", ")}. Detected: ${JSON.stringify(detected)}` }],
    };
  }

  const errors: Array<{ row: number; message: string }> = [];
  const rows: RawInvoiceRow[] = [];

  json.forEach((row, idx) => {
    const rowNo = idx + 2; // header is row 1
    const extId = row[detected.external_customer_id];
    const date = coerceDate(row[detected.invoice_date]);
    const amount = coerceAmount(row[detected.amount]);

    if (extId == null || String(extId).trim() === "") {
      errors.push({ row: rowNo, message: "Missing customer number" });
      return;
    }
    if (!date) {
      errors.push({ row: rowNo, message: `Invalid date: ${row[detected.invoice_date]}` });
      return;
    }
    if (amount == null) {
      errors.push({ row: rowNo, message: `Invalid amount: ${row[detected.amount]}` });
      return;
    }

    rows.push({
      external_customer_id: String(extId).trim(),
      customer_name: detected.customer_name ? (row[detected.customer_name] != null ? String(row[detected.customer_name]).trim() : null) : null,
      invoice_number: detected.invoice_number ? (row[detected.invoice_number] != null ? String(row[detected.invoice_number]).trim() : null) : null,
      invoice_date: date,
      amount,
      description: detected.description ? (row[detected.description] != null ? String(row[detected.description]).trim() : null) : null,
      raw: row,
    });
  });

  return { rows, detected_columns: detected, total_rows: json.length, errors };
}

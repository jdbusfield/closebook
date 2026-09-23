/**
 * Reads the Quotes Report workbook in the browser (the file is ~4 MB, close
 * to the upload limit) and returns one row per quote. Uses the "Query1" tab,
 * which already holds one version per quote; falls back to "Raw Data".
 */
export interface ParsedQuote {
  id: string;
  project: string;
  start: string;
  end: string;
  amount: number;
  status: string;
  salesRep: string | null;
  path: string | null;
  version: number | null;
}

const MS_DAY = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function toIso(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(EXCEL_EPOCH + Math.round(v) * MS_DAY).toISOString().slice(0, 10);
  if (typeof v === "string") {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
      return new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2]))).toISOString().slice(0, 10);
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

export async function parseQuotesWorkbook(
  file: File,
  keepFrom: string,
): Promise<{ sheet: string; quotes: ParsedQuote[]; rows: number }> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const probe = XLSX.read(buf, { type: "array", bookSheets: true });
  const sheet = probe.SheetNames.find((n) => n.toLowerCase() === "query1")
    ?? probe.SheetNames.find((n) => n.toLowerCase() === "raw data");
  if (!sheet) throw new Error('The workbook needs a "Query1" or "Raw Data" tab.');
  const wb = XLSX.read(buf, { type: "array", sheets: [sheet], cellDates: false });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheet], { defval: null, raw: true });
  const byId = new Map<string, ParsedQuote>();
  for (const r of rows) {
    const id = r["Quote ID"];
    if (typeof id !== "string" || !id.trim()) continue;
    const start = toIso(r["Start Date"]);
    const end = toIso(r["Return Date"]);
    const amount = Number(r["Column8"]);
    if (!start || !end || !Number.isFinite(amount) || r["Column8"] === null || r["Column8"] === "") continue;
    if (end < keepFrom) continue;
    const q: ParsedQuote = {
      id: id.trim(),
      project: String(r["Project Name"] ?? "").trim(),
      start,
      end,
      amount,
      status: String(r["Column9"] ?? "").trim(),
      salesRep: r["SalesRep"] != null ? String(r["SalesRep"]).trim() : r["Column10"] != null ? String(r["Column10"]).trim() : null,
      path: r["File Path"] != null ? String(r["File Path"]) : null,
      version: r["Version"] != null && Number.isFinite(Number(r["Version"])) ? Number(r["Version"]) : null,
    };
    const prev = byId.get(q.id);
    // Raw Data can repeat a quote; keep the invoiced / latest version
    if (!prev || /invoic/i.test(q.path ?? "") || (q.version ?? 0) > (prev.version ?? 0)) {
      if (!prev || !/invoic/i.test(prev.path ?? "")) byId.set(q.id, q);
    }
  }
  return { sheet, quotes: [...byId.values()], rows: rows.length };
}

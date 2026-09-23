import ExcelJS from "exceljs";
import type { AccrualItem } from "./types";
import type { AccrualReport } from "./report";
import type { Journal } from "./journals";
import { accountLabel } from "./engine";
import { monthShort } from "./dates";

const MONEY = '#,##0.00;(#,##0.00);"-"';
const FONT = { name: "Arial", size: 10 };
const HEAD = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };

export const TIER_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  job: "Matched On The Job",
  quote: "From Quote Dates",
  review: "Needs Review",
};

function header(ws: ExcelJS.Worksheet, cols: { header: string; width: number; money?: boolean; date?: boolean }[]) {
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }));
  const row = ws.getRow(1);
  row.font = HEAD;
  row.fill = HEAD_FILL;
  row.alignment = { wrapText: true, vertical: "middle" };
  row.height = 30;
  cols.forEach((c, i) => {
    if (c.money) ws.getColumn(i + 1).numFmt = MONEY;
    if (c.date) ws.getColumn(i + 1).numFmt = "mm/dd/yyyy";
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

const asDate = (s: string | null | undefined) => (s ? new Date(`${s.slice(0, 10)}T00:00:00Z`) : null);

function itemSheet(wb: ExcelJS.Workbook, name: string, items: AccrualItem[], included: Set<string>) {
  const ws = wb.addWorksheet(name);
  header(ws, [
    { header: "Included", width: 9 },
    { header: "Tier", width: 18 },
    { header: "Source", width: 30 },
    { header: "Customer", width: 44 },
    { header: "Quote ID", width: 17 },
    { header: "Project", width: 26 },
    { header: "Rental Start", width: 11, date: true },
    { header: "Rental End", width: 11, date: true },
    { header: "Quote Total", width: 12, money: true },
    { header: "Invoice #", width: 10 },
    { header: "Invoice Date", width: 11, date: true },
    { header: "Invoice Created", width: 19 },
    { header: "Invoice Total", width: 12, money: true },
    { header: "Amount", width: 13, money: true },
    { header: "Accounts And Classes", width: 60 },
    { header: "Why", width: 80 },
  ]);
  for (const it of items) {
    const r = ws.addRow([
      included.has(it.id) ? "Yes" : "No",
      TIER_LABEL[it.tier] ?? it.tier,
      it.source,
      it.customer ?? "",
      it.quoteId ?? "",
      it.project ?? "",
      asDate(it.quoteStart),
      asDate(it.quoteEnd),
      it.quoteAmount ?? null,
      it.docNum ?? "",
      asDate(it.docDate),
      it.docCreated ? it.docCreated.replace("T", " ").slice(0, 16) : "",
      it.docAmount ?? null,
      it.amount,
      it.allocation.map((a) => `${accountLabel(a.account)} / ${a.className ?? "No class"}: ${a.amount.toFixed(2)}`).join("\n"),
      it.memo ? `${it.reason} Memo: ${it.memo}` : it.reason,
    ]);
    r.font = FONT;
    r.alignment = { wrapText: true, vertical: "top" };
  }
  const total = ws.addRow(["Total included", "", "", "", "", "", null, null, null, "", null, "", null,
    items.filter((i) => included.has(i.id)).reduce((s, i) => s + i.amount, 0)]);
  total.font = { ...FONT, bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: items.length + 1, column: 16 } };
}

/** One sheet per JE in the HDR import layout. */
function journalSheet(wb: ExcelJS.Workbook, j: Journal) {
  const ws = wb.addWorksheet(j.number.replace(/[\\/*?:[\]]/g, "-").slice(0, 31));
  ws.columns = [
    { header: "ACCOUNT", width: 70 },
    { header: "DEBITS", width: 14 },
    { header: "CREDITS", width: 14 },
    { header: "DESCRIPTION", width: 20 },
    { header: "NAME", width: 10 },
    { header: "CLASS", width: 20 },
  ];
  ws.getRow(1).font = { ...FONT, bold: true };
  ws.getColumn(2).numFmt = "#,##0.00";
  ws.getColumn(3).numFmt = "#,##0.00";
  for (const r of j.rows) ws.addRow([r.account, r.debit, r.credit, r.description, r.name, r.className]).font = FONT;
}

export async function journalWorkbook(journals: Journal[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const idx = wb.addWorksheet("Entries");
  header(idx, [
    { header: "JE Number", width: 22 },
    { header: "Date", width: 12, date: true },
    { header: "What It Does", width: 28 },
    { header: "Lines", width: 8 },
    { header: "Total Debits", width: 14, money: true },
    { header: "Total Credits", width: 14, money: true },
  ]);
  for (const j of journals) {
    idx.addRow([j.number, asDate(j.date), j.title, j.rows.length, j.total,
      j.rows.reduce((s, r) => s + (r.credit ?? 0), 0)]).font = FONT;
  }
  for (const j of journals) journalSheet(wb, j);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function workingWorkbook(entityName: string, report: AccrualReport): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const { result, totals, booked, prior } = report;
  const included = new Set(
    result.items.filter((i) => (i.id in report.decisions ? report.decisions[i.id] : i.defaultInclude)).map((i) => i.id),
  );
  const mon = `${monthShort(result.period)} ${result.period.year}`;

  const s = wb.addWorksheet("Summary");
  s.getColumn(1).width = 64;
  s.getColumn(2).width = 16;
  s.getColumn(3).width = 16;
  s.getColumn(2).numFmt = MONEY;
  s.getColumn(3).numFmt = MONEY;
  const line = (a: string, b?: number | string | null, c?: number | string | null, bold = false) => {
    const r = s.addRow([a, b ?? null, c ?? null]);
    r.font = { ...FONT, bold };
    return r;
  };
  s.addRow([`${entityName}: Revenue Accrual And Deferral, ${mon}`]).font = { name: "Arial", size: 14, bold: true };
  line(`Month-end ${result.periodEnd}. Built from the Quotes Report and QuickBooks invoices, sales receipts, credit memos and refunds.`);
  s.addRow([]);
  line("Included In The Journal Entries", "Accrual", "Deferral", true);
  for (const t of ["confirmed", "job", "quote", "review"]) {
    const v = totals.byTier[t];
    line(`  ${TIER_LABEL[t]} (${v?.included ?? 0} of ${v?.count ?? 0} lines included)`, v?.accrual ?? 0, v?.deferral ?? 0);
  }
  line("Total", totals.accrual, totals.deferral, true);
  s.addRow([]);
  line("Already Booked In QuickBooks For This Month", booked.accrualTotal, booked.deferralTotal, true);
  line("  Journal entries", booked.accrual.map((j) => j.num).join(", "), booked.deferral.map((j) => j.num).join(", "));
  line("Difference (this report minus booked)", totals.accrual - booked.accrualTotal, totals.deferral - booked.deferralTotal);
  s.addRow([]);
  line(`Prior Month Check: ${monthShort(prior.period)} ${prior.period.year}`, null, null, true);
  line("  Accrual by this method with today's invoices", prior.recomputedAccrual);
  line("  Accrual booked in QuickBooks", prior.bookedAccrual);
  line("  Short / (over)", prior.shortfall, null, true);
  if (prior.enteredBeforeBooking != null) {
    line(`  Confirmed items already in QuickBooks when the accrual was booked (${prior.bookedAt?.replace("T", " ").slice(0, 16)})`, prior.enteredBeforeBooking);
  }
  s.addRow([]);
  line("Match Coverage", null, null, true);
  line("  QuickBooks documents pulled", result.stats.docs);
  line("  Documents that tie to a quote exactly", result.stats.docsMatched);
  line("  Revenue on documents that tie to a quote", result.stats.docsMatchedAmount);
  line("  Revenue on all documents pulled", result.stats.docsAmount);

  itemSheet(wb, "Accruals", result.items.filter((i) => i.kind === "accrual" && i.tier !== "review"), included);
  itemSheet(wb, "Deferrals", result.items.filter((i) => i.kind === "deferral" && i.tier !== "review"), included);
  itemSheet(wb, "Needs Review", result.items.filter((i) => i.tier === "review"), included);

  const u = wb.addWorksheet("Unmatched Invoices");
  header(u, [
    { header: "Type", width: 14 },
    { header: "Number", width: 10 },
    { header: "Date", width: 11, date: true },
    { header: "Customer", width: 60 },
    { header: "Revenue", width: 13, money: true },
  ]);
  for (const d of result.unmatchedDocs) u.addRow([d.type, d.num, asDate(d.date), d.customer, d.amount]).font = FONT;

  for (const j of report.journals) journalSheet(wb, j);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// POST /api/financial-statements/bridge/export
//
// Builds an .xlsx workbook for the requested bridge. Two sheets:
//   1) "Bridge" — the schedule rows with all category columns, periods
//      summed across the visible range
//   2) "By Period" — same schedule but expanded with one column block per
//      period (only when more than one period is present)

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";
import type {
  BridgeRequest,
  BridgeResponse,
  BridgeRow,
} from "@/lib/financial-statements/bridge-types";

function sumOver(amounts: Record<string, number>, keys: string[]): number {
  let s = 0;
  for (const k of keys) s += amounts[k] ?? 0;
  return s;
}

const NUMBER_FMT = "#,##0;(#,##0);\"—\"";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: BridgeRequest;
  try {
    body = (await request.json()) as BridgeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Re-fetch the bridge data via the existing endpoint so the export
  // always matches the on-screen view.
  const url = new URL(request.url);
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const origin = `${proto}://${host}`;
  const cookieHeader = request.headers.get("cookie");

  const bridgeRes = await fetch(`${origin}/api/financial-statements/bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!bridgeRes.ok) {
    const text = await bridgeRes.text();
    return NextResponse.json(
      { error: `Bridge fetch failed: ${bridgeRes.status} ${text}` },
      { status: 500 },
    );
  }
  const bridge = (await bridgeRes.json()) as BridgeResponse;

  const wb = new ExcelJS.Workbook();
  wb.creator = "CloseBook";
  wb.created = new Date();

  const periodKeys = bridge.periods.map((p) => p.key);

  // ---------- Sheet 1: Bridge (totals across range) ----------
  const sheet = wb.addWorksheet("Bridge", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 4 }],
  });

  sheet.columns = [
    { width: 50 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 14 },
  ];

  sheet.mergeCells("A1:J1");
  sheet.getCell("A1").value =
    `${bridge.metadata.organizationName ?? ""} — ${bridge.statement === "BS" ? "Balance Sheet" : "Income Statement"} Bridge`;
  sheet.getCell("A1").font = { bold: true, size: 14 };

  sheet.mergeCells("A2:J2");
  sheet.getCell("A2").value = `${bridge.fromChartName} → ${bridge.toChartName}`;
  sheet.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  sheet.mergeCells("A3:J3");
  sheet.getCell("A3").value =
    `Period: ${bridge.metadata.startPeriod} to ${bridge.metadata.endPeriod} · Generated ${new Date(bridge.metadata.generatedAt).toLocaleString()}`;
  sheet.getCell("A3").font = { italic: true, color: { argb: "FF666666" } };

  // Header row
  const headerRow = sheet.addRow([
    "Line",
    `From (${bridge.fromChartName})`,
    "Δ Pro Forma",
    "Δ Allocation",
    "Δ Year-End",
    "Δ IC Elim",
    "Δ NI Pres.",
    "Δ Mapping",
    `To (${bridge.toChartName})`,
    "Tie",
  ]);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin" } };
  });

  // Group rows by major group
  const groups = new Map<string, BridgeRow[]>();
  for (const r of bridge.rows) {
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group)!.push(r);
  }
  const groupOrder = ["Assets", "Liabilities", "Equity", "Revenue", "Expense"];

  function pushRow(r: BridgeRow): void {
    const fromVal = sumOver(r.fromAmounts, periodKeys);
    const toVal = sumOver(r.toAmounts, periodKeys);
    const proForma = sumOver(r.deltas.proForma, periodKeys);
    const allocation = sumOver(r.deltas.allocation, periodKeys);
    const yearEnd = sumOver(r.deltas.yearEnd, periodKeys);
    const icElim = sumOver(r.deltas.icElim, periodKeys);
    const niPres = sumOver(r.deltas.niPresentation, periodKeys);
    const mapping = sumOver(r.deltas.mapping, periodKeys);
    const tie =
      toVal - fromVal - (proForma + allocation + yearEnd + icElim + niPres + mapping);

    const row = sheet.addRow([
      r.label,
      fromVal,
      proForma,
      allocation,
      yearEnd,
      icElim,
      niPres,
      mapping,
      toVal,
      tie,
    ]);
    for (let i = 2; i <= 10; i++) {
      row.getCell(i).numFmt = NUMBER_FMT;
    }
    if (r.fromLine?.isGrandTotal || r.toLine?.isGrandTotal) {
      row.font = { bold: true };
      row.eachCell((c) => (c.border = { top: { style: "double" } }));
    } else if (r.fromLine?.isTotal || r.toLine?.isTotal) {
      row.font = { bold: true };
      row.eachCell((c) => (c.border = { top: { style: "thin" } }));
    }
    if (!r.fromLine || !r.toLine) {
      row.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
      });
    }
    if (Math.abs(tie) >= 0.5) {
      row.getCell(10).font = { color: { argb: "FFCC0000" }, bold: true };
    }
  }

  for (const g of groupOrder) {
    const rows = groups.get(g);
    if (!rows || rows.length === 0) continue;
    const hdr = sheet.addRow([g.toUpperCase()]);
    hdr.font = { bold: true };
    hdr.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } }));
    sheet.mergeCells(`A${hdr.number}:J${hdr.number}`);
    for (const r of rows) pushRow(r);
  }
  for (const [g, rows] of groups) {
    if (groupOrder.includes(g)) continue;
    const hdr = sheet.addRow([g.toUpperCase()]);
    hdr.font = { bold: true };
    hdr.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } }));
    sheet.mergeCells(`A${hdr.number}:J${hdr.number}`);
    for (const r of rows) pushRow(r);
  }

  // Total row
  const tb = bridge.totalBridge;
  const tFrom = sumOver(tb.fromAmounts, periodKeys);
  const tTo = sumOver(tb.toAmounts, periodKeys);
  const tProForma = sumOver(tb.deltas.proForma, periodKeys);
  const tAlloc = sumOver(tb.deltas.allocation, periodKeys);
  const tYE = sumOver(tb.deltas.yearEnd, periodKeys);
  const tIC = sumOver(tb.deltas.icElim, periodKeys);
  const tNI = sumOver(tb.deltas.niPresentation, periodKeys);
  const tMap = sumOver(tb.deltas.mapping, periodKeys);
  const totalRow = sheet.addRow([
    "BRIDGE TOTAL",
    tFrom, tProForma, tAlloc, tYE, tIC, tNI, tMap, tTo,
    tTo - tFrom - (tProForma + tAlloc + tYE + tIC + tNI + tMap),
  ]);
  totalRow.font = { bold: true };
  totalRow.eachCell((c, colNumber) => {
    c.border = { top: { style: "double" }, bottom: { style: "double" } };
    if (colNumber >= 2) c.numFmt = NUMBER_FMT;
  });

  // ---------- Sheet 2: By Period (only if multiple periods) ----------
  if (bridge.periods.length > 1) {
    const s2 = wb.addWorksheet("By Period", {
      views: [{ state: "frozen", xSplit: 1, ySplit: 5 }],
    });

    s2.getColumn(1).width = 50;

    s2.mergeCells(1, 1, 1, 1 + bridge.periods.length * 9);
    s2.getCell(1, 1).value =
      `${bridge.metadata.organizationName ?? ""} — Bridge by Period`;
    s2.getCell(1, 1).font = { bold: true, size: 14 };

    // Period header (spans 9 columns each)
    const periodHdr = s2.getRow(3);
    periodHdr.getCell(1).value = "";
    let col = 2;
    for (const p of bridge.periods) {
      s2.mergeCells(3, col, 3, col + 8);
      const c = s2.getCell(3, col);
      c.value = p.label;
      c.alignment = { horizontal: "center" };
      c.font = { bold: true };
      c.border = { bottom: { style: "thin" } };
      col += 9;
    }

    const subHdrLabels = [
      `From`,
      `Δ PF`,
      `Δ Alloc`,
      `Δ YE`,
      `Δ IC`,
      `Δ NI`,
      `Δ Map`,
      `To`,
      `Tie`,
    ];
    const subHdr = s2.getRow(4);
    subHdr.getCell(1).value = "Line";
    subHdr.getCell(1).font = { bold: true };
    col = 2;
    for (let pi = 0; pi < bridge.periods.length; pi++) {
      for (let i = 0; i < subHdrLabels.length; i++) {
        const c = s2.getCell(4, col + i);
        c.value = subHdrLabels[i];
        c.font = { bold: true };
        c.alignment = { horizontal: "center" };
      }
      col += 9;
    }
    s2.getRow(4).border = { bottom: { style: "thin" } };

    function pushPerPeriodRow(r: BridgeRow): void {
      const values: (string | number)[] = [r.label];
      for (const p of bridge.periods) {
        const k = p.key;
        const fromVal = r.fromAmounts[k] ?? 0;
        const toVal = r.toAmounts[k] ?? 0;
        const proForma = r.deltas.proForma[k] ?? 0;
        const allocation = r.deltas.allocation[k] ?? 0;
        const yearEnd = r.deltas.yearEnd[k] ?? 0;
        const icElim = r.deltas.icElim[k] ?? 0;
        const niPres = r.deltas.niPresentation[k] ?? 0;
        const mapping = r.deltas.mapping[k] ?? 0;
        const tie =
          toVal - fromVal - (proForma + allocation + yearEnd + icElim + niPres + mapping);
        values.push(fromVal, proForma, allocation, yearEnd, icElim, niPres, mapping, toVal, tie);
      }
      const row = s2.addRow(values);
      for (let i = 2; i <= values.length; i++) {
        row.getCell(i).numFmt = NUMBER_FMT;
      }
      if (r.fromLine?.isGrandTotal || r.toLine?.isGrandTotal) {
        row.font = { bold: true };
      } else if (r.fromLine?.isTotal || r.toLine?.isTotal) {
        row.font = { bold: true };
      }
      if (!r.fromLine || !r.toLine) {
        row.eachCell((c) => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
        });
      }
    }

    for (const g of groupOrder) {
      const rows = groups.get(g);
      if (!rows || rows.length === 0) continue;
      const hdr = s2.addRow([g.toUpperCase()]);
      hdr.font = { bold: true };
      const totalCols = 1 + bridge.periods.length * 9;
      hdr.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } }));
      s2.mergeCells(hdr.number, 1, hdr.number, totalCols);
      for (const r of rows) pushPerPeriodRow(r);
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `bridge-${bridge.statement.toLowerCase()}-${body.startYear}${String(body.startMonth).padStart(2, "0")}-${body.endYear}${String(body.endMonth).padStart(2, "0")}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

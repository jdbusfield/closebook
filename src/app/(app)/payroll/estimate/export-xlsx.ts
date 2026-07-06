/**
 * Formatted Excel export of the Monthly Payroll Estimate.
 *
 * Four sheets:
 *  1. Employees          — one row per person: total accrual cost + OT/DT/meal figures
 *  2. Allocation Detail  — one row per person × company/department/class share,
 *                          dollars scaled by day-weight × class %; reconciles to sheet 1
 *  3. By Entity          — entity rollup with the cash → accrual bridge
 *  4. By Class           — class rollup
 *
 * Loaded lazily (dynamic import) so exceljs stays out of the page bundle.
 */

// Structural types matching the /api/paylocity/monthly-estimate response
interface AmountTriple {
  wages: number;
  erTaxes: number;
  erBenefits: number;
}

interface ClassSplit {
  className: string;
  pct: number;
}

interface EmployeeSlice {
  entityCode: string;
  entityName: string;
  department: string;
  weight: number;
  classSplits: ClassSplit[];
  earnedInMonth: AmountTriple;
  overtimeHours: number;
  doubletimeHours: number;
  mealPremiums: number;
  premiumPayCost: number;
}

interface EmployeeRow {
  employeeId: string;
  companyId: string;
  employeeName: string;
  employingEntityCode?: string;
  department: string;
  earnedInMonth: AmountTriple;
  overtimeHours: number;
  doubletimeHours: number;
  mealPremiums: number;
  premiumPayCost: number;
  slices?: EmployeeSlice[];
}

interface EntityGroup {
  entityCode: string;
  entityName: string;
  headcount: number;
  cash: AmountTriple;
  beginningAccrued: AmountTriple;
  endingAccrued: AmountTriple;
  estimatedTail: AmountTriple;
  earnedInMonth: AmountTriple;
  overtimeHours: number;
  doubletimeHours: number;
  mealPremiums: number;
  premiumPayCost: number;
  employees: EmployeeRow[];
}

interface ClassGroup {
  className: string;
  headcount: number;
  earnedInMonth: AmountTriple;
  entities: { entityCode: string; earnedInMonth: AmountTriple }[];
}

export interface EstimateExportData {
  year: number;
  month: number;
  isClosedMonth: boolean;
  org: {
    headcount: number;
    earnedInMonth: AmountTriple;
    overtimeHours: number;
    doubletimeHours: number;
    mealPremiums: number;
    premiumPayCost: number;
  };
  entities: EntityGroup[];
  payingEntities: EntityGroup[];
  classes: ClassGroup[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONEY_FMT = '#,##0.00';
const HOURS_FMT = '#,##0.0';
const PCT_FMT = '0.0%';

const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1F2937" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
const TOTAL_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE5E7EB" } };

const tripleTotal = (t: AmountTriple) => t.wages + t.erTaxes + t.erBenefits;
const r2 = (n: number) => Math.round(n * 100) / 100;

function classLabel(splits: ClassSplit[]): string {
  if (splits.length === 0) return "";
  if (splits.length === 1) return splits[0].className;
  return splits.map((s) => `${s.className} ${Math.round(s.pct * 10) / 10}%`).join(" / ");
}

/** Build the workbook (no DOM access — also usable from Node for testing). */
export async function buildEstimateWorkbook(
  data: EstimateExportData
): Promise<import("exceljs").Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Closebook";
  const monthLabel = `${MONTHS[data.month - 1]} ${data.year}`;
  const statusLabel = data.isClosedMonth
    ? "Closed month (includes estimated month-end tail)"
    : "In progress — actuals to date";

  // Unique employees, partitioned by paying entity so each appears once
  const employees: EmployeeRow[] = data.payingEntities
    .flatMap((e) =>
      e.employees.map((emp) => ({ ...emp, employingEntityCode: e.entityCode }))
    )
    .sort((a, b) => tripleTotal(b.earnedInMonth) - tripleTotal(a.earnedInMonth));

  function addTitle(ws: import("exceljs").Worksheet, title: string, colCount: number) {
    const t = ws.addRow([`Monthly Payroll Estimate — ${monthLabel}`]);
    t.font = { bold: true, size: 14 };
    ws.mergeCells(t.number, 1, t.number, colCount);
    const s = ws.addRow([`${title} · ${statusLabel} · Exported ${new Date().toLocaleDateString("en-US")}`]);
    s.font = { size: 9, color: { argb: "FF6B7280" } };
    ws.mergeCells(s.number, 1, s.number, colCount);
    ws.addRow([]);
  }

  function styleHeader(row: import("exceljs").Row) {
    row.eachCell((c) => {
      c.fill = HEADER_FILL;
      c.font = HEADER_FONT;
      c.alignment = { vertical: "middle", wrapText: true };
    });
  }

  function styleTotal(row: import("exceljs").Row) {
    row.font = { bold: true };
    row.eachCell((c) => {
      c.fill = TOTAL_FILL;
      c.border = { top: { style: "thin" } };
    });
  }

  // ── Sheet 1: Employees ──
  {
    const ws = wb.addWorksheet("Employees", { views: [{ state: "frozen", ySplit: 4 }] });
    addTitle(ws, "One row per employee — total accrual-basis cost", 14);
    const header = ws.addRow([
      "Employee", "Employee ID", "Payroll Co.", "Cost Applied To (companies)", "Department(s)", "Class(es)",
      "Wages", "ER Taxes", "ER Benefits",
      "OT Hours", "DT Hours", "Meal Premiums", "OT+DT+Meal Cost", "Total Cost",
    ]);
    styleHeader(header);
    ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: 14 } };

    for (const emp of employees) {
      const slices = emp.slices ?? [];
      const companies = slices.length
        ? slices.map((s) => `${s.entityCode} ${Math.round(s.weight * 1000) / 10}%`).join(" / ")
        : "";
      const departments = [...new Set(slices.map((s) => s.department))].join(" / ") || emp.department;
      const classes = [...new Set(slices.map((s) => classLabel(s.classSplits)).filter(Boolean))].join(" / ");
      ws.addRow([
        emp.employeeName, emp.employeeId, emp.employingEntityCode ?? "", companies, departments, classes,
        r2(emp.earnedInMonth.wages), r2(emp.earnedInMonth.erTaxes), r2(emp.earnedInMonth.erBenefits),
        emp.overtimeHours || 0, emp.doubletimeHours || 0, emp.mealPremiums || 0,
        r2(emp.premiumPayCost), r2(tripleTotal(emp.earnedInMonth)),
      ]);
    }
    const total = ws.addRow([
      `Total (${employees.length} employees)`, "", "", "", "", "",
      r2(data.org.earnedInMonth.wages), r2(data.org.earnedInMonth.erTaxes), r2(data.org.earnedInMonth.erBenefits),
      data.org.overtimeHours, data.org.doubletimeHours, data.org.mealPremiums,
      r2(data.org.premiumPayCost), r2(tripleTotal(data.org.earnedInMonth)),
    ]);
    styleTotal(total);

    ws.columns.forEach((col, i) => {
      col.width = [26, 12, 10, 26, 20, 24, 12, 11, 12, 9, 9, 9, 13, 13][i] ?? 12;
      if (i >= 6 && i <= 8) col.numFmt = MONEY_FMT;
      if (i >= 9 && i <= 11) col.numFmt = HOURS_FMT;
      if (i >= 12) col.numFmt = MONEY_FMT;
    });
  }

  // ── Sheet 2: Allocation Detail ──
  {
    const ws = wb.addWorksheet("Allocation Detail", { views: [{ state: "frozen", ySplit: 4 }] });
    addTitle(ws, "One row per employee × company / department / class share", 14);
    const header = ws.addRow([
      "Employee", "Employee ID", "Company", "Department", "Class", "Share of Cost",
      "Wages", "ER Taxes", "ER Benefits",
      "OT Hours", "DT Hours", "Meal Premiums", "OT+DT+Meal Cost", "Total Cost",
    ]);
    styleHeader(header);
    ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: 14 } };

    let sumCheck: AmountTriple = { wages: 0, erTaxes: 0, erBenefits: 0 };
    for (const emp of employees) {
      const empTotal = tripleTotal(emp.earnedInMonth);
      for (const slice of emp.slices ?? []) {
        const splits: ClassSplit[] =
          slice.classSplits.length > 0 ? slice.classSplits : [{ className: "", pct: 100 }];
        // Scale by class %, pinning the rounding residual to the last split
        let acc: AmountTriple = { wages: 0, erTaxes: 0, erBenefits: 0 };
        let accOt = 0, accDt = 0, accMeal = 0, accPrem = 0;
        splits.forEach((sp, i) => {
          const last = i === splits.length - 1;
          const f = sp.pct / 100;
          const part: AmountTriple = last
            ? {
                wages: r2(slice.earnedInMonth.wages - acc.wages),
                erTaxes: r2(slice.earnedInMonth.erTaxes - acc.erTaxes),
                erBenefits: r2(slice.earnedInMonth.erBenefits - acc.erBenefits),
              }
            : {
                wages: r2(slice.earnedInMonth.wages * f),
                erTaxes: r2(slice.earnedInMonth.erTaxes * f),
                erBenefits: r2(slice.earnedInMonth.erBenefits * f),
              };
          const ot = last ? r2(slice.overtimeHours - accOt) : r2(slice.overtimeHours * f);
          const dt = last ? r2(slice.doubletimeHours - accDt) : r2(slice.doubletimeHours * f);
          const meal = last ? r2(slice.mealPremiums - accMeal) : r2(slice.mealPremiums * f);
          const prem = last ? r2(slice.premiumPayCost - accPrem) : r2(slice.premiumPayCost * f);
          acc = {
            wages: acc.wages + part.wages,
            erTaxes: acc.erTaxes + part.erTaxes,
            erBenefits: acc.erBenefits + part.erBenefits,
          };
          accOt += ot; accDt += dt; accMeal += meal; accPrem += prem;
          sumCheck = {
            wages: sumCheck.wages + part.wages,
            erTaxes: sumCheck.erTaxes + part.erTaxes,
            erBenefits: sumCheck.erBenefits + part.erBenefits,
          };
          ws.addRow([
            emp.employeeName, emp.employeeId, slice.entityName, slice.department,
            sp.className || "Unassigned",
            empTotal > 0 ? tripleTotal(part) / empTotal : 0,
            part.wages, part.erTaxes, part.erBenefits,
            ot, dt, meal, prem, r2(tripleTotal(part)),
          ]);
        });
      }
    }
    const total = ws.addRow([
      "Total", "", "", "", "", 1,
      r2(sumCheck.wages), r2(sumCheck.erTaxes), r2(sumCheck.erBenefits),
      data.org.overtimeHours, data.org.doubletimeHours, data.org.mealPremiums,
      r2(data.org.premiumPayCost), r2(tripleTotal(sumCheck)),
    ]);
    styleTotal(total);

    ws.columns.forEach((col, i) => {
      col.width = [26, 12, 24, 18, 18, 12, 12, 11, 12, 9, 9, 9, 13, 13][i] ?? 12;
      if (i === 5) col.numFmt = PCT_FMT;
      if ((i >= 6 && i <= 8) || i >= 12) col.numFmt = MONEY_FMT;
      if (i >= 9 && i <= 11) col.numFmt = HOURS_FMT;
    });
  }

  // ── Sheet 3: By Entity ──
  {
    const ws = wb.addWorksheet("By Entity", { views: [{ state: "frozen", ySplit: 4 }] });
    addTitle(ws, "Entity rollup with the cash → accrual bridge", 12);
    const header = ws.addRow([
      "Entity", "Headcount", "Cash Paid", "− Begin Accrued", "+ End Accrued",
      "of which Est. Tail", "Wages", "ER Taxes", "ER Benefits",
      "OT Hours", "OT+DT+Meal Cost", "Accrual Expense",
    ]);
    styleHeader(header);
    for (const e of data.entities) {
      ws.addRow([
        `${e.entityName} (${e.entityCode})`, e.headcount,
        r2(tripleTotal(e.cash)), r2(-tripleTotal(e.beginningAccrued)), r2(tripleTotal(e.endingAccrued)),
        r2(tripleTotal(e.estimatedTail)),
        r2(e.earnedInMonth.wages), r2(e.earnedInMonth.erTaxes), r2(e.earnedInMonth.erBenefits),
        e.overtimeHours, r2(e.premiumPayCost), r2(tripleTotal(e.earnedInMonth)),
      ]);
    }
    const total = ws.addRow([
      "Org Total", data.org.headcount,
      r2(data.entities.reduce((s, e) => s + tripleTotal(e.cash), 0)),
      r2(-data.entities.reduce((s, e) => s + tripleTotal(e.beginningAccrued), 0)),
      r2(data.entities.reduce((s, e) => s + tripleTotal(e.endingAccrued), 0)),
      r2(data.entities.reduce((s, e) => s + tripleTotal(e.estimatedTail), 0)),
      r2(data.org.earnedInMonth.wages), r2(data.org.earnedInMonth.erTaxes), r2(data.org.earnedInMonth.erBenefits),
      data.org.overtimeHours, r2(data.org.premiumPayCost), r2(tripleTotal(data.org.earnedInMonth)),
    ]);
    styleTotal(total);
    ws.columns.forEach((col, i) => {
      col.width = [32, 10, 13, 14, 14, 13, 13, 12, 12, 9, 13, 14][i] ?? 12;
      if (i >= 2 && i !== 9) col.numFmt = MONEY_FMT;
      if (i === 9) col.numFmt = HOURS_FMT;
    });
  }

  // ── Sheet 4: By Class ──
  if ((data.classes?.length ?? 0) > 0) {
    const ws = wb.addWorksheet("By Class", { views: [{ state: "frozen", ySplit: 4 }] });
    addTitle(ws, "Class rollup (multi-class splits applied, date-adjusted)", 7);
    const header = ws.addRow([
      "Class", "Headcount", "Entity Breakdown", "Wages", "ER Taxes", "ER Benefits", "Accrual Expense",
    ]);
    styleHeader(header);
    for (const c of data.classes) {
      ws.addRow([
        c.className, c.headcount,
        c.entities.map((e) => `${e.entityCode} ${r2(tripleTotal(e.earnedInMonth)).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`).join(" · "),
        r2(c.earnedInMonth.wages), r2(c.earnedInMonth.erTaxes), r2(c.earnedInMonth.erBenefits),
        r2(tripleTotal(c.earnedInMonth)),
      ]);
    }
    const total = ws.addRow([
      `Total (${data.classes.length} classes)`, data.org.headcount, "",
      r2(data.org.earnedInMonth.wages), r2(data.org.earnedInMonth.erTaxes), r2(data.org.earnedInMonth.erBenefits),
      r2(tripleTotal(data.org.earnedInMonth)),
    ]);
    styleTotal(total);
    ws.columns.forEach((col, i) => {
      col.width = [22, 10, 44, 13, 12, 12, 14][i] ?? 12;
      if (i >= 3) col.numFmt = MONEY_FMT;
    });
  }

  return wb;
}

export async function exportEstimateXlsx(data: EstimateExportData): Promise<void> {
  const wb = await buildEstimateWorkbook(data);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payroll-estimate-${data.year}-${String(data.month).padStart(2, "0")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

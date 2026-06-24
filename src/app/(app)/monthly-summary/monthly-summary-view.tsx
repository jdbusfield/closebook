"use client";

/**
 * On-page HTML preview of the monthly summary. Renders the exact same
 * MonthlySummaryInput model the PDF uses (YTD block left, Month block right,
 * red/green variance shading) so the screen preview matches the export.
 */

import {
  DASH,
  fmtValue,
  variance,
  type CellValues,
  type MonthlySummaryInput,
  type SummaryRow,
  type SummarySection,
} from "./monthly-summary-model";

const FAV = { background: "#d6f3de", color: "#156e3d" };
const UNFAV = { background: "#f8dbdb", color: "#9d1f1f" };
const MUTED = "#6e6e6e";
const FAINT = "#b4b4b4";

const NUM_BASE: React.CSSProperties = {
  textAlign: "right",
  padding: "3px 6px",
  borderBottom: "1px solid #e9e9e9",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

function ValueCell({
  row,
  n,
  isBase,
  keyId,
}: {
  row: SummaryRow;
  n: number | null;
  isBase: boolean;
  keyId: string;
}) {
  const style: React.CSSProperties = { ...NUM_BASE };
  if (row.bold && !isBase) style.fontWeight = 700;
  if (row.sub) style.color = MUTED;
  return (
    <td key={keyId} style={style}>
      {fmtValue(row.kind, n)}
    </td>
  );
}

function VarCell({
  row,
  actual,
  base,
  show,
  keyId,
}: {
  row: SummaryRow;
  actual: number | null;
  base: number | null;
  show: boolean;
  keyId: string;
}) {
  if (!show) {
    return (
      <td key={keyId} style={{ ...NUM_BASE, color: FAINT }}>
        {DASH}
      </td>
    );
  }
  const v = variance(row.kind, actual, base, !!row.invert);
  const style: React.CSSProperties = { ...NUM_BASE };
  if (v.favorable === true) Object.assign(style, FAV);
  else if (v.favorable === false) Object.assign(style, UNFAV);
  else style.color = MUTED;
  return (
    <td key={keyId} style={style}>
      {v.text}
    </td>
  );
}

function blockCells(
  row: SummaryRow,
  vals: CellValues,
  showBudget: boolean,
  prefix: string
) {
  return [
    <ValueCell key={`${prefix}-a`} keyId={`${prefix}-a`} row={row} n={vals.actual} isBase={false} />,
    <ValueCell key={`${prefix}-py`} keyId={`${prefix}-py`} row={row} n={vals.py} isBase />,
    <VarCell key={`${prefix}-vpy`} keyId={`${prefix}-vpy`} row={row} actual={vals.actual} base={vals.py} show />,
    showBudget ? (
      <ValueCell key={`${prefix}-b`} keyId={`${prefix}-b`} row={row} n={vals.budget} isBase />
    ) : (
      <td key={`${prefix}-b`} style={{ ...NUM_BASE, color: FAINT }}>
        {DASH}
      </td>
    ),
    <VarCell key={`${prefix}-vb`} keyId={`${prefix}-vb`} row={row} actual={vals.actual} base={vals.budget} show={showBudget} />,
  ];
}

function SectionTable({
  section,
  ytdShort,
  ytdPyShort,
  monthShort,
  pyShort,
}: {
  section: SummarySection;
  ytdShort: string;
  ytdPyShort: string;
  monthShort: string;
  pyShort: string;
}) {
  const barCell: React.CSSProperties = {
    background: "#111",
    color: "#fff",
    fontWeight: 700,
    fontSize: 11,
    padding: "5px 6px",
    textAlign: "center",
    letterSpacing: "0.03em",
  };
  const subHeadCell: React.CSSProperties = {
    background: "#eee",
    color: "#282828",
    fontWeight: 700,
    fontSize: 10,
    padding: "3px 6px",
    textAlign: "right",
    borderBottom: "1px solid #d2d2d2",
    whiteSpace: "nowrap",
  };
  const subHeads = [ytdShort, ytdPyShort, "A v PY", "Budget", "A v B", monthShort, pyShort, "A v PY", "Budget", "A v B"];

  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
        marginTop: 14,
        fontSize: 12,
      }}
    >
      <colgroup>
        <col style={{ width: "17%" }} />
        {Array.from({ length: 10 }, (_, i) => (
          <col key={i} style={{ width: "8.3%" }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th style={{ ...barCell, textAlign: "left" }}>{section.title.toUpperCase()}</th>
          <th style={barCell} colSpan={5}>
            YEAR-TO-DATE
          </th>
          <th style={barCell} colSpan={5}>
            MONTH
          </th>
        </tr>
        <tr>
          <th style={{ ...subHeadCell, textAlign: "left" }}></th>
          {subHeads.map((h, i) => (
            <th key={i} style={subHeadCell}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {section.rows.map((row, ri) => {
          if (row.spacer) {
            return (
              <tr key={ri}>
                <td colSpan={11} style={{ height: 6 }} />
              </tr>
            );
          }
          const labelStyle: React.CSSProperties = {
            textAlign: "left",
            padding: "3px 6px",
            borderBottom: "1px solid #e9e9e9",
            whiteSpace: "nowrap",
          };
          if (row.bold) labelStyle.fontWeight = 700;
          if (row.sub) {
            labelStyle.color = MUTED;
            labelStyle.fontStyle = "italic";
            labelStyle.paddingLeft = 20;
          }
          return (
            <tr key={ri}>
              <td style={labelStyle}>{row.label}</td>
              {blockCells(row, row.ytd, section.showBudget, `${ri}-ytd`)}
              {blockCells(row, row.month, section.showBudget, `${ri}-mo`)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function MonthlySummaryView({ data }: { data: MonthlySummaryInput }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-white p-6 text-black shadow-sm">
      <div style={{ minWidth: 760 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{data.organizationName}</div>
        <div style={{ fontSize: 13, marginTop: 2 }}>
          Monthly Performance Summary &mdash; {data.monthLabel}
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
          {(data.scopeNote ?? "Consolidated") + "   ·   $ in thousands"}
        </div>

        {data.sections.map((section) => (
          <SectionTable
            key={section.title}
            section={section}
            ytdShort={data.ytdShort}
            ytdPyShort={data.ytdPyShort}
            monthShort={data.monthShort}
            pyShort={data.pyShort}
          />
        ))}

        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 14 }}>
          Operating-cost variances are shaded by favorability (green = favorable).
          Utilization, rate, and fleet figures show actual vs prior year only.
        </div>
      </div>
    </div>
  );
}

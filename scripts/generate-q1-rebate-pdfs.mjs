// Mirrors the in-app PDF export at
//   src/app/(app)/[entityId]/rebates/[customerId]/page.tsx :: handleExportPdf
// for every Versatile rebate customer with Q1 2026 invoices, so the team can
// download the same artifact in batch.

import "dotenv/config";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ENTITY_ID = "2fdafa28-8ba2-4caa-aa9f-5d8f39f57081";
const QUARTER = "2026 Q1";
const QUARTER_FILE_LABEL = QUARTER.replace(/\s+/g, "-");
const OUT_DIR = "q1-2026-reports";

// ─── Mirror of helpers used in handleExportPdf ─────────────────────────────

const RECORD_TYPE_CATEGORIES = [
  { key: "R", label: "Rental", excluded: false },
  { key: "S", label: "Sales", excluded: true },
  { key: "F", label: "Loss & Damage", excluded: true },
  { key: "L", label: "Loss & Damage", excluded: true },
  { key: "M", label: "Miscellaneous", excluded: true },
];

const EQUIPMENT_LABELS = {
  pro_supplies: "Pro Supplies",
  vehicle: "Vehicle",
  grip_lighting: "G&L",
  studio: "Studio",
};

const fmt = (n) =>
  "$" +
  (Number(n) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtPct = (n) => (Number(n) || 0).toFixed(2) + "%";

function getEquipmentLabel(t) {
  return EQUIPMENT_LABELS[t] || t || "—";
}

function isNonRebatableRecordType(rt) {
  return rt === "S" || rt === "F" || rt === "L" || rt === "M";
}

function getExclusionBadgeLabel(rt, short = false) {
  if (rt === "F" || rt === "L") return short ? "L&D" : "Loss & Damage";
  if (rt === "S") return "Sales — excluded";
  if (rt === "M") return "Misc — excluded";
  return "Excluded";
}

function groupItemsByCategory(items) {
  const groups = {};
  for (const item of items) {
    const key = item.record_type || "O";
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

function safeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}

// ─── Build one PDF for a single customer ───────────────────────────────────

function buildPdf({ customer, tiers, invoices, items, excludedICodes }) {
  const exportInvoices = invoices.filter((i) => !i.is_manually_excluded);
  if (exportInvoices.length === 0) return null;

  // Sort by billing_end_date asc (matches the in-app order)
  exportInvoices.sort((a, b) =>
    (a.billing_end_date || a.invoice_date || "").localeCompare(
      b.billing_end_date || b.invoice_date || "",
    ),
  );

  const itemsByInvoice = new Map();
  for (const it of items) {
    const arr = itemsByInvoice.get(it.rebate_invoice_id) || [];
    arr.push(it);
    itemsByInvoice.set(it.rebate_invoice_id, arr);
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  // --- Title page / header ---
  doc.setFontSize(18);
  doc.text("Rebate Report", margin, 50);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Customer: ${customer.customer_name}`, margin, 70);
  doc.text(
    `Agreement Type: ${customer.agreement_type.charAt(0).toUpperCase() + customer.agreement_type.slice(1)}`,
    margin,
    85,
  );
  doc.text(`Quarter: ${QUARTER}`, margin, 100);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, 115);
  doc.setTextColor(0);

  // --- Summary table ---
  const summaryHead = [[
    "Invoice #", "Date", "Quarter", "Deal / Order", "Type",
    "Gross Total", "Excluded", "Before Disc", "Eligible Discount",
    "Final Amount", "Rebate %", "Net Rebate",
  ]];
  const summaryBody = [];

  let grandTotalList = 0, grandTotalExcl = 0, grandTotalBefore = 0;
  let grandTotalDisc = 0, grandTotalFinal = 0, grandTotalRebate = 0;

  for (const inv of exportInvoices) {
    grandTotalList += inv.gross_total || 0;
    grandTotalExcl += (inv.gross_total || 0) - (inv.before_discount || 0);
    grandTotalBefore += inv.before_discount || 0;
    grandTotalDisc += inv.discount_eligible_amount ?? inv.discount_amount ?? 0;
    grandTotalFinal += inv.final_amount || 0;
    grandTotalRebate += inv.net_rebate || 0;

    summaryBody.push([
      inv.invoice_number,
      inv.billing_end_date || inv.invoice_date || "",
      inv.quarter || "",
      (inv.deal || inv.order_description || "").slice(0, 35),
      getEquipmentLabel(inv.equipment_type),
      fmt(inv.gross_total),
      fmt((inv.gross_total || 0) - (inv.before_discount || 0)),
      fmt(inv.before_discount),
      fmt(inv.discount_eligible_amount ?? inv.discount_amount),
      fmt(inv.final_amount),
      fmtPct(inv.remaining_rebate_pct),
      fmt(inv.net_rebate),
    ]);
  }

  summaryBody.push([
    "TOTALS", "", "", "", "",
    fmt(grandTotalList), fmt(grandTotalExcl), fmt(grandTotalBefore),
    fmt(grandTotalDisc), fmt(grandTotalFinal), "",
    fmt(grandTotalRebate),
  ]);

  autoTable(doc, {
    startY: 135,
    head: summaryHead,
    body: summaryBody,
    theme: "grid",
    headStyles: { fillColor: [41, 41, 41], fontSize: 7.5 },
    bodyStyles: { fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 58 },
      3: { cellWidth: 100 },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
      11: { halign: "right", fontStyle: "bold" },
    },
    didParseCell: (data) => {
      if (data.row.index === summaryBody.length - 1) {
        data.cell.styles.fillColor = [240, 240, 240];
        data.cell.styles.fontStyle = "bold";
      }
    },
    margin: { left: margin, right: margin },
  });

  // --- Tier rate grids (commercial) ---
  if (tiers.length > 0) {
    let tierY = doc.lastAutoTable.finalY + 25;
    const categories = ["pro_supplies", "vehicle", "grip_lighting", "studio"];
    const catLabels = {
      pro_supplies: "Pro Supplies",
      vehicle: "Vehicle",
      grip_lighting: "Grip & Lighting",
      studio: "Studio",
    };

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Rebate Rates", margin, tierY);
    doc.setFont("helvetica", "normal");
    tierY += 5;

    const sortedTiers = [...tiers].sort((a, b) => a.sort_order - b.sort_order);

    const rateHead = [["Tier", "Revenue Range", ...categories.map((c) => catLabels[c])]];
    const rateBody = sortedTiers.map((t) => [
      t.label,
      t.threshold_max
        ? `${fmt(t.threshold_min)} – ${fmt(t.threshold_max)}`
        : `${fmt(t.threshold_min)}+`,
      ...categories.map((c) =>
        t[`rate_${c}`] != null ? fmtPct(t[`rate_${c}`]) : "—",
      ),
    ]);

    autoTable(doc, {
      startY: tierY,
      head: rateHead,
      body: rateBody,
      theme: "grid",
      headStyles: { fillColor: [41, 41, 41], fontSize: 7.5 },
      bodyStyles: { fontSize: 7 },
      margin: { left: margin, right: margin + (pageWidth - 2 * margin) / 2 + 10 },
      tableWidth: (pageWidth - 2 * margin) / 2 - 10,
    });

    const discHead = [["Tier", "Revenue Range", ...categories.map((c) => catLabels[c])]];
    const discBody = sortedTiers.map((t) => [
      t.label,
      t.threshold_max
        ? `${fmt(t.threshold_min)} – ${fmt(t.threshold_max)}`
        : `${fmt(t.threshold_min)}+`,
      ...categories.map((c) =>
        t[`max_disc_${c}`] != null ? fmtPct(t[`max_disc_${c}`]) : "—",
      ),
    ]);

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(
      "Max Discount Allowed",
      margin + (pageWidth - 2 * margin) / 2 + 10,
      tierY - 5,
    );
    doc.setFont("helvetica", "normal");

    autoTable(doc, {
      startY: tierY,
      head: discHead,
      body: discBody,
      theme: "grid",
      headStyles: { fillColor: [41, 41, 41], fontSize: 7.5 },
      bodyStyles: { fontSize: 7 },
      margin: { left: margin + (pageWidth - 2 * margin) / 2 + 10, right: margin },
      tableWidth: (pageWidth - 2 * margin) / 2 - 10,
    });
  }

  // --- Per-invoice detail pages ---
  for (const inv of exportInvoices) {
    doc.addPage();
    let yPos = 45;

    doc.setFontSize(14);
    doc.text(`Invoice: ${inv.invoice_number}`, margin, yPos);
    yPos += 20;

    doc.setFontSize(9);
    doc.setTextColor(100);
    const metaLines = [
      `Date: ${inv.billing_end_date || inv.invoice_date || "N/A"}`,
      `Deal / Order: ${inv.deal || inv.order_description || "N/A"}`,
      `Equipment Type: ${getEquipmentLabel(inv.equipment_type)}    Quarter: ${inv.quarter || "N/A"}`,
      `Tier: ${inv.tier_label || "N/A"}    Rebate Rate: ${fmtPct(inv.rebate_rate)}    Cumulative Revenue: ${fmt(inv.cumulative_revenue)}    Cumulative Rebate: ${fmt(inv.cumulative_rebate)}`,
    ];
    for (const line of metaLines) {
      doc.text(line, margin, yPos);
      yPos += 13;
    }
    doc.setTextColor(0);
    yPos += 5;

    // Calc breakdown
    doc.setFontSize(10);
    doc.text("Calculation Breakdown", margin, yPos);
    yPos += 5;

    const breakdownBody = [
      ["Gross Invoice Total", fmt(inv.gross_total)],
      ["Excluded", fmt(inv.excluded_total)],
      ["Tax", fmt(inv.tax_amount)],
      ["Taxable Sales", fmt(inv.taxable_sales)],
      ["Before Discount", fmt(inv.before_discount)],
      ["Eligible Discount", fmt(inv.discount_eligible_amount ?? inv.discount_amount)],
      ["Discount %", fmtPct(inv.discount_percent)],
      ["Final Amount", fmt(inv.final_amount)],
      ["Remaining Rebate", fmtPct(inv.remaining_rebate_pct)],
      ["Net Rebate", fmt(inv.net_rebate)],
    ];

    autoTable(doc, {
      startY: yPos,
      body: breakdownBody,
      theme: "plain",
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 120, fontStyle: "bold" },
        1: { cellWidth: 80, halign: "right" },
      },
      didParseCell: (data) => {
        if (data.row.index === 1) data.cell.styles.fillColor = [255, 230, 230];
        if (data.row.index === 4) data.cell.styles.fillColor = [255, 255, 220];
        if (data.row.index === 9) {
          data.cell.styles.fillColor = [220, 255, 220];
          data.cell.styles.fontStyle = "bold";
        }
      },
      margin: { left: margin, right: margin },
      tableWidth: 200,
    });

    yPos = doc.lastAutoTable.finalY + 15;

    // Line items
    const invItems = itemsByInvoice.get(inv.id) || [];
    if (invItems.length > 0) {
      const grouped = groupItemsByCategory(invItems);
      const orderedKeys = [
        ...RECORD_TYPE_CATEGORIES.map((c) => c.key).filter((k) => grouped[k]),
        ...Object.keys(grouped).filter(
          (k) => !RECORD_TYPE_CATEGORIES.some((c) => c.key === k),
        ),
      ];

      doc.setFontSize(10);
      doc.text("Line Items", margin, yPos);
      yPos += 18;

      for (const catKey of orderedKeys) {
        const catItems = grouped[catKey];
        const catConfig = RECORD_TYPE_CATEGORIES.find((c) => c.key === catKey);
        const label = catConfig?.label || "Other";
        // RW's `extended` is the POST-discount line total; `discount_amount` is
        // the discount in dollars. So list (= qty × days × rate) is
        // `extended + discount_amount`, and `extended` itself is the net.
        const catRegular = catItems.reduce(
          (s, it) =>
            s + (Number(it.extended) || 0) + (Number(it.discount_amount) || 0),
          0,
        );
        const catNet = catItems.reduce(
          (s, it) => s + (Number(it.extended) || 0),
          0,
        );

        if (yPos > doc.internal.pageSize.getHeight() - 80) {
          doc.addPage();
          yPos = 45;
        }

        doc.setFontSize(9);
        doc.setTextColor(80);
        const catSuffix = catConfig?.excluded ? " — excluded from rebate" : "";
        doc.text(
          `${label} (${catItems.length} items)${catSuffix} — Regular ${fmt(catRegular)} · Net ${fmt(catNet)}`,
          margin,
          yPos,
        );
        doc.setTextColor(0);
        yPos += 8;

        const itemHead = [["I-Code", "Description", "Qty", "Regular", "Disc %", "Discount", "Net", "Status"]];
        const itemBody = [];

        for (const item of catItems) {
          const isExcludedByICode =
            item.i_code != null && excludedICodes.has(item.i_code.trim());
          const isNonRebatable = isNonRebatableRecordType(item.record_type);
          const isExcluded = item.is_excluded || isExcludedByICode || isNonRebatable;
          const net = Number(item.extended) || 0;        // post-discount line total
          const discount = Number(item.discount_amount) || 0;
          const regular = net + discount;                // qty × days × rate (list)
          const discPct = regular > 0 ? (discount / regular) * 100 : 0;
          const statusLabel = !isExcluded
            ? ""
            : isNonRebatable
              ? getExclusionBadgeLabel(item.record_type, true)
              : "Excluded";
          itemBody.push([
            item.i_code || "",
            (item.description || "").slice(0, 50),
            item.quantity ?? "",
            fmt(regular),
            discount > 0 ? fmtPct(discPct) : "—",
            discount > 0 ? fmt(discount) : "—",
            fmt(net),
            statusLabel,
          ]);
        }

        autoTable(doc, {
          startY: yPos,
          head: itemHead,
          body: itemBody,
          theme: "striped",
          headStyles: { fillColor: [70, 70, 70], fontSize: 7 },
          bodyStyles: { fontSize: 7 },
          columnStyles: {
            0: { cellWidth: 60 },
            1: { cellWidth: 175 },
            2: { cellWidth: 28, halign: "right" },
            3: { cellWidth: 55, halign: "right" },
            4: { cellWidth: 40, halign: "right" },
            5: { cellWidth: 55, halign: "right" },
            6: { cellWidth: 55, halign: "right" },
            7: { cellWidth: 50 },
          },
          didParseCell: (data) => {
            if (data.section === "body") {
              const status = itemBody[data.row.index]?.[7];
              if (status) {
                data.cell.styles.fillColor = [255, 240, 240];
              }
            }
          },
          margin: { left: margin, right: margin },
        });

        yPos = doc.lastAutoTable.finalY + 18;
      }
    }
  }

  const filename = `${OUT_DIR}/${safeFilename(`Rebate Report - ${customer.customer_name} - ${QUARTER_FILE_LABEL}.pdf`)}`;
  doc.save(filename);
  return { filename, rebate: grandTotalRebate, invoiceCount: exportInvoices.length };
}

// ─── Pull data + drive ─────────────────────────────────────────────────────

async function main() {
  const { data: customers } = await sb
    .from("rebate_customers")
    .select("*")
    .eq("entity_id", ENTITY_ID)
    .eq("status", "active")
    .order("customer_name");

  const customerIds = customers.map((c) => c.id);

  const { data: invoices } = await sb
    .from("rebate_invoices")
    .select("*")
    .eq("entity_id", ENTITY_ID)
    .eq("quarter", QUARTER)
    .in("rebate_customer_id", customerIds);

  const { data: tiers } = await sb
    .from("rebate_tiers")
    .select("*")
    .in("rebate_customer_id", customerIds);

  const invoiceIds = invoices.map((i) => i.id);
  const { data: items } = invoiceIds.length
    ? await sb
        .from("rebate_invoice_items")
        .select("*")
        .in("rebate_invoice_id", invoiceIds)
    : { data: [] };

  // Excluded I-Codes (global + per-customer) — same logic as get_customer_detail
  const { data: globalCodes } = await sb
    .from("rebate_excluded_icodes")
    .select("i_code")
    .eq("entity_id", ENTITY_ID)
    .is("rebate_customer_id", null);

  const { data: customerCodes } = await sb
    .from("rebate_excluded_icodes")
    .select("i_code, rebate_customer_id")
    .in("rebate_customer_id", customerIds);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Generating Q1 2026 rebate PDFs for ${customers.length} customers...\n`);
  const results = [];

  for (const customer of customers) {
    const custInvoices = invoices.filter((i) => i.rebate_customer_id === customer.id);
    if (custInvoices.length === 0) continue;

    const custInvoiceIds = new Set(custInvoices.map((i) => i.id));
    const custItems = items.filter((it) => custInvoiceIds.has(it.rebate_invoice_id));
    const custTiers = tiers.filter((t) => t.rebate_customer_id === customer.id);

    // Build excludedICodes set: global if customer.use_global_exclusions, plus
    // any rows tied to this customer
    const excludedICodes = new Set();
    if (customer.use_global_exclusions) {
      for (const c of globalCodes) excludedICodes.add(c.i_code.trim());
    }
    for (const c of customerCodes.filter((x) => x.rebate_customer_id === customer.id)) {
      excludedICodes.add(c.i_code.trim());
    }

    const result = buildPdf({
      customer,
      tiers: custTiers,
      invoices: custInvoices,
      items: custItems,
      excludedICodes,
    });
    if (result) {
      results.push({ name: customer.customer_name, ...result });
    }
  }

  console.log("Generated:");
  for (const r of results) {
    console.log(
      `  ✓ ${r.filename}  (${r.invoiceCount} inv · ${fmt(r.rebate)})`,
    );
  }
  console.log(`\nTotal Q1 rebate: ${fmt(results.reduce((s, r) => s + r.rebate, 0))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

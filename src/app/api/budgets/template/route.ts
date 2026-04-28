import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as XLSX from "xlsx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// GET — download a pre-populated budget template XLSX using Master GL accounts
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entityId");
    const fiscalYear = searchParams.get("fiscalYear") ?? "2025";

    if (!entityId) {
      return NextResponse.json(
        { error: "entityId is required" },
        { status: 400 }
      );
    }

    const admin: AnyClient = createAdminClient();

    // Get entity info (need organization_id for master accounts)
    const { data: entity } = await admin
      .from("entities")
      .select("name, code, organization_id")
      .eq("id", entityId)
      .single();

    if (!entity) {
      return NextResponse.json(
        { error: "Entity not found" },
        { status: 404 }
      );
    }

    // Budgets are management-only, so resolve the management chart and
    // scope the account list to it.
    const { data: mgmtChart } = await admin
      .from("master_charts")
      .select("id")
      .eq("organization_id", entity.organization_id)
      .eq("kind", "management")
      .single();

    if (!mgmtChart) {
      return NextResponse.json(
        { error: "Management chart not found for this organization" },
        { status: 500 },
      );
    }

    // Get Master GL P&L accounts (Revenue + Expense) in the management chart
    const { data: masterAccounts } = await admin
      .from("master_accounts")
      .select("id, account_number, name, classification, account_type")
      .eq("organization_id", entity.organization_id)
      .eq("chart_id", mgmtChart.id)
      .eq("is_active", true)
      .in("classification", ["Revenue", "Expense"])
      .order("classification")
      .order("account_number");

    const accountList = masterAccounts ?? [];

    // Build worksheet data
    const MONTHS = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];

    const wsData: (string | number)[][] = [];

    // Header row
    wsData.push([
      "Account Number",
      "Account Name",
      "Classification",
      ...MONTHS.map((m) => `${m} ${fiscalYear}`),
      "Annual Total",
    ]);

    // Account rows — using Master GL accounts
    for (const account of accountList) {
      wsData.push([
        account.account_number ?? "",
        account.name,
        account.classification,
        // 12 blank month columns
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        // Annual total placeholder
        0,
      ]);
    }

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    ws["!cols"] = [
      { wch: 18 }, // Account Number
      { wch: 40 }, // Account Name
      { wch: 15 }, // Classification
      ...MONTHS.map(() => ({ wch: 15 })), // Month columns
      { wch: 15 }, // Annual Total
    ];

    XLSX.utils.book_append_sheet(wb, ws, `Budget ${fiscalYear}`);

    // Add instructions sheet
    const instrData = [
      ["Budget Import Template — Master GL Accounts"],
      [""],
      [`Entity: ${entity.name} (${entity.code})`],
      [`Fiscal Year: ${fiscalYear}`],
      [""],
      ["Instructions:"],
      ["1. Fill in monthly budget amounts for each Master GL account."],
      ["2. Amounts should be positive for both Revenue and Expense accounts."],
      ["3. Leave amounts as 0 for accounts with no budget."],
      ["4. Do not modify Account Number or Account Name columns."],
      ["5. Save the file and upload it on the Budget Management page."],
      [""],
      ["Notes:"],
      ["- Accounts are from the Master GL chart of accounts (not entity-level)."],
      ["- Only Revenue and Expense accounts are included (P&L budget)."],
      ["- Balance Sheet accounts are not budgeted in this template."],
      ["- The Annual Total column is for reference only and not imported."],
    ];

    const instrWs = XLSX.utils.aoa_to_sheet(instrData);
    instrWs["!cols"] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, instrWs, "Instructions");

    // Generate buffer
    const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `budget_template_${entity.code ?? entityId}_${fiscalYear}.xlsx`;

    return new Response(xlsxBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("GET /api/budgets/template error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

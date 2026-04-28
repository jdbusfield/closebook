import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as XLSX from "xlsx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- budget tables not yet in generated types
type AnyClient = any;

interface PreviewRow {
  accountNumber: string;
  accountName: string;
  masterAccountId: string | null;
  months: Record<string, number>; // "1" through "12" -> amount
  status: "matched" | "unmatched" | "error";
  message?: string;
}

// POST — import budget from XLSX (preview or commit mode) using Master GL accounts
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const entityId = formData.get("entityId") as string | null;
    const versionId = formData.get("versionId") as string | null;
    const mode = (formData.get("mode") as string) ?? "preview";
    const fiscalYear = parseInt(
      (formData.get("fiscalYear") as string) ?? "2025"
    );

    if (!file || !entityId || !versionId) {
      return NextResponse.json(
        { error: "file, entityId, and versionId are required" },
        { status: 400 }
      );
    }

    const admin: AnyClient = createAdminClient();

    // Verify version exists and belongs to entity
    const { data: version } = await admin
      .from("budget_versions")
      .select("id, entity_id, fiscal_year")
      .eq("id", versionId)
      .eq("entity_id", entityId)
      .single();

    if (!version) {
      return NextResponse.json(
        { error: "Budget version not found" },
        { status: 404 }
      );
    }

    // Get entity's organization_id for Master GL lookup
    const { data: entity } = await admin
      .from("entities")
      .select("organization_id")
      .eq("id", entityId)
      .single();

    if (!entity) {
      return NextResponse.json(
        { error: "Entity not found" },
        { status: 404 }
      );
    }

    // Budgets are management-only, so match against the management chart only.
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

    // Get Master GL accounts for matching (P&L only) in the management chart
    const { data: masterAccounts } = await admin
      .from("master_accounts")
      .select("id, name, account_number, classification, account_type")
      .eq("organization_id", entity.organization_id)
      .eq("chart_id", mgmtChart.id)
      .eq("is_active", true)
      .in("classification", ["Revenue", "Expense"])
      .order("account_number");

    const accountList: Array<{
      id: string;
      name: string;
      account_number: string;
      classification: string;
      account_type: string;
    }> = masterAccounts ?? [];

    // Parse XLSX
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      return NextResponse.json(
        { error: "No sheets found in workbook" },
        { status: 400 }
      );
    }

    const rawData: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
    });

    if (rawData.length === 0) {
      return NextResponse.json(
        { error: "No data rows found in spreadsheet" },
        { status: 400 }
      );
    }

    // Detect column headers
    const headers = Object.keys(rawData[0]);

    // Find account number column
    const acctNumCol = headers.find((h) => {
      const norm = h.toLowerCase().replace(/[^a-z0-9]/g, "");
      return (
        norm.includes("accountnumber") ||
        norm.includes("acctno") ||
        norm.includes("accountno") ||
        norm.includes("acctnum") ||
        norm === "account" ||
        norm === "number"
      );
    });

    // Find account name column
    const acctNameCol = headers.find((h) => {
      const norm = h.toLowerCase().replace(/[^a-z0-9]/g, "");
      return (
        norm.includes("accountname") ||
        norm.includes("acctname") ||
        norm === "name" ||
        norm === "description"
      );
    });

    if (!acctNumCol && !acctNameCol) {
      return NextResponse.json(
        {
          error:
            'Could not find account identifier column. Expected "Account Number" or "Account Name" header.',
        },
        { status: 400 }
      );
    }

    // Find month columns
    const MONTH_NAMES = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ];
    const MONTH_ABBRS = [
      "jan", "feb", "mar", "apr", "may", "jun",
      "jul", "aug", "sep", "oct", "nov", "dec",
    ];

    const monthColumns: Record<string, string> = {};

    for (const h of headers) {
      const norm = h.toLowerCase().trim();
      const monthIdx = MONTH_NAMES.findIndex(
        (m) => norm === m || norm.startsWith(m)
      );
      if (monthIdx >= 0) {
        monthColumns[String(monthIdx + 1)] = h;
        continue;
      }
      const abbrIdx = MONTH_ABBRS.findIndex(
        (m) => norm === m || norm.startsWith(m)
      );
      if (abbrIdx >= 0) {
        monthColumns[String(abbrIdx + 1)] = h;
        continue;
      }
      const num = parseInt(norm);
      if (num >= 1 && num <= 12 && String(num) === norm) {
        monthColumns[String(num)] = h;
      }
    }

    if (Object.keys(monthColumns).length === 0) {
      return NextResponse.json(
        {
          error:
            "Could not find month columns. Expected month names (January, Feb, etc.) or numbers (1-12).",
        },
        { status: 400 }
      );
    }

    // Process rows — match against Master GL accounts
    const previewRows: PreviewRow[] = [];

    for (const row of rawData) {
      const acctNum = acctNumCol ? String(row[acctNumCol] ?? "").trim() : "";
      const acctName = acctNameCol ? String(row[acctNameCol] ?? "").trim() : "";

      // Skip empty rows
      if (!acctNum && !acctName) continue;

      // Match to Master GL account
      let matchedAccount: (typeof accountList)[0] | undefined;

      // 1) Exact account number match
      if (acctNum) {
        matchedAccount = accountList.find(
          (a) => a.account_number === acctNum
        );
      }

      // 2) Exact name match
      if (!matchedAccount && acctName) {
        matchedAccount = accountList.find(
          (a) => a.name.toLowerCase() === acctName.toLowerCase()
        );
      }

      // 3) Partial name match (only if single result)
      if (!matchedAccount && acctName) {
        const partialMatches = accountList.filter((a) =>
          a.name.toLowerCase().includes(acctName.toLowerCase())
        );
        if (partialMatches.length === 1) {
          matchedAccount = partialMatches[0];
        }
      }

      // Read month amounts
      const months: Record<string, number> = {};
      for (const [monthNum, colHeader] of Object.entries(monthColumns)) {
        const raw = row[colHeader];
        const val =
          typeof raw === "number"
            ? raw
            : parseFloat(String(raw ?? "0").replace(/[,$]/g, ""));
        months[monthNum] = isNaN(val) ? 0 : val;
      }

      previewRows.push({
        accountNumber: acctNum,
        accountName: acctName || matchedAccount?.name || "",
        masterAccountId: matchedAccount?.id ?? null,
        months,
        status: matchedAccount ? "matched" : "unmatched",
        message: matchedAccount
          ? `Matched to Master GL ${matchedAccount.account_number} - ${matchedAccount.name}`
          : `No matching Master GL account found for "${acctNum || acctName}"`,
      });
    }

    // Preview mode — return parsed rows with match status
    if (mode === "preview") {
      const matched = previewRows.filter((r) => r.status === "matched").length;
      const unmatched = previewRows.filter(
        (r) => r.status === "unmatched"
      ).length;

      return NextResponse.json({
        rows: previewRows,
        summary: {
          total: previewRows.length,
          matched,
          unmatched,
          monthsFound: Object.keys(monthColumns)
            .map(Number)
            .sort((a, b) => a - b),
        },
      });
    }

    // Commit mode — insert budget amounts
    const matchedRows = previewRows.filter(
      (r) => r.status === "matched" && r.masterAccountId
    );

    if (matchedRows.length === 0) {
      return NextResponse.json(
        { error: "No matched Master GL accounts to import" },
        { status: 400 }
      );
    }

    // Delete existing amounts for this version (full replace)
    await admin
      .from("budget_amounts")
      .delete()
      .eq("budget_version_id", versionId);

    // Build insert rows using master_account_id
    const insertRows: Array<{
      entity_id: string;
      master_account_id: string;
      budget_version_id: string;
      period_year: number;
      period_month: number;
      amount: number;
    }> = [];

    for (const row of matchedRows) {
      for (const [monthNum, amount] of Object.entries(row.months)) {
        if (amount !== 0) {
          insertRows.push({
            entity_id: entityId,
            master_account_id: row.masterAccountId!,
            budget_version_id: versionId,
            period_year: fiscalYear,
            period_month: parseInt(monthNum),
            amount,
          });
        }
      }
    }

    if (insertRows.length > 0) {
      // Insert in batches of 500
      const BATCH_SIZE = 500;
      for (let i = 0; i < insertRows.length; i += BATCH_SIZE) {
        const batch = insertRows.slice(i, i + BATCH_SIZE);
        const { error } = await admin.from("budget_amounts").insert(batch);
        if (error) {
          return NextResponse.json(
            { error: `Insert failed: ${error.message}` },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      imported: {
        accounts: matchedRows.length,
        amounts: insertRows.length,
      },
    });
  } catch (err) {
    console.error("POST /api/budgets/import error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

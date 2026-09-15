import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import {
  INCOME_STATEMENT_SECTIONS,
  INCOME_STATEMENT_COMPUTED,
  type StatementSectionConfig,
  type ComputedLineConfig,
} from "@/lib/config/statement-sections";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- budget tables not yet in generated types
type AnyClient = any;

interface MasterAccount {
  id: string;
  name: string;
  accountNumber: string;
  classification: string;
  accountType: string;
}

interface BudgetLineItem {
  accountId: string;
  accountName: string;
  accountNumber: string | null;
  months: Record<string, number>; // "1"-"12" -> amount
  total: number;
}

interface BudgetSection {
  id: string;
  title: string;
  lines: BudgetLineItem[];
  subtotal: Record<string, number>; // "1"-"12" + "total"
}

interface ComputedLine {
  id: string;
  label: string;
  amounts: Record<string, number>; // "1"-"12" + "total"
  isGrandTotal?: boolean;
}

// GET — return structured budget data for a version using Master GL accounts
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();

    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get("versionId");
    const entityId = searchParams.get("entityId");

    if (!versionId || !entityId) {
      return NextResponse.json(
        { error: "versionId and entityId are required" },
        { status: 400 }
      );
    }

    const admin: AnyClient = createAdminClient();
    await requireVersionAccess(admin, actor, versionId, false);

    // Verify version exists
    const { data: version } = await admin
      .from("budget_versions")
      .select("id, entity_id, fiscal_year, name, status")
      .eq("id", versionId)
      .eq("entity_id", entityId)
      .single();

    if (!version) {
      return NextResponse.json(
        { error: "Budget version not found" },
        { status: 404 }
      );
    }

    // Fetch budget amounts (now keyed by master_account_id)
    const amounts = await fetchAllPaginated<any>((offset, limit) =>
      admin
        .from("budget_amounts")
        .select("master_account_id, period_month, amount")
        .eq("budget_version_id", versionId)
        .range(offset, offset + limit - 1)
    );

    // Collect unique master account IDs
    const masterAccountIds = [
      ...new Set(
        amounts.map(
          (a: { master_account_id: string }) => a.master_account_id
        )
      ),
    ];

    if (masterAccountIds.length === 0) {
      return NextResponse.json({
        version: {
          id: version.id,
          name: version.name,
          fiscalYear: version.fiscal_year,
          status: version.status,
        },
        sections: [],
        computedLines: [],
      });
    }

    // Fetch Master GL accounts
    const masterAccounts = await fetchAllPaginated<any>((offset, limit) =>
      admin
        .from("master_accounts")
        .select("id, name, account_number, classification, account_type")
        .in("id", masterAccountIds)
        .order("account_number")
        .range(offset, offset + limit - 1)
    );

    const accountMap = new Map<string, MasterAccount>();
    for (const a of masterAccounts) {
      accountMap.set(a.id, {
        id: a.id,
        name: a.name,
        accountNumber: a.account_number,
        classification: a.classification,
        accountType: a.account_type,
      });
    }

    // Index amounts by master_account_id -> month
    const amountIndex = new Map<string, Record<string, number>>();
    for (const row of amounts ?? []) {
      let byMonth = amountIndex.get(row.master_account_id);
      if (!byMonth) {
        byMonth = {};
        amountIndex.set(row.master_account_id, byMonth);
      }
      byMonth[String(row.period_month)] =
        (byMonth[String(row.period_month)] ?? 0) + row.amount;
    }

    // Build sections matching income statement structure
    const sections: BudgetSection[] = [];
    const sectionTotals: Record<string, Record<string, number>> = {};

    for (const config of INCOME_STATEMENT_SECTIONS) {
      const sectionAccounts = [...accountMap.values()]
        .filter(
          (a) =>
            a.classification === config.classification &&
            config.accountTypes.includes(a.accountType)
        )
        .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

      // Only include section if it has budget accounts
      const linesWithData = sectionAccounts.filter((a) =>
        amountIndex.has(a.id)
      );
      if (linesWithData.length === 0) continue;

      const subtotal: Record<string, number> = {};
      for (let m = 1; m <= 12; m++) subtotal[String(m)] = 0;
      subtotal.total = 0;

      const lines: BudgetLineItem[] = linesWithData.map((a) => {
        const byMonth = amountIndex.get(a.id) ?? {};
        const months: Record<string, number> = {};
        let total = 0;

        for (let m = 1; m <= 12; m++) {
          const raw = byMonth[String(m)] ?? 0;
          months[String(m)] = raw;
          total += raw;
          subtotal[String(m)] += raw;
        }
        subtotal.total += total;

        return {
          accountId: a.id,
          accountName: a.name,
          accountNumber: a.accountNumber,
          months,
          total,
        };
      });

      sectionTotals[config.id] = subtotal;
      sections.push({
        id: config.id,
        title: config.title,
        lines,
        subtotal,
      });
    }

    // Build computed lines (Gross Margin, Operating Margin, Net Income)
    const computedLines: ComputedLine[] = [];

    for (const comp of INCOME_STATEMENT_COMPUTED) {
      const compAmounts: Record<string, number> = {};
      for (let m = 1; m <= 12; m++) {
        let val = 0;
        for (const { sectionId, sign } of comp.formula) {
          val += (sectionTotals[sectionId]?.[String(m)] ?? 0) * sign;
        }
        compAmounts[String(m)] = val;
      }
      let total = 0;
      for (const { sectionId, sign } of comp.formula) {
        total += (sectionTotals[sectionId]?.total ?? 0) * sign;
      }
      compAmounts.total = total;

      computedLines.push({
        id: comp.id,
        label: comp.label,
        amounts: compAmounts,
        isGrandTotal: comp.isGrandTotal,
      });
    }

    return NextResponse.json({
      version: {
        id: version.id,
        name: version.name,
        fiscalYear: version.fiscal_year,
        status: version.status,
      },
      sections,
      computedLines,
    });
  } catch (err) {
    console.error("GET /api/budgets/view error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateDepreciationSchedule,
  buildOpeningBalance,
  type AssetForDepreciation,
} from "@/lib/utils/depreciation";
import {
  generateAmortizationSchedule,
  type DebtForAmortization,
} from "@/lib/utils/amortization";
import {
  generateASC842Schedule,
  generateMonthlyJournalEntry,
  type LeaseForASC842,
} from "@/lib/utils/lease-calculations";

// ---------------------------------------------------------------------------
// GET /api/close/je-worksheet?entityId=&periodYear=&periodMonth=&module=
// Computes journal entries from subledger engines for a given period/module
// ---------------------------------------------------------------------------

interface WorksheetEntry {
  source: string;
  sourceRecordId?: string;
  sourceRecordName: string;
  date: string;
  description: string;
  debits: { account: string; accountId?: string; amount: number }[];
  credits: { account: string; accountId?: string; amount: number }[];
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");
  const periodYear = Number(url.searchParams.get("periodYear"));
  const periodMonth = Number(url.searchParams.get("periodMonth"));
  const module = url.searchParams.get("module");

  if (!entityId || !periodYear || !periodMonth || !module) {
    return NextResponse.json(
      { error: "entityId, periodYear, periodMonth, and module are required" },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  try {
    switch (module) {
      case "depreciation":
        return NextResponse.json(
          await computeDepreciationEntries(admin, entityId, periodYear, periodMonth)
        );
      case "debt":
        return NextResponse.json(
          await computeDebtEntries(admin, entityId, periodYear, periodMonth)
        );
      case "leases":
        return NextResponse.json(
          await computeLeaseEntries(admin, entityId, periodYear, periodMonth)
        );
      case "payroll":
        return NextResponse.json(
          await computePayrollEntries(admin, entityId, periodYear, periodMonth)
        );
      default:
        return NextResponse.json({ entries: [], module, message: "Unknown module" });
    }
  } catch (err) {
    console.error("JE worksheet error:", err);
    return NextResponse.json(
      { error: "Failed to compute journal entries" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Depreciation — compute monthly book depreciation for all active assets
// ---------------------------------------------------------------------------

async function computeDepreciationEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  entityId: string,
  periodYear: number,
  periodMonth: number
) {
  // Also include disposed assets — if disposed within this period, the
  // disposal month's book_depreciation is 0 and generateDepreciationSchedule
  // will correctly skip it. If disposed before, no entry is emitted.
  const { data: assets } = await admin
    .from("fixed_assets")
    .select("*")
    .eq("entity_id", entityId)
    .in("status", ["active", "disposed", "fully_depreciated"]);

  if (!assets || assets.length === 0) {
    return { module: "depreciation", entries: [], totalDebit: 0, totalCredit: 0 };
  }

  // Opening balance — anchor schedule generation so we match the subledger
  // (and Roll-Forward / Depreciation tabs).
  const { data: entityRow } = await admin
    .from("entities")
    .select("rental_asset_opening_date")
    .eq("id", entityId)
    .single();
  const openingDateIso =
    (entityRow as { rental_asset_opening_date?: string } | null)
      ?.rental_asset_opening_date ?? null;
  const [oy, om] = openingDateIso
    ? openingDateIso.split("-").map(Number)
    : [0, 0];

  const entries: WorksheetEntry[] = [];
  let totalAmount = 0;

  for (const asset of assets) {
    const assetData: AssetForDepreciation = {
      acquisition_cost: Number(asset.acquisition_cost),
      in_service_date: asset.in_service_date,
      book_useful_life_months: asset.book_useful_life_months,
      book_salvage_value: Number(asset.book_salvage_value),
      book_depreciation_method: asset.book_depreciation_method,
      tax_cost_basis: asset.tax_cost_basis ? Number(asset.tax_cost_basis) : null,
      tax_depreciation_method: asset.tax_depreciation_method,
      tax_useful_life_months: asset.tax_useful_life_months,
      section_179_amount: Number(asset.section_179_amount ?? 0),
      bonus_depreciation_amount: Number(asset.bonus_depreciation_amount ?? 0),
      disposed_date: asset.disposed_date,
    };

    // Pull the opening book_accumulated for this asset so the schedule
    // picks up the freeze-at-opening behavior — same math the Roll-Forward
    // and Depreciation tabs use. Falls back to 0 if no opening row.
    let openingBook = 0;
    let openingTax = 0;
    if (openingDateIso) {
      const { data: opRow } = await admin
        .from("fixed_asset_depreciation")
        .select("book_accumulated, tax_accumulated")
        .eq("fixed_asset_id", asset.id)
        .eq("period_year", oy)
        .eq("period_month", om)
        .eq("is_manual_override", true)
        .maybeSingle();
      if (opRow) {
        openingBook = Number((opRow as { book_accumulated: number | string }).book_accumulated);
        openingTax = Number((opRow as { tax_accumulated: number | string }).tax_accumulated);
      }
    }

    const opening = openingDateIso
      ? buildOpeningBalance(openingDateIso, openingBook, openingTax)
      : undefined;

    const schedule = generateDepreciationSchedule(
      assetData,
      periodYear,
      periodMonth,
      opening
    );
    const periodEntry = schedule.find(
      (e) => e.period_year === periodYear && e.period_month === periodMonth
    );
    const monthlyDepr = periodEntry ? periodEntry.book_depreciation : 0;
    if (monthlyDepr <= 0) continue;

    totalAmount += monthlyDepr;

    entries.push({
      source: "depreciation",
      sourceRecordId: asset.id,
      sourceRecordName: asset.asset_name,
      date: `${periodYear}-${String(periodMonth).padStart(2, "0")}-01`,
      description: `Book depreciation — ${asset.asset_name}`,
      debits: [
        {
          account: "Depreciation Expense",
          accountId: asset.depr_expense_account_id ?? undefined,
          amount: monthlyDepr,
        },
      ],
      credits: [
        {
          account: "Accumulated Depreciation",
          accountId: asset.accum_depr_account_id ?? undefined,
          amount: monthlyDepr,
        },
      ],
    });
  }

  return {
    module: "depreciation",
    entries,
    totalDebit: round2(totalAmount),
    totalCredit: round2(totalAmount),
    assetCount: assets.length,
    entriesWithAmount: entries.length,
  };
}

// ---------------------------------------------------------------------------
// Debt — compute interest expense from amortization schedules
// ---------------------------------------------------------------------------

async function computeDebtEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  entityId: string,
  periodYear: number,
  periodMonth: number
) {
  const { data: instruments } = await admin
    .from("debt_instruments")
    .select("*")
    .eq("entity_id", entityId)
    .eq("status", "active");

  if (!instruments || instruments.length === 0) {
    return { module: "debt", entries: [], totalDebit: 0, totalCredit: 0 };
  }

  const entries: WorksheetEntry[] = [];
  let totalInterest = 0;
  let totalPrincipal = 0;

  for (const inst of instruments) {
    const debtData: DebtForAmortization = {
      debt_type: inst.debt_type,
      original_amount: Number(inst.original_amount),
      interest_rate: Number(inst.interest_rate),
      term_months: inst.term_months,
      start_date: inst.start_date,
      maturity_date: inst.maturity_date,
      payment_amount: inst.payment_amount ? Number(inst.payment_amount) : null,
      payment_structure: inst.payment_structure ?? "principal_and_interest",
      day_count_convention: inst.day_count_convention ?? "30/360",
      credit_limit: inst.credit_limit ? Number(inst.credit_limit) : null,
      current_draw: inst.current_draw ? Number(inst.current_draw) : null,
      balloon_amount: inst.balloon_amount ? Number(inst.balloon_amount) : null,
      balloon_date: inst.balloon_date ?? null,
      rate_type: inst.rate_type ?? "fixed",
      is_pik: inst.is_pik ?? false,
    };

    const schedule = generateAmortizationSchedule(debtData, periodYear, periodMonth);
    const periodEntry = schedule.find(
      (e) => e.period_year === periodYear && e.period_month === periodMonth
    );

    if (!periodEntry || (periodEntry.interest === 0 && periodEntry.principal === 0)) continue;

    totalInterest += periodEntry.interest;
    totalPrincipal += periodEntry.principal;

    const debits: WorksheetEntry["debits"] = [];
    const credits: WorksheetEntry["credits"] = [];

    // PIK capitalization period: interest accrues but is not paid in cash —
    // it's credited to Loan Payable, growing the liability.
    const isPikCapitalization =
      inst.is_pik && periodEntry.interest > 0 && periodEntry.principal === 0 && periodEntry.payment === 0;

    if (isPikCapitalization) {
      debits.push({
        account: "Interest Expense",
        accountId: inst.interest_expense_account_id ?? undefined,
        amount: periodEntry.interest,
      });
      credits.push({
        account: "Loan Payable",
        accountId: inst.liability_account_id ?? undefined,
        amount: periodEntry.interest,
      });
    } else {
      if (periodEntry.interest > 0) {
        debits.push({
          account: "Interest Expense",
          accountId: inst.interest_expense_account_id ?? undefined,
          amount: periodEntry.interest,
        });
      }

      if (periodEntry.principal > 0) {
        debits.push({
          account: "Loan Payable",
          accountId: inst.liability_account_id ?? undefined,
          amount: periodEntry.principal,
        });
      }

      credits.push({
        account: "Cash / AP",
        amount: round2(periodEntry.interest + periodEntry.principal),
      });
    }

    entries.push({
      source: "debt",
      sourceRecordId: inst.id,
      sourceRecordName: inst.instrument_name,
      date: `${periodYear}-${String(periodMonth).padStart(2, "0")}-01`,
      description: isPikCapitalization
        ? `PIK interest capitalization — ${inst.instrument_name}`
        : `Debt service — ${inst.instrument_name}`,
      debits,
      credits,
    });
  }

  return {
    module: "debt",
    entries,
    totalDebit: round2(totalInterest + totalPrincipal),
    totalCredit: round2(totalInterest + totalPrincipal),
    totalInterest: round2(totalInterest),
    totalPrincipal: round2(totalPrincipal),
    instrumentCount: instruments.length,
    entriesWithAmount: entries.length,
  };
}

// ---------------------------------------------------------------------------
// Leases — compute monthly ASC 842 journal entries
// ---------------------------------------------------------------------------

async function computeLeaseEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  entityId: string,
  periodYear: number,
  periodMonth: number
) {
  const { data: leases } = await admin
    .from("leases")
    .select("*")
    .eq("entity_id", entityId)
    .eq("status", "active");

  if (!leases || leases.length === 0) {
    return { module: "leases", entries: [], totalDebit: 0, totalCredit: 0 };
  }

  const entries: WorksheetEntry[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const lease of leases) {
    const leaseData: LeaseForASC842 = {
      lease_type: lease.lease_type as "operating" | "finance",
      lease_term_months: lease.lease_term_months,
      discount_rate: Number(lease.discount_rate),
      commencement_date: lease.commencement_date,
      initial_direct_costs: Number(lease.initial_direct_costs ?? 0),
      lease_incentives_received: Number(lease.lease_incentives_received ?? 0),
      prepaid_rent: Number(lease.prepaid_rent ?? 0),
      base_rent_monthly: Number(lease.base_rent_monthly),
    };

    const { schedule } = generateASC842Schedule(leaseData);
    const periodEntry = schedule.find(
      (e) => e.period_year === periodYear && e.period_month === periodMonth
    );

    if (!periodEntry) continue;

    const je = generateMonthlyJournalEntry(periodEntry, leaseData.lease_type, {
      rouAssetAccountId: lease.rou_asset_account_id ?? undefined,
      leaseLiabilityAccountId: lease.lease_liability_account_id ?? undefined,
      leaseExpenseAccountId: lease.lease_expense_account_id ?? undefined,
      interestExpenseAccountId: lease.interest_expense_account_id ?? undefined,
      asc842AdjustmentAccountId: lease.asc842_adjustment_account_id ?? undefined,
      cashApAccountId: lease.cash_ap_account_id ?? undefined,
    });

    const entryDebits = je.debits.map((d) => ({
      account: d.account,
      accountId: d.accountId,
      amount: d.amount,
    }));
    const entryCredits = je.credits.map((c) => ({
      account: c.account,
      accountId: c.accountId,
      amount: c.amount,
    }));

    const debitTotal = entryDebits.reduce((s, d) => s + d.amount, 0);
    const creditTotal = entryCredits.reduce((s, c) => s + c.amount, 0);
    totalDebit += debitTotal;
    totalCredit += creditTotal;

    entries.push({
      source: "leases",
      sourceRecordId: lease.id,
      sourceRecordName: lease.lease_name,
      date: je.date,
      description: `${lease.lease_type === "operating" ? "Operating" : "Finance"} lease — ${lease.lease_name}`,
      debits: entryDebits,
      credits: entryCredits,
    });
  }

  return {
    module: "leases",
    entries,
    totalDebit: round2(totalDebit),
    totalCredit: round2(totalCredit),
    leaseCount: leases.length,
    entriesWithAmount: entries.length,
  };
}

// ---------------------------------------------------------------------------
// Payroll — pull stored accruals from payroll_accruals table
// ---------------------------------------------------------------------------

async function computePayrollEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  entityId: string,
  periodYear: number,
  periodMonth: number
) {
  // Fetch accruals and GL mappings in parallel
  const [{ data: accruals }, { data: glMappings }] = await Promise.all([
    admin
      .from("payroll_accruals")
      .select("*")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth),
    admin
      .from("payroll_gl_mappings")
      .select("accrual_type, debit_account_id, credit_account_id")
      .eq("entity_id", entityId),
  ]);

  if (!accruals || accruals.length === 0) {
    return {
      module: "payroll",
      entries: [],
      totalDebit: 0,
      totalCredit: 0,
      message: "No payroll accruals found for this period. Run payroll sync first.",
    };
  }

  // Build GL mapping lookup for fallback
  const glLookup: Record<string, { debit: string | null; credit: string | null }> = {};
  for (const m of glMappings ?? []) {
    glLookup[m.accrual_type] = {
      debit: m.debit_account_id,
      credit: m.credit_account_id,
    };
  }

  const entries: WorksheetEntry[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const accrual of accruals) {
    const amount = Number(accrual.amount ?? 0);
    if (amount === 0) continue;

    const isReversal = amount < 0;
    const absAmount = Math.abs(amount);
    const gl = glLookup[accrual.accrual_type];

    // For positive accruals: DR Expense / CR Liability
    // For reversals (negative): DR Liability / CR Expense (flip the sides)
    const debitAccountId = accrual.account_id ?? gl?.debit ?? undefined;
    const creditAccountId = accrual.offset_account_id ?? gl?.credit ?? undefined;

    if (isReversal) {
      // Reversal entry — debit the liability, credit the expense
      totalDebit += absAmount;
      totalCredit += absAmount;

      entries.push({
        source: "payroll",
        sourceRecordId: accrual.id,
        sourceRecordName: accrual.description,
        date: `${periodYear}-${String(periodMonth).padStart(2, "0")}-01`,
        description: accrual.description,
        debits: [
          {
            account: accrualTypeToCreditAccount(accrual.accrual_type),
            accountId: creditAccountId,
            amount: absAmount,
          },
        ],
        credits: [
          {
            account: accrualTypeToDebitAccount(accrual.accrual_type),
            accountId: debitAccountId,
            amount: absAmount,
          },
        ],
      });
    } else {
      // Normal accrual — debit expense, credit liability
      totalDebit += absAmount;
      totalCredit += absAmount;

      entries.push({
        source: "payroll",
        sourceRecordId: accrual.id,
        sourceRecordName: accrual.description,
        date: `${periodYear}-${String(periodMonth).padStart(2, "0")}-${lastDay(periodYear, periodMonth)}`,
        description: accrual.description,
        debits: [
          {
            account: accrualTypeToDebitAccount(accrual.accrual_type),
            accountId: debitAccountId,
            amount: absAmount,
          },
        ],
        credits: [
          {
            account: accrualTypeToCreditAccount(accrual.accrual_type),
            accountId: creditAccountId,
            amount: absAmount,
          },
        ],
      });
    }
  }

  return {
    module: "payroll",
    entries,
    totalDebit: round2(totalDebit),
    totalCredit: round2(totalCredit),
    accrualCount: accruals.length,
    entriesWithAmount: entries.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lastDay(year: number, month: number): string {
  const d = new Date(year, month, 0).getDate();
  return String(d).padStart(2, "0");
}

function accrualTypeToDebitAccount(type: string): string {
  switch (type) {
    case "wages":
      return "Wage Expense";
    case "payroll_tax":
      return "Payroll Tax Expense";
    case "benefits":
      return "Employee Benefits Expense";
    case "pto":
      return "PTO Expense";
    default:
      return "Payroll Expense";
  }
}

function accrualTypeToCreditAccount(type: string): string {
  switch (type) {
    case "wages":
      return "Accrued Wages Payable";
    case "payroll_tax":
      return "Accrued Payroll Taxes";
    case "benefits":
      return "Accrued Benefits Payable";
    case "pto":
      return "Accrued PTO Payable";
    default:
      return "Accrued Payroll";
  }
}

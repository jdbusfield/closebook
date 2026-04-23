import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";
import {
  generateAmortizationSchedule,
  type DebtForAmortization,
} from "@/lib/utils/amortization";
import { getCurrentPeriod } from "@/lib/utils/dates";

/**
 * POST /api/debt/upload
 * Bulk-imports debt instruments from an XLSX or CSV spreadsheet.
 *
 * Expected columns (flexible header matching):
 *   Instrument Name, Lender, Type (Term Loan / LOC), Original Amount,
 *   Interest Rate, Term (months), Start Date, Maturity Date,
 *   Payment Amount, Credit Limit, Current Draw, Status
 *
 * Minimum required per row: Instrument Name, Original Amount, Interest Rate, Start Date
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const entityId = formData.get("entityId") as string;

  if (!file || !entityId) {
    return NextResponse.json(
      { error: "Missing required fields: file, entityId" },
      { status: 400 }
    );
  }

  // Parse spreadsheet
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  if (rawRows.length === 0) {
    return NextResponse.json(
      { error: "Spreadsheet is empty" },
      { status: 400 }
    );
  }

  // Build flexible header map
  const headers = Object.keys(rawRows[0]);
  const hm = buildHeaderMap(headers);

  const currentPeriod = getCurrentPeriod();
  const results = {
    imported: 0,
    skipped: 0,
    errors: [] as string[],
  };

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowNum = i + 2; // 1-indexed + header row

    // Parse required fields
    const instrumentName = parseString(raw[hm.instrumentName]);
    const originalAmount = parseNumber(raw[hm.originalAmount]);
    const interestRate = parseRate(raw[hm.interestRate]);
    const startDate = parseDateToISO(raw[hm.startDate]);

    if (!instrumentName || !originalAmount || !startDate) {
      results.errors.push(
        `Row ${rowNum}: missing instrument name, original amount, or start date — skipped`
      );
      results.skipped++;
      continue;
    }

    // Parse optional fields
    const lenderName = parseString(raw[hm.lenderName]);
    const debtType = resolveDebtType(raw[hm.debtType]);
    const termMonths = parseIntSafe(raw[hm.termMonths]);
    const maturityDate = parseDateToISO(raw[hm.maturityDate]);
    const paymentAmount = parseNumber(raw[hm.paymentAmount]) || null;
    const creditLimit = parseNumber(raw[hm.creditLimit]) || null;
    const currentDraw = parseNumber(raw[hm.currentDraw]) || null;
    const status = resolveStatus(raw[hm.status]);

    // Parse enhanced fields (v2)
    const loanNumber = parseString(raw[hm.loanNumber]);
    const paymentStructure = resolvePaymentStructure(raw[hm.paymentStructure]);
    const dayCountConvention = resolveDayCount(raw[hm.dayCountConvention]);
    const rateType = resolveRateType(raw[hm.rateType]);
    const indexRateName = parseString(raw[hm.indexRateName]);
    const spreadMargin = parseRate(raw[hm.spreadMargin]) || null;
    const balloonAmount = parseNumber(raw[hm.balloonAmount]) || null;
    const collateralDescription = parseString(raw[hm.collateral]);
    const notes = parseString(raw[hm.notes]);

    // Insert debt instrument
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: instrument, error: insertError } = await (supabase as any)
      .from("debt_instruments")
      .insert({
        entity_id: entityId,
        instrument_name: instrumentName,
        lender_name: lenderName,
        debt_type: debtType,
        original_amount: originalAmount,
        interest_rate: interestRate,
        term_months: termMonths,
        start_date: startDate,
        maturity_date: maturityDate,
        payment_amount: paymentAmount,
        credit_limit: creditLimit,
        current_draw: currentDraw,
        status,
        loan_number: loanNumber,
        payment_structure: paymentStructure,
        day_count_convention: dayCountConvention,
        rate_type: rateType,
        index_rate_name: indexRateName,
        spread_margin: spreadMargin,
        balloon_amount: balloonAmount,
        is_secured: collateralDescription ? true : false,
        collateral_description: collateralDescription,
        notes,
        source_file_name: file.name,
        uploaded_at: new Date().toISOString(),
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      results.errors.push(`Row ${rowNum}: ${insertError.message}`);
      results.skipped++;
      continue;
    }

    // Generate amortization schedule through current period
    const amortInput: DebtForAmortization = {
      debt_type: debtType,
      original_amount: originalAmount,
      interest_rate: interestRate,
      term_months: termMonths,
      start_date: startDate,
      maturity_date: maturityDate,
      payment_amount: paymentAmount,
      payment_structure: paymentStructure,
      day_count_convention: dayCountConvention,
      credit_limit: creditLimit,
      current_draw: currentDraw,
      balloon_amount: balloonAmount,
      rate_type: rateType,
    };

    const schedule = generateAmortizationSchedule(
      amortInput,
      currentPeriod.year,
      currentPeriod.month
    );

    if (schedule.length > 0) {
      const amortEntries = schedule.map((entry) => ({
        debt_instrument_id: instrument.id,
        period_year: entry.period_year,
        period_month: entry.period_month,
        beginning_balance: entry.beginning_balance,
        payment: entry.payment,
        principal: entry.principal,
        interest: entry.interest,
        ending_balance: entry.ending_balance,
        interest_rate: entry.interest_rate,
        fees: entry.fees,
        cumulative_principal: entry.cumulative_principal,
        cumulative_interest: entry.cumulative_interest,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("debt_amortization").insert(amortEntries);
    }

    results.imported++;
  }

  return NextResponse.json(results);
}

// ---- Header mapping ----

function buildHeaderMap(headers: string[]) {
  const find = (patterns: string[]) => {
    for (const h of headers) {
      const lower = h.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const p of patterns) {
        if (lower.includes(p)) return h;
      }
    }
    return headers[0]; // fallback
  };

  return {
    instrumentName: find(["instrumentname", "loanname", "name", "instrument", "loan", "description"]),
    lenderName: find(["lendername", "lender", "bank", "creditor", "institution"]),
    debtType: find(["debttype", "type", "loantype", "instrumenttype"]),
    originalAmount: find(["originalamount", "original", "loanamount", "principal", "amount", "balance"]),
    interestRate: find(["interestrate", "rate", "annualrate", "apr"]),
    termMonths: find(["termmonths", "term", "months", "loanterm"]),
    startDate: find(["startdate", "originationdate", "loandate", "start", "originated", "dateoriginated"]),
    maturityDate: find(["maturitydate", "maturity", "enddate", "duedate"]),
    paymentAmount: find(["paymentamount", "payment", "monthlypayment", "pmt"]),
    creditLimit: find(["creditlimit", "limit", "maxdraw"]),
    currentDraw: find(["currentdraw", "draw", "outstandingbalance", "outstanding", "currentbalance"]),
    status: find(["status", "active", "state"]),
    loanNumber: find(["loannumber", "accountnumber", "loannumber", "loanno", "accountno"]),
    paymentStructure: find(["paymentstructure", "paymenttype", "amorttype", "amortization"]),
    dayCountConvention: find(["daycountconvention", "daycount", "basis", "accrual"]),
    rateType: find(["ratetype", "fixedvariable", "variablerate"]),
    indexRateName: find(["indexrate", "indexname", "benchmark", "primerate", "sofr"]),
    spreadMargin: find(["spreadmargin", "spread", "margin"]),
    balloonAmount: find(["balloonamount", "balloon", "balloonpayment"]),
    collateral: find(["collateral", "security", "secured", "collateraldescription"]),
    notes: find(["notes", "comments", "memo"]),
  };
}

// ---- Value parsers ----

function parseString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim();
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "");
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function parseIntSafe(value: unknown): number | null {
  if (typeof value === "number") return Math.round(value);
  if (typeof value === "string") {
    const n = parseInt(value.replace(/[^0-9-]/g, ""));
    return isNaN(n) ? null : n;
  }
  return null;
}

function parseDateToISO(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split("T")[0];
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  if (typeof value === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(value);
    if (d) {
      const date = new Date(d.y, d.m - 1, d.d);
      return date.toISOString().split("T")[0];
    }
  }
  return null;
}

/**
 * Parse interest rate — handles percentage strings like "6.5%" or "0.065"
 */
function parseRate(value: unknown): number {
  if (typeof value === "number") {
    // If > 1, assume it's a percentage (e.g. 6.5 → 0.065)
    return value > 1 ? value / 100 : value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[%,\s]/g, "");
    const n = parseFloat(cleaned);
    if (isNaN(n)) return 0;
    return n > 1 ? n / 100 : n;
  }
  return 0;
}

function resolveDebtType(value: unknown): string {
  if (!value) return "term_loan";
  const s = String(value).toLowerCase().replace(/[^a-z]/g, "");
  if (s.includes("investor")) return "investor_loc";
  if (s.includes("revolv")) return "revolving_credit";
  if (s.includes("loc") || s.includes("lineofcredit") || s.includes("line")) return "line_of_credit";
  if (s.includes("mortgage")) return "mortgage";
  if (s.includes("equipment")) return "equipment_loan";
  if (s.includes("balloon")) return "balloon_loan";
  if (s.includes("bridge")) return "bridge_loan";
  if (s.includes("sba")) return "sba_loan";
  return "term_loan";
}

function resolveStatus(value: unknown): "active" | "paid_off" | "inactive" {
  if (!value) return "active";
  const s = String(value).toLowerCase().replace(/[^a-z]/g, "");
  if (s.includes("paidoff") || s.includes("paid") || s.includes("closed")) return "paid_off";
  if (s.includes("inactive") || s.includes("dormant")) return "inactive";
  return "active";
}

function resolvePaymentStructure(value: unknown): string {
  if (!value) return "principal_and_interest";
  const s = String(value).toLowerCase().replace(/[^a-z]/g, "");
  if (s.includes("interestonly") || s.includes("io")) return "interest_only";
  if (s.includes("balloon")) return "balloon";
  if (s.includes("revolv")) return "revolving";
  if (s.includes("custom")) return "custom";
  return "principal_and_interest";
}

function resolveDayCount(value: unknown): string {
  if (!value) return "30/360";
  const s = String(value).toLowerCase().replace(/[^a-z0-9/]/g, "");
  if (s.includes("actual/360") || s.includes("act360")) return "actual/360";
  if (s.includes("actual/365") || s.includes("act365")) return "actual/365";
  if (s.includes("actual/actual") || s.includes("actact")) return "actual/actual";
  return "30/360";
}

function resolveRateType(value: unknown): string {
  if (!value) return "fixed";
  const s = String(value).toLowerCase().replace(/[^a-z]/g, "");
  if (s.includes("variable") || s.includes("float")) return "variable";
  if (s.includes("adjustable") || s.includes("arm")) return "adjustable";
  return "fixed";
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateAmortizationSchedule,
  type DebtForAmortization,
  type RateChange,
} from "@/lib/utils/amortization";
import { getCurrentPeriod } from "@/lib/utils/dates";

/**
 * POST /api/debt/amortize
 * (Re)generate the amortization schedule for a debt instrument.
 * Deletes existing entries and regenerates from the instrument's current parameters.
 *
 * Body: { debt_instrument_id }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { debt_instrument_id } = await request.json();
  if (!debt_instrument_id) {
    return NextResponse.json({ error: "Missing debt_instrument_id" }, { status: 400 });
  }

  // Fetch instrument
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: instr, error: instrError } = await (supabase as any)
    .from("debt_instruments")
    .select("*")
    .eq("id", debt_instrument_id)
    .single();

  if (instrError || !instr) {
    return NextResponse.json({ error: instrError?.message || "Instrument not found" }, { status: 404 });
  }

  // Fetch rate history for variable rate instruments
  let rateChanges: RateChange[] = [];
  if (instr.rate_type && instr.rate_type !== "fixed") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rates } = await (supabase as any)
      .from("debt_rate_history")
      .select("effective_date, interest_rate")
      .eq("debt_instrument_id", debt_instrument_id)
      .order("effective_date", { ascending: true });

    if (rates) {
      rateChanges = rates.map((r: { effective_date: string; interest_rate: number }) => ({
        effective_date: r.effective_date,
        interest_rate: r.interest_rate,
      }));
    }
  }

  const currentPeriod = getCurrentPeriod();
  const amortInput: DebtForAmortization = {
    debt_type: instr.debt_type,
    original_amount: instr.original_amount,
    interest_rate: instr.interest_rate,
    term_months: instr.term_months,
    start_date: instr.start_date,
    maturity_date: instr.maturity_date,
    payment_amount: instr.payment_amount,
    payment_structure: instr.payment_structure,
    day_count_convention: instr.day_count_convention,
    credit_limit: instr.credit_limit,
    current_draw: instr.current_draw,
    balloon_amount: instr.balloon_amount,
    rate_type: instr.rate_type,
    is_pik: instr.is_pik,
  };

  const schedule = generateAmortizationSchedule(
    amortInput,
    currentPeriod.year,
    currentPeriod.month,
    rateChanges
  );

  // Delete existing amortization entries
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("debt_amortization")
    .delete()
    .eq("debt_instrument_id", debt_instrument_id);

  // Insert new entries
  if (schedule.length > 0) {
    const amortEntries = schedule.map((entry) => ({
      debt_instrument_id,
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
    const { error: insertError } = await (supabase as any)
      .from("debt_amortization")
      .insert(amortEntries);

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ periods: schedule.length });
}

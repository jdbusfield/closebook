import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateAmortizationSchedule,
  type DebtForAmortization,
} from "@/lib/utils/amortization";
import { getCurrentPeriod } from "@/lib/utils/dates";
import { logAuditEvent } from "@/lib/utils/audit";

/**
 * POST /api/debt
 * Create a new debt instrument manually.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const {
    entity_id,
    instrument_name,
    lender_name,
    debt_type,
    original_amount,
    interest_rate,
    term_months,
    start_date,
    maturity_date,
    payment_amount,
    credit_limit,
    current_draw,
    opening_accrued_interest,
    loan_number,
    payment_structure,
    day_count_convention,
    rate_type,
    index_rate_name,
    spread_margin,
    balloon_amount,
    is_secured,
    collateral_description,
    notes,
  } = body;

  if (!entity_id || !instrument_name || !original_amount || !start_date) {
    return NextResponse.json(
      { error: "Missing required fields: entity_id, instrument_name, original_amount, start_date" },
      { status: 400 }
    );
  }

  // Normalize rate if passed as percentage
  const normalizedRate = interest_rate > 1 ? interest_rate / 100 : interest_rate;
  const normalizedSpread = spread_margin != null && spread_margin > 1 ? spread_margin / 100 : spread_margin;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("debt_instruments")
    .insert({
      entity_id,
      instrument_name,
      lender_name: lender_name || null,
      debt_type: debt_type || "term_loan",
      original_amount,
      interest_rate: normalizedRate || 0,
      term_months: term_months || null,
      start_date,
      maturity_date: maturity_date || null,
      payment_amount: payment_amount || null,
      credit_limit: credit_limit || null,
      current_draw: current_draw || null,
      opening_accrued_interest: opening_accrued_interest ?? 0,
      loan_number: loan_number || null,
      payment_structure: payment_structure || "principal_and_interest",
      day_count_convention: day_count_convention || "30/360",
      rate_type: rate_type || "fixed",
      index_rate_name: index_rate_name || null,
      spread_margin: normalizedSpread || null,
      balloon_amount: balloon_amount || null,
      is_secured: is_secured || false,
      collateral_description: collateral_description || null,
      notes: notes || null,
      status: "active",
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Generate amortization schedule
  if (data) {
    const currentPeriod = getCurrentPeriod();
    const amortInput: DebtForAmortization = {
      debt_type: data.debt_type,
      original_amount: data.original_amount,
      interest_rate: data.interest_rate,
      term_months: data.term_months,
      start_date: data.start_date,
      maturity_date: data.maturity_date,
      payment_amount: data.payment_amount,
      payment_structure: data.payment_structure,
      day_count_convention: data.day_count_convention,
      credit_limit: data.credit_limit,
      current_draw: data.current_draw,
      balloon_amount: data.balloon_amount,
      rate_type: data.rate_type,
      opening_accrued_interest: data.opening_accrued_interest,
    };

    const schedule = generateAmortizationSchedule(
      amortInput,
      currentPeriod.year,
      currentPeriod.month
    );

    if (schedule.length > 0) {
      const amortEntries = schedule.map((entry) => ({
        debt_instrument_id: data.id,
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
  }

  // Audit log
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (membership) {
    logAuditEvent({
      organizationId: membership.organization_id,
      entityId: entity_id,
      userId: user.id,
      action: "create",
      resourceType: "debt_instrument",
      resourceId: data.id,
      newValues: { instrument_name, debt_type, original_amount, lender_name },
      request,
    });
  }

  return NextResponse.json(data, { status: 201 });
}

/**
 * PATCH /api/debt
 * Update an existing debt instrument.
 * Body: { id, ...fields_to_update }
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "Missing required field: id" }, { status: 400 });
  }

  // current_draw is derived from transactions only — never allow manual override
  delete updates.current_draw;

  // Normalize rates if passed as percentage
  if (updates.interest_rate != null && updates.interest_rate > 1) {
    updates.interest_rate = updates.interest_rate / 100;
  }
  if (updates.spread_margin != null && updates.spread_margin > 1) {
    updates.spread_margin = updates.spread_margin / 100;
  }

  // Fetch old values for audit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data: existing } = await sb
    .from("debt_instruments")
    .select("*")
    .eq("id", id)
    .single();

  const { data, error } = await sb
    .from("debt_instruments")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit log
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (membership) {
    logAuditEvent({
      organizationId: membership.organization_id,
      entityId: existing?.entity_id,
      userId: user.id,
      action: "update",
      resourceType: "debt_instrument",
      resourceId: id,
      oldValues: existing,
      newValues: updates,
      request,
    });
  }

  return NextResponse.json(data);
}

/**
 * DELETE /api/debt?id=...
 * Delete a debt instrument and all related records.
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing required query param: id" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbDel = supabase as any;

  // Fetch instrument for audit before deleting
  const { data: instrument } = await sbDel
    .from("debt_instruments")
    .select("instrument_name, entity_id, debt_type, lender_name")
    .eq("id", id)
    .single();

  // Delete child records first (amortization, transactions, rate history)
  await sbDel.from("debt_amortization").delete().eq("debt_instrument_id", id);
  await sbDel.from("debt_transactions").delete().eq("debt_instrument_id", id);
  await sbDel.from("debt_rate_history").delete().eq("debt_instrument_id", id);

  const { error } = await sbDel
    .from("debt_instruments")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit log
  const { data: membershipDel } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (membershipDel) {
    logAuditEvent({
      organizationId: membershipDel.organization_id,
      entityId: instrument?.entity_id,
      userId: user.id,
      action: "delete",
      resourceType: "debt_instrument",
      resourceId: id,
      oldValues: instrument ? { instrument_name: instrument.instrument_name, debt_type: instrument.debt_type, lender_name: instrument.lender_name } : null,
      request,
    });
  }

  return NextResponse.json({ success: true });
}

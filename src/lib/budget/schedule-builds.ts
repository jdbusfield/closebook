/**
 * Schedule builds: lines that already exist as schedules elsewhere in
 * Closebook, pulled into the budget year for the version's entities.
 *
 *   debt        interest by month from the amortization generator (plus
 *               capex debt from the capex plan)
 *   leases      lease_payments rows for the year (base rent, CAM, tax,
 *               insurance, utilities, other); subleases as income
 *   depreciation stored 2027 rows when present, else generated from each
 *               active asset; capex placeholders and disposals from the plan
 *   insurance   annual premium / 12 for active policies, renewal uplift
 *   allocations intercompany rules rolled forward month by month
 */
import { generateAmortizationSchedule, type DebtForAmortization, type RateChange } from "@/lib/utils/amortization";
import { generateDepreciationSchedule, type AssetForDepreciation } from "@/lib/utils/depreciation";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { computeCapexMonthly, type CapexItemInput, type DisposalItemInput, unitMonthlyDepreciation } from "./capex-engine";
import { amountsFromArray, baseBuild, isAllZero, zeros, type BuildContext, type BuildInsert } from "./build-types";

function masterFor(ctx: BuildContext, accountId: string | null | undefined, fallbackNumber: string): string | null {
  if (accountId) {
    const m = ctx.accountToMaster.get(accountId);
    if (m) return m;
  }
  return ctx.masterByNumber.get(fallbackNumber)?.id ?? null;
}

const INTEREST_NUMBER = "7100";
const RENT_NUMBER = "6000";
const VEHICLE_DEPR_NUMBER = "7000";
const OTHER_DEPR_NUMBER = "7500";
const GAIN_LOSS_NUMBER = "7400";
const AUTO_INSURANCE_NUMBER = "5010";
const WORKERS_COMP_NUMBER = "6160";
const OTHER_EXPENSES_NUMBER = "6300";

// ---------------------------------------------------------------------------
// Debt
// ---------------------------------------------------------------------------
export async function debtBuilds(ctx: BuildContext): Promise<BuildInsert[]> {
  const out: BuildInsert[] = [];
  const { data: instruments } = await ctx.admin
    .from("debt_instruments")
    .select("*")
    .in("entity_id", ctx.memberEntityIds)
    .eq("status", "active");
  if (!instruments || instruments.length === 0) return out;

  const ids = instruments.map((d: { id: string }) => d.id);
  const { data: rates } = await ctx.admin
    .from("debt_rate_history")
    .select("debt_instrument_id, effective_date, interest_rate")
    .in("debt_instrument_id", ids);
  const ratesByDebt = new Map<string, RateChange[]>();
  for (const r of (rates ?? []) as { debt_instrument_id: string; effective_date: string; interest_rate: number }[]) {
    const list = ratesByDebt.get(r.debt_instrument_id) ?? [];
    list.push({ effective_date: r.effective_date, interest_rate: Number(r.interest_rate) });
    ratesByDebt.set(r.debt_instrument_id, list);
  }
  const indexRate = ctx.assumptions.get("floating_rate_index") / 100;

  for (const d of instruments as Array<Record<string, unknown>>) {
    const debt: DebtForAmortization = {
      debt_type: String(d.debt_type ?? "term_loan"),
      original_amount: Number(d.original_amount ?? 0),
      interest_rate: Number(d.interest_rate ?? 0),
      term_months: (d.term_months as number | null) ?? null,
      start_date: String(d.start_date),
      maturity_date: (d.maturity_date as string | null) ?? null,
      payment_amount: (d.payment_amount as number | null) ?? null,
      payment_structure: (d.payment_structure as string | undefined) ?? undefined,
      day_count_convention: (d.day_count_convention as string | undefined) ?? undefined,
      credit_limit: (d.credit_limit as number | null) ?? null,
      current_draw: (d.current_draw as number | null) ?? null,
      balloon_amount: (d.balloon_amount as number | null) ?? null,
      balloon_date: (d.balloon_date as string | null) ?? null,
      rate_type: (d.rate_type as string | undefined) ?? undefined,
      is_pik: !!d.is_pik,
      opening_accrued_interest: (d.opening_accrued_interest as number | null) ?? null,
    };
    if (!debt.start_date || debt.start_date === "null") continue;
    let rateChanges = ratesByDebt.get(String(d.id)) ?? [];
    // Floating-rate instruments reprice from the index assumption when set
    if (indexRate > 0 && debt.rate_type && debt.rate_type !== "fixed") {
      const spread = Number(d.spread_margin ?? 0);
      rateChanges = [...rateChanges, { effective_date: `${ctx.year}-01-01`, interest_rate: indexRate + spread }];
    }
    let entries;
    try {
      entries = generateAmortizationSchedule(debt, ctx.year, 12, rateChanges);
    } catch (err) {
      console.warn(`Amortization failed for ${d.instrument_name}:`, err);
      continue;
    }
    const interest = zeros();
    const principal = zeros();
    for (const e of entries) {
      if (e.period_year !== ctx.year) continue;
      interest[e.period_month - 1] += Number(e.interest ?? 0) + Number(e.fees ?? 0);
      principal[e.period_month - 1] += Number(e.principal ?? 0);
    }
    if (isAllZero(interest)) continue;
    const master = masterFor(ctx, d.interest_expense_account_id as string | null, INTEREST_NUMBER);
    if (!master) continue;
    out.push(
      baseBuild(ctx, {
        master_account_id: master,
        qbo_class_id: null,
        build_type: "schedule",
        source_table: "debt_instruments",
        source_id: String(d.id),
        component: "interest",
        label: String(d.instrument_name ?? "Debt"),
        amounts: amountsFromArray(interest),
        assumption_keys: ["floating_rate_index"],
        meta: { principalByMonth: principal.map((v) => Math.round(v * 100) / 100), rate: debt.interest_rate, structure: debt.payment_structure ?? null, entityId: d.entity_id },
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Leases and subleases
// ---------------------------------------------------------------------------
export async function leaseBuilds(ctx: BuildContext): Promise<BuildInsert[]> {
  const out: BuildInsert[] = [];
  const { data: leases } = await ctx.admin
    .from("leases")
    .select("id, entity_id, lease_name, status, commencement_date, expiration_date, base_rent_monthly, cam_monthly, insurance_monthly, property_tax_annual, property_tax_frequency, utilities_monthly, other_monthly_costs, lease_expense_account_id, cam_expense_account_id")
    .in("entity_id", ctx.memberEntityIds)
    .in("status", ["active", "active_non_operational"]);
  if (leases && leases.length > 0) {
    const leaseIds = leases.map((l: { id: string }) => l.id);
    const payments = await fetchAllPaginated<{ lease_id: string; period_month: number; payment_type: string; scheduled_amount: number }>((o, l) =>
      ctx.admin
        .from("lease_payments")
        .select("lease_id, period_month, payment_type, scheduled_amount")
        .in("lease_id", leaseIds)
        .eq("period_year", ctx.year)
        .range(o, o + l - 1),
    );
    const byLease = new Map<string, Map<string, number[]>>();
    for (const p of payments) {
      const types = byLease.get(p.lease_id) ?? new Map<string, number[]>();
      const arr = types.get(p.payment_type) ?? zeros();
      arr[p.period_month - 1] += Number(p.scheduled_amount ?? 0);
      types.set(p.payment_type, arr);
      byLease.set(p.lease_id, types);
    }
    for (const l of leases as Array<Record<string, unknown>>) {
      const id = String(l.id);
      let types = byLease.get(id);
      if (!types) {
        // No generated rows for the year: flat monthly amounts while the lease runs
        types = new Map();
        const exp = String(l.expiration_date ?? "");
        const start = String(l.commencement_date ?? "");
        const flat = (amount: number) => {
          const arr = zeros();
          for (let m = 1; m <= 12; m++) {
            const key = `${ctx.year}-${String(m).padStart(2, "0")}`;
            if (start && start.slice(0, 7) > key) continue;
            if (exp && exp.slice(0, 7) < key) continue;
            arr[m - 1] = amount;
          }
          return arr;
        };
        if (Number(l.base_rent_monthly)) types.set("base_rent", flat(Number(l.base_rent_monthly)));
        if (Number(l.cam_monthly)) types.set("cam", flat(Number(l.cam_monthly)));
        if (Number(l.insurance_monthly)) types.set("insurance", flat(Number(l.insurance_monthly)));
        if (Number(l.utilities_monthly)) types.set("utilities", flat(Number(l.utilities_monthly)));
        if (Number(l.other_monthly_costs)) types.set("other", flat(Number(l.other_monthly_costs)));
        if (Number(l.property_tax_annual)) types.set("property_tax", flat(Number(l.property_tax_annual) / 12));
      }
      const rentMaster = masterFor(ctx, l.lease_expense_account_id as string | null, RENT_NUMBER);
      const camMaster = masterFor(ctx, (l.cam_expense_account_id as string | null) ?? (l.lease_expense_account_id as string | null), RENT_NUMBER);
      for (const [type, arr] of types) {
        if (isAllZero(arr)) continue;
        const master = type === "base_rent" ? rentMaster : camMaster;
        if (!master) continue;
        out.push(
          baseBuild(ctx, {
            master_account_id: master,
            qbo_class_id: null,
            build_type: "schedule",
            source_table: "leases",
            source_id: id,
            component: type,
            label: `${l.lease_name} (${type.replace(/_/g, " ")})`,
            amounts: amountsFromArray(arr),
            assumption_keys: [],
            meta: { entityId: l.entity_id, expiration: l.expiration_date ?? null },
          }),
        );
      }
    }
  }

  // Subleases net against the rent line (JD): what we collect from a
  // subtenant comes off the lease it sits under, so Rent is net rent.
  const { data: subleases } = await ctx.admin
    .from("subleases")
    .select("id, entity_id, lease_id, sublease_name, status")
    .in("entity_id", ctx.memberEntityIds)
    .eq("status", "active");
  if (subleases && subleases.length > 0) {
    const ids = subleases.map((s: { id: string }) => s.id);
    const payments = await fetchAllPaginated<{ sublease_id: string; period_month: number; payment_type: string; scheduled_amount: number }>((o, l) =>
      ctx.admin
        .from("sublease_payments")
        .select("sublease_id, period_month, payment_type, scheduled_amount")
        .in("sublease_id", ids)
        .eq("period_year", ctx.year)
        .range(o, o + l - 1),
    );
    const rentAccountByLease = new Map<string, string | null>(
      ((leases ?? []) as Array<{ id: string; lease_expense_account_id: string | null }>).map((l) => [l.id, l.lease_expense_account_id]),
    );
    {
      const bySub = new Map<string, number[]>();
      for (const p of payments) {
        const arr = bySub.get(p.sublease_id) ?? zeros();
        arr[p.period_month - 1] += Number(p.scheduled_amount ?? 0);
        bySub.set(p.sublease_id, arr);
      }
      for (const s of subleases as Array<Record<string, unknown>>) {
        const arr = bySub.get(String(s.id));
        if (!arr || isAllZero(arr)) continue;
        // Same master as the lease's own rent, so the two net on one line
        const master = masterFor(ctx, rentAccountByLease.get(String(s.lease_id)) ?? null, RENT_NUMBER);
        if (!master) continue;
        out.push(
          baseBuild(ctx, {
            master_account_id: master,
            qbo_class_id: null,
            build_type: "schedule",
            source_table: "subleases",
            source_id: String(s.id),
            component: "sublease_income",
            label: `${s.sublease_name} (sublease, nets against rent)`,
            amounts: amountsFromArray(arr.map((v) => -v)),
            assumption_keys: [],
            meta: { entityId: s.entity_id, leaseId: s.lease_id, netsAgainstRent: true },
          }),
        );
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Depreciation: existing assets, capex placeholders, disposals
// ---------------------------------------------------------------------------
interface AssetRow {
  id: string;
  entity_id: string;
  asset_name: string;
  vehicle_class: string | null;
  rental_category: string | null;
  master_type_override: string | null;
  status: string;
  disposed_date: string | null;
  acquisition_cost: number;
  in_service_date: string | null;
  book_useful_life_months: number | null;
  book_salvage_value: number | null;
  book_depreciation_method: string | null;
  book_accumulated_depreciation: number | null;
  tax_cost_basis: number | null;
  tax_depreciation_method: string | null;
  tax_useful_life_months: number | null;
  section_179_amount: number | null;
  bonus_depreciation_amount: number | null;
  depr_expense_account_id: string | null;
}

export async function loadCapexPlan(ctx: BuildContext): Promise<{ items: CapexItemInput[]; disposals: DisposalItemInput[] }> {
  const orgId = ctx.owner.organizationId!;
  const { data: items } = await ctx.admin
    .from("capex_plan_items")
    .select("*")
    .eq("organization_id", orgId)
    .or(
      [
        ctx.owner.reportingEntityId ? `reporting_entity_id.eq.${ctx.owner.reportingEntityId}` : null,
        ctx.memberEntityIds.length ? `entity_id.in.(${ctx.memberEntityIds.join(",")})` : null,
      ].filter(Boolean).join(","),
    );
  const { data: disposals } = await ctx.admin
    .from("disposal_plan_items")
    .select("*")
    .eq("organization_id", orgId)
    .or(
      [
        ctx.owner.reportingEntityId ? `reporting_entity_id.eq.${ctx.owner.reportingEntityId}` : null,
        ctx.memberEntityIds.length ? `entity_id.in.(${ctx.memberEntityIds.join(",")})` : null,
      ].filter(Boolean).join(","),
    );
  return {
    items: ((items ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      description: String(r.description ?? ""),
      assetGroup: (r.asset_group as string | null) ?? null,
      quantity: Number(r.quantity ?? 1),
      unitCost: Number(r.unit_cost ?? 0),
      inServiceYear: Number(r.in_service_year),
      inServiceMonth: Number(r.in_service_month),
      usefulLifeMonths: (r.useful_life_months as number | null) ?? null,
      salvagePct: (r.salvage_pct as number | null) ?? null,
      funding: (r.funding as "cash" | "debt" | "lease") ?? "cash",
      debtRate: (r.debt_rate as number | null) ?? null,
      debtTermMonths: (r.debt_term_months as number | null) ?? null,
      debtPct: (r.debt_pct as number | null) ?? null,
      status: String(r.status ?? "planned"),
    })),
    disposals: ((disposals ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      description: (r.description as string | null) ?? null,
      assetGroup: (r.asset_group as string | null) ?? null,
      quantity: Number(r.quantity ?? 1),
      disposalYear: Number(r.disposal_year),
      disposalMonth: Number(r.disposal_month),
      expectedProceeds: Number(r.expected_proceeds ?? 0),
      nbvAtDisposal: (r.nbv_at_disposal as number | null) ?? null,
      monthlyDepreciation: (r.monthly_depreciation as number | null) ?? null,
      status: String(r.status ?? "planned"),
    })),
  };
}

export async function loadDepreciationDefaults(ctx: BuildContext): Promise<(group: string | null) => { usefulLifeMonths: number; salvagePct: number }> {
  const { data: rules } = await ctx.admin
    .from("asset_depreciation_rules")
    .select("entity_id, reporting_group, book_useful_life_months, book_salvage_pct")
    .in("entity_id", ctx.memberEntityIds);
  const byGroup = new Map<string, { usefulLifeMonths: number; salvagePct: number }>();
  for (const r of (rules ?? []) as Array<{ reporting_group: string; book_useful_life_months: number | null; book_salvage_pct: number | null }>) {
    if (!byGroup.has(r.reporting_group)) {
      byGroup.set(r.reporting_group, { usefulLifeMonths: r.book_useful_life_months ?? 60, salvagePct: Number(r.book_salvage_pct ?? 0) });
    }
  }
  return (group) => (group && byGroup.get(group)) || { usefulLifeMonths: 60, salvagePct: 0 };
}

function isTrailerGroup(group: string | null | undefined, override: string | null | undefined): boolean {
  if (override) return override.toLowerCase() === "trailer";
  return /trailer/i.test(group ?? "");
}

export async function depreciationBuilds(ctx: BuildContext): Promise<BuildInsert[]> {
  const out: BuildInsert[] = [];
  const assets = await fetchAllPaginated<AssetRow>((o, l) =>
    ctx.admin
      .from("fixed_assets")
      .select("id, entity_id, asset_name, vehicle_class, rental_category, master_type_override, status, disposed_date, acquisition_cost, in_service_date, book_useful_life_months, book_salvage_value, book_depreciation_method, book_accumulated_depreciation, tax_cost_basis, tax_depreciation_method, tax_useful_life_months, section_179_amount, bonus_depreciation_amount, depr_expense_account_id")
      .in("entity_id", ctx.memberEntityIds)
      .eq("status", "active")
      .range(o, o + l - 1),
  );

  // Stored rows for the year (manual overrides win)
  const stored = new Map<string, number[]>();
  if (assets.length > 0) {
    const ids = assets.map((a) => a.id);
    const CH = 300;
    for (let i = 0; i < ids.length; i += CH) {
      const rows = await fetchAllPaginated<{ fixed_asset_id: string; period_month: number; book_depreciation: number }>((o, l) =>
        ctx.admin
          .from("fixed_asset_depreciation")
          .select("fixed_asset_id, period_month, book_depreciation")
          .in("fixed_asset_id", ids.slice(i, i + CH))
          .eq("period_year", ctx.year)
          .range(o, o + l - 1),
      );
      for (const r of rows) {
        const arr = stored.get(r.fixed_asset_id) ?? zeros();
        arr[r.period_month - 1] += Number(r.book_depreciation ?? 0);
        stored.set(r.fixed_asset_id, arr);
      }
    }
  }

  // Aggregate existing assets per (master, entity) so the build list stays readable
  const agg = new Map<string, { master: string; entityId: string; values: number[]; count: number; label: string }>();
  const groupMonthly = new Map<string, number>(); // asset group -> average monthly depreciation per unit (for disposals)
  const groupUnits = new Map<string, number>();
  for (const a of assets) {
    let values = stored.get(a.id);
    if (!values && a.in_service_date && Number(a.acquisition_cost) > 0) {
      const input: AssetForDepreciation = {
        acquisition_cost: Number(a.acquisition_cost),
        in_service_date: a.in_service_date,
        book_useful_life_months: Number(a.book_useful_life_months ?? 60),
        book_salvage_value: Number(a.book_salvage_value ?? 0),
        book_depreciation_method: a.book_depreciation_method ?? "straight_line",
        tax_cost_basis: a.tax_cost_basis,
        tax_depreciation_method: a.tax_depreciation_method ?? "macrs_5",
        tax_useful_life_months: a.tax_useful_life_months,
        section_179_amount: Number(a.section_179_amount ?? 0),
        bonus_depreciation_amount: Number(a.bonus_depreciation_amount ?? 0),
        disposed_date: a.disposed_date,
      };
      try {
        const entries = generateDepreciationSchedule(input, ctx.year, 12);
        values = zeros();
        for (const e of entries) if (e.period_year === ctx.year) values[e.period_month - 1] += Number(e.book_depreciation ?? 0);
      } catch {
        values = undefined;
      }
    }
    if (!values || isAllZero(values)) continue;
    const trailer = isTrailerGroup(a.vehicle_class, a.master_type_override);
    const master = masterFor(ctx, a.depr_expense_account_id, trailer ? OTHER_DEPR_NUMBER : VEHICLE_DEPR_NUMBER);
    if (!master) continue;
    const key = `${master}|${a.entity_id}`;
    const entry = agg.get(key) ?? { master, entityId: a.entity_id, values: zeros(), count: 0, label: "" };
    for (let i = 0; i < 12; i++) entry.values[i] += values[i];
    entry.count++;
    agg.set(key, entry);
    const g = a.vehicle_class ?? "Unassigned";
    groupMonthly.set(g, (groupMonthly.get(g) ?? 0) + values.reduce((t, v) => t + v, 0) / 12);
    groupUnits.set(g, (groupUnits.get(g) ?? 0) + 1);
  }
  const entityCodes = await entityCodeMap(ctx);
  for (const e of agg.values()) {
    out.push(
      baseBuild(ctx, {
        master_account_id: e.master,
        qbo_class_id: null,
        build_type: "schedule",
        source_table: "fixed_assets",
        source_id: e.entityId,
        component: "depreciation",
        label: `Existing assets, ${entityCodes.get(e.entityId) ?? "entity"} (${e.count})`,
        amounts: amountsFromArray(e.values),
        assumption_keys: [],
        meta: { assetCount: e.count, entityId: e.entityId },
      }),
    );
  }

  // Capex placeholders and disposals
  const plan = await loadCapexPlan(ctx);
  if (plan.items.length > 0 || plan.disposals.length > 0) {
    const defaultsFor = await loadDepreciationDefaults(ctx);
    // Disposal rows without a monthly depreciation figure use the group average
    for (const d of plan.disposals) {
      if (d.monthlyDepreciation == null && d.assetGroup && groupUnits.get(d.assetGroup)) {
        d.monthlyDepreciation = ((groupMonthly.get(d.assetGroup) ?? 0) / (groupUnits.get(d.assetGroup) ?? 1)) * d.quantity;
      }
    }
    const capex = computeCapexMonthly(ctx.year, plan.items, plan.disposals, defaultsFor, ctx.assumptions.get("disposal_proceeds_pct_of_nbv"));
    const vehicleDepr = ctx.masterByNumber.get(VEHICLE_DEPR_NUMBER)?.id;
    const otherDepr = ctx.masterByNumber.get(OTHER_DEPR_NUMBER)?.id;
    // Depreciation per item so the drill-down names the purchase
    for (const it of plan.items) {
      if (!["planned", "approved", "ordered", "received"].includes(it.status)) continue;
      const d = defaultsFor(it.assetGroup);
      const perUnit = unitMonthlyDepreciation(it.unitCost, it.usefulLifeMonths ?? d.usefulLifeMonths, it.salvagePct ?? d.salvagePct) * it.quantity;
      const start = (it.inServiceYear - ctx.year) * 12 + (it.inServiceMonth - 1);
      const life = it.usefulLifeMonths ?? d.usefulLifeMonths;
      const values = zeros();
      for (let i = 0; i < 12; i++) if (i >= start && i <= start + life - 1) values[i] = perUnit;
      if (isAllZero(values)) continue;
      const master = isTrailerGroup(it.assetGroup, null) ? otherDepr : vehicleDepr;
      if (!master) continue;
      out.push(
        baseBuild(ctx, {
          master_account_id: master,
          qbo_class_id: null,
          build_type: "capex",
          source_table: "capex_plan_items",
          source_id: it.id,
          component: "depreciation",
          label: `${it.description} (${it.quantity} × ${it.assetGroup ?? "unit"})`,
          amounts: amountsFromArray(values),
          assumption_keys: [],
          meta: { capexCash: it.inServiceYear === ctx.year ? it.quantity * it.unitCost : 0, inService: `${it.inServiceYear}-${it.inServiceMonth}`, funding: it.funding },
        }),
      );
      // Capex debt interest
      if (it.funding === "debt") {
        const single = computeCapexMonthly(ctx.year, [it], [], defaultsFor);
        if (!isAllZero(single.debtInterest)) {
          const interestMaster = ctx.masterByNumber.get(INTEREST_NUMBER)?.id;
          if (interestMaster) {
            out.push(
              baseBuild(ctx, {
                master_account_id: interestMaster,
                qbo_class_id: null,
                build_type: "capex",
                source_table: "capex_plan_items",
                source_id: it.id,
                component: "interest",
                label: `${it.description} financing`,
                amounts: amountsFromArray(single.debtInterest),
                assumption_keys: [],
                meta: { principalByMonth: single.debtPrincipal, debtDraw: single.debtDraw },
              }),
            );
          }
        }
      }
    }
    // Disposals: gain/loss and depreciation avoided
    const gainMaster = ctx.masterByNumber.get(GAIN_LOSS_NUMBER)?.id;
    if (!isAllZero(capex.disposalGainLoss) && gainMaster) {
      out.push(
        baseBuild(ctx, {
          master_account_id: gainMaster,
          qbo_class_id: null,
          build_type: "capex",
          source_table: "disposal_plan_items",
          source_id: null,
          component: "gain_loss",
          label: "Planned disposals (gain) / loss",
          amounts: amountsFromArray(capex.disposalGainLoss.map((v) => -v)), // expense sign: loss positive
          assumption_keys: ["disposal_proceeds_pct_of_nbv"],
          meta: { proceedsByMonth: capex.disposalProceeds },
        }),
      );
    }
    if (!isAllZero(capex.depreciationAvoided) && vehicleDepr) {
      out.push(
        baseBuild(ctx, {
          master_account_id: vehicleDepr,
          qbo_class_id: null,
          build_type: "capex",
          source_table: "disposal_plan_items",
          source_id: null,
          component: "depreciation_avoided",
          label: "Planned disposals (depreciation stops)",
          amounts: amountsFromArray(capex.depreciationAvoided.map((v) => -v)),
          assumption_keys: [],
          meta: {},
        }),
      );
    }
  }
  return out;
}

async function entityCodeMap(ctx: BuildContext): Promise<Map<string, string>> {
  const { data } = await ctx.admin.from("entities").select("id, code").in("id", ctx.memberEntityIds);
  return new Map(((data ?? []) as { id: string; code: string }[]).map((e) => [e.id, e.code]));
}

// ---------------------------------------------------------------------------
// Insurance
// ---------------------------------------------------------------------------
const AUTO_TYPES = new Set(["auto_liability", "auto_physical_damage", "garagekeepers", "hired_non_owned_auto"]);

export async function insuranceBuilds(ctx: BuildContext): Promise<BuildInsert[]> {
  const out: BuildInsert[] = [];
  const { data: policies } = await ctx.admin
    .from("insurance_policies")
    .select("id, entity_id, policy_type, status, effective_date, expiration_date, annual_premium, policy_number, line_of_business")
    .in("entity_id", ctx.memberEntityIds)
    .in("status", ["active", "pending_renewal"]);
  if (!policies || policies.length === 0) return out;
  const renewalPct = ctx.assumptions.get("insurance_renewal_pct", [{ scope: "reporting_entity", scopeId: ctx.owner.reportingEntityId }]) / 100;

  for (const p of policies as Array<Record<string, unknown>>) {
    const annual = Number(p.annual_premium ?? 0);
    if (!annual) continue;
    const type = String(p.policy_type ?? "other");
    const number = AUTO_TYPES.has(type) ? AUTO_INSURANCE_NUMBER : type === "workers_comp" ? WORKERS_COMP_NUMBER : OTHER_EXPENSES_NUMBER;
    const master = ctx.masterByNumber.get(number)?.id;
    if (!master) continue;
    // Renewal month from the expiration date; premiums after it carry the uplift
    const exp = String(p.expiration_date ?? "");
    const expMonth = exp ? Number(exp.slice(5, 7)) : 0;
    const expYear = exp ? Number(exp.slice(0, 4)) : 0;
    const values = zeros();
    for (let m = 1; m <= 12; m++) {
      const renewed = expYear < ctx.year || (expYear === ctx.year && m > expMonth);
      values[m - 1] = (annual / 12) * (renewed ? 1 + renewalPct : 1);
    }
    out.push(
      baseBuild(ctx, {
        master_account_id: master,
        qbo_class_id: null,
        build_type: "schedule",
        source_table: "insurance_policies",
        source_id: String(p.id),
        component: type,
        label: `${type.replace(/_/g, " ")} ${p.policy_number ?? ""}`.trim(),
        amounts: amountsFromArray(values),
        assumption_keys: ["insurance_renewal_pct"],
        meta: { entityId: p.entity_id, annualPremium: annual, expiration: exp || null },
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Intercompany allocation rules, rolled forward by month
// ---------------------------------------------------------------------------
interface AllocRow {
  id: string;
  source_entity_id: string;
  destination_entity_id: string;
  master_account_id: string;
  destination_master_account_id: string | null;
  amount: number;
  description: string;
  schedule_type: string;
  period_year: number | null;
  period_month: number | null;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  is_repeating: boolean;
  repeat_end_year: number | null;
  repeat_end_month: number | null;
}

/** Expands a rule into (year, month, amount) entries. */
export function expandAllocation(a: AllocRow): Array<{ year: number; month: number; amount: number }> {
  const out: Array<{ year: number; month: number; amount: number }> = [];
  const total = Number(a.amount);
  if (a.schedule_type === "single_month") {
    if (a.period_year == null || a.period_month == null) return out;
    if (a.is_repeating && a.repeat_end_year != null && a.repeat_end_month != null) {
      const n = (a.repeat_end_year - a.period_year) * 12 + (a.repeat_end_month - a.period_month) + 1;
      let y = a.period_year;
      let m = a.period_month;
      for (let i = 0; i < n; i++) {
        out.push({ year: y, month: m, amount: total });
        m++;
        if (m > 12) { m = 1; y++; }
      }
    } else {
      out.push({ year: a.period_year, month: a.period_month, amount: total });
    }
  } else if (a.schedule_type === "monthly_spread") {
    if (a.start_year == null || a.start_month == null || a.end_year == null || a.end_month == null) return out;
    const n = (a.end_year - a.start_year) * 12 + (a.end_month - a.start_month) + 1;
    if (n < 1) return out;
    let y = a.start_year;
    let m = a.start_month;
    for (let i = 0; i < n; i++) {
      out.push({ year: y, month: m, amount: total / n });
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  return out;
}

export async function allocationBuilds(ctx: BuildContext): Promise<BuildInsert[]> {
  const out: BuildInsert[] = [];
  const orgId = ctx.owner.organizationId!;
  const rows = await fetchAllPaginated<AllocRow>((o, l) =>
    ctx.admin
      .from("allocation_adjustments")
      .select("id, source_entity_id, destination_entity_id, master_account_id, destination_master_account_id, amount, description, schedule_type, period_year, period_month, start_year, start_month, end_year, end_month, is_repeating, repeat_end_year, repeat_end_month")
      .eq("organization_id", orgId)
      .eq("is_excluded", false)
      .range(o, o + l - 1),
  );
  const members = new Set(ctx.memberEntityIds);
  const rollForward = ctx.assumptions.get("allocations_roll_forward") !== 0;

  // Per (master, description-ish) monthly legs for this RE, for the budget
  // year directly, else rolled forward from the prior year's same months.
  const direct = new Map<string, { label: string; values: number[]; master: string }>();
  const prior = new Map<string, { label: string; values: number[]; master: string }>();
  const add = (map: typeof direct, key: string, label: string, master: string, monthIndex: number, amount: number) => {
    const e = map.get(key) ?? { label, values: zeros(), master };
    e.values[monthIndex] += amount;
    map.set(key, e);
  };

  for (const a of rows) {
    const srcIn = members.has(a.source_entity_id);
    const dstIn = members.has(a.destination_entity_id);
    if (!srcIn && !dstIn) continue;
    const sameEntity = a.source_entity_id === a.destination_entity_id;
    const legs: Array<{ master: string; sign: number }> = [];
    if (sameEntity) {
      // Reclass inside one entity: out of master, into destination master
      if (!a.destination_master_account_id) continue;
      legs.push({ master: a.master_account_id, sign: -1 }, { master: a.destination_master_account_id, sign: 1 });
    } else {
      if (srcIn) legs.push({ master: a.master_account_id, sign: -1 });
      if (dstIn) legs.push({ master: a.destination_master_account_id ?? a.master_account_id, sign: 1 });
    }
    for (const e of expandAllocation(a)) {
      for (const leg of legs) {
        const key = `${leg.master}|${a.description}|${leg.sign}`;
        const label = `${a.description} (${leg.sign > 0 ? "in" : "out"})`;
        if (e.year === ctx.year) add(direct, key, label, leg.master, e.month - 1, e.amount * leg.sign);
        else if (e.year === ctx.year - 1) add(prior, key, label, leg.master, e.month - 1, e.amount * leg.sign);
      }
    }
  }

  const chosen = direct.size > 0 ? direct : rollForward ? prior : new Map();
  for (const [key, e] of chosen) {
    if (isAllZero(e.values)) continue;
    if (!ctx.masters.some((m) => m.id === e.master)) continue;
    out.push(
      baseBuild(ctx, {
        master_account_id: e.master,
        qbo_class_id: null,
        build_type: "schedule",
        source_table: "allocation_adjustments",
        source_id: key.slice(0, 200),
        component: "allocation",
        label: direct.size > 0 ? e.label : `${e.label}, rolled forward from ${ctx.year - 1}`,
        amounts: amountsFromArray(e.values),
        assumption_keys: ["allocations_roll_forward"],
        meta: { rolledForward: direct.size === 0 },
      }),
    );
  }
  return out;
}

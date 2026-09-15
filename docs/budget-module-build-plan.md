# Budget Module Build Plan (FY2027)

Living checklist for the budget + capex build. Each loop iteration: read this file, pick the
next unchecked item in order, build it, typecheck (`npx tsc --noEmit -p tsconfig.json`), lint
touched files (`npx eslint <files>`), commit on branch `feat/budget-module`, push, tick the box
here with a one-line note. Never skip ahead of an unchecked prerequisite.

Proposal: https://claude.ai/artifact/VCXR8trCTA9BuEW9qJPme3

## Decisions (JD, Sep 15 2026)

- Budgets are keyed to **reporting entities** (reporting groups), not legal entities.
  Prod groups: Avon `19ca5bda-8442-49cd-b348-b78921dffa0f` = {AVON b664a9c1, ARH b56dec66,
  NCNT cb56911c, 2F 8dbff882}; HDR `ec9857a4-6b36-4e5d-9b90-047efd35f92e` = {HDR 7529580d,
  HSS f641caa2}; Versatile `301b13eb-55be-4086-9c9e-26c86c02268a` = {VS 2fdafa28}.
  "Avon Accountant View" is excluded (exclude_from_breakdown). Existing FY2026 budgets are
  per entity (Silverco, HDR, VS); keep them readable.
- 12-month budget; optional quarterly check-in via forecast versions (kind = forecast).
- **Capex and disposal plan module** is part of this build (org-level, feeds depreciation,
  interest, gain/loss, fleet count).
- Bonus accrues monthly (annual target / 12).
- No GL transaction sync. Vendor-level questions are answered ad hoc.
- Personnel Costs (mgmt master 6100, id 4bafffb9-8dd2-404b-bfc0-f68ebd96b269) gets
  sub-masters with parent_account_id = 6100 so statements keep one rolled-up line:
  6110 Wages & Salaries, 6120 Overtime & Premiums, 6130 Bonus & Commissions,
  6140 Employer Payroll Taxes, 6150 Employee Benefits, 6160 Workers Comp, 6170 PTO,
  6180 Payroll Fees & Other. Remap the 91 mapped entity accounts by name pattern.
- Class dimension: budget personnel and revenue by QBO class (optional per line); other
  lines at reporting-entity level only.
- Roles: existing roles (preparer edits drafts, controller/admin approves).

## Facts to rely on

- Management chart id `cf4a56e3-1f44-4e97-b4b0-ca66e6b7c0bb`; flat today; `applyParentRollup`
  in `src/app/api/financial-statements/route.ts` sums children into parents when
  parent_account_id is set (so sub-masters roll up automatically).
- `budget_amounts` live columns: id, entity_id, master_account_id, budget_version_id,
  period_year, period_month, amount, created_at, updated_at (migration 013 is stale).
- Actuals: `gl_balances.ending_balance` is cumulative YTD; monthly = diff (route ~L931).
  `gl_class_balances.net_change` is true monthly by class (revenue sign-flipped).
- Payroll: `employee_paycheck_details` (Jan 2025 → now, `detail_lines` jsonb of
  {detType, detCode, amount, hours, rate}, `er_benefit_detail`), `employee_monthly_costs`,
  `employee_allocations` (effective-dated, entity_allocations/class_allocations jsonb),
  `payroll_earning_codes` (99 rows, `effective_category` earning/pto/premium/ee_deduction/
  er_contribution/other, `effective_subcategory`). `payroll_pay_statements` exists but
  stops Apr 2026; do not depend on it. Paylocity roster is live via
  `src/lib/paylocity/client.ts getEmployees` (include futurePayrates).
- `calculateEmployerTaxes` in `src/lib/utils/payroll-calculations.ts:282` with TAX_RATES at
  :35 (SS cap 176,100 is the 2025 base; 2026 = 184,500; CA_SDI is employee-paid, remove).
- DDL is applied by JD in Supabase Studio. The service key can read/write data but not DDL.
  Validate every migration in pglite (`@electric-sql/pglite`) before committing.
- Conventions: API routes inline auth (`createClient` + `auth.getUser`), `{ error }` shape,
  admin client for writes with org membership check; new tables get RLS + an
  `audit_table_config` insert + label in `src/lib/utils/audit-labels.ts` + types in
  `src/lib/types/database.types.ts`; module keys in `src/lib/access/modules.ts`; nav in
  `src/components/layout/nav-config.ts`; grids modeled on
  `src/app/(app)/[entityId]/reports/budget/budget-edit-grid.tsx`; XLSX via
  `src/lib/utils/excel.ts`. Plain copy, no em-dashes, no catchphrases.
- Do not merge to main until JD applies the migration; push the branch (Vercel preview).

## Architecture

- Lines: `budget_versions` (+ reporting_entity_id, kind, base_version_id, chart_id,
  approved_at/by, locked_at) and `budget_amounts` (+ reporting_entity_id, chart_id,
  qbo_class_id, source, note). A version belongs to exactly one of entity_id /
  reporting_entity_id.
- Builds: `budget_builds` (version, reporting_entity_id, master_account_id, qbo_class_id,
  build_type headcount|schedule|driver|trend|manual|capex, source_table, source_id, label,
  component, amounts jsonb {"1":..,"12":..}, assumption_keys text[], is_computed, note).
  Line amount = Σ builds when any build exists for (version, master, class); recompute
  endpoint enforces it.
- Assumptions: `budget_assumptions` (version, scope org|reporting_entity|class|employee|
  asset_group, scope_id, key, value numeric, text_value, unit, effective_from, effective_to,
  source_note).
- Headcount: `budget_headcount` (version, reporting_entity_id, employee_id, paylocity_company_id,
  name, title, department, pay_type, base_rate, annual_salary, std_hours_week, fte_pct,
  start_month, end_month, merit_pct, merit_month, bonus_target, ot_pct, dt_pct, meal_pct,
  benefits_monthly, match_pct, life_disability_monthly, wc_class_code, pto_hours_per_period,
  entity_allocations jsonb, class_allocations jsonb, is_requisition, notes, seeded_from jsonb).
- Snapshots: `budget_version_snapshots` (version, kind comparables|assumptions, payload jsonb).
- Capex: `capex_plan_items` (org, reporting_entity_id, entity_id, description, asset_group,
  vehicle_class, quantity, unit_cost, in_service_year/month, useful_life_months, salvage_pct,
  method, funding cash|debt, debt_rate, debt_term_months, status planned|ordered|received|
  cancelled, fixed_asset_id, notes) and `disposal_plan_items` (org, reporting_entity_id,
  entity_id, fixed_asset_id, asset_group, quantity, disposal_year/month, expected_proceeds,
  nbv_at_disposal, status, notes).
- Engines (pure, unit-testable, under `src/lib/budget/`): `personnel-engine.ts`,
  `schedule-builds.ts`, `driver-builds.ts`, `trend-builds.ts`, `capex-engine.ts`,
  `comparables.ts`, `recompute.ts`.
- Routes: `src/app/api/budget/*` (versions, assumptions, headcount [+seed], builds,
  recompute, comparables, approve, export) and `src/app/api/capex-plan/*`.
- Pages (org-level): `/budget` (overview), `/budget/[versionId]/assumptions`, `/headcount`,
  `/drivers`, `/lines`, `/review`; `/capex-plan`. Module keys `budgeting`, `capex_plan`.

## Checklist

### Phase 0: hardening and schema
- [x] 0.1 Migration `supabase/migrations/20260915_budget_module.sql` (all tables/columns above,
      RLS, indexes, updated_at triggers, audit_table_config inserts + audit_install_triggers(),
      immutability trigger for locked versions). Validated in pglite (legacy 013 shape and
      production shape, re-run idempotent; test at %TEMP%\claude\pgtest\budget-migration.test.mjs).
      Extra: `budget_line_notes` table, `user_organization_ids()`, `user_is_org_editor()`.
- [x] 0.2 `database.types.ts` updated (budget_versions, budget_amounts, 7 new tables, plus
      reporting_entities / reporting_entity_members which were missing).
- [x] 0.3 Script `scripts/budget-personnel-submasters.mjs` written; dry run Sep 15: 91 mappings
      on 6100, all 91 classified, 0 unmatched (6110:21, 6120:11, 6130:3, 6140:24, 6150:11,
      6160:0, 6170:7, 6180:14). NOT APPLIED YET: run `--apply` right after the branch merges
      (drill-down on main does not expand children until then).
- [x] 0.4 Budget routes check org membership via `src/lib/budget/access.ts`; single-cell PUT and
      new `PUT /api/budget/amounts/batch` share `upsertBudgetCells`; import is additive
      (`replace=true` clears first). Legacy `any` casts dropped where the types now exist.
- [x] 0.5 Statements route: shims removed; `loadBudgetByAccount` resolves versions through
      `src/lib/budget/versions.ts` (RE first, entity fallback) and rolls children into parents.
      Drill-down expands parent masters to children and reads RE budgets. Payroll preview
      attributes an RE budget to its lead operating entity.
- [x] 0.6 `src/lib/budget/tax-tables.ts`; `calculateEmployerTaxes(wage, ytd, table?)`; CA SDI
      removed; SS base 2026 = 184,500 (2027 placeholder until SSA notice).
- [x] 0.7 Sync writes workers_comp_code, pay_type, cost_center_code per paycheck.
- [x] 0.8 Cron sorts work stalest-first (never-synced, then oldest synced_at, then newest
      month), 250 s time budget, skipped periods reported; sync-age UI deferred to 3.2.

### Phase 1: personnel engine
- [ ] 1.1 `personnel-engine.ts`: price a headcount row × 12 months × components (wages, ot, dt,
      meal, bonus, commission, ss, medicare, futa, sui, ett, benefits, match, life_disab, wc,
      pto, fees, other) with cumulative-wage caps; unit tests in `src/lib/budget/__tests__`.
- [ ] 1.2 Seeding: `POST /api/budget/headcount/seed` from live roster + 12 months of paycheck
      lines classified by `payroll_earning_codes`; per-employee run rates; entity/class splits
      from `employee_allocations`; reporting entity from entity membership.
- [ ] 1.3 Recompute: `POST /api/budget/recompute` writes headcount builds to the 61x0 sub-masters
      and syncs `budget_amounts`.
- [ ] 1.4 Headcount page with grid, requisition dialog, side sheet (monthly components), and the
      2026 → 2027 bridge (run rate, merit, hires, terms, benefit renewal, tax caps).

### Phase 2: GL builds, drivers, capex
- [ ] 2.1 Capex and disposal plan module: tables (0.1), API, `/capex-plan` page, `capex-engine.ts`
      (monthly capex cash, depreciation by asset group rules, disposal gain/loss vs NBV from
      `fixed_assets`/`fixed_asset_depreciation`, fleet count by month).
- [ ] 2.2 Schedule builds: debt (amortization + placeholders from capex debt funding), leases
      (lease_payments + subleases), depreciation (existing schedule + capex), insurance
      (payment schedules / annual premium ÷ 12 with renewal pct), allocation rules.
- [ ] 2.3 Driver builds: rental revenue by reporting group from `rental_asset_kpis`
      (fleet days × utilization × charged rate) with capex/disposal fleet deltas.
- [ ] 2.4 Trend builds: 36-month actuals at RE scope via the statements engine; seasonality
      index; growth/inflation keys; volatility band stored with the build.
- [ ] 2.5 Manual list builds (named items with amount + months).
- [ ] 2.6 Lines page: grid over sections, batch save, fill right, annual spread by seasonality,
      clone prior year × pct, derived cells read-only with link to build, note per line.
- [ ] 2.7 Drivers page listing every schedule/driver build with refresh + diff since last refresh.

### Phase 3: review and variance
- [ ] 3.1 `comparables.ts` + `GET /api/budget/comparables`: prior 3 years by month, T3/T6/T12,
      volatility band, last-year budget accuracy per master; RE scope.
- [ ] 3.2 Stale-sync guard: per entity-month `trial_balances.synced_at` age + close status;
      `comparable: boolean` per month in the comparables payload; shown on review page.
- [ ] 3.3 Review page: budget vs PY vs T12 per line with bands, flags, notes; consolidated view.
- [ ] 3.4 Forecast versions: clone budget as kind=forecast with actuals through month M,
      builds re-run for remaining months; Financial Model reads active forecast when asked.

### Phase 4: approval, exports, wiki
- [ ] 4.1 Approve: snapshot comparables + assumptions into `budget_version_snapshots`, set
      active, lock (trigger blocks edits to amounts/builds/headcount of locked versions).
- [ ] 4.2 XLSX export per reporting entity and consolidated (lines + headcount + builds sheets).
- [ ] 4.3 Nav + module keys (`budgeting`, `capex_plan`), overview page, entity Budget page
      redirects to the org module when the entity's group has an RE version.
- [ ] 4.4 Wiki: features, core-concepts, usage-guide, changelog entries.
- [ ] 4.5 Final: full `tsc`, `eslint` on touched files, `next build`, branch pushed, PR opened
      with the migration apply-then-merge steps, memory updated.

## Iteration log
(append one line per iteration: date, item, commit)

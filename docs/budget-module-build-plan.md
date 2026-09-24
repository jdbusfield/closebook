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
- [x] 1.1 `personnel-engine.ts` (20 components, capped taxes on cumulative wages, merit month,
      bonus accrual, renewal month, waiting period, recruiting, RE share) + `assumption-keys.ts`
      catalog and `AssumptionSet`; 10 tests pass (`npm test`, tsx added as a dev dependency).
- [x] 1.2 `personnel-seed.ts` + `POST /api/budget/headcount/seed` (preview/commit, overwrite):
      live roster from both companies incl. future pay rates, twelve months of paycheck lines
      classified via `payroll_earning_codes` (PTO/holiday/sick count as base), allocations as
      of Jan 1, RE share from member entities; workers comp code falls back to
      `payroll_pay_statements`. Untested against prod until the migration lands.
- [x] 1.3 `recompute.ts`: `recomputePersonnel` (one build per row × sub-master × class) and
      `syncLinesFromBuilds`; `POST /api/budget/recompute`. Falls back to 6100 if sub-masters
      are missing. Also `/api/budget/versions` (list, create, clone), `/versions/[id]`,
      `/headcount` CRUD, `/assumptions` GET/PUT.
- [x] 1.4 Pages: `/budget` overview + create dialog, `/budget/[id]` shell with tabs and recompute,
      `/assumptions` grid (org + per company + source notes), `/headcount` (seed dialog with
      preview, add position, inline numeric edits, status/pay selects, side sheet with monthly
      components, bridge card: trailing gross → merit → new → terminations → rate/hours/mix,
      by-month component table).

### Phase 2: GL builds, drivers, capex
- [x] 2.1 Capex module: `capex-engine.ts` (pure, 3 tests), `/api/capex-plan` CRUD + monthly summary
      per org and per RE, `/capex-plan` page (purchases, disposals, by-month table, dialogs).
      Depreciation of planned units uses asset_depreciation_rules by group; disposals without a
      monthly figure use the group average from existing assets.
- [x] 2.2 `schedule-builds.ts`: debt (generateAmortizationSchedule + rate history, floating index
      assumption), leases (lease_payments rows for the year, flat fallback; subleases → 4090),
      depreciation (stored rows else generated; capex placeholders; disposal gain/loss → 7400 and
      depreciation stops), insurance (annual/12 with renewal uplift after expiration; auto → 5010,
      WC → 6160, other → 6300), allocations (direct rules for the year, else prior-year rules
      rolled forward by month; reclass and cross-entity legs).
- [x] 2.3 `driver-builds.ts`: asset-level KPIs (trailing 12 months to the latest upload) grouped by
      the DBR reporting_group; units now + capex/disposal deltas × days × utilization by month
      (+points) × revenue per rental day (+pct); Vehicle → 4000, Trailer → 4010.
- [x] 2.4 `trend-builds.ts` + `actuals.ts` (monthly P&L per master from gl_balances YTD diffs):
      36 months, seasonality bounded 0.25–3, trailing 12 (or 3 annualized), growth/inflation,
      mean/stddev stored in meta. Only masters with no other build.
- [x] 2.5 Manual builds via `/api/budget/builds` (POST/PATCH/DELETE) and the Lines page dialog.
- [x] 2.6 `/budget/[id]/lines`: sections in statement order, children under parents, class rows,
      derived cells read-only with a link to the builds, batch save, Spread (prior-year shape or
      even), Fill →, Fill from prior year × pct, prior-year actual row toggle, computed margins.
- [x] 2.7 `/budget/[id]/drivers`: builds grouped by type with per-group Refresh (scoped recompute),
      expandable monthly detail and meta. Diff-since-last-refresh not built (computed_at shown).

### Phase 3: review and variance
- [x] 3.1 `comparables.ts` + `GET /api/budget/comparables`: 3 years by month, T3/T6 annualized,
      T12, mean/stddev, prior-year budget vs actual (RE first, entity fallback), rolled to parents.
- [x] 3.2 `loadFreshness`: per month of the prior year, oldest TB synced_at across member entities,
      missing entities, close status per entity; `comparable` + `reason`; shown as a 12-tile strip.
- [x] 3.3 `/budget/[id]/review`: budget vs PY/PY-1/PY-2/T3, band ± 1σ with aggressive/conservative
      verdict (sign-aware for expenses), accuracy %, review flag select + note (budget_line_notes).
      Consolidated view = `GET /api/budget/consolidated` (per RE + org without IC lines); used by
      the consolidated XLSX export rather than a separate page.
- [x] 3.4 Forecast: `POST /api/budget/versions` kind=forecast + forecastThroughMonth overwrites
      months 1..M with actuals per master (source clone, note "actual"); statements route accepts
      `budgetKind=forecast` (toolbar toggle not added; URL param only).

### Phase 4: approval, exports, wiki
- [x] 4.1 `POST /api/budget/approve` (controller/admin): snapshots comparables, assumptions, lines,
      headcount; deactivates siblings; sets approved + active + locked_at (trigger then blocks edits).
- [x] 4.2 `GET /api/budget/export?versionId=` (Lines matrix with PY column, Headcount, Builds) and
      `?fiscalYear=&kind=` (one sheet per reporting group + Organization). Buttons on the overview.
- [x] 4.3 Nav + module keys done in phase 1; overview has recompute/approve/export; the entity
      Budget page shows a banner linking to `/budget` (no auto-redirect, legacy FY2026 still edits).
- [x] 4.4 Wiki: features (Budget module + Capex plan), core-concepts (versions, builds,
      assumptions), usage-guide (build a reporting-group budget), changelog entry.
- [x] 4.5 Final: `tsc` clean, eslint clean on new files (pre-existing `any` errors in
      financial-statements/route.ts untouched), `next build` run (see log line below), branch
      pushed, PR opened, memory updated.

## Iteration log
- 2026-09-15 phase 0 (0.1–0.8): c6d64e2 migration validated in pglite, RE budgets in statements,
  route hardening, tax tables, cron ordering
- 2026-09-15 phase 1 (1.1–1.4): ec17a43 engine + APIs (10 tests), 6f85dcd pages
- 2026-09-15 phase 2 (2.1–2.7): 91c6bac schedule/driver/trend builds, capex module, lines and
  drivers pages (15 tests)
- 2026-09-15 phase 3 (3.1–3.4): 5d9e3f2 comparables, freshness guard, review page, forecasts
- 2026-09-15 phase 4 (4.1–4.5): d177a0f approve/lock, exports, wiki; then Link fix + build

### Phase 5: the model view (Sep 24 2026)

JD: budget only the master accounts the Financial Model shows, through EBITDA,
with items under each master that say what the money is and why; payroll and
rent come from their modules.

- [x] 5.1 `line-methods.ts`: pure item methods (run rate, last year adjusted, same each
      month, annual total even/shape, percent of a line, one time, by month), plain-English
      `describeMethod`, `readMethod`. Tests in `__tests__/line-methods.test.ts`.
- [x] 5.2 `method-builds.ts`: items are manual builds with `meta.method`; `recomputeMethodBuilds`
      re-evaluates them last (percent-of-line reads the other builds); `breakoutMaster` seeds a
      bucketed master with one run-rate item per entity account (same-named accounts share an
      item, small ones as "Other accounts"). `actuals.ts` now returns `byAccount`.
- [x] 5.3 Recompute scope `methods` (in `all` after trend). Builds API takes `method`; adding an
      item clears the master's trend build. `POST /api/budget/builds/breakout`.
- [x] 5.4 `GET /api/budget/lines` returns every top-level master with its items (payroll grouped
      by component, leases grouped per lease), prior-year rolled to masters, `belowEbitda` net,
      plus the older `lines` list for Review.
- [x] 5.5 `/budget/[id]/lines` (tab "Model"): sections to EBITDA, expandable masters, item rows
      with source chip, method text and reason; Add item / Break out by account / Replace run
      rate; one net line below EBITDA to net income. Inline cell editing removed.
- [ ] 5.6 Insurance from `insurance_payment_schedules`; lease fallback with escalations;
      commissions and rebates as percent-of-revenue items; a preview in the item dialog.

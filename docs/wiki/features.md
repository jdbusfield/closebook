---
title: Features
slug: features
section: Features
order: 40
description: Reference documentation for each major Closebook feature.
---

# Features

This page lists Closebook's major features and links into more detailed
treatment in the relevant sections.

## Org-level features

- **Dashboard** (`/dashboard`) — high-level KPIs and close health across all
  entities.
- **Close Dashboard** (`/close-dashboard`) — every entity's close status in
  one view.
- **Financial Model** (`/reports/financial-model`) — consolidated and
  per-entity P&L, balance sheet, cash flow. Supports saveable templates
  with favorites, drag-reorder, static / dynamic / hybrid period modes,
  and a sequence-builder PDF export with title pages (PRs #98–#107). Year
  selectors run from 2017 onward (PR #76). Yearly views that don't end in
  December read "Year to Date through…" instead of "Year Ended" (PR #101).
  When **Total** is on together with **Budget** and/or **YoY Change**, a
  **Compare on Total only** checkbox appears: it moves the Budget / Var
  columns and the Prior Year / YoY columns so they follow the Total column
  only (e.g. Jan–Jul, Total, Budget, Var $, Prior Year Total, YoY Change)
  instead of repeating Budget after every month and comparing YoY to the
  last month. The XLSX export, template PDF, and saved templates honor it
  (templates need migration `20260817_financial_model_templates_compare_total_only.sql`).
  A **Bridge** tab reconciles accountant-prepared vs management-prepared
  statements with seven named categories, tier-2 / tier-3 drill-down,
  XLSX + landscape print export, and an explicit cross-chart link
  manager at `/settings/master-gl/bridge-links` (PRs #69, #70, #72). The
  Bridge tab is visible at consolidated and reporting-entity scopes.
- **Debt Dashboard** (`/debt`) — org-wide view of all debt facilities.
- **TB Variance** (`/tb-variance`) — flags trial-balance issues across
  entities (unmapped accounts, missing GL rows, prior-period drift).
- **IC Eliminations** (`/ic-eliminations`) — verifies intercompany balances
  net to zero.
- **Payroll** (`/payroll`) — org-wide payroll roster and accruals. See
  **Monthly Payroll Estimate** below.
- **Real Estate** (`/real-estate`) — leases, subleases, lot square footage.
- **QBO Sync** (`/sync`) — connect each entity's QuickBooks Online file and
  pull trial balances.

### Monthly Payroll Estimate

`/payroll/estimate` produces an org-level, accrual-basis payroll estimate for
a single month: the cash → accrual bridge, a per-entity breakdown, employee
detail, exceptions, and reconciliation flags. It reads stored Paylocity
paycheck detail (`employee_paycheck_details`) only — it makes no live
Paylocity API calls. Costs are attributed to operating entities by the
employee allocation rules described in
[Core Concepts → Employee allocations](/settings/wiki/core-concepts#employee-allocations-payroll).

**New-hire allocation dialog.** Employees whose first paycheck activity falls
in the viewed month and who have no allocation row on file are returned by the
API as `newHires`, and the page auto-opens a dialog listing them. Each row
shows the employee, payroll company, department, first check period, and
estimated cost this month, with an entity dropdown preselected to the entity
their Paylocity cost center implies (marked *(assumed)*). Saving writes a
**100% base entity allocation** per employee. Dismissing with **Later** leaves
an amber **Review & allocate** banner above the estimate that reopens the
dialog. See
[Usage Guide → Allocate new employees](/settings/wiki/usage-guide#allocate-new-employees-on-the-monthly-payroll-estimate)
and
[Changelog → 9a2cd8f](/settings/wiki/changelog#9a2cd8f---monthly-estimate-new-hire-allocation-dialog---2026-08-04).

### Budget module (`/budget`)

One budget version per **reporting group** per fiscal year (Avon, HDR,
Versatile), with optional forecast versions that start from actuals through a
chosen month. A version has five working tabs:

- **Assumptions**: rates, caps and growth keys with source notes (employer
  payroll taxes by year and Paylocity company, benefit renewal, workers comp
  by class code, payroll fees, growth, inflation, floating-rate index).
- **Headcount**: one row per position, seeded from the live Paylocity roster
  and twelve months of paycheck lines, plus planned positions. Every row is
  priced into twenty cost components (base, overtime, premiums, bonus accrued
  monthly, commission, Social Security and Medicare with wage-base caps, FUTA,
  CA SUI and ETT, medical, 401(k) match, life and disability, workers comp,
  PTO accrual, payroll fees, recruiting, other). A bridge card walks from the
  trailing run rate to the budget.
- **Drivers**: every computed build beneath the lines. Schedules pull debt
  interest, lease payments, depreciation, insurance premiums and intercompany
  allocation rules; the fleet driver builds rental revenue from units in
  service, utilization by month and revenue per rental day; trend builds cover
  lines with no other source.
- **Lines**: the statement grid. Lines with builds are read only and equal the
  sum of their builds; other lines are typed in, spread from an annual figure,
  or filled from last year. Named manual items can be added beneath a line.
- **Review**: budget against three years of actuals with a one-sigma band
  verdict per line, last year's budget accuracy, a per-month check that the
  prior year is safe to compare against (fresh trial balance and a soft-closed
  period for every entity), and a review flag and note per line.

Approving a version snapshots its comparables, assumptions, lines and
headcount, makes it the active version the Financial Model reads, and locks
it. Personnel Costs (6100) has sub-masters 6110 to 6180 on the management
chart so the categories carry through to variance; the statement still shows
one rolled-up line. Exports: one workbook per version (lines, headcount,
builds) and a consolidated workbook per year.

### Capex and disposal plan (`/capex-plan`)

Planned purchases (quantity, unit cost, in-service month, life, salvage,
funding) and planned disposals (proceeds, net book value, month). The budget
reads the plan for depreciation, financing interest, gain or loss on sale, and
the unit counts behind rental revenue.

## Entity-level features

Available under `/<entityId>/...`:

- **Dashboard** — KPIs scoped to the entity.
- **Close Management** — close calendar, tasks, and approvals.
- **Reports & KPIs** — P&L, balance sheet, cash flow, custom KPIs.
- **Budget** — budget vs actuals with variance analysis. Budget data uses
  Master GL structure, not entity-specific accounts.
- **Chart of Accounts** — view and edit entity-specific accounts and their
  Master GL mappings.
- **Trial Balance** — import, edit, and lock the TB.
- **Schedules** — fixed-asset, accrual, and reconciliation schedules.
- **Rental Assets** — fixed asset register with depreciation.
- **Debt Schedule** — facility-by-facility amortization and interest.
- **Real Estate** — lease accounting (ASC 842) for the entity.
- **Insurance** — policies and premium accruals.
- **Employees** — roster, payroll accruals, and paycheck details.
- **Revenue Accruals** — unbilled revenue tracking.
- **Commissions** — commission calculations and paid tracking.
- **Rebate Tracker** — customer rebate accruals (feature-flagged).
  Includes a **Monthly Rebates** table for GL posting (PR #58) with CSV
  export. Sales / Misc / L&D categories are flagged "Excluded from
  rebate" on detail views and exports (PR #56). Line-item math:
  Regular = list price, Net = post-discount (PR #57).
- **Revenue Projection** — monthly closed / pending / pipeline revenue from
  live RentalWorks data, plus an unbilled-earned drilldown for work done but
  not yet invoiced (feature-flagged). Orders and invoices are both pulled over
  a 13-month window (b0c8f3b). See
  [Core Concepts → Revenue projection](/settings/wiki/core-concepts#revenue-projection).

## Settings / Administration

- **Master GL** — consolidated chart of accounts. Supports two charts
  (management and accountant). Each classification table shows a
  **Total ({year})** column (PR #59) with a year selector going back to
  2017 (PR #77). Mapping side sheet exposes chart-scoped year-end
  adjustments (PR #60) with optional entity tagging for per-entity NI
  attribution (PR #67) and an "Apply to Intercompany Eliminations, Net"
  toggle (PR #61). The accountant chart defaults to the **By Rollup**
  view; the management chart defaults to **By Classification** (PR #62).
  The Unmapped Accounts panel supports search (PR #93), an inline
  master-account picker on every row (PR #84) that lists every master
  regardless of classification (PR #88), and surfaces the QBO
  AccountType / sub-type as a second badge (PR #89). Mappings can be
  added in bulk — pick one entity and toggle multiple entity accounts
  in a single save (PR #83). A **Bridge Links** settings page at
  `/settings/master-gl/bridge-links` pairs accountant masters ↔
  management masters explicitly for the Bridge view (PR #69).
- **Reporting Entities** — user-defined entity groupings for consolidated
  views. Supports an **Exclude from breakdown** flag (PR #97) that hides
  the RE from the Financial Model breakdown columns and (PR #109) from
  the org dashboard's consolidated totals.
- **Close Templates** — task templates that drive the close calendar for
  each entity.
- **Members** — invite users, assign roles (admin / member / viewer).
- **Audit Log** — history of every create / update / delete / state
  transition across the org.
- **Organization** — create / delete the organization itself, plus add
  entities.
- **Wiki** — this documentation, served from `docs/wiki/`.

## Feature flags

Two entity-scoped flags currently exist:

- `rebates` — turns on the Rebate Tracker.
- `revenue_projection` — turns on the Revenue Projection feature.

Flags are derived from entity name in `getEntityFeatures()` — entities whose
name contains "Versatile" get both flags. To roll out to more entities,
update that helper.

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
  per-entity P&L, balance sheet, cash flow.
- **Debt Dashboard** (`/debt`) — org-wide view of all debt facilities.
- **TB Variance** (`/tb-variance`) — flags trial-balance issues across
  entities (unmapped accounts, missing GL rows, prior-period drift).
- **IC Eliminations** (`/ic-eliminations`) — verifies intercompany balances
  net to zero.
- **Payroll** (`/payroll`) — org-wide payroll roster and accruals.
- **Real Estate** (`/real-estate`) — leases, subleases, lot square footage.
- **QBO Sync** (`/sync`) — connect each entity's QuickBooks Online file and
  pull trial balances.

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
- **Revenue Projection** — forward-looking revenue from RentalWorks
  pipeline (feature-flagged).

## Settings / Administration

- **Master GL** — consolidated chart of accounts.
- **Reporting Entities** — user-defined entity groupings for consolidated
  views.
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

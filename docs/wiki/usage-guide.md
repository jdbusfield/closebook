---
title: Usage Guide
slug: usage-guide
section: Usage Guide
order: 30
description: Step-by-step instructions for the workflows accountants run most often.
---

# Usage Guide

This guide covers the workflows you will run on a recurring basis.

## Run a month-end close

1. Open *Close Dashboard* from the org-level sidebar.
2. Pick the close period (e.g., "March 2026") for the entity you are closing.
3. Work through the close tasks in order. Each task has a status
   (pending, in-progress, done) and an owner.
4. Import the latest trial balance via *QBO Sync* (preferred) or by uploading
   a CSV from *Trial Balance*.
5. Resolve any TB variance flagged on the *TB Variance* dashboard. Common
   causes: new accounts not yet mapped to Master GL, unposted accruals,
   missed reclasses.
6. Post payroll, revenue, and any other accruals for the period.
7. Review pro forma adjustments — adjust opening balances if needed.
8. Reconcile fixed assets, debt, and leases. Each module has its own
   reconciliation tab.
9. Once all tasks are done, mark the period **locked**. Locked periods
   reject further trial-balance imports.

## Import a trial balance

- *QBO Sync*: prefer this. It pulls the TB directly from QBO, applies your
  Master GL mappings, and shows a diff of what will change before you
  commit.
- *Manual upload*: under each entity's *Trial Balance* page. Useful for
  one-off entities not connected to QBO.

After import, always check **TB Variance** to catch new unmapped accounts.

## Map a new account to Master GL

1. Go to the entity's *Trial Balance* page.
2. Find the unmapped row (highlighted).
3. Click the account combobox and pick the Master GL account it should roll
   into.
4. Save. The mapping is entity-scoped, so the same QBO account number can
   map differently in another entity.

When a single QBO account appears unresolved across many months, resolving
it once now back-fills every other period for that entity automatically
(PR #82). You can also map multiple entity accounts to one master in a
single save from *Settings → Master GL → Add Mapping* (PR #83), or use
the inline picker on each row of the Unmapped Accounts panel (PR #84).

### Bulk-create accounts from QBO

For trial balances with many unmatched QBO accounts (typical after a
historical sync), use **Auto-Create All** on the Trial Balance Unmatched
panel (PR #91). It fetches classification + account type from QBO for
each row, creates the local entity account, and back-fills `gl_balances`
across every period. Rows with no QBO id or deleted in QBO stay
unresolved and are surfaced in the toast for manual mapping. Deleted
QBO accounts are included via a name-based fallback (PR #92).

You can also create a brand-new account from the Trial Balance via the
top-of-page **New Account** button (PR #90). The dialog takes name +
optional account number + master-GL picker and back-fills every
historical unmatched row with the same name across all periods.

### Reclassify an existing account

Each row on the Trial Balance has a pencil icon (PR #85) that opens a
popover to edit Classification (Asset / Liability / Equity / Revenue /
Expense) and Account Type. Use this to fix historical mis-classifications
(e.g., a Bank account that landed in Expense).

## Add a fixed asset

1. Open the entity's *Rental Assets* page.
2. Click *Add Asset*. Fill out tag, description, cost, in-service date,
   and asset class.
3. The depreciation schedule auto-generates from the asset class's
   useful-life rule.
4. Reconcile the asset against the GL via *Asset Reconciliations* in the
   schedules section.

## Track a rebate

Only enabled for entities with the `rebates` feature flag (currently
"Versatile" and similar). On the entity's *Rebate Tracker*:

1. Add the customer with their tier, rate, and customer number.
2. The system pulls list-revenue from RentalWorks invoices automatically.
3. Quarterly rebate accruals post on close.

## Project revenue

For entities with the `revenue_projection` feature flag, the *Revenue
Projection* page (`/<entityId>/revenue-projection`) buckets live RentalWorks
invoices, orders, and quotes into months — 12 back through 3 forward.

1. Open the page and let it pull from RentalWorks. The order and invoice pulls
   each cover 13 months, so the fetch takes up to two minutes on a cold run.
2. Read the month columns: **closed** (finalized invoices), **pending**
   (drafted or approved invoices), **pipeline** (active orders), and
   **forecast** for future months.
3. Use the **Unbilled** tab to find work that has happened but has no invoice
   covering it. Each line shows the order total, how much has been billed
   against it, and the remainder allocated to the month.
4. Drill into a line to get the order number and customer, then chase the
   invoice in RentalWorks.

> Forecast for future months is a 6-month simple moving average of closed
> revenue. It is not a probability-weighted pipeline — no per-deal close
> percentage is applied anywhere in this page.

See [Core Concepts → Revenue projection](/settings/wiki/core-concepts#revenue-projection)
for the data windows and the exact unbilled-earned definition.

## Allocate new employees on the monthly payroll estimate

Payroll cost is attributed to an operating entity by each employee's
allocation row. A brand-new employee has no row yet, so Closebook falls back
to the entity implied by their Paylocity cost center — a silent assumption.
The Monthly Payroll Estimate makes you confirm it.

1. Open *Payroll → Monthly Estimate* (`/payroll/estimate`) and pick the year
   and month.
2. If the month contains employees with a first paycheck and no allocation on
   file, the **New employees** dialog opens automatically. (If you dismissed
   it, click **Review & allocate** on the amber banner above the estimate.)
3. Review each row: employee and payroll company, department, first check
   period, and estimated cost this month. Rows are ordered by cost, largest
   first.
4. In **Allocate to**, confirm or change the operating entity. The dropdown
   is preselected to the cost-center-implied entity, labelled *(assumed)*.
5. Click **Save N allocations**. Each employee gets a **100% allocation** with
   effective date `2000-01-01`, so the attribution applies to their whole
   history rather than starting this month. The estimate then reloads and the
   banner disappears.
6. Choose **Later** to defer. Nothing is written and the estimate keeps using
   the assumed entities, but the amber banner stays until the allocations are
   saved.

> The dialog only writes whole-entity allocations. For an employee whose cost
> genuinely splits across companies, save any entity here, then open the
> entity's *Employees* roster and set the percentage split (and any class
> split or effective-dated change) there.

See [Core Concepts → Employee allocations](/settings/wiki/core-concepts#employee-allocations-payroll)
for how the resolver picks a row, and
[Changelog → 9a2cd8f](/settings/wiki/changelog#9a2cd8f---monthly-estimate-new-hire-allocation-dialog---2026-08-04).

## Run consolidated financial statements

1. Org sidebar -> *Financial Model*.
2. Pick consolidated, a reporting entity, or a single entity.
3. Toggle EBITDA on/off as needed.
4. Print. Statements are sized to fit a single 8.5x11 page (portrait for
   <=6 columns, landscape otherwise).

### Save and re-use Financial Model templates

Each Financial Model configuration (scope, chart, granularity,
comparison toggles, period range, and active tab) can be saved as a
template (PR #98). Templates can be marked favorite, drag-reordered
(PRs #105, #106), and exported to PDF as a drag-orderable sequence
with optional title pages (PR #107). Loading a template auto-runs
Generate (PR #100). Period modes:

- **Static** — fixed start and end.
- **Dynamic** — both endpoints resolve against today (e.g., "Last
  completed month", "YTD", "Trailing 12").
- **Hybrid** — start is pinned to a fixed date, end follows a dynamic
  preset (perfect for running YTD that always begins at a fiscal-year
  start). See PR #102.

PDF export uses the same Print path as the model page so output matches
exactly (PR #103). For templates saved on the All Statements tab, only
the include-PDF checkboxes you ticked are exported (PR #104).

## Reconcile accountant vs management statements

Use the **Bridge** tab on `/reports/financial-model` (PR #69). It walks
through seven named categories (Pro Forma, Allocations, Year-End, IC
Eliminations, NI Presentation, Mapping residual, Tie check) and
side-by-side renders the from/to statements below. Click any line to
drill into per-master deltas (Tier 2), then into entity-level GL
accounts that map to the master (Tier 3). The Bridge tab is visible at
consolidated and reporting-entity scopes (PR #70). Export to XLSX or
landscape print. To pair specific accountant ↔ management masters
explicitly (overriding the heuristic), use *Settings → Master GL →
Bridge Links*. The **GL account mapping diff** panel below the schedule
surfaces individual GL accounts categorized differently between the two
charts (PR #72).

## Post year-end adjustments

For chart-scoped reconciliation (e.g., trueing up the accountant chart
to externally-prepared statements without touching journals), open
*Settings → Master GL*, click into a master account's mapping side
sheet, and use the **Year-End Adjustment** section (PR #60). One-time
yearly entry, treated as a Dec 31 journal entry; Asset/Liability/Equity
adjustments carry forward, Revenue/Expense stay in-year. Tag with an
optional entity (PR #67) so the adjustment flows into that entity's
equity rollup on the accountant chart. Toggle **Apply to Intercompany
Eliminations, Net** (PR #61) to balance the source account against the
synthetic IC line in one entry.

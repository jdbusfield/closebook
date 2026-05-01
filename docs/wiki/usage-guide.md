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
Projection* page produces forward-looking revenue from RentalWorks open
quotes / orders weighted by close probability.

## Run consolidated financial statements

1. Org sidebar -> *Financial Model*.
2. Pick consolidated, a reporting entity, or a single entity.
3. Toggle EBITDA on/off as needed.
4. Print. Statements are sized to fit a single 8.5x11 page (portrait for
   <=6 columns, landscape otherwise).

---
title: Troubleshooting
slug: troubleshooting
section: Troubleshooting
order: 70
description: Common issues and how to fix them.
---

# Troubleshooting

## "Trial balance import shows zero rows"

Almost always one of:

- The Supabase query is paginating implicitly at 1000 rows. Add `.range()`
  or paginate explicitly.
- The user's session does not have a membership row for the organization,
  so RLS hides everything. Check `organization_members`.
- New accounts in the source TB are not mapped to Master GL yet — the
  unmapped rows show on *TB Variance*, not on the consolidated views.

## "Balance sheet does not balance"

Closebook treats `Assets != Liabilities + Equity` as an error and surfaces
it on TB Variance. Common causes:

- Pro forma adjustment posted only to one side (entries must be
  double-entry).
- Allocation reclass missed its offsetting entry.
- Period closed mid-month with stale opening balances.
- **If it balances consolidated but not by entity/reporting entity**, the
  cause is almost always a cross-scope allocation — see the dedicated entry
  below.

## "Balance sheet balances consolidated but not by entity/reporting entity"

If the **consolidated** balance sheet ties but a **single-entity** or
**reporting-entity** view is off by exactly the net of a cross-scope
allocation, the cause is a cross-entity allocation whose offsetting leg lives
in an out-of-scope entity. The in-scope leg shifts that entity's Net Income
and equity with no offsetting asset/liability movement.

Closebook handles this by injecting a synthetic **"Due to/from affiliates
(allocations)"** current-liability line (account `__alloc_due_to_from__`,
ASC 850 intercompany settlement balance) on entity/RE-scoped statements so the
balance sheet re-articulates (PR #149). If you still see an imbalance of this
shape:

- Confirm the **"Due to/from affiliates (allocations)"** line appears in
  current liabilities on the out-of-balance entity/RE view. Its absence means
  the allocation leg's `counterpart_entity_id` was not set, so the engine
  could not tell the counterpart was out of scope.
- Make sure the synthetic account `__alloc_due_to_from__` has **not** been
  flagged `isIntercompany` or renamed to start with `__intercompany`. If it
  has, the cash-flow intercompany-elimination filters (PR #147) will drop it
  and the balance breaks again.

See [Core Concepts → Cross-scope allocations](/settings/wiki/core-concepts#cross-scope-allocations-and-the-due-tofrom-affiliates-line)
for the methodology and the
[PR #149 changelog entry](/settings/wiki/changelog#pr-149---fix-per-entityre-balance-sheet-imbalance-from-cross-scope-allocation-adjustments---2026-06-12).

## "Consolidated total does not equal sum of entities"

Check:

- Intercompany balances on *IC Eliminations*. ARH and Silverco are
  separate entities — IC flags must be set on the right accounts.
- Pro forma adjustments — these are period-specific, not cumulative.
- Reporting entity scoping — make sure you are comparing apples to apples
  (full org vs. reporting entity vs. single entity).

## "Cash flow Operating looks too high / 'Other non-cash reconciling items, net' is large"

If a chart books goodwill/intangible amortization through a dedicated
expense account (e.g. master 7300 "Amortization of Goodwill") *and* carries
the matching intangible master (e.g. 1600 Goodwill), older builds added the
amortization back twice — once from the expense account and once from the
asset's carrying-value decline. That overstated Operating, understated
Investing by the same amount, and left a residual in the **"Other non-cash
reconciling items, net"** plug line.

This was fixed in **PR #147** (intangible amortization is now an Operating
add-back only; the carrying-decline add-back is a fallback used only when no
amortization expense account exists). If you still see an inflated Operating
total or a large plug line on a recent period:

- Confirm the intangible amortization expense account name matches
  `INTANGIBLE_ASSET_NAME_PATTERNS` so it is recognized as intangible rather
  than counted as tangible depreciation.
- Check the *Other non-cash reconciling items, net* drill-down — a leftover
  intercompany residual now surfaces here on purpose (it is excluded from
  Investing/Financing), so a nonzero value points at an unbalanced
  `__intercompany_*` account rather than a cash-flow bug.

See [Core Concepts → Statement of cash flows](/settings/wiki/core-concepts)
for the methodology and the [PR #147 changelog entry](/settings/wiki/changelog#pr-147---fix-cash-flow-misclassification-intangible-amortization-double-count--dead-ic-exclusion---2026-06-12).

## "A new employee's payroll cost landed in the wrong entity"

Until an employee has an `employee_allocations` row, the Monthly Payroll
Estimate attributes their cost to the entity mapped to their Paylocity cost
center. If that mapping is wrong for this person, the estimate is wrong.

- Reopen `/payroll/estimate` for the month, click **Review & allocate** on the
  amber banner, pick the correct entity, and save. The write is a base
  allocation (`effective_date` `2000-01-01`), so it corrects every month, not
  just the one you are viewing.
- If the banner is gone because an allocation was already saved to the wrong
  entity, fix it on the entity's *Employees* roster instead — the dialog only
  lists employees with **no** allocation row, so a saved-but-wrong employee
  will never reappear there.
- If the same cost center keeps producing the wrong default, the mapping
  itself is stale. Update `COMPANY_COST_CENTER_MAPS` in
  `src/lib/paylocity/cost-center-config.ts` — remember the map is scoped by
  Paylocity company (132427 Silverco, 316791 HDR) because the codes overlap.

## "The new-hire banner will not go away" / "an employee is missing from the dialog"

The dialog lists an employee only when **both** conditions hold: their
earliest paycheck period begins in the viewed month (or the 21 days before it)
**and** they have no `employee_allocations` row.

- **Banner persists after saving** — a save failed partway. The dialog saves
  employees one at a time and stops at the first error, so the earlier
  employees are written and the rest are not. Reopen it; the ones already
  saved are gone and only the remainder are listed.
- **Employee you expect is missing** — usually they already have an allocation
  row (any effective date), or their first check period predates the 21-day
  lookback. Employees hired in earlier months who lack an allocation are out
  of scope for this dialog by design; audit those from the entity *Employees*
  roster.
- **A long-tenured employee appears as a new hire** — the estimate only reads
  three years of checks (`year - 1`, `year`, `year + 1`), so a rehire with no
  checks in that window until now reads as new. Allocate them normally.

See [Core Concepts → Employee allocations](/settings/wiki/core-concepts#employee-allocations-payroll)
and the
[9a2cd8f changelog entry](/settings/wiki/changelog#9a2cd8f---monthly-estimate-new-hire-allocation-dialog---2026-08-04).

## "An unbilled order I know about is missing from Revenue Projection"

Work through these in order:

- **The order is older than the window.** Orders are pulled 13 months back by
  `OrderDate`. An order opened before that is invisible to the projection, no
  matter how much of it is unbilled. Check it directly in RentalWorks.
- **The order is in a terminal status.** Only orders that are not `CANCELLED`,
  `CLOSED`, or `VOID` are treated as active.
- **A pending invoice already covers it.** Drafted `NEW`/`APPROVED` invoices
  count as billed-against, so the order shows in the *pending* series instead of
  *unbilled earned*. This is deliberate — otherwise the same dollars appear in
  both (b0c8f3b).
- **The rental period has not started.** Only the portion of the unbilled
  remainder allocated to the current month or earlier counts as earned. The
  rest sits in pipeline.
- **The order has no rental dates or a zero total.** Orders missing
  `EstimatedStartDate` / `EstimatedStopDate`, or totalling zero, are skipped.

## "The unbilled remainder on a discounted order looks wrong"

Amounts are compared at **list basis**: `Order.Total` is at list rate, so the
billed figure adds the discount back (`InvoiceSubTotal + InvoiceDiscountTotal`).
Before b0c8f3b the comparison used the post-discount subtotal, which left every
fully billed discounted order showing a phantom remainder equal to its discount.
If the numbers still look off, check whether the invoice carries misc or labor
charges — those are outside the list-rate basis on both sides.

## "Revenue Projection times out"

The order pull is month-windowed (`browseAllByMonthWindows`) at five concurrent
windows, and `/api/revenue-projection` and `/api/rw-revenue/orders` both run
with `maxDuration = 120`. A cold 13-month pull is genuinely slow. If it still
times out, RentalWorks is likely throttling — do not raise the batch size above
5, which is the observed safe concurrency.

## "RentalWorks API returns 500"

Some RW endpoints are known broken on the HDR instance:

- `/rentalinventory/browse`
- `/item/browse`
- `/physicalinventory/browse`
- `/container/browse`
- `/orderitem/browse`

Use GET-by-ID instead, or pull the data via a different entity browse and
join client-side.

## "QBO sync says token expired"

The OAuth refresh token has rotated and the encrypted blob in Supabase is
stale. Reconnect the entity from *QBO Sync*. If it keeps happening,
check that `TOKEN_ENCRYPTION_KEY` (or equivalent) hasn't changed between
deploys.

## "I shipped a PR but the wiki is unchanged"

The Closebook Wiki Maintainer agent has not yet processed it. Either ping
the agent with the PR number, or update `docs/wiki/changelog.md` and the
relevant section pages yourself in a follow-up PR.

## "Browse endpoint returns positional arrays I cannot parse"

This is RentalWorks's normal response format. Always pipe the response
through the `parseRows()` helper in `src/lib/rentalworks/client.ts` —
it uses `ColumnIndex` to convert each row's positional array into a named
object. Never index by hard-coded column number; the order is not stable.

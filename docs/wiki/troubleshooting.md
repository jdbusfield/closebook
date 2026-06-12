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

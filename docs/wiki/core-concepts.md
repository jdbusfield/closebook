---
title: Core Concepts
slug: core-concepts
section: Core Concepts
order: 20
description: The domain model that everything else in Closebook hangs off of.
---

# Core Concepts

Closebook's data model is hierarchical. Understanding the four core nouns —
**Organization**, **Entity**, **Reporting Entity**, and **Close Period** —
will make every other feature easier to navigate.

## Organization

The top-level container. An organization groups all the legal entities that
belong to one ownership group. A user belongs to one or more organizations
through a row in `organization_members`. Almost every other table in the
schema is `organization_id`-scoped, and Supabase row-level security uses
that scope to enforce access.

> Most users belong to exactly one organization. Multi-org membership is
> supported but rare.

## Entity

A single legal company within an organization. Each entity has its own:

- Chart of accounts
- Trial balance
- Close calendar (one row per period in `close_periods`)
- QBO company connection
- Set of close tasks

Entities live at `/<entityId>/...` in the URL — for example
`/abc123/dashboard` is the dashboard for the entity with id `abc123`.
The org-level routes (`/dashboard`, `/close-dashboard`, `/reports/...`)
operate across **all** entities in the organization.

## Reporting Entity

A user-defined grouping of entities for consolidated reporting. Reporting
entities exist so you can produce a consolidated P&L for, say, "all
operating entities except the holdco" without having to use the full
organization-wide rollup. Configured under *Settings -> Reporting Entities*.

Each reporting entity has an **Exclude from breakdown** flag (PR #97).
When set:

- The reporting entity is hidden from the Financial Model's Reporting
  Entity Breakdown columns.
- Its member entities are **also dropped from the org dashboard's
  consolidated KPIs** (TTM Revenue, EBITDA, EBITDA Margin, Net Income,
  the Monthly Revenue / EBITDA charts) — see PR #109. Entities that
  also belong to a non-excluded reporting entity, or that are
  unassigned, are still counted.
- Per-entity dashboards at `/[entityId]/dashboard` are unaffected.

## Close Period

A month-end close cycle for a single entity. Each close period:

- Has a status (open, in-progress, locked, etc.)
- Owns a set of close tasks driven by a close template
- Locks once approved, so trial-balance imports for that period stop
  overwriting prior numbers

## Master GL

A consolidated chart of accounts that all entity-level accounts map into.
Mapping is entity-scoped: account `4000-Revenue` in entity A and account
`40000-Sales` in entity B can both map to the same Master GL account
"Revenue", which is what makes consolidation work.

## Pro forma adjustments

Period-specific journal entries layered on top of actuals. They:

- Must flow through all three statements (P&L, balance sheet, cash flow)
- Are **not** cumulative — each period is independent
- Use double-entry (debits = credits) and are entity-scoped

## Allocations

Cross-entity cost / revenue allocations driven by allocation rules. There are
two kinds:

- **Reclass allocations** — move dollars between accounts within one entity
- **Cross-entity allocations** — move dollars between entities (these
  generate matching intercompany entries automatically)

### Cross-scope allocations and the "Due to/from affiliates" line

A cross-entity allocation expands into a **balanced +/− pair of P&L legs**,
one leg per entity involved. When you view the **consolidated** statements,
both legs are present, so Net Income and equity are unaffected and the
balance sheet ties.

But when you scope to a **single entity** or a **reporting entity**, only the
in-scope leg is kept. That leg shifts Net Income (and therefore equity) with
no offsetting balance-sheet entry, which would leave
`Assets ≠ Liabilities + Equity` by exactly the net cross-scope allocation.

To keep the per-entity / per-reporting-entity balance sheet articulated,
Closebook injects the missing leg into a synthetic account
`__alloc_due_to_from__`, shown as **"Due to/from affiliates (allocations)"**
(classification **Liability**, type **Other Current Liability**) — the GAAP
treatment of an unsettled affiliate allocation, i.e. an ASC 850 intercompany
settlement balance (PR #149). The line:

- renders in **balance-sheet current liabilities**, and
- flows through the **operating working-capital** section of the statement of
  cash flows,

so it nets against the Net Income shift and all three statements tie. Legs
whose counterpart entity is *also* in scope cancel out and inject nothing, so
consolidated output is unchanged.

> **Gotcha:** the `__alloc_due_to_from__` account must never be flagged
> `isIntercompany` or renamed to start with `__intercompany` — the cash-flow
> intercompany-elimination filters (PR #147) would drop it and re-break the
> balance. See
> [Changelog → PR #149](/settings/wiki/changelog#pr-149---fix-per-entityre-balance-sheet-imbalance-from-cross-scope-allocation-adjustments---2026-06-12).

## Year-end adjustments

Chart-scoped one-time entries that true up a master GL account at year
end without touching entity-level journals (PR #60). Each adjustment
lives on a specific chart (management or accountant), master account,
and period year. Behavior by classification:

- **Asset / Liability / Equity** — carry forward into subsequent periods
  (cumulative ending balance).
- **Revenue / Expense** — stay within the year of impact.

Optional fields:

- `entity_id` (PR #67) — tags the adjustment to a specific entity for
  per-entity NI attribution on the accountant chart. Untagged
  adjustments fall back to the largest-|NI| heuristic introduced in
  PR #65.
- `offset_to_ic_net` (PR #61) — injects a balancing entry into the
  synthetic Intercompany Eliminations, Net line so a single adjustment
  zeros out both the source account and the IC residual.

## Intercompany eliminations

When the consolidated view sums entities, IC payables/receivables and IC
revenue/expense between entities should net to zero. Closebook flags any
imbalance on the *IC Eliminations* dashboard.

> **Gotcha:** ARH and Silverco are **different** entities for IC purposes.
> Intercompany flag must be set on the relevant accounts.

## Statement of cash flows

Closebook derives the statement of cash flows indirectly (ASC 230) from the
trial-balance movements, in `buildCashFlowStatement`
(`src/app/api/financial-statements/route.ts`). The geography of each line —
Operating, Investing, or Financing — is decided by classification helpers, and
a few rules are worth understanding because they affect how non-cash items
reconcile.

### Depreciation vs. amortization (tangible vs. intangible)

Depreciation/amortization (D&A) expense accounts are identified by name
pattern, then **split into two buckets** (PR #147):

- **Tangible depreciation** — D&A accounts that do *not* match the intangible
  patterns. This is the only depreciation figure that feeds the Investing
  section, where it offsets the change in property & equipment carrying value.
- **Intangible amortization** — D&A expense accounts whose names match
  `INTANGIBLE_ASSET_NAME_PATTERNS` (e.g. master 7300 "Amortization of
  Goodwill"). This is an **Operating add-back only**. It is never netted into
  the Investing carrying-value offset, because intangible masters (goodwill,
  etc.) are excluded from Investing, so their amortization is not embedded in
  any P&E carrying-value change.

### The intangible carrying-decline fallback

The period decline in the carrying value of a goodwill/intangible master is
also non-cash amortization. Closebook adds it back **only as a fallback** —
specifically when a chart has *no* pattern-matched intangible-amortization
expense account. When a dedicated amortization expense account exists, that
expense already carries the Operating add-back, and adding the carrying decline
*as well* would double-count the same amortization (overstating Operating and,
via the offset, distorting Investing). See the PR #147 changelog entry for the
quantified Q1 2026 impact.

### Intercompany residuals stay off the face of the statement

Synthetic `__intercompany_*` elimination accounts (and any account named
"intercompany elimination") are excluded from the Investing, Financing-liability,
and Financing-equity filters (PR #147). Any nonzero residual on those synthetic
accounts therefore cannot masquerade as an investing or financing cash flow — it
falls through to the visible **"Other non-cash reconciling items, net"** line in
Operating, where it is easy to spot rather than silently misclassified.

> **Note:** The PR #147 fix is a *reclassification* — net change in cash is
> unchanged. It corrects only the Operating/Investing split and the size of the
> "Other non-cash reconciling items, net" plug line. See
> [Changelog → PR #147](/settings/wiki/changelog#pr-147---fix-cash-flow-misclassification-intangible-amortization-double-count--dead-ic-exclusion---2026-06-12).

### "Due to/from affiliates" balances articulate through working capital

On entity- and reporting-entity-scoped statements, the synthetic
**"Due to/from affiliates (allocations)"** current-liability balance — injected
to balance cross-scope allocations (see
[Allocations → Cross-scope allocations](#cross-scope-allocations-and-the-due-tofrom-affiliates-line))
— is a real balance-sheet movement, so its period change flows through the
**operating working-capital** section of the cash-flow statement (PR #149). That
working-capital change nets against the Net Income shift the kept allocation leg
caused, which is what keeps the entity/RE balance sheet and cash-flow statement
articulated. Unlike the `__intercompany_*` elimination accounts, this account is
**not** flagged intercompany, so it is intentionally *not* filtered out of the
statement.

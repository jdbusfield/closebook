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

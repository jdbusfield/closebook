---
title: Changelog
slug: changelog
section: Changelog
order: 90
description: Chronological record of every PR-driven change to Closebook. Most recent first.
---

# Changelog

This page records every merged pull request that affected Closebook's
behavior, configuration, or documentation. Entries are appended by the
Closebook Wiki Maintainer agent after each PR is merged.

The entry format is:

```
## [PR #<number>] - <Short Title> - <YYYY-MM-DD>

**Author:** <author>
**Type:** Feature | Bug Fix | Refactor | Breaking Change | Documentation | Performance | Security
**Related Issues:** <#issue-numbers or N/A>

### Summary
One-paragraph summary in plain language.

### Changes Made
- Bullet 1
- Bullet 2

### User Impact
Who is affected and how.

### Migration Notes
Steps required to adopt, or "None".

### Wiki Pages Updated
- /settings/wiki/<page>
```

Work pushed directly to `main` without a pull request is identified by its
short commit SHA in place of `[PR #<number>]`.

---

## [main] - Financial Model: "Compare on Total only" checkbox - 2026-08-17

**Author:** JD Busfield (jd@avonrents.com)
**Type:** Feature
**Related Issues:** N/A (pushed directly to `main`; no PR)

### Summary
On a month-by-month Financial Model view with a Total column, budget and
prior-year comparisons were awkward: Budget / Var repeated after every month,
and the Prior Year / YoY columns compared only the last month rather than the
whole period. A new **Compare on Total only** checkbox (shown when Total is on
and Budget and/or YoY Change is on) anchors both comparisons to the Total
column, so the layout reads: months… → Total → Budget → Var → Prior Year Total
→ YoY Change. Unchecked, the previous layout is unchanged.

### Changes Made
- `StatementTable` / `StatementCard` accept `compareTotalOnly`; budget columns
  render only after the Total period and YoY compares against the Total
  period's prior-year amounts (header reads "Prior Year Total").
- `ConfigToolbar` shows the checkbox next to Total; wired on
  `/reports/financial-model` and `/[entityId]/reports/financial-statements`.
- XLSX export (`/api/financial-statements/export`) accepts `compareTotalOnly`.
- Template PDF export places the budget triplet on the Total column only when
  the template has the flag; the templates-print page passes it through.
- Templates persist the flag in a new `compare_total_only` column (migration
  `20260817_financial_model_templates_compare_total_only.sql`). Until the
  migration is applied, the templates API drops that one column and retries so
  template saves still succeed (the flag just isn't remembered).
- Fixed pre-existing React "unique key" warnings in `StatementTable`
  (fragments inside `periods.map`).

### User Impact
Anyone reading a monthly P&L with a Total column can now see budget and
year-over-year comparisons for the period as a whole, next to the Total.

### Migration Notes
Run `supabase/migrations/20260817_financial_model_templates_compare_total_only.sql`
in Studio so saved templates remember the checkbox.

### Wiki Pages Updated
- /settings/wiki/features

## [b0c8f3b] - Revenue projection: fix three unbilled-order blind spots - 2026-08-05

**Author:** JD Busfield (jd@avonrents.com)
**Type:** Bug Fix
**Related Issues:** N/A (pushed directly to `main`; no PR)

### Summary
An investigation into long-outstanding orders found a substantial backlog of
active orders past their stop date, most never invoiced at all — and the
Revenue Projection was not showing them faithfully. Three separate defects
were responsible. The order
fetch only reached back 3 months, so any order opened earlier vanished from the
projection even when it was entirely unbilled. Drafted invoices counted in the
*pending* series while their orders still counted as fully unbilled, so the same
dollars appeared twice. And billed amounts were compared post-discount against
order totals stated at list rate, leaving a phantom unbilled remainder on every
discounted order that was in fact fully billed. All three are now fixed.

### Changes Made
- Widened the RentalWorks order browse from 3 to 13 months, matching the invoice
  window, in both `fetchRentalWorksRevenueData`
  (`src/lib/rentalworks/fetch-revenue-data.ts`) and
  `/api/rw-revenue/orders` (`src/app/api/rw-revenue/orders/route.ts`). The quote
  window is unchanged at 3 months.
- `browseAllByMonthWindows()` in `src/lib/rentalworks/client.ts` now runs its
  month windows in **batches of 5** rather than firing every window at once —
  RentalWorks's observed safe concurrency. A 13-month range would otherwise open
  13 simultaneous browses.
- Raised `maxDuration` from 60 to 120 on `/api/rw-revenue/orders` and
  `/api/revenue-projection` to accommodate the wider pull.
- In `processRevenueData` (`src/lib/utils/revenue-projection.ts`), the
  `orderBilledMap` now includes **pending** (`NEW`/`APPROVED`) invoices
  alongside closed (`CLOSED`/`PROCESSED`) ones, so a drafted invoice no longer
  leaves its order fully unbilled while also showing in the pending series.
- Billed-against amounts are now accumulated at **list basis**
  (`InvoiceSubTotal + InvoiceDiscountTotal`) to match `Order.Total`'s list-rate
  basis. The `UnbilledEarnedLine.billedAgainstOrder` field and the
  `MonthlyRevenue.unbilledEarned` doc comments were updated to match.

### User Impact
Long-outstanding orders now stay visible in the unbilled-earned figure and its
drilldown instead of silently ageing out after 3 months — the main reason the
backlog was invisible. Two offsetting corrections also change the number:
pending invoices no longer inflate it, and discounted orders no longer
contribute phantom remainders. The window widening pushes the figure up while
the other two fixes pull it down, so the net effect is a moderately higher and
more complete number that is not directly comparable to figures recorded
before this date. The projection page and the
daily `/api/rw-revenue/snapshot` cron both take longer to run, since the order
pull now covers 13 months.

### Migration Notes
None. No schema or configuration change. Revenue Projection snapshots stored
before 2026-08-05 reflect the old logic; re-run the projection for any month
whose unbilled figure you intend to compare or rely on.

### Wiki Pages Updated
- /settings/wiki/core-concepts (new "Revenue projection" section: data windows,
  monthly series, unbilled-earned definition)
- /settings/wiki/usage-guide (rewrote "Project revenue" — the previous text
  described the page as probability-weighted, which it has never been)
- /settings/wiki/features (Revenue Projection bullet)
- /settings/wiki/troubleshooting (three new entries: missing unbilled order,
  discounted-order remainder, projection timeouts)
- /settings/wiki/changelog

---

## [9a2cd8f] - Monthly estimate: new-hire allocation dialog - 2026-08-04

**Author:** JD Busfield (jd@avonrents.com)
**Type:** Feature
**Related Issues:** N/A (pushed directly to `main`; no PR)

### Summary
Payroll cost is attributed to an operating entity by each employee's
`employee_allocations` row. A brand-new employee has no row yet, so the
Monthly Payroll Estimate quietly falls back to the entity mapped to their
Paylocity cost center — a real accounting decision made by default, with
nothing on screen saying so. This change surfaces it. The
`/api/paylocity/monthly-estimate` response now carries a `newHires` array of
employees whose first paycheck activity falls in the viewed month and who have
no allocation row, and `/payroll/estimate` auto-opens a dialog listing them
with the cost-center-assumed entity preselected. Saving writes a 100% base
entity allocation per employee; dismissing leaves an amber banner that reopens
the dialog. The estimate's numbers are unchanged — this only adds a prompt to
confirm or correct the assumption behind them.

### Changes Made
- In `src/app/api/paylocity/monthly-estimate/route.ts`: the paycheck loop now
  records the earliest `begin_date` per `employeeId:companyId` **before** the
  month-window filter is applied, so the earliest date reflects the full
  three-year fetch (`year - 1`, `year`, `year + 1`) rather than only the
  in-window checks. Two guard clauses moved below that bookkeeping; no change
  to which checks enter the estimate.
- Same file: a new `newHires` block runs after `buildOrgEstimate`. An employee
  is included when they have checks in the month, have **no**
  `employee_allocations` row for that `employee_id:paylocity_company_id`, and
  their earliest begin date falls between 21 days before the month start and
  the month end (inclusive). Each entry carries `employeeId`, `companyId`,
  `employeeName`, `department`, `costCenterCode`, `firstActivityDate`,
  `assumedEntityId` / `assumedEntityCode` / `assumedEntityName` (from
  `getOperatingEntityForCostCenter`), and `earnedInMonth` (wages + employer
  taxes + employer benefits, rounded to cents). Sorted by cost descending,
  then name. The array is returned alongside the existing estimate payload;
  every pre-existing field is untouched.
- In `src/app/(app)/payroll/estimate/page.tsx`: a new `applyData` handler
  replaces the bare `setData` on load — it seeds a per-employee draft keyed
  `employeeId:companyId` defaulting to `assumedEntityId` and opens the dialog
  when `newHires` is non-empty.
- Same file: the **New employees — {Month} {Year}** dialog renders a table of
  Employee (with "HDR payroll" / "Silverco payroll" beneath the name),
  Department, First check period, Est. cost this month, and an **Allocate to**
  entity `Select` listing every entity in `ENTITY_ORDER`, with the assumed one
  suffixed *(assumed)*.
- Same file: **Save N allocations** issues one `PUT /api/paylocity/allocations`
  per employee with `effectiveDate: "2000-01-01"` and
  `entityAllocations: [{ entityId, entityName, pct: 100 }]`, then refetches the
  estimate. Requests are sequential and stop at the first failure, surfacing
  the API's error message in the dialog. **Later** closes without writing.
- Same file: when `newHires` is non-empty, an amber-bordered card above the
  headline reports the count and offers **Review & allocate** to reopen the
  dialog.

### User Impact
Accountants opening `/payroll/estimate` for a month containing new employees
are now interrupted once, with the specific list of people whose entity
attribution is being assumed rather than chosen, the dollar amount at stake
for each, and a one-click confirm. Previously that assumption was invisible
and typically only caught when an entity's payroll looked off. Saving from the
dialog writes a base allocation dated `2000-01-01`, so it governs the
employee's whole history rather than starting in the viewed month — correcting
prior months' estimates as well. The dialog writes only whole-entity (100%)
allocations; percentage splits across companies, class splits, and
effective-dated transfers still belong on the entity's *Employees* roster.
Months with no unallocated new hires behave exactly as before — no dialog, no
banner.

### Migration Notes
None. No schema change, no new environment variables, no new dependencies.
`newHires` is additive on an existing response and the page treats it as
optional (`newHires?`), so a stale client against the new API — or a new
client against a cached old response — degrades to the previous behavior.

Two behaviors worth knowing before adopting:

- The dialog lists only employees whose **first** paycheck activity is in the
  viewed month. Employees hired earlier who are still missing an allocation
  are not surfaced; audit those from the entity *Employees* roster.
- "First ever" is measured across the three years the estimate fetches, so a
  rehire with no checks in that window until now is reported as a new hire.

### Wiki Pages Updated
- /settings/wiki/features (new "Monthly Payroll Estimate" subsection under
  Org-level features, covering the page and the new-hire dialog; the Payroll
  bullet now points to it)
- /settings/wiki/core-concepts (new "Employee allocations (payroll)" section:
  effective dating, percentage splits, the cost-center fallback, and an
  "Assumed vs. allocated new hires" subsection with the inclusion criteria)
- /settings/wiki/usage-guide (new "Allocate new employees on the monthly
  payroll estimate" workflow)
- /settings/wiki/troubleshooting (new entries "A new employee's payroll cost
  landed in the wrong entity" and "The new-hire banner will not go away / an
  employee is missing from the dialog")
- /settings/wiki/changelog

---

## [PR #149] - Fix per-entity/RE balance sheet imbalance from cross-scope allocation adjustments - 2026-06-12

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
Inter-entity allocation adjustments expand into a balanced +/− pair of P&L legs (one leg per entity involved). The consolidated view keeps both legs, so it always balanced; but entity- and reporting-entity-scoped statements kept only the in-scope leg, shifting Net Income (and therefore equity) with no offsetting balance-sheet entry. The result was `Assets ≠ Liabilities + Equity`, off by exactly the net cross-scope allocation — but **only** when scoped to a single entity or reporting entity. This PR makes the engine, whenever it keeps a leg whose counterpart entity is outside the statement scope, inject the missing leg into a synthetic account `__alloc_due_to_from__` ("Due to/from affiliates (allocations)"). That is the GAAP treatment of an unsettled affiliate allocation — an ASC 850 intercompany settlement balance — so the per-entity/RE balance sheet re-articulates and all three statements tie again. The income statement and the consolidated output are unchanged.

### Changes Made
- In `src/app/api/financial-statements/route.ts`: allocation legs now carry a `counterpart_entity_id`. When a kept leg's counterpart entity is outside the current scope (single-entity or reporting-entity), the engine emits the offsetting leg into the synthetic account `__alloc_due_to_from__`, named **"Due to/from affiliates (allocations)"**, classification **Liability**, account type **Other Current Liability**. It renders in balance-sheet current liabilities and flows through the cash-flow operating working-capital section, netting against the Net Income shift so the statement stays articulated. Legs whose counterpart is also in scope cancel out and inject nothing (consolidated behavior is unchanged).
- In `src/app/api/financial-statements/reporting-entity-breakdown/route.ts`: the same per-column treatment was applied. For each reporting-entity column a leg whose counterpart entity is not a member of that column is offset into the "Due to/from affiliates" line; the Consolidated column gets the offset only in the excluded-counterpart case (when the counterpart entity belongs exclusively to an excluded reporting entity).

### User Impact
Operators viewing a **single-entity or reporting-entity** balance sheet that was previously out of balance by the net of cross-scope allocations now see a balanced statement, with the offset shown as a **"Due to/from affiliates (allocations)"** line in current liabilities. On 2026 live data the imbalances were: HDR equity understated by **$332,636.40**, Versatile understated by **$658,563.43**, and Avon overstated by **$991,199.83** (summing to $0 across the group). After the fix each entity/RE balance sheet articulates. Consolidated statements and every income statement are numerically unchanged — they already balanced.

### Migration Notes
None. This is a derivation-logic fix; no schema, configuration, or stored-data changes. Corrected balance sheets appear on the next render.

> **Maintenance note:** the synthetic account `__alloc_due_to_from__` must **never** be flagged `isIntercompany` or renamed to start with `__intercompany`. The cash-flow intercompany-elimination filters added in PR #147 would drop it, which would re-break the balance.

### Wiki Pages Updated
- /settings/wiki/core-concepts (new "Cross-scope allocations and the Due to/from affiliates line" subsection under Allocations; note added to Statement of cash flows)
- /settings/wiki/troubleshooting (new "Balance sheet balances consolidated but not by entity/reporting entity" entry; cross-reference added to "Balance sheet does not balance")
- /settings/wiki/changelog

---

## [PR #147] - Fix cash flow misclassification: intangible amortization double-count + dead IC exclusion - 2026-06-12

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
A review of the Q1 2026 statement of cash flows found a hidden Operating/Investing misclassification that netted to zero (so the statement still tied) plus a dead-code intercompany exclusion. When a chart has both a dedicated intangible-amortization expense account (master 7300 "Amortization of Goodwill") and the matching intangible master (1600 Goodwill), the old `buildCashFlowStatement` logic added the amortization back twice — once from the D&A expense name filter (Operating) and again from the goodwill carrying-value decline — while the Investing "tangible depreciation" offset incorrectly netted out the intangible amortization expense that is not embedded in any P&E carrying value. The fix splits D&A into tangible vs. intangible, makes the carrying-decline add-back a fallback, and wires in the previously-dead `isIntercompanyElim` filter. Net change in cash is unchanged; only the Operating/Investing split and the "Other non-cash reconciling items, net" plug line move.

### Changes Made
- In `src/app/api/financial-statements/route.ts` (`buildCashFlowStatement`): D&A expense accounts are split via `INTANGIBLE_ASSET_NAME_PATTERNS` into **tangible depreciation** (`tangibleDepAccounts`) and **intangible amortization** (`intangibleAmortExpenseAccounts`). Only tangible depreciation feeds the Investing carrying-value offset; intangible amortization is an Operating add-back only.
- The intangible carrying-value-decline add-back is now a **fallback** (`useCarryingDeclineFallback = intangibleAmortExpenseAccounts.length === 0`), applied only when a chart has no pattern-matched amortization expense account — eliminating the double count.
- `isIntercompanyElim` (previously defined but never called) is now applied to the Investing, Financing-liability, and Financing-equity account filters, so synthetic `__intercompany_*` elimination residuals can no longer appear as investing/financing cash flows; any nonzero residual falls through to the visible Operating "Other non-cash reconciling items, net" line.

### User Impact
Operators viewing the statement of cash flows get a correctly classified statement. For the Q1 2026 Management chart (consolidated), net cash from operating activities was overstated by **$509,733** and investing understated by the same amount, with a ~$54.6K residual surfacing in the "Other non-cash reconciling items, net" plug line. After the fix: Operating −$509,733 / Investing +$509,733 (net change in cash unchanged), the D&A line shows the true expense ($1,441,728, no longer inflated by the ~$455K carrying decline), and the $54.6K plug line drops to roughly zero. No data migration or user action is required — the corrected numbers appear on the next render.

### Migration Notes
None. This is a derivation-logic fix; no schema, configuration, or stored data changes. Net change in cash is unaffected, so historical period totals still tie — only the Operating/Investing split and the plug line are restated when a period is re-rendered.

### Wiki Pages Updated
- /settings/wiki/core-concepts (new "Statement of cash flows" section)
- /settings/wiki/troubleshooting (new "Cash flow Operating looks too high" entry)
- /settings/wiki/changelog

---

## [PR #110] - Wiki sub-pages bouncing to /dashboard - 2026-05-21

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
The wiki index rendered fine in production but every link to a sub-page redirected to `/dashboard` instead of opening the article. Root cause: the wiki pages were marked `export const dynamic = "force-static"`, but the parent `(app)/layout.tsx` reads cookies via Supabase for auth. At build time the layout's `getUserProfile()` returned null and hit `redirect("/login")`, baking that redirect into the static output. At runtime `/login` redirects authenticated users to `/dashboard`, so every wiki sub-page resolved to the dashboard. The fix drops `force-static` (and the unused `generateStaticParams`) so wiki pages render per-request against the real session; the in-memory page cache (`loadAllPages()`) is untouched.

### Changes Made
- Removed `force-static` and `generateStaticParams` from the wiki page routes under `src/app/(app)/settings/wiki/`.
- Pages now render per-request, picking up the live Supabase session for auth checks.

### User Impact
Links from the wiki index to individual wiki pages now work for signed-in users. Unauthenticated visitors are still redirected to `/login` as expected.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #109] - Dashboard respects reporting-entity exclude_from_breakdown in consolidated totals - 2026-05-21

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
PR #97 added an `exclude_from_breakdown` flag on reporting entities that hid their column from the Financial Model breakdown, but the consolidated headline KPIs on the org dashboard still summed all entities — so excluding a reporting entity hid the column without lowering the totals. This PR threads the flag through every consumer of the consolidated dataset: a new `getExcludedFromBreakdownEntityIds` helper returns entity IDs whose every reporting-entity membership is excluded (entities that also belong to a non-excluded RE, or are unassigned, are kept). `/api/financial-statements` filters those entities out of `orgEntityIds` before consolidation, and `/api/financial-statements/reporting-entity-breakdown` computes the Consolidated column (and its pro-forma / allocation adjustments) on the filtered list. The Revenue by Reporting Entity chart drops the excluded REs as well.

### Changes Made
- Added `src/lib/db/queries/reporting-entity-exclusions.ts` with `getExcludedFromBreakdownEntityIds`.
- `/api/financial-statements` org scope filters out fully-excluded entities before consolidation, so TTM Revenue, EBITDA, EBITDA Margin, Net Income, and the Monthly Revenue / EBITDA charts all reflect the exclusion.
- `/api/financial-statements/reporting-entity-breakdown` Consolidated column and its adjustments compute against the filtered entity list.
- `dashboard/revenue-by-re.tsx` drops `excludeFromBreakdown = true` REs from the stacked-bar chart so it matches the headline KPIs.

### User Impact
Toggling `exclude_from_breakdown` on a reporting entity now reduces the consolidated totals shown on the org dashboard and the Financial Model's Reporting Entity Breakdown — the column disappears AND the totals drop. Per-entity dashboards at `/[entityId]/dashboard` are unaffected.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/core-concepts (clarifies reporting-entity exclusion semantics)
- /settings/wiki/changelog

---

## [PR #108] - Versatile revenue requires V prefix on orders and invoices - 2026-05-20

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
The Versatile revenue projection was leaking `AS`-/`AC`-prefixed Avon Studios / Avon Cahuenga items through the Cahuenga warehouse match. `processRevenueData` in `src/lib/utils/revenue-projection.ts` now requires `OrderNumber` and `InvoiceNumber` to start with `V`, which automatically tightens every Versatile revenue tab, KPI, and the daily `/api/rw-revenue/snapshot` cron.

### Changes Made
- Tightened the order/invoice filter in `processRevenueData` to require a `V` prefix.

### User Impact
Versatile entities' Open Orders / Unbilled / Invoices tabs, YTD Revenue, Current Month, and Pipeline KPI cards, equipment breakdown, unbilled-earned drilldown, and the daily revenue cron now exclude non-Versatile items. Other entities are unaffected.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #107] - Financial Model PDF export becomes a sequence builder with title pages - 2026-05-20

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Templates → Export to PDF is now a drag-orderable sequence builder. You can drop title or divider pages between templates to organize the output — for example, a "Monthly" cover before your monthly templates and a "Year to Date" cover before the YTD set. Each row in the sequence can be dragged to any position; title pages have an editable title and optional subtitle; any item can be removed; an "Add template" dropdown re-adds removed templates. Select-all / Favorites-only / Clear shortcuts seed the sequence. The sequence is base64-JSON-encoded into the print page URL, and the print view renders title pages as full-page centered slides with their own page break.

### Changes Made
- Replaced the static export menu with a sequence builder dialog.
- Print view renders title pages as full-page slides and template pages via the existing Print path (PR #103).

### User Impact
Operators producing report packets can now control the order and inject title pages without exporting separately and stitching outside the app.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #106] - Drag-reorder works for all saved Financial Model templates - 2026-05-20

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Drag-reorder now applies to every saved template, not just favorites (which got drag support in PR #105). Each row in both the Favorites and Other groups has a grip handle and accepts drops within its group. Cross-group drags are intentionally ignored — use the star button to change a template's favorite status.

### Changes Made
- Extended the drag-and-drop reorder handler from favorites to all template groups.
- Single-template groups don't render a grip (nothing to reorder).

### User Impact
Users can order non-favorite templates the way they want them to appear in the dropdown.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/changelog

---

## [PR #105] - Drag-reorder favorite Financial Model templates - 2026-05-20

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Favorite templates in the Templates dropdown are now drag-and-droppable. Each row gets a grip handle; dragging shows a highlighted drop target; the new order persists immediately. A new `POST /api/financial-model-templates/reorder` endpoint accepts `{ organizationId, orderedIds }` and writes `display_order` in bulk. Non-favorites stay in created-at order.

### Changes Made
- Added drag handles + drop targets to favorite template rows.
- Added `POST /api/financial-model-templates/reorder` endpoint and `display_order` writes.

### User Impact
Favorites surface in user-controlled order in the dropdown and in PDF export.

### Migration Notes
None — `display_order` already existed on `financial_model_templates` (added with PR #98).

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/changelog

---

## [PR #104] - Template print respects include-PDF checkboxes on All tab - 2026-05-20

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
Templates saved on the "All Statements" tab now honor the Income Statement / Balance Sheet / Cash Flow / Pro Forma checkboxes from the save dialog when printing. Previously, an "All" template always printed every statement regardless of which boxes were checked. Single-statement tabs (IS, BS, CF, Pro Forma) still imply their own statement and ignore the include flags.

### Changes Made
- Templates-print page filters the rendered statements by the saved include flags when the template's active tab is "all".

### User Impact
Users get the statements they actually checked when they saved the template.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #103] - Template PDF export uses the same Print path as the model page - 2026-05-20

**Author:** jdbusfield
**Type:** Refactor
**Related Issues:** N/A

### Summary
Templates → Export to PDF no longer goes through jspdf. It now opens a new tab at `/reports/financial-model/templates-print?ids=...` that renders each selected template with the same StatementCard / EntityBreakdownTable / ProFormaDetailSchedule components used on screen, then auto-triggers `window.print()`. Output now matches the model page's Print button exactly — same fonts, spacing, dollar-sign rules, double-rule grand totals, one-statement-per-page CSS, etc. Dynamic and hybrid templates re-resolve against today at print time, just like loading them on the page does. Allocations and Bridge render an "unsupported in print export" placeholder for now. The old `/api/financial-model-templates/export-pdf` route is orphaned and can be deleted in a follow-up.

### Changes Made
- New `/reports/financial-model/templates-print` route renders selected templates using the on-screen components and triggers `window.print()`.
- Templates dialog now opens that route instead of calling the jspdf endpoint.

### User Impact
Exported PDFs match the on-screen statements exactly.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/changelog

---

## [PR #102] - Hybrid period mode for fixed-start YTD templates - 2026-05-20

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds a "Hybrid" period mode to Financial Model templates that pins the start to whatever start year/month was selected at save time, while the end follows a dynamic preset (e.g., "Last completed month") that re-resolves against today on every load and export. Perfect for a running YTD that always begins at Jan 2026 but extends as new months close. The template list and PDF cover render hybrid templates with both the fixed start and the dynamic-end label.

### Changes Made
- New migration `20260520_financial_model_templates_hybrid_period.sql` widens the `period_mode` CHECK constraint to include `'hybrid'`.
- Templates UI gains the Hybrid option; save dialog captures the fixed start; loader/exporter resolves the dynamic end at render time.

### User Impact
Reporting users can save one template that always anchors to a fiscal-year start while rolling its endpoint forward each month.

### Migration Notes
Run `supabase/migrations/20260520_financial_model_templates_hybrid_period.sql`.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/changelog

---

## [PR #101] - Caption yearly view as YTD when range doesn't end in December - 2026-05-20

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
On the Financial Model with yearly granularity, when the selected range doesn't end in December the statement caption now reads `Year to Date through {endDate}` instead of `For the Year Ended {endDate}`. Ranges ending December still read `For the Year Ended December 31, YYYY`.

### Changes Made
- Caption derivation now checks whether the end month is December and switches the prefix accordingly.

### User Impact
Statement captions accurately reflect partial-year ranges instead of misleadingly reading "Year Ended".

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #100] - Auto-generate when a Financial Model template is loaded - 2026-05-20

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Loading a saved Financial Model template now auto-runs Generate — no second click required. Uses a one-shot flag that fires once `canFetch` is true and no other fetch is in flight. Manually switching scope or dates still requires the Generate button (no unintended auto-fetches).

### Changes Made
- Added a one-shot auto-generate trigger on template load.

### User Impact
Less friction when stepping through saved views.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #99] - Templates remember the active tab and export it - 2026-05-20

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Each Financial Model template now stores the active tab it was created on. Loading a template drops you straight into that view — open a saved RE-breakdown template and the RE Breakdown tab opens with the right scope and dates. The PDF export dispatches per template: a template saved on Income Statement exports just that, RE Breakdown exports a per-RE column view, Allocations exports the allocation list, etc. Covered tabs: all / income statement / balance sheet / cash flow / pro forma / allocations / entity breakdown / RE breakdown. Bridge gets a placeholder cover page (left for follow-up). The two static "Export all" / "Export favorites" menu items are replaced with a multi-select Export dialog.

### Changes Made
- Migration `20260520_financial_model_templates_active_tab.sql` adds `active_tab text default 'all'`.
- Template save / load / export honor `active_tab`.
- Export menu replaced with a multi-select dialog.

### User Impact
Templates round-trip cleanly to whichever tab they were created on, and PDF exports render the matching view.

### Migration Notes
Run `supabase/migrations/20260520_financial_model_templates_active_tab.sql`.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/changelog

---

## [PR #98] - Saveable Financial Model templates with favorites and PDF export - 2026-05-20

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Introduces saveable, per-organization Financial Model templates with a favorite toggle. Each template stores scope, chart, granularity, comparison toggles, and either a static period range or a dynamic preset (last month, YTD, trailing 12, prior year, etc.) that re-resolves against today's date on load and on export. A Templates menu on the Financial Model page lets you save the current configuration, load a saved one, favorite/unfavorite, edit, and delete. A new `GET /api/financial-model-templates/export-pdf` endpoint renders one PDF containing every template (or only favorites), each with a cover page plus the user-selected statements: IS, BS, CF, pro-forma adjustments schedule. Follow-ups in #99 (active-tab tracking), #100 (auto-generate), #101–#107 layer on additional behavior.

### Changes Made
- New migration `20260520_financial_model_templates.sql` adds the `financial_model_templates` table (RLS-scoped to org members).
- Templates menu UI under the Financial Model toolbar (save, load, favorite, edit, delete).
- `GET /api/financial-model-templates/export-pdf` for batch PDF export (later superseded by the Print-path implementation in #103).

### User Impact
Reporting users no longer have to reconfigure scope and dates each time — favorite views are one click away.

### Migration Notes
Run `supabase/migrations/20260520_financial_model_templates.sql`.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #97] - Hide reporting entities from breakdown view - 2026-05-19

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds an `exclude_from_breakdown` flag on `reporting_entities` with a checkbox in Settings → Reporting Entities. The Financial Model's Reporting Entity Breakdown view now drops excluded REs from its columns. Their member entities still roll into the consolidated total and are NOT surfaced under "Other". (PR #109 later extended this so excluded REs are also removed from the consolidated totals on the org dashboard.)

### Changes Made
- Schema migration adds `exclude_from_breakdown` to `reporting_entities`.
- Settings → Reporting Entities gains a checkbox.
- Financial Model RE Breakdown filters columns by the flag.

### User Impact
Operators can hide reporting entities (e.g., "Avon Accounting") from the breakdown without losing them from consolidation.

### Migration Notes
Run the accompanying `exclude_from_breakdown` migration.

### Wiki Pages Updated
- /settings/wiki/core-concepts
- /settings/wiki/changelog

---

## [PR #96] - Year/month period filters on pro forma and allocation tabs - 2026-05-18

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds independent Year and Month filter dropdowns (each defaulting to "All") to the Pro Forma and Allocation adjustment toolbars, next to the existing search/sort from PR #95. Pro Forma filters on each row's single `period_year` / `period_month`. Allocations use a coverage check: single-month, repeating (start → repeat-end), and monthly-spread (start → end) rows all match when the selected period falls within their active span. Year and month are independent. Header count shows "X of N" when any filter is active.

### Changes Made
- Added Year and Month dropdowns to the Pro Forma and Allocation toolbars.
- Coverage logic for allocation schedule types implemented client-side.

### User Impact
Users can isolate adjustments by year, by month-across-years, or by a specific month.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/changelog

---

## [PR #95] - Search and sort on pro forma and allocation tabs - 2026-05-18

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds a client-side search box and sort controls (Company / GL Account / Month, with asc/desc toggle) above the Pro Forma and Allocation adjustment tables. Search matches entity code/name, GL account number/name (including offset/destination account), description, and notes. Filtering/sorting is in-memory via `useMemo` — both tabs already fetch all rows up front, so no query changes. Header subtitle shows "X of N" while filtering; an empty filter shows a "no match" message.

### Changes Made
- New search input + sort dropdown on both adjustment tabs.
- Allocation Company sort uses the source entity; Month sort handles single-month and spread/repeating schedule types.

### User Impact
Quickly find specific adjustments in long lists without scrolling.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #94] - Master GL Unmapped includes deleted accounts - 2026-05-15

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
The unmapped-monthly endpoint was passing `activeOnly: true` to `fetchAllAccounts`, which dropped QBO-deleted accounts. Those accounts still carry historical TB balances and need to be mappable. The endpoint now passes `false` so deleted accounts show up in the Unmapped panel and in the search added by PR #93.

### Changes Made
- `/api/master-accounts/unmapped-monthly` no longer filters out deleted accounts.

### User Impact
Deleted QBO accounts (e.g., "Construction in Progress (deleted)") now appear in Master GL Unmapped Accounts and can be mapped inline.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #93] - Search on Master GL Unmapped Accounts panel - 2026-05-15

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds a search box to the Unmapped Accounts header. When a search is active, the panel switches to a flat results table that includes both unmapped and already-mapped accounts, showing the master GL each mapped account points to. Unmapped matches keep the inline master picker so the user can map on the spot.

### Changes Made
- Search input on Master GL → Unmapped Accounts.
- Flat results table renders both unmapped and mapped accounts when filtering.

### User Impact
Users can find a specific account in any entity without scrolling per-entity grids.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #92] - TB auto-create includes deleted accounts and name fallback - 2026-05-15

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
QBO's `SELECT * FROM Account` filters to `Active = true` by default, so "(deleted)" accounts were silently skipped — exactly the rows the auto-create button from PR #91 needs. Switched to a paginated full-chart pull with `Active IN (true, false)` and built both id- and name-keyed indexes. Legacy unmatched rows without a `qbo_account_id` now resolve via case-insensitive name match instead of being skipped.

### Changes Made
- Replaced default-filter QBO pull with paginated `Active IN (true, false)`.
- Added name-based fallback for unmatched rows missing `qbo_account_id`.

### User Impact
Auto-Create All now succeeds on entities with deleted-QBO unmatched accounts.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #91] - Trial balance: auto-create all missing accounts from QBO - 2026-05-15

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds an "Auto-Create All" button to the Unmatched QBO Accounts panel on the trial balance. For each unresolved row, the system fetches classification + account type from QBO via the Account API, creates the local entity account, and back-fills `gl_balances` across every period referencing it. Rows whose QBO id is missing or deleted in QBO stay unresolved — surfaced in the toast for manual mapping. (PR #92 added the deleted-account + name-fallback path.)

### Changes Made
- New "Auto-Create All" button on the Trial Balance unmatched panel.
- Per-row classification pull from QBO Account API + back-fill across periods.

### User Impact
Bulk resolution of large unmatched lists in one click.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #90] - Trial balance: New Account button with cross-period back-fill - 2026-05-15

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds a top-of-page **New Account** button to the Trial Balance page. The dialog takes name + optional account number + master-GL picker. Submitting creates the entity account (classification + account type copied from the chosen master), inserts the `master_account_mappings` row, and sweeps every unresolved `tb_unmatched_rows` row for this entity whose `qbo_account_name` matches the new account name (case-insensitive trim), resolving them in one shot — `gl_balances` posted per period, `resolved_account_id` set. Toast reports how many periods were back-filled. New endpoint `POST /api/accounts` accepts `{ entityId, name, accountNumber?, masterAccountId?, classification?, accountType? }`; requires either `masterAccountId` or explicit `classification` + `accountType`.

### Changes Made
- New Account button + dialog on the Trial Balance page.
- New `POST /api/accounts` endpoint.
- Cross-period unmatched back-fill on creation (matches the behavior introduced for the unmatched flow in PR #82).

### User Impact
Brand-new accounts can be added from the Trial Balance and automatically clear historical unmatched rows in one step.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #89] - Master GL: surface QBO AccountType on unmapped accounts table - 2026-05-14

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
The QBO sync already stores `Classification` (Asset/Liability/Equity/Revenue/Expense), `AccountType` (Bank, Other Current Asset, etc.), and `AccountSubType` (Checking, MoneyMarket, etc.) per account. The Unmapped Accounts table now renders the QBO AccountType as a second badge next to the classification chip, with the sub-type appended when it differs (e.g. `Bank · Checking`). No QBO calls or re-syncs needed — the data was already on the `accounts` row.

### Changes Made
- `/api/master-accounts/unmapped-monthly` pipes `accountType` and `accountSubType` through to the UI.
- Unmapped table renders a second badge for AccountType (+ sub-type when distinct).

### User Impact
Easier to recognize the right master GL for an unmapped account at a glance.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #88] - Master GL unmapped picker shows all master accounts - 2026-05-14

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
The inline "Map to Master GL" dropdown on each Unmapped Accounts row was filtering masters to the row's classification (Asset rows → only Asset masters, etc.). This PR drops the filter so any entity account can be mapped to any master regardless of classification.

### Changes Made
- Removed the classification filter from the inline master picker.
- Updated placeholder to "Select any master GL account...".

### User Impact
Operators can override classification when the QBO classification is wrong (e.g., a Bank account misclassified as Expense — see PR #85).

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #87] - tb-unmatched: drop auto-classifier, pick a master GL account instead - 2026-05-14

**Author:** jdbusfield
**Type:** Breaking Change
**Related Issues:** N/A

### Summary
Replaces the QBO trial-balance auto-classifier (`inferClassification`) with explicit master-account selection. The name-substring heuristic from PR #85 was the root cause of bugs like "Chase BusCking (Legacy) (deleted)" landing under Silverco's Expense section; with this PR there's no guessing — the user picks a master GL account and the entity account is created with that master's classification + account_type and mapped in one step. `POST /api/tb-unmatched/create-account` now accepts a `masterAccountId`. When provided we copy `classification` and `account_type` from the master and insert into `master_account_mappings` (duplicate treated as no-op). When omitted, explicit `classification` + `accountType` are required — there is no longer any name-based fallback. The bulk "Create All Accounts" button is removed because it depended on the heuristic. Each row now has a "Create + Map" button that opens a popover with every active master GL account grouped by classification.

> **Breaking:** any external caller of `/api/tb-unmatched/create-account` that relied on name-based classification inference must now pass either a `masterAccountId` or both `classification` and `accountType`.

### Changes Made
- `POST /api/tb-unmatched/create-account` requires explicit master or classification+type.
- Per-row "Create + Map" popover replaces the auto-classifier path.
- Bulk "Create All Accounts" button removed.

### User Impact
No more silent mis-classification. Existing mis-classified rows can still be fixed via the per-row pencil-reclassify popover from PR #85.

### Migration Notes
External integrations calling the create-account endpoint must update their payload.

### Wiki Pages Updated
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #86] - Hotfix: account_type cannot be null in PATCH - 2026-05-14

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
Vercel build for PR #85's commit failed because `accounts.account_type` is `text NOT NULL` (migration 001) but the new PATCH branch had a fallback that set `account_type = null` when the caller omitted or blanked the field. The API now treats `accountType` as non-nullable — when supplied it must be a non-empty trimmed string; an empty string returns a 400. The ReclassifyPopover validates client-side before calling the PATCH.

### Changes Made
- `PATCH /api/accounts/[accountId]` rejects blank `accountType`.
- ReclassifyPopover validates client-side and toasts "Account Type cannot be blank".

### User Impact
Build is unblocked; reclassify still works end-to-end.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #85] - Improve TB auto-classifier + allow inline reclassify - 2026-05-14

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
"Chase BusCking (Legacy) (deleted)" was landing in Expense because the auto-classifier's substring tests for `"bank"` and `"checking"` miss QBO's compressed "BusCking" label, so the function fell through to its default Expense bucket. This PR tightens the classifier with a high-confidence bank-name list (chase, wells fargo, bank of america, bofa, citibank, us bank / u.s. bank, pnc bank, first republic, jpmorgan / jp morgan, manufacturers bank, plus abbreviations `buscking`, `bus cking`, `bus ckg`, `buschecking`), keeps the list narrow to avoid false positives on `tracking`/`operating expense`. Also adds an inline reclassify path: `PATCH /api/accounts/[accountId]` now accepts `classification` (Asset/Liability/Equity/Revenue/Expense) + `accountType`, and the Trial Balance shows a pencil icon next to each account name that opens a Classification + Account Type popover. (Largely superseded one PR later by #87, which replaced the heuristic entirely.)

### Changes Made
- Expanded bank-name list in `inferClassification`.
- `PATCH /api/accounts/[accountId]` accepts classification edits.
- Pencil reclassify button + popover on each Trial Balance row.

### User Impact
Historical mis-classifications can be fixed without leaving the page.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #84] - Master GL: inline master-account picker on unmapped accounts table - 2026-05-14

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds a "Map to Master GL" column with a searchable dropdown on every row of the per-entity unmapped table in Settings → Master GL. Picking a master immediately POSTs `/api/master-accounts/mappings`, refreshes the mapping list and the unmapped table, and shows a toast. (Originally classification-filtered; PR #88 removed the filter shortly after.)

### Changes Made
- Inline master picker column on each unmapped row.
- Toast confirms the mapping; row leaves the unmapped table on success.

### User Impact
No more opening the master-account sheet just to map a single account.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #83] - Master GL: map multiple entity accounts in one click - 2026-05-14

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
The "Add Mapping" panel in Settings → Master GL previously let you pick one entity account per save and closed the popover after every click. Now you pick an entity once, toggle as many entity accounts as you want (the popover stays open, the search query is preserved, each click toggles selection), and the button rewrites to "Map N Accounts" and inserts all of them in parallel against `POST /api/master-accounts/mappings`. Successes and failures are tallied separately, so an already-mapped duplicate doesn't kill the rest of the batch. `AccountCombobox` gained an opt-in `multiple` mode (`values: string[]` / `onValuesChange`); the other 11 call sites stay single-select.

### Changes Made
- `AccountCombobox` opt-in `multiple` mode.
- Batch insert against `/api/master-accounts/mappings` with per-row success/failure reporting.

### User Impact
Mapping a long list of entity accounts to one master is now a single workflow.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #82] - tb-unmatched: back-fill new mapping across all prior months - 2026-05-14

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
When you resolve a single unmatched QBO trial-balance row — either by creating a new account or by mapping it to an existing one — the system now finds every other unresolved row in the same entity for the same QBO account (matched first by `qbo_account_id`, falling back to `qbo_account_name` when the row has no QBO id) and posts/upserts a `gl_balances` record for each of those periods, then marks them resolved. Directly addresses the deleted-QBO-account case (e.g. "Money Market at Manufacturers - x9814 (deleted)"). Sibling rows live in other periods, so no double-processing. Toast reports how many additional months were back-filled.

### Changes Made
- Single-resolve flow back-fills siblings across all other periods.
- Toast surfaces the back-fill count.

### User Impact
You only have to resolve a QBO account once in any month — every other month with that QBO account name lights up automatically.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #81] - Trial balance: extend year selector back to 2017 - 2026-05-14

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Replaces the hard-coded 4-year window (`year-2`, `year-1`, `year`, `year+1`) on the per-entity Trial Balance page with a dynamic range from 2017 through `currentPeriod.year + 1`, matching the range already supported on Pro Forma, Allocations, Financial Model, Master GL, and QBO Sync (PRs #75–#79).

### Changes Made
- Trial Balance year dropdown now lists 2017 → next year.

### User Impact
Backfilled historical TBs are reachable.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #80] - Pro forma: multi-month entry with shared description - 2026-05-14

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
The Pro Forma "Add Adjustment" dialog now lets you enter multiple (month, year, amount) rows that share one entity, master account, offset account, description, and notes. "Add month" appends a new row (auto-advancing to the next month); the trash icon removes a row (last row locked). Each row is inserted as its own `pro_forma_adjustments` record, so the bridge engine, filtering, and exclude/edit/delete flows are unchanged. The edit dialog stays single-row; duplicate (year, month) entries in one submission are rejected client-side. Save button label updates to "Add N Adjustments" when more than one row is entered.

### Changes Made
- Multi-row entry in the Pro Forma "Add Adjustment" dialog.
- Each row inserted independently as a `pro_forma_adjustments` record.

### User Impact
Adding the same recurring adjustment across many months no longer requires re-opening the dialog per month.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #79] - Pro forma + allocation: extend year selectors back to 2017 - 2026-05-14

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Extends the year dropdown in the Pro Forma Adjustments dialog and the Allocation Adjustments dialog from 2023–2028 to 2017–2028, matching the range already supported by `config-toolbar.tsx`, the Financial Model From/To selector, Master GL, and QBO Sync (PRs #75, #76, #77).

### Changes Made
- Year dropdowns on both adjustment dialogs now span 2017–2028.

### User Impact
Pro forma and allocation adjustments can be entered against any year back to 2017.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #78] - Allocations: per-month bulk-create mode - 2026-05-13

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds a third Schedule option to the allocation dialog: **Per-Month Entries (separate row per month)**. The user picks Start month/year, End month/year, one amount and one description; submit inserts N independent `single_month` rows (one per month in the range). Each row stays individually editable/deletable afterwards — distinct from the existing Repeating flag (a single logical row). UI-only change; no schema migration. The option is hidden when editing an existing allocation.

### Changes Made
- New "Per-Month Entries" schedule option in the allocation dialog.
- Inserts N independent `single_month` rows on submit.

### User Impact
Bulk-creates an allocation across N months while preserving per-month edit/delete.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #77] - Master GL: extend year selectors back to 2017 - 2026-05-13

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Replaces three hardcoded year arrays in the Master GL settings UI with a generated range from 2017 through next year (newest first): the `master-gl/page.tsx` totals year dropdown, the unmapped-accounts year dropdown, and the `master-gl/consolidated/page.tsx` period year dropdown.

### Changes Made
- Three year dropdowns in Master GL pages now list 2017 → next year.

### User Impact
Master GL views work back to 2017.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #76] - Financial model: extend year selector back to 2017 - 2026-05-13

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Extends the hardcoded `YEARS` array in `ConfigToolbar` from `[2023..2028]` to `[2017..2028]` so the From/To year dropdowns on the Financial Model and per-entity financial statements pages can target backfilled historical periods.

### Changes Made
- `YEARS` array widened in `ConfigToolbar`.

### User Impact
Reporting users can render historical statements from 2017 onward.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #75] - Sync: extend QBO sync year selector back to 2017 - 2026-05-13

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Replaces the hardcoded 4-year array in both the batch sync and full-year sync dropdowns on `/sync` with a generated range from 2017 through next year (newest first). No backend changes needed — `/api/qbo/sync` and `/api/qbo/sync-year` already accept any year; the prior 2-years-back floor was UI-only.

### Changes Made
- `/sync` year dropdowns now list 2017 → next year.

### User Impact
QBO syncs can be triggered for historical years back to 2017 (subject to each QBO subscription's data availability).

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #72] - Bridge: GL account mapping diff panel - 2026-05-05

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds a collapsible **GL account mapping diff** section under the bridge schedule. For every QBO GL account mapped on either chart, shows the line it feeds on each chart side-by-side, defaulting to showing only **Different** (mismatched) rows. Filter by status / entity / line / free-text search. The bridge schedule answers "how much does each line differ?" — this panel answers "which GL accounts are categorized differently between the two charts?".

### Changes Made
- New collapsible diff panel below the Bridge schedule.
- Filters for status, entity, line, and free text.
- Reporting Entity scope is honored.

### User Impact
Accountants and controllers can pinpoint individual GL accounts driving cross-chart differences.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/changelog

---

## [PR #71] - Retrigger Vercel production deploy - 2026-05-05

**Author:** jdbusfield
**Type:** Refactor
**Related Issues:** N/A

### Summary
PR #70's squash merge fired a Preview build but no Production deploy. Empty commit to retrigger main → Production so the reporting-entity-scope bridge ships.

### Changes Made
- Empty commit to retrigger Vercel.

### User Impact
None — internal CI/CD action.

### Migration Notes
No user-facing documentation changes required.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #70] - Bridge: support reporting-entity scope - 2026-05-05

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
The Bridge tab now appears at both consolidated and reporting-entity scopes (was org-only). Reporting-entity scope is what accountant-prepared statements actually cover (e.g., Avon Combined = AVON + NCNT + 2F), so this is where the bridge has signal. `BridgeRequest.reportingEntityId` flows through to both chart fetches via the underlying FS API.

### Changes Made
- Bridge tab visible at consolidated + reporting-entity scopes.
- `BridgeRequest.reportingEntityId` plumbed through both chart fetches.
- XLSX export covers reporting-entity data when set.

### User Impact
The bridge is usable for the entity grouping accountants actually report.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/changelog

---

## [PR #69] - Bridge view between accountant and management financial statements - 2026-05-05

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Introduces the complete bridge view between accountant-prepared and company-prepared financial statements. All five phases land in this PR:

- **Phase 1 — Core schedule**: Bridge tab in `/reports/financial-model` (consolidated org scope). Seven named categories (Pro Forma, Allocations, Year-End, IC Eliminations, NI Presentation, Mapping residual, Tie check). Both directions (Accountant → Company, Company → Accountant). BS + P&L, single-period or multi-period. Side-by-side from/to statements below the schedule. Heuristic line linker (group + name similarity + account-number prefix) with unmatched lines surfaced inline.
- **Phase 2 — Drill-down**: Every bridge row expands to Tier 2 (master account, with chart-side badge from/to/both and per-master adjustment deltas) and Tier 3 (entity-level GL accounts that map to the master, lazy-fetched via `/api/financial-statements/bridge/tier3`).
- **Phase 4 — Exports**: XLSX (`/api/financial-statements/bridge/export` produces a "Bridge" range-total sheet and a "By Period" sheet with grouping, totals, IC line highlighting). Print button + `.stmt-bridge-print` named-page CSS that flips to landscape letter so the 10-column schedule fits.
- **Phase 5 — Explicit cross-chart links**: New `master_account_bridge_links` table (org-scoped, RLS-enforced). `/api/master-charts/bridge-links` GET/POST/DELETE. New settings page `/settings/master-gl/bridge-links` for pairing accountant masters ↔ management masters. The engine prefers explicit links; the heuristic fills the gaps. "Links" button on the bridge tab navigates to the settings page.

### Changes Made
- Bridge tab + schedule + tier 2 / tier 3 drilldown.
- XLSX export + print CSS.
- `master_account_bridge_links` schema + API + settings UI.

### User Impact
Accountants can finally explain the difference between the externally-prepared statements and the management statements down to a specific GL account.

### Migration Notes
Run `supabase/migrations/20260505_master_account_bridge_links.sql`. The bridge works without it (heuristic only); explicit links require the table.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/usage-guide
- /settings/wiki/changelog

---

## [PR #68] - Financial model: cap account-name column on accountant chart - 2026-05-05

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
The first column of the financial-statement table was sized to its longest label, which on the accountant chart can dominate the page. This PR caps it at 240px on the accountant chart and lets long names wrap. Threaded a `compactLabels` prop through `StatementCard` → `StatementTable`; the financial-model page passes it as `true` only when the accountant chart is selected. Management chart and other consumers are unchanged.

### Changes Made
- New `compactLabels` prop on `StatementCard`/`StatementTable`.
- Financial Model passes the flag when the accountant chart is selected.

### User Impact
Accountant-chart statements no longer get pushed off the page by long master-account names.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #67] - Year-end adjustments: optional entity_id for per-entity NI attribution - 2026-05-05

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds an optional `entity_id` on year-end adjustments so a P&L adjustment can be tagged to a specific entity. Tagged adjustments flow into that entity's accumulated-deficit / member's-equity rollup on the accountant balance sheet. Untagged adjustments still fall back to the existing largest-|NI| heuristic from PR #65. Closes the loop on the $34,079 IC residual adjustment that PR #66 surfaced landing on the wrong entity — tagging it to NCNT lands the $34k on NCNT's equity line.

### Changes Made
- Migration `20260505_year_adj_entity_id.sql` adds nullable `entity_id` (FK to entities, ON DELETE SET NULL, indexed) on `master_account_year_adjustments`.
- `/api/master-accounts/year-adjustments` GET returns `entity_id`; POST accepts `entityId`.
- Master GL mapping side-sheet exposes an entity dropdown on the adjustment form and an entity code badge in the list.
- `/api/financial-statements` runs `applyEntityTaggedYearAdjustments` between `computePerEntityNI` and `reconcileEntityNIToTotal`.

### User Impact
Year-end adjustments can be precisely attributed to the right entity's equity rollup.

### Migration Notes
Run `supabase/migrations/20260505_year_adj_entity_id.sql` **before** deploying — the route's `select(... entity_id)` will 500 otherwise.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/changelog

---

## [PR #66] - Fix per-entity NI to include IC contributions on accountant chart - 2026-05-05

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
The IC-elimination block at the end of `buildConsolidatedStatements` mutates `consolidatedAccounts` (removes IC-flagged Revenue/Expense masters) **before** `computePerEntityNI` runs. The previous code iterated that mutated list when summing per-entity P&L, silently dropping each entity's standalone IC revenue/expense from its allocated NI. The total still tied (IC nets to zero across entities), but per-entity NI shifted — Two Family +$456k, Silverco +$1.86M, NCNT -$2.32M. Fixed by iterating the original `masterAccounts` parameter (never mutated) for the per-entity P&L sum.

### Changes Made
- `computePerEntityNI` reads from the unmutated `masterAccounts` parameter.

### User Impact
Per-entity equity rollups on the accountant chart now reflect each entity's true standalone NI. Management chart unaffected.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #65] - Distribute net income to per-entity equity rollups on accountant chart - 2026-05-04

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
When the accountant-chart equity section is structured by entity (e.g. "Accumulated deficit - Two Family", "Member's deficit - Silverco", "Member's equity - NCNT"), allocate each entity's YTD net income directly into that entity's rollup line instead of surfacing a standalone "Net Income" row. Matches the combined-presentation balance sheet layout external accountants use. Routing auto-detects from the existing chart structure — an Equity rollup parent qualifies as an NI absorber when (a) descendants map to exactly one entity and (b) its name matches deficit/retained/earnings/member's equity (excluding common stock / paid-in / distributions). No schema change. Per-entity NI is computed from raw GL P&L balances per entity; any residual is attributed to the entity carrying the largest |NI| so the BS still balances. A one-shot migration (`scripts/setup-per-entity-equity.mjs`, already applied to prod) moved existing AVON/NCNT equity mappings off Two-Family-parented leaves into entity-specific leaves.

### Changes Made
- `buildConsolidatedStatements` distributes per-entity NI into matching equity rollup leaves on the accountant chart.
- Heuristic to identify entity-scoped equity rollup leaves.
- Management-chart path unchanged.

### User Impact
Accountant-chart balance sheets match the combined presentation used in externally-prepared statements.

### Migration Notes
The one-shot script `scripts/setup-per-entity-equity.mjs` has already been applied to production.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/changelog

---

## [PR #64] - Financial model: suppress IC eliminations net line when residual is effectively zero - 2026-05-04

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
Bumps the P&L IC line display threshold from $0.005 to $0.50 (matching the BS side) so a balanced IC offset adjustment doesn't leave a sub-dollar residual line on the Financial Model.

### Changes Made
- P&L IC display threshold raised to $0.50.

### User Impact
Cleaner statements when IC eliminations balance exactly.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #63] - Fix: IC-offset year adjustment doubled residual instead of zeroing it - 2026-05-04

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
On the accountant chart for 2025, a year-end adjustment of -$34,079 on Vehicle Operating Costs with the **Apply to Intercompany Eliminations, Net** toggle from PR #61 enabled was doubling the IC residual instead of canceling it. The virtual IC offset account was being given the same sign as the source. Fixed by applying the offset to the virtual IC account with the **opposite sign**, matching the balanced-JE convention used by `pro_forma_adjustments.offset_master_account_id`: source `+amount`, virtual IC `-amount`, so IC residual + offset = $0. Help text on the toggle updated.

### Changes Made
- Virtual IC offset account now receives `-amount` while the source receives `+amount`.
- Toggle help text updated to describe the balanced-JE behavior.

### User Impact
The IC offset toggle now zeroes the residual as intended.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #62] - Master GL: accountant chart defaults to By Rollup view - 2026-05-04

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Accountant charts now open in **By Rollup** view by default, since their structure is built around parent rollups. Management charts still default to **By Classification**. The toggle still works — the default just re-applies when switching charts.

### Changes Made
- Default view on Master GL switches based on the active chart.
- Manual toggle within a chart is respected until the next chart switch.

### User Impact
The default view matches how each chart is actually used.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #61] - Year-end adjustments: apply to IC eliminations net toggle - 2026-05-04

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
New `offset_to_ic_net` flag on year-end adjustments. When on, the same amount is injected into the synthetic "Intercompany Eliminations, Net" line on the Financial Model so a single entry zeros out both the source IC account and the residual. Implemented by adding a virtual IC-flagged account that the existing IC elimination block folds into the synthetic — no special-casing of the IC line itself. (See PR #63 for the sign-direction follow-up fix.)

### Changes Made
- Migration `20260504_year_adj_ic_offset.sql` adds `offset_to_ic_net boolean default false` to `master_account_year_adjustments`.
- Switch in the Year-End Adjustment section of the Master GL mapping side sheet.
- "IC offset" badge on each adjustment in the list.

### User Impact
A single year-end entry can reconcile both the source account and the IC residual line.

### Migration Notes
Run `supabase/migrations/20260504_year_adj_ic_offset.sql`.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #60] - Master GL: chart-scoped year-end adjustments - 2026-05-04

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds chart-scoped year-end adjustments so the accountant view can be reconciled to externally prepared statements (e.g., $34k IC residual) without touching entity-level GL or the existing IC elimination logic. A new table `master_account_year_adjustments` keyed by `(chart_id, master_account_id, period_year)` exists only on the chart you set it on, so the management chart and the Financial Model in management mode are unaffected. One-time yearly entry treated as a Dec 31 journal entry: for Asset/Liability/Equity it carries forward into subsequent periods (cumulative ending balance); for Revenue/Expense it stays within the year of impact. Applied in `/api/master-accounts/consolidated` (Master GL Consolidated View) and `/api/financial-statements` (reuses `applyProFormaPostAggregation`). New Year-End Adjustment section in the Master GL mapping side sheet; affected rows show a small `adj` badge in Master GL settings and on the Consolidated View.

### Changes Made
- Migration `20260504_master_account_year_adjustments.sql` adds the table + RLS.
- Year-end adjustments applied in Consolidated View and Financial Model routes.
- UI on Master GL mapping side sheet + `adj` badges.

### User Impact
Accountant-chart presentation can be trued up to externally-prepared statements without touching journals.

### Migration Notes
Run `supabase/migrations/20260504_master_account_year_adjustments.sql`.

### Wiki Pages Updated
- /settings/wiki/features
- /settings/wiki/usage-guide
- /settings/wiki/core-concepts
- /settings/wiki/changelog

---

## [PR #59] - Master GL: Total column and per-mapping year-end balances - 2026-05-04

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds a year selector (default 2025) on the Master GL settings page and a new **Total ({year})** column on each classification table. Each row sums the Dec-31 GL balances of its mapped entity accounts; rollup parents sum their children. Clicking into a mapped account shows each linked entity account's balance as of `{year}-12-31` instead of `current_balance`. Works for both management and accountant charts (chartId passed through). Reuses `/api/master-accounts/consolidated?periodYear={year}&periodMonth=12` — no new endpoint required.

### Changes Made
- Year selector + Total column on Master GL settings.
- Side sheet shows year-end balances per linked entity account.

### User Impact
Operators can see year-end totals and per-mapping balances directly on the Master GL settings page.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #58] - Rebate tracker: monthly rebate-by-customer view for GL posting - 2026-05-04

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Adds a Monthly Rebates table to the Rebate Tracker so rebates can be posted to the GL by month. Customer × Jan–Dec grid with row/column totals, scoped to the year selected via the existing quarter picker. New CSV export. New `get_monthly_rebates` API action — aggregates `net_rebate` from `rebate_invoices` by `billing_end_date` month per customer; skips manually-excluded invoices.

### Changes Made
- Monthly Rebates table between summary cards and Commercial Agreements.
- CSV export.
- New `get_monthly_rebates` API action.

### User Impact
Accountants can now produce per-month rebate accruals for GL posting from the Rebate Tracker.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/usage-guide
- /settings/wiki/features
- /settings/wiki/changelog

---

## [PR #57] - Rebate line items: Regular = list price, Net = post-discount - 2026-05-01

**Author:** jdbusfield
**Type:** Bug Fix
**Related Issues:** N/A

### Summary
The per-line **Regular** column was reading `inv.extended`, which is RentalWorks' **post-discount** line total. So `Net = Regular − Discount` double-applied the discount, and 100%-discount lines (Extended = $0) went negative. Fixed at all four sites that render line items (on-page drill-down, Excel export per-invoice tab, PDF export per-invoice page, and the standalone `scripts/generate-q1-rebate-pdfs.mjs`): `net = extended`, `regular = net + discount`, `discPct = discount / regular`. Category subtotals also corrected: Regular sums `extended + discount_amount`, Net sums `extended`. For V300796 SIDEWALL this changed Regular $1,319 → $1,656 and Net $982 → $1,319 (matching the source invoice); for 100%-discount M6 MIFI lines, Net is now $0 instead of −$1,320.

### Changes Made
- Fixed `regular`/`net`/`discPct` derivation across drill-down, Excel, PDF, and the standalone script.
- Corrected category subtotal aggregation.

### User Impact
Rebate detail views and exports now reconcile to source RentalWorks invoices exactly. 100%-discount lines no longer show negative Net.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [PR #56] - Rebate detail: flag Sales / Misc categories as excluded from rebate - 2026-05-01

**Author:** jdbusfield
**Type:** Feature
**Related Issues:** N/A

### Summary
Sales and Misc line items are non-rebatable per the WSM agreement (and the calc already removes them via the back-calculated `taxableSales`), but the drill-down UI didn't surface that — only L&D was visibly flagged. This makes the UX consistent: every non-rental category is clearly marked. New helpers `isNonRebatableRecordType` and `getExclusionBadgeLabel` keep all four exclusion-check sites in sync. Each non-rental category (Sales / Misc / Loss & Damage) gets an "Excluded from rebate" badge in its header; per-line rows highlight red with category-specific status badges (F/L → "Loss & Damage", S → "Sales — excluded", M → "Misc — excluded", I-Code excluded → "Excluded"). Excel + PDF exports' status column and category header reflect the same labels. Pure UI/labeling — no calc change.

### Changes Made
- Added `isNonRebatableRecordType` and `getExclusionBadgeLabel` helpers.
- Sales / Misc / L&D categories show "Excluded from rebate" badge + per-row status badges.
- Excel and PDF exports show the same labels.

### User Impact
Non-rental categories are clearly marked across detail views and exports, matching the actual calc.

### Migration Notes
None.

### Wiki Pages Updated
- /settings/wiki/changelog

---

## [Wiki Bootstrap] - Wiki section added under Organization Settings - 2026-05-01

**Author:** closebook-wiki-maintainer agent
**Type:** Documentation
**Related Issues:** N/A

### Summary
Created the initial Closebook wiki and wired it into the application as a
section under *Organization Settings*. The wiki is filesystem-backed
(Markdown files under `docs/wiki/`) and is rendered server-side by a small
dependency-free Markdown renderer. Existing long-form docs (the Accounting
Manager Onboarding Packet) are now surfaced through the wiki instead of
being orphaned in `docs/`.

### Changes Made
- Added `docs/wiki/` with seed pages: Overview, Getting Started, Core
  Concepts, Usage Guide, Features, Configuration, Architecture,
  Troubleshooting, and this Changelog.
- Added `src/lib/wiki/loader.ts` — reads markdown files with YAML
  frontmatter and produces a sorted, sectioned index.
- Added `src/lib/wiki/markdown.tsx` — minimal Markdown -> JSX renderer
  (no new npm dependency).
- Added `src/app/(app)/settings/wiki/page.tsx` — wiki landing page.
- Added `src/app/(app)/settings/wiki/[slug]/page.tsx` — individual wiki
  page renderer.
- Surfaced `docs/accounting-manager-onboarding-packet.md` through the wiki
  loader.
- Added a "Wiki" link to the Administration group in
  `src/components/layout/nav-config.ts`.

### User Impact
Anyone with access to Organization Settings can now read and link to the
Closebook wiki at `/settings/wiki`. Future PRs that change user-facing
behavior will append a changelog entry here so the history is auditable.

### Migration Notes
None. No database changes. No new environment variables.

### Wiki Pages Updated
- /settings/wiki
- /settings/wiki/getting-started
- /settings/wiki/core-concepts
- /settings/wiki/usage-guide
- /settings/wiki/features
- /settings/wiki/configuration
- /settings/wiki/architecture
- /settings/wiki/troubleshooting
- /settings/wiki/changelog
- /settings/wiki/accounting-manager-onboarding-packet

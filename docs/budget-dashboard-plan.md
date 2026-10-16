# Budget dashboard in CloseBook

JD, Oct 16 2026: the FY 2027 budget is edited in CloseBook from now on. The edited master list
workbook (`2027 Budget Master List (2026 detail).xlsx`, OneDrive Avon HQ) seeds it once, then every
budget item carries a **class**, **location** and **function**, and a dashboard in CloseBook shows the
P&L by function with drill-down to the item. The standalone dashboard artifact
(claude.ai/artifact/LdP2NbHg8gF6sZqtfZgYyt) is the design to match.

## Decisions (JD)
- CloseBook is the source of truth; the workbook becomes an export.
- Functions: **Sales, Fleet, Operations, Overhead** everywhere. Payroll's Executive and Administrative
  become Overhead; Fleet & Maintenance becomes Fleet.
- Location = operating location (Saticoy, Cahuenga, Southeast, Overhead, more if JD adds them); each
  site (Peoria, Santa Monica, Valhalla, Santa Clarita, Winona, Washington Blvd, airport) maps to one.
- Class = QBO class (unchanged).
- Per-vehicle fleet model (DMV registration, Fleetio maintenance) moves in as phase 2.

## How tags resolve (first match wins)
1. The item's own tags (typed and method items: columns on `budget_builds`).
2. Payroll: each person's tags in the payroll plan (`budget_headcount`), split by their percentages.
3. A source rule (`budget_tag_rules` with `source_table` + `source_id`): a lease, a debt instrument,
   an insurance policy, a run-rate line.
4. An account rule (`budget_tag_rules` with `master_account_id`), falling back to the parent account.
5. Nothing: the amount shows as **Unassigned** so it can be tagged.

Rules can be scoped to one reporting group or apply to the whole organization. Computed builds are
regenerated on every recompute, so their tags live on the source or in a rule, never on the build.
Tags are resolved when the model is read, so a rule change shows immediately without a recompute.

## Phase 1
- [x] 1. Data model: migration (build tag columns, `budget_tag_rules`, payroll functions to the four),
      resolver (`item-tags.ts`) with tests, model items carry their function / location split,
      rules API, builds API takes tags.
- [x] 2. Model page: Class / Location / Function on every item; edit an item's tags, a source's rule,
      or an account default.
- [x] 3. Seed from the workbook into the FY 2027 versions (backed up first): amounts that differ, typed
      items for the fleet lines, tags for every item, rent splits as lease rules. Diff report before
      and after.
      Done Oct 16: 3-way compare (original export / edited copy / CloseBook) kept CloseBook's revenue and rent
      (edited after the export), took 9 Avon items from the workbook, tagged 97 items and added 89 source rules.
      Backup: budget_builds_backup_20261016 (RLS on).
- [ ] 4. Dashboard page `/budget/dashboard/[year]`: Overview, Master P&L by function with drill to the
      item, Cost by function, Rent by location; company switch, full year vs 2026 pace or Jan–Aug,
      $M / $K / $. 2026 actuals from the Financial Model.

## Phase 2
- [ ] Fleet: registration per vehicle (DMV bills, card samples, comparables) and maintenance per vehicle
      (Fleetio history scaled to the GL) as driver builds, plus the Fleet page.

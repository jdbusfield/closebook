# Rental Asset Dashboard — First-Pass Data Analysis

_Date: 2026-04-22 · Inputs: `Jan 2026 utilization data.xlsx` + Fleetio account 131153_

## 1. Headline results

| Metric | Value |
|---|---|
| Spreadsheet rows (Jan 2026) | **451** |
| Fleetio vehicles in account | **663** |
| Auto-matched rows | **440 / 451** (97.6%) |
| Matched via license plate | 413 |
| Matched via name/unit number | 27 |
| **Unmatched spreadsheet rows** | **11** |
| Fleetio vehicles NOT in the January utilization report | **223** |

Raw outputs: `scripts/match-report.csv`, `scripts/match-report.json`.
Re-run any time with `node scripts/match-fleetio-to-utilization.mjs`.

## 2. Column map — `Jan 2026 utilization data.xlsx`, sheet "JAN 2026 (2)"

| Col | Field | What it is | Use |
|---|---|---|---|
| A | `Veh_number` | NCNT asset tag (e.g., `814164`) or equipment tag (e.g., `KSCF01`) | **Primary link to `fixed_assets.asset_tag`** |
| B | `License_no` | License plate (e.g., `41785X2`) | Secondary link — matches Fleetio 91% of the time |
| C | `Status` | DBR status letter (O, A, X, P, I, N, D, F, S, E, B) — see §6 | Info only; Fleetio has its own richer status |
| D | `Year` | 2-digit year | |
| E | `Class` | Vehicle class code — matches `VEHICLE_CLASSIFICATIONS` except for `EQU` | Drives reporting group via `getReportingGroup()` |
| F | `Model` | | |
| G | `Purch_date` | | |
| H | `Sale_date` | Non-null if sold during the period; **Fleet_days is already reduced** for sold vehicles | |
| I | `Fleet_days` | **Denominator**: days the vehicle was in the fleet during the period | |
| J | `Rental_DBR_days` | **Numerator (user-specified)**: rental days on the DBR (Daily Business Report) | `utilization_dbr_pct = J / I × 100` |
| K | `Rental_act_days` | Actual physical rental days | `utilization_act_pct = K / I × 100` |
| L | `Total_rev` | **Revenue for dollar utilization (user-specified)** | Aggregated directly; dollar util can be computed per asset |
| M | `Avg_rev` | Avg revenue per rental day | |
| N | `Chg_rate` | Charged rate | |
| O | `Std_rate` | Standard (benchmark) rate | |
| P | `Chg_loc` | Charge location indicator | |
| Q | `DBR_util` | DBR utilization % (pre-computed = J/I × 100) | Import and reconcile against our computation |
| R | `Act_util` | Actual utilization % (= K/I × 100) | |
| S | `Rev_util` | Revenue utilization % (= M/O × 100) — **dollar utilization** | |
| T | `Subrental` | Subrental flag | |

**Formulas confirmed against row 814164:** J/I = 21.18/31 = 68.3% matches Q=68. K/I matches R. M/O matches S.

## 3. The 11 unmatched spreadsheet rows

These are NOT failures — most are equipment pool rows, not individual vehicles:

| Veh_number | Plate | Year | Class | Model | Analysis |
|---|---|---|---|---|---|
| `KSCF01` | 61614TRL | 2002 | EQU | SND TRLR | Sound trailer pool — equipment, not a tracked vehicle |
| `KSCF02` | 2267FTJ | 2089(?) | EQU | TRNSTRLR | Transit trailer pool |
| `KSCF03` | 330WSF | 2019 | 32 | SPRINTER | A real Sprinter van; Fleetio has several HT-series Sprinters but none with this plate. Worth manual review. |
| `KSCF04` | 88917W3 | 2023 | 17 | F-150 | A real F-150. Probably in Fleetio under a different name — manual review. |
| `KSCF05..08` | NA | 2025 | EQU | EQUIP | Generic equipment pool rows |
| `BATH` | NA | 2025 | BATH | BATH | Bathroom trailer equipment pool |
| `EQU` | NA | 2025 | EQU | EQUIP | Generic equipment pool row |
| `PML006` | 9GBL332 | 2023 | 6 | GLE | Mercedes-Benz GLE, sold 2026-01-05. **Not in Fleetio** — sold 5 days into the month, likely never onboarded. |

**Recommendation:** Treat `KSCF`, `BATH`, `EQU`, and any `Class = EQU` rows as **pool aggregates**, not linked vehicles. Import their revenue into the KPI table as an `'equipment_pool'` grain row rather than matching them to `fixed_assets`. Flag `KSCF03` and `KSCF04` for manual mapping — they are real vehicles with weird labels.

## 4. The 223 Fleetio vehicles NOT in the January utilization report

This is the critical finding for the rental-vs-service split. Segmented:

| Fleetio status | Count | Interpretation |
|---|---|---|
| **Available** | 173 | Active in Fleetio but not on the DBR. A mix of: HSS subsidiary fleet (91), service/shop vehicles, and newer additions. |
| **Non-Fleet Asset** | 26 | **Explicitly service items** — Shop locations, Generators, Pressure Washers, Vehicle Movement tool, etc. These clearly don't belong in rental utilization. |
| **For Sale** | 22 | Being phased out — should not count toward available fleet for utilization denominator. |
| Sold | 2 | Already disposed |
| Planned Non-Op | 1 | |

Segmented by vehicle type (Fleetio's class codes):

| Fleetio type | Count | Likely classification |
|---|---|---|
| **4BR** | 70 | Four-bedroom/bath trailer — most likely specialty/service equipment |
| **Truck** (generic) | 18 | Mostly Ford F-550s with no plate — likely service/shop |
| **7, 23, 20, 28** (numeric classes) | 44 | Real rental-class vehicles — need review; some may be HSS fleet |
| **Generator, Shop, Pressure Washer** | 28 | **Definitively service** |
| **Trailer - Bathroom/Wardrobe/Makeup** | 13 | Specialty trailers (possibly rental, possibly service) |
| **HSST, P** | 10 | HSS-specific |
| Other numeric classes | remainder | |

Segmented by group:

| Group | Count | Interpretation |
|---|---|---|
| **HSS** | 91 | Hollywood Site Services — a separate business unit. Do they appear on a different DBR report? |
| `-` (no group) | 56 | Ungrouped |
| Location | 38 | |
| Avon | 30 | Avon main fleet items that didn't make the Jan DBR |
| Avon Trailer | 5 | |

**Key takeaway**: Only **7 of the 224** Fleetio-only vehicles were created after 2026-02-01, so the mismatch is not "new vehicles added after January". The 217 others are a real operational subset not on the rental utilization report.

**This is good news**: using the DBR spreadsheet as the "is this vehicle in rental utilization scope this period?" signal is cleaner than trying to classify from Fleetio alone. A vehicle appears on the DBR ⇒ it's in the rental-category scope for that period.

## 5. Linking architecture (refined)

```
  Jan 2026 DBR spreadsheet            Fixed Assets register           Fleetio
  ─────────────────────────           ──────────────────────         ───────
  Veh_number (e.g., 814164) ─────────> asset_tag                     
  License_no (41785X2)      ─────────> license_plate ─────(match)───> license_plate
                                       vin           ─────(match)───> vin (VIN is the gold standard)
                                       fleetio_vehicle_id ◄─────────── id (cached after first link)
```

**Match rules for bulk linking:**

1. **Spreadsheet → `fixed_assets`**: exact match on `Veh_number → asset_tag` within the user's organization. Expected: 100% hit rate since the register is already seeded from NCNT/tax data.
2. **`fixed_assets` → Fleetio**: strict VIN match only (no tag match — tags have collided across entities). Expected: ~90% auto-link.
3. **Residual unlinked**: `fixed_assets` without a matching Fleetio VIN → shown in "Unlinked assets" panel, user resolves manually (create in Fleetio, link to an existing Fleetio row, or mark as ignore).

For the 11 spreadsheet rows without a direct Fleetio match, the right fix is upstream:
- Equipment pool rows → create an `equipment_pool` grain in `rental_asset_kpis` so we don't need to link them.
- `PML006` → if it existed briefly, it belongs in `fixed_assets` with `disposed_date = 2026-01-05` and no Fleetio link.
- `KSCF03`, `KSCF04` → manual identification: ask user for the Fleetio name.

## 6. Status-code decoder (proposed — user to confirm)

DBR spreadsheet status column:

| Code | Count | Proposed meaning |
|---|---|---|
| O | 204 | **On rent** (or "Out" to customer) |
| A | 152 | **Available** |
| X | 36 | Unknown — possibly "eXchange" or "cross-rented" |
| P | 28 | **Prep** (preparation for rent) |
| I | 6 | **In shop** (maintenance) |
| N | 6 | **Non-rentable** |
| D | 5 | **Disposed** (not the same as Sold) |
| F | 5 | **Flagged / For-review** |
| S | 5 | **Sold** (matches 10 rows with non-null Sale_date — 5 of those have status S; the other 5 have different statuses) |
| E | 3 | **End-of-life** (Expired?) |
| B | 1 | Unknown |

**Action**: ask user for the authoritative meaning before we do anything more specific with status than "store and display".

## 7. Rental-vs-service: recommended rule

Given that the DBR report already excludes service vehicles, the cleanest classification rule is:

> A vehicle is **`rental_category='rental'`** for a period ⇔ it appears on that period's utilization spreadsheet with `Class ≠ 'EQU'` and `Veh_number` is numeric.

In other words, **the spreadsheet is the source of truth for rental classification**. Vehicles in Fleetio or `fixed_assets` that are never on any DBR report are either service (shop, generator, pressure washer), non-fleet assets, or subsidiary (HSS) fleet — and all three are out of scope for this dashboard.

Implementation:
1. Tag every `fixed_assets` row as `rental_category='rental'` if it has appeared on at least one DBR period since the start of our KPI history (default Jan 2020).
2. Tag as `rental_category='service'` otherwise.
3. Both can be manually overridden via a bulk-update in the Rental Asset Register Settings.
4. The dashboard filters to `rental_category='rental'` by default.

This is cleaner than trying to auto-classify by reporting group, and it matches the user's stated intent that the spreadsheet defines the rental fleet.

## 8. Formulas for the dashboard (locked in)

Per the user's instruction:

- **Days utilization (DBR)** = `sum(J) / sum(I)` across the selected scope (org / reporting entity / entity / reporting group)
- **Days utilization (actual)** = `sum(K) / sum(I)`
- **Revenue / dollar utilization** = `sum(L) / sum(O × I)` at the asset level, aggregated by group
- **Avg daily rental rate** = `sum(L) / sum(J)`
- **Net fleet change (MoM)** = `count(in_service_date ≤ eop AND disposed_date > eop) - count(prior month equivalent)`
- **Sold vehicles in period**: rows where `Sale_date is not null AND Sale_date in [start, end]`
- **Fleet days excluded from denominator**: `(days_in_month - Fleet_days)` represents out-of-fleet days due to sale or acquisition during the period

## 9. Recommended next actions

**Shippable next (Phase A — small, doesn't need Fleetio UI yet):**

1. Write migration `20260422_rental_asset_kpis.sql` with the `rental_asset_kpis` table and `fixed_assets.fleetio_vehicle_id` / `rental_category` columns.
2. Write a one-time backfill script `scripts/backfill-kpis-from-dbr.mjs` that ingests the spreadsheet (and any historical ones the user uploads) into `rental_asset_kpis` at the `asset` grain.
3. Scaffold `src/app/(app)/rental-assets/page.tsx` as a read-only dashboard driven by `rental_asset_kpis` + existing `fixed_assets`. Works without Fleetio.

**Phase B — Fleetio integration:**
4. Add `src/lib/fleetio/client.ts` (read-only wrapper).
5. Add `/api/fleetio/sync/vehicles` — pulls vehicles, auto-links by VIN, writes `fleetio_vehicle_id` on `fixed_assets`. **GET-only**, no writes to Fleetio.
6. Add `/api/fleetio/sync/maintenance` — pulls service entries, work orders, meter readings into `rental_asset_maintenance` / `rental_asset_meter_readings`.
7. Daily cron at `0 7 * * *` pulls `updated_at` deltas.

**Phase C — UX polish:**
8. KPI upload dialog (batch-upload years of historical data in one workbook).
9. Roll-forward table, composition panels, trend chart, KPI crosswalk panel, export dialog.
10. Settings → Integrations → Fleetio page (connection status + link-assist).

## 10. Open questions (pre-implementation)

1. **Confirm DBR status codes** (§6 table) so we can label them correctly in the UI.
2. **HSS scope**: are the 91 HSS vehicles in Fleetio a separate business we should NOT show in Avon's rental dashboard, or should they have their own tab?
3. **`Class = EQU`**: confirm these should be bucketed as `equipment_pool` grain (generic revenue lines) rather than individual assets.
4. **PML006** and any other spreadsheet rows missing from Fleetio: should we create these in Fleetio manually (via Fleetio UI — not automation — per your directive to not write), or keep them only in our register?
5. **Historical KPI data**: how far back does the DBR spreadsheet history go? Plan assumed 2020-present — confirm.

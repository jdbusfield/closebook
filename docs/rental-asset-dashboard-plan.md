# Organization-Level Rental Asset Dashboard — Implementation Plan

_Draft · 2026-04-22 · Author: Claude (for JD Busfield)_

---

## 1. Goal & User Story

> As a CEO / accounting manager for Avon Rents, I want a single organization-level Rental Asset dashboard that unifies three currently siloed data sources — the fixed-asset register (already in the app), operating KPIs that live in a monthly spreadsheet, and maintenance history from Fleetio — so I can see how fleet operating performance (utilization, maintenance spend, net fleet change) is driving any given month's financial performance across entities and reporting groups.

**Key asks derived from the conversation:**

1. Mirror the pattern already used for Debt at the entity level (scope selector, reporting groupings, roll-forward, drill-down, export) — but at the **organization level**, because the rental fleet is managed centrally across entities.
2. Pull **maintenance history from Fleetio** via their API (confirmed: they mean fleetio.com — see §4).
3. Ingest **KPI data via spreadsheet upload** because it does not exist in any API today.
4. Show **utilization by reporting group** with **month-over-month net change** driven by purchases (additions) vs sales (dispositions).
5. Serve as a **KPI dashboard that a manager/CEO can tap into** to cross-walk operating metrics against financial performance for the month.

---

## 2. Recommended Architecture (at a glance)

| Decision | Choice | Why |
|---|---|---|
| Page location | **NEW** `src/app/(app)/rental-assets/` — an org-level top-level page | Matches existing org-level pages (`close-dashboard`, `dashboard`, `reports`, `ic-eliminations`, `tb-variance`). Avoids adding yet another entity-level tab. |
| Data model for the asset itself | **Extend `fixed_assets`** with rental-specific columns, do NOT create a parallel `rental_assets` table | The same vehicle is both a fixed asset (cost basis, depreciation, reconciliation) AND a rental asset. Splitting would duplicate reality. The existing register in `[entityId]/assets/` already holds all rental asset info (NCNT-sourced, RentalWorks-reconciled). |
| Rental vs service split | Add `rental_category` column (`'rental' | 'service' | 'other'`) on `fixed_assets`. Dashboard filters to `'rental'` by default; a settings toggle opts-in service vehicles. | Per user: only trucks, trailers, container trailers count toward rentable revenue. Service vehicles (shop/delivery/admin) must be excluded by default so utilization math isn't diluted. |
| Reporting group | **Reuse existing vehicle classifications** (`VEHICLE_CLASSIFICATIONS` + `custom_vehicle_classes`) — `getReportingGroup(vehicle_class)` already returns Car / Cargo Van / Box Truck / Studio Box Truck / Stakebed / Passenger Van / Cast Trailer / Makeup Trailer | Already in production, already the user's vocabulary. |
| Cross-entity grouping | Offer **scope selector: Organization / Reporting Entity / Entity** (same pattern as existing entity-scoped pages, just inverted default) | The user already has `reporting_entities` for cross-entity aggregation; we surface it at org level. |
| Fleetio sync | **Webhooks as primary, polling sweep as backstop** | Fleetio supports 89 webhook event types. Rate limits are tight (~20 RPM). Webhooks avoid the rate-limit trap entirely, and a daily `updated_at`-filtered sweep catches anything missed (incl. GPS-sourced meter readings which don't fire webhooks — see §4). |
| Fleetio → asset linking | **Strict VIN match only** for automatic linking. Asset-tag or manual linking requires a user confirmation. Cache `fleetio_vehicle_id` on `fixed_assets`. | VIN is the only truly apples-to-apples identifier across Fleetio, the rental-asset register, NCNT, and the KPI spreadsheet. Tag-based matching has collided across entities before (per existing `051_unique_asset_tag` migration). |
| KPI ingestion | **Spreadsheet upload** with the same header-map pattern used by `api/assets/upload` and `api/debt/upload` | Zero new infrastructure; users already use this pattern. |
| Utilization source of truth | **RentalWorks contracts/invoices** (days on rent) as primary numerator; Fleetio meter deltas as a secondary "physical usage" signal | RentalWorks already integrates; rental days map directly to the KPI definition. Fleetio mileage is diagnostic, not revenue-tied. |
| KPI → GL crosswalk | Compute at render time in a pure util (`rental-kpi-crosswalk.ts`) that joins period KPIs to period financial statements | Keeps the DB clean; follows the existing pattern of pure utils (`debt-rollforward.ts`, `depreciation.ts`). |

---

## 3. Data Model

### 3.1 Extend `fixed_assets`

New migration: `supabase/migrations/20260422_rental_asset_fleetio_link.sql`

```sql
ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS fleetio_vehicle_id bigint,
  ADD COLUMN IF NOT EXISTS fleetio_group_name text,     -- cached for filtering
  ADD COLUMN IF NOT EXISTS fleetio_last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS rental_category text NOT NULL DEFAULT 'rental'
    CHECK (rental_category IN ('rental','service','other')),
  ADD COLUMN IF NOT EXISTS rental_category_source text DEFAULT 'auto'
    CHECK (rental_category_source IN ('auto','manual')),
  ADD COLUMN IF NOT EXISTS odometer_current int,        -- latest meter reading snapshot
  ADD COLUMN IF NOT EXISTS odometer_current_as_of date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fixed_assets_fleetio_vehicle
  ON fixed_assets(fleetio_vehicle_id) WHERE fleetio_vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fixed_assets_rental_cat
  ON fixed_assets(rental_category);

-- One-time classification of existing rows. The rule: anything that is a
-- truck, van, or trailer from the built-in rental reporting groups is
-- categorised 'rental'; Cars default to 'rental' too (most of Avon's Car
-- class are rental sedans/SUVs/minivans/pickups) but are flagged for user
-- review via rental_category_source='auto'. User can bulk-flip any asset
-- to 'service' from the register, and the override sticks because the
-- source flips to 'manual'.
UPDATE fixed_assets
SET rental_category = CASE
  WHEN vehicle_class IN (
    -- Trailers
    '1R','2R','3R','8MU',
    -- Cargo Vans
    '11','26','29','30','31','32','33','34',
    -- Passenger Vans
    '8','28','28P','28S',
    -- Box Trucks
    '13','13T','14','20','20T','22','24',
    -- Studio Box Trucks
    '2','9','27','40',
    -- Stakebeds
    '15','15I','15L','16','23','51','52',
    -- Cars (SUVs, sedans, premium, luxury, pickups, minivans)
    '3','4','5','6','7','12','17','18','21'
  ) THEN 'rental'
  ELSE 'rental'  -- default retained; user can flip
END,
  rental_category_source = 'auto'
WHERE rental_category_source IS NULL OR rental_category_source = 'auto';
```

*Rationale:* Per the user, only trucks, trailers, and container trailers are rental assets. Service vehicles (internal use — shop trucks, delivery, admin cars) must be excludable. `rental_category` is a three-valued enum rather than a boolean so we can distinguish "internal service fleet" from "non-fleet fixed assets" (e.g., a ledger adjustment). `rental_category_source='auto'` lets the Rental Asset Register UI surface "needs review" badges on auto-classified rows and preserves any manual override across re-classifications.

**Default dashboard filter:** `rental_category = 'rental'`. A settings toggle (§7.2 below) lets the user opt-in to include service vehicles.

### 3.2 New tables

All RLS-guarded via the existing `user_entity_ids()` helper (or `organization_id IN (SELECT organization_id FROM organization_members ...)` for org-scoped rows).

```sql
-- Organization-level integration credentials. If a generic table already
-- exists, reuse it; this is the shape assumed in this plan.
CREATE TABLE IF NOT EXISTS organization_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,              -- 'fleetio'
  account_token_ciphertext text,       -- encrypted Fleetio Account-Token
  api_key_ciphertext text,             -- encrypted Fleetio API key
  api_version text DEFAULT '2025-05-05',
  webhook_secret_ciphertext text,      -- HMAC shared secret
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, provider)
);

-- Per-resource sync cursor so we can do incremental `updated_at >= X` polling.
CREATE TABLE IF NOT EXISTS fleetio_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource text NOT NULL,              -- 'vehicles' | 'service_entries' | 'meter_entries' | 'issues' | 'work_orders'
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  last_seen_updated_at timestamptz,    -- high-water mark for q[updated_at_gt]
  last_cursor text,                    -- if mid-cursor-page
  status text DEFAULT 'idle',          -- idle|running|error
  last_error text,
  UNIQUE (organization_id, resource)
);

-- Raw, idempotent webhook receipt log (for replay/debugging).
CREATE TABLE IF NOT EXISTS fleetio_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fleetio_event_id text NOT NULL,
  event text NOT NULL,                 -- e.g. 'service_entry_updated'
  payload jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  received_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  process_error text,
  UNIQUE (organization_id, fleetio_event_id)
);

-- Mirror of Fleetio service_entries / work_orders (unified).
CREATE TABLE IF NOT EXISTS rental_asset_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fixed_asset_id uuid REFERENCES fixed_assets(id) ON DELETE SET NULL,
  fleetio_vehicle_id bigint NOT NULL,
  fleetio_id bigint NOT NULL,          -- service_entry.id or work_order.id
  source text NOT NULL CHECK (source IN ('service_entry','work_order','issue','expense_entry')),
  status text,                          -- scheduled, in_progress, completed, etc.
  started_at timestamptz,
  completed_at timestamptz,
  reference text,
  general_notes text,
  vendor_name text,
  total_amount numeric(19,4),
  labor_amount numeric(19,4),
  parts_amount numeric(19,4),
  tax_amount numeric(19,4),
  meter_value_at_service int,
  primary_meter_unit text,
  line_items jsonb,                    -- cached breakdown (labor+parts+tax)
  raw jsonb,                           -- full payload for forward compat
  fleetio_updated_at timestamptz,
  synced_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, source, fleetio_id)
);

CREATE INDEX idx_rental_asset_maint_asset_date
  ON rental_asset_maintenance(fixed_asset_id, completed_at DESC);
CREATE INDEX idx_rental_asset_maint_org_date
  ON rental_asset_maintenance(organization_id, completed_at DESC);

-- Meter readings stream (odometer / engine hours).
CREATE TABLE IF NOT EXISTS rental_asset_meter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fixed_asset_id uuid REFERENCES fixed_assets(id) ON DELETE CASCADE,
  fleetio_vehicle_id bigint NOT NULL,
  fleetio_id bigint NOT NULL,
  meter_value numeric(19,4) NOT NULL,
  meter_unit text NOT NULL,           -- miles, km, hours
  reading_date date NOT NULL,
  source text,                         -- manual | gps | integration
  raw jsonb,
  synced_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, fleetio_id)
);

CREATE INDEX idx_meter_readings_asset_date
  ON rental_asset_meter_readings(fixed_asset_id, reading_date DESC);

-- Monthly operating KPIs uploaded from spreadsheet.
-- One row per (organization, period, grain). Grain is either a reporting
-- group (e.g., "Car") or an individual asset (via fixed_asset_id) or an entity.
CREATE TABLE IF NOT EXISTS rental_asset_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  grain text NOT NULL CHECK (grain IN ('reporting_group','entity','asset')),
  reporting_group text,                 -- set when grain='reporting_group'
  entity_id uuid REFERENCES entities(id) ON DELETE CASCADE,
  fixed_asset_id uuid REFERENCES fixed_assets(id) ON DELETE CASCADE,

  -- Operating KPIs (all nullable — spreadsheet may omit any)
  available_days int,                   -- fleet-days available in the period
  rental_days int,                      -- fleet-days actually on rent
  revenue_days int,                     -- revenue-generating days (<= rental_days)
  utilization_pct numeric(7,4),         -- 0–100; nullable if we compute from days
  target_utilization_pct numeric(7,4),
  avg_daily_rate numeric(19,4),
  rental_revenue numeric(19,4),
  maintenance_spend numeric(19,4),
  fuel_spend numeric(19,4),
  fleet_size_eop int,                   -- end-of-period count
  net_additions int,                    -- +purchases – sales
  additions int,
  dispositions int,
  notes text,

  source_filename text,
  uploaded_by uuid REFERENCES profiles(id),
  uploaded_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, period_year, period_month, grain,
          COALESCE(reporting_group,''),
          COALESCE(entity_id,'00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(fixed_asset_id,'00000000-0000-0000-0000-000000000000'::uuid))
);

CREATE INDEX idx_kpis_org_period
  ON rental_asset_kpis(organization_id, period_year, period_month);
CREATE INDEX idx_kpis_group
  ON rental_asset_kpis(organization_id, reporting_group, period_year, period_month)
  WHERE grain = 'reporting_group';
```

**RLS policies** (same model as debt/assets):
- `fleetio_*` and `rental_asset_*` tables: SELECT if user is in the organization; INSERT/UPDATE/DELETE if role IN ('admin','controller','preparer').
- `organization_integrations`: read/write admin/controller only (secrets).

### 3.3 What we do NOT store

- **Fuel entries**, **expense entries (non-service)** — pull on demand if needed for drill-down, don't mirror at first. Keeps sync scope small.
- **Issues** — available in Fleetio; mirror in phase 2.
- **Full Fleetio vehicle record** — we keep the authoritative asset in `fixed_assets`. We cache `fleetio_group_name` and `odometer_current` on `fixed_assets` and leave the rest in Fleetio.

---

## 4. Fleetio Integration

### 4.1 Verified API basics (from `developer.fleetio.com`)

| Item | Value | Note |
|---|---|---|
| Base URL | `https://secure.fleetio.com/api/` | US-only, AWS-hosted |
| Auth | `Authorization: Token <API_KEY>` **+** `Account-Token: <account-slug>` | Both headers required on every request |
| Versioning | Date-based (latest: `2025-05-05`); header `X-Api-Version` overrides | Keys are pinned to creation-date version |
| Rate limit | No public RPM; docs advise **≤20 req/min** for standard API; 429 returns `Retry-After` | No `X-RateLimit-*` headers — detect by 429 |
| Pagination | Legacy: `page`/`per` (max 100, headers: `X-Pagination-*`). New (2024-01+): cursor (`start_cursor`/`per_page`, body envelope) | Some endpoints (service_entries, work_orders, issues) moved to v2 cursor-only in 2024 |
| Incremental sync | `q[updated_at_gteq]=<ISO>` (legacy) or `filter[updated_at][gteq]=...` (new) | **AND-only filters, no OR** |
| Webhooks | ~89 event types; HMAC-SHA256 signature in `X-Fleetio-Webhook-Signature`; 5 retries/hour then hourly for 24h; **auto-disables after 3 consecutive failures** | Monitor for disablement |
| Sandbox | **None.** Trial accounts have sample data excluded from API | Need to allocate a 5-vehicle Professional tier ($35/mo) for dev/staging |
| Tier requirement | Professional ($7/veh/mo) or Premium ($10/veh/mo) — **not** Essential | Confirm Avon Rents' plan supports API |

**Key gotcha:** `meter_entry_*` webhooks fire only for manual readings. GPS-sourced meter updates do NOT emit webhooks. We must run a daily poll sweep as backstop.

### 4.2 Client library

New file: `src/lib/fleetio/client.ts` — mirrors the shape of `src/lib/rentalworks/client.ts`.

```typescript
export class FleetioClient {
  constructor(private opts: {
    apiKey: string;
    accountToken: string;
    apiVersion?: string;  // default '2025-05-05'
    fetch?: typeof fetch;
  }) {}

  async listVehicles(params?: { updatedAfter?: string; cursor?: string }): Promise<Paged<FleetioVehicle>>;
  async listServiceEntries(params?: { vehicleId?: number; updatedAfter?: string; cursor?: string }): Promise<Paged<FleetioServiceEntry>>;
  async listMeterEntries(params?: { vehicleId?: number; updatedAfter?: string; cursor?: string }): Promise<Paged<FleetioMeterEntry>>;
  async listWorkOrders(params?: { updatedAfter?: string; cursor?: string }): Promise<Paged<FleetioWorkOrder>>;
  async listIssues(params?: { updatedAfter?: string; cursor?: string }): Promise<Paged<FleetioIssue>>;
  async listGroups(): Promise<FleetioGroup[]>;
  async listCustomFields(): Promise<FleetioCustomField[]>;
}
```

- **Typed responses** generated from `https://developer.fleetio.com/schemas/2025-05-05.yaml` via `openapi-typescript` (zero-runtime-cost types).
- **Exponential backoff** on 429 honoring `Retry-After`.
- **Automatic header injection** (Authorization + Account-Token + X-Api-Version).
- **Concurrency gate**: default max 3 concurrent requests to stay under ~20 RPM even during bulk fetches.

### 4.3 Initial backfill flow

`POST /api/fleetio/sync/initial` (admin-only):

1. Load credentials from `organization_integrations`.
2. Fetch `/groups` → store raw list in memory (for caching names on vehicles).
3. Fetch `/vehicles` (active) + `/archived_vehicles` paginated. For each, upsert into a temp table keyed by VIN.
4. **Match Fleetio vehicles to `fixed_assets` by VIN only.** Normalise VIN case + strip spaces before compare. Unmatched Fleetio rows go into a "Needs linking" UI where a user can (a) pick the matching asset manually, (b) create a new `fixed_assets` row, or (c) mark as "ignore — not tracked in our register". **No auto-link by asset tag** — tags have collided across entities historically.
5. For every matched vehicle, fetch nested `/service_entries`, `/meter_entries`, `/issues`, `/work_orders` (all filtered by vehicle_id, incremental by updated_at on subsequent runs).
6. Populate `rental_asset_maintenance` and `rental_asset_meter_readings` with upserts on `(organization_id, source, fleetio_id)`.
7. Record high-water mark `last_seen_updated_at` in `fleetio_sync_state` per resource.
8. Return: `{ vehicles_matched, vehicles_unmatched, service_entries_imported, meter_entries_imported, duration_ms, warnings: [...] }`.

**Estimated runtime:** For 500 vehicles × average 20 service entries × 50 meter entries = ~11k rows. At ~20 RPM, the per-vehicle nested fetches dominate (~500 × 4 = 2000 requests → ~100 min worst case). Recommend running as a Vercel cron or background job, not in the request/response cycle. Use `next.config.ts` to bump the route timeout.

### 4.4 Ongoing sync

**Primary: webhooks.** `POST /api/fleetio/webhook` (public endpoint):

1. Read raw body, look up org by `webhook_secret_ciphertext` (or include the org id in a subscription-level path: `/api/fleetio/webhook/[orgId]`).
2. Verify HMAC-SHA256 against `X-Fleetio-Webhook-Signature`. Reject 401 on mismatch.
3. Insert into `fleetio_webhook_events` (idempotent on `fleetio_event_id`).
4. Dispatch to handler by `event`:
   - `vehicle_*` → upsert `fixed_assets.fleetio_*` cache fields + possibly create unlinked candidate row
   - `service_entry_*`, `work_order_*` → upsert `rental_asset_maintenance`
   - `meter_entry_*` → upsert `rental_asset_meter_readings`, also update `fixed_assets.odometer_current`
5. Return 200 within 30s (must — Fleetio will retry then auto-disable).

**Backstop: daily poll sweep.** Vercel cron at `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/fleetio/sync/incremental", "schedule": "0 7 * * *" }
  ]
}
```

Pulls each resource with `q[updated_at_gt]=<last_seen_updated_at>` and upserts. Catches:
- GPS-sourced meter entries (no webhook)
- Events missed during webhook auto-disable
- Backfill after reconnect

### 4.5 Webhook subscription management

Fleetio webhooks are registered in their UI, not programmatically (as of 2025-05-05 API version). Provide:

- A **Settings → Fleetio** page showing: connection status, last sync time, list of expected event types, and a "Test webhook" button.
- Clear instructions: create webhook in Fleetio pointing to `https://closebook.vercel.app/api/fleetio/webhook/<org_id>`, paste shared secret.
- Subscribe to: `vehicle_*`, `service_entry_*`, `work_order_*`, `issue_*`, `meter_entry_*`, `vehicle_assignment_*`.

### 4.6 Mapping rules

| Fleetio concept | Our concept |
|---|---|
| `vehicle.vin` | `fixed_assets.vin` — **strict match key; no fuzzy fallback for auto-link.** VIN has no ambiguity and is shared with NCNT and the KPI spreadsheet, so everything lines up apples-to-apples. |
| `vehicle.group_name` | Cached on `fixed_assets.fleetio_group_name`; **informational only** — our `reporting_group` stays driven by `vehicle_class` → `getReportingGroup()`. We surface Fleetio groups as a secondary filter. |
| `vehicle.primary_meter_usage_per_day` | Secondary utilization signal on asset detail; not the primary KPI. |
| `service_entry.*` | `rental_asset_maintenance` (source='service_entry') |
| `work_order.*` | `rental_asset_maintenance` (source='work_order') |
| `meter_entry.*` | `rental_asset_meter_readings` |
| `custom_fields` | Stored in `raw` JSON column; exposed in detail view; optional promotion to columns later |

### 4.7 Security

- Credentials stored **encrypted at rest** (AES-GCM via Supabase Vault or app-level key in `TOKEN_ENCRYPTION_KEY` — same pattern already used for FanRanked OAuth secrets).
- Webhook endpoint is public but rejects requests with invalid HMAC or unknown `org_id` path param.
- No credential exposure in API responses — settings UI returns only `{ is_configured: true, last_synced_at }`.

---

## 5. KPI Spreadsheet Upload

### 5.1 Template (download link on the dashboard)

Two sheets in one workbook:

**Sheet 1 — "By Reporting Group" (primary KPI source)**

| Period | Reporting Group | Available Days | Rental Days | Revenue Days | Utilization % | Target Utilization % | Avg Daily Rate | Rental Revenue | Maintenance Spend | Fuel Spend | Fleet Size EOP | Additions | Dispositions | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-04 | Car | 3,000 | 2,160 | 2,100 | 72.00 | 75.00 | 89.50 | 188,100 | 12,450 | 3,200 | 100 | 2 | 1 | |
| 2026-04 | Box Truck | 1,860 | 1,302 | 1,250 | 70.00 | 70.00 | 145.00 | 181,250 | 18,900 | 4,100 | 62 | 1 | 0 | |

**Sheet 2 — "By Asset (optional)"** — for manager-driven asset-level overrides.

| Period | Asset Tag | VIN | Rental Days | Revenue | Notes |
|---|---|---|---|---|---|

**Sheet 3 — "By Entity (optional)"** — rollup per entity for entity-scoped views.

### 5.2 Parsing rules (`POST /api/rental-assets/kpis/upload`)

- Reuse the `buildHeaderMap` / `parseNumber` / `parseDateToISO` utilities already in `api/assets/upload/route.ts`.
- **Multi-period imports supported.** One workbook can hold many months — the user's KPI archive goes back to 2020, so the initial load is one ~70-period upload, not 70 individual uploads. Parser groups rows by `period_year + period_month` and upserts per group.
- Period parsing: accept `YYYY-MM`, `MM/YYYY`, `Apr 2026`, or an Excel date (use the month of the date).
- Reporting group: match against `getAllReportingGroups()` (built-in + custom). Unknown group → error row.
- **Rental-category guardrail:** if a spreadsheet row targets an asset-grain KPI and the linked `fixed_assets.rental_category != 'rental'`, we warn the user ("this asset is classified as a service vehicle — did you mean to include it?"). User can confirm-and-import or fix the classification first.
- Asset Tag lookup: exact match on `fixed_assets.asset_tag WHERE organization_id=X`. Ambiguous asset tag across entities → error with entity disambiguation hint.
- VIN lookup: **takes precedence over asset tag for any asset-grain row**. This matches the Fleetio linking policy and the user's intent to keep every system apples-to-apples.
- Upsert semantics: `ON CONFLICT (organization_id, period_year, period_month, grain, ...) DO UPDATE`. Re-uploading the same period replaces.
- Response: `{ imported: N, updated: M, skipped: S, periods_touched: [...], errors: [{row, reason}, ...], preview: first-5-rows }`.

### 5.3 Validation

- If `utilization_pct` is null but `available_days` and `rental_days` are both present → compute `utilization_pct = rental_days / available_days * 100`.
- If a row's `fleet_size_eop` disagrees with the computed count from `fixed_assets` (where in_service ≤ EOP date ≤ disposed_date) by >5%, flag a warning (not an error) — lets user see data drift.
- Warn if the uploaded period has no corresponding financial close period yet (keeps CEO-view honest about preliminary data).

### 5.4 Template generator

Endpoint: `GET /api/rental-assets/kpis/template?organizationId=X` — returns an XLSX with:
- Header row in bold, frozen pane
- Existing reporting groups (including custom) pre-populated in the Reporting Group column as a dropdown data validation
- The current and prior month pre-stamped in the Period column
- Formula hint in the Utilization % cell: `=IF(AND(C2>0,D2>0),D2/C2*100,"")`

---

## 6. Compute Engine

New pure-TS util: `src/lib/utils/rental-asset-rollforward.ts`

### 6.1 Inputs

```typescript
interface ComputeInputs {
  assets: FixedAssetForRental[];       // filtered by is_rental_asset=true
  kpis: RentalAssetKpiRow[];
  maintenance: RentalAssetMaintenanceRow[];
  meterReadings: RentalAssetMeterReadingRow[];
  customClasses: VehicleClassification[];
  window: { startIso: string; endIso: string };
  scope: { type: 'organization' } | { type: 'reporting_entity'; id: string } | { type: 'entity'; id: string };
  reportingGroupFilter?: string[];
}
```

### 6.2 Outputs

```typescript
interface FleetRollForward {
  // Fleet count movement (count-based)
  beginningCount: number;
  additions: FleetChange[];        // { date, assetId, acquisitionCost, reportingGroup, entityId }
  dispositions: FleetChange[];     // { date, assetId, salePrice, gainLoss, reportingGroup, entityId }
  endingCount: number;

  // Net Book Value movement (dollar-based)
  beginningNBV: number;
  additionsDollar: number;
  depreciationDollar: number;
  dispositionsNBV: number;
  endingNBV: number;

  byReportingGroup: Map<string, GroupRollForward>;
  byEntity: Map<string, EntityRollForward>;

  // Operating KPIs aggregated
  utilization: {
    weightedAvg: number;            // weighted by available_days
    byGroup: Map<string, number>;
    momDelta: number;               // pp change vs prior month
  };

  maintenance: {
    total: number;
    perAsset: number;                // avg
    byGroup: Map<string, number>;
    top10: MaintenanceEvent[];
  };

  // 24-month trend series (for trend chart)
  trend: Array<{
    period: string;                  // 'YYYY-MM'
    fleetCount: number;
    netBookValue: number;
    utilizationPct: number;
    maintenanceSpend: number;
    additions: number;
    dispositions: number;
  }>;
}
```

### 6.3 Core algorithms

**Fleet count roll-forward** (mirrors `debt-rollforward.ts`):

```
beginningCount = count of fixed_assets where
  in_service_date <= window.start AND
  (disposed_date IS NULL OR disposed_date > window.start) AND
  is_rental_asset = true AND
  (scope filter applied)

additions = fixed_assets where in_service_date IN [window.start, window.end]
dispositions = fixed_assets where disposed_date IN [window.start, window.end]

endingCount = beginningCount + |additions| - |dispositions|
```

**Utilization aggregation:**
- Primary: pull `rental_asset_kpis` rows where `grain='reporting_group'` and period in window; weight by `available_days`.
- Fallback (no KPIs uploaded): compute from RentalWorks contract data IF available for the period (contract_days_on_rent / fleet_days_available).
- Meter-based secondary signal: sum of meter_value deltas / (miles_per_available_day_benchmark). Not used for the headline utilization, just shown as a "physical usage" comparator on the asset detail.

**Maintenance rollup:**
- Sum of `total_amount` from `rental_asset_maintenance` where `completed_at` in window AND joined asset matches scope/group filter.
- Top 10 most expensive maintenance events in the window → drives the Activity tab.
- Per-asset maintenance cost → asset table column.

**Trend series:**
- For each of the trailing 24 months ending at `window.end`:
  - Compute fleet count as of month-end.
  - Pull KPI row for that (org, month, group) — if missing, interpolate as null (don't fabricate).
  - Sum maintenance in the month.
- Emit array for Recharts.

### 6.4 Financial crosswalk util

New file: `src/lib/utils/rental-kpi-crosswalk.ts`

- For a given period, cross-walk: KPI `rental_revenue` vs GL revenue accounts; KPI `maintenance_spend` vs GL maintenance accounts; KPI `fleet_size_eop` vs depreciation-expense-driving asset count.
- Output: `{ metric, kpi_value, gl_value, variance, variance_pct, accounts_included: [...] }` rows for display on the dashboard.
- Uses existing `financial-statements` / `trial-balance` queries as inputs.

---

## 7. UI Design

### 7.1 Page structure

```
src/app/(app)/rental-assets/
├── page.tsx                              # main page
├── use-rental-asset-dashboard-data.ts    # data-loader hook (mirrors use-debt-dashboard-data.ts)
├── control-bar.tsx                       # scope/period/group filters + export
├── hero-summary.tsx                      # 5 hero tiles
├── composition-panels.tsx                # by-group donut + by-entity stacked bar
├── fleet-roll-forward-table.tsx          # entity → group → asset hierarchy
├── utilization-matrix.tsx                # group × month heatmap
├── maintenance-feed.tsx                  # recent service entries w/ vehicle drill-in
├── kpi-crosswalk-panel.tsx               # KPI vs GL variance table
├── trend-chart.tsx                       # 24-month multi-series
├── kpi-upload-dialog.tsx                 # drag-and-drop KPI spreadsheet uploader
├── fleetio-link-panel.tsx                # unmatched Fleetio vehicles helper
├── export-dialog.tsx                     # multi-sheet Excel export
└── rental-asset-excel.ts                 # export builder
```

### 7.2 Header strip

`Rental Asset Dashboard — Organization · As of Apr 30, 2026 · Activity Jan 1 – Apr 30`

- **Scope pill**: Organization (default) / Reporting Entity / Entity
- **Period preset**: MTD / QTD / YTD / T12 / Custom
- **Reporting group multi-select**: Car, Cargo Van, Box Truck, ..., "All"
- **Include service vehicles toggle** (off by default). When on, the dashboard aggregates `rental_category IN ('rental','service')`; when off, `rental_category = 'rental'` only. The toggle state is persisted per-user via `localStorage` and surfaced next to the scope pill with a visible "Rental only" / "Rental + Service" chip.
- **Sync state indicator**: green dot + "Fleetio synced 12 min ago" (or red if stale/disabled)
- **Upload KPIs** button (opens dialog)
- **Export** button (opens multi-sheet dialog)

### 7.3 Hero tiles (five)

1. **Fleet Size** — e.g., 412 vehicles · MoM: +4 (3 additions, 1 disposition) · YoY: +18
2. **Weighted Utilization** — e.g., 71.3% · vs Target 75.0% · MoM delta in pp
3. **Maintenance Spend (window)** — e.g., $128,450 · $312 avg per vehicle · MoM delta
4. **Net Book Value** — e.g., $8.4M · Beginning $8.1M + Additions $720k – Depreciation $295k – Dispositions $125k
5. **KPI Coverage** — e.g., 94% of rented days have reported revenue (flags data quality)

### 7.4 Composition panels

**Left panel — by reporting group**:
- Horizontal stacked bar: fleet count segmented by group, click-to-filter
- Small legend with: count, % utilization, maintenance $/veh

**Right panel — by entity**:
- Donut: NBV by entity
- Click = drill into entity scope

### 7.5 Detail tabs (Radix Tabs)

1. **Roll-Forward** — collapsible hierarchy: Entity → Reporting Group → Individual Asset
   - Columns: Asset, Class, VIN, In Service, Status, Beg Count, Adds, Disp, End Count, NBV, Utilization %, Maint $ (window), Last Service, Next Service Due
   - Row click → asset detail drawer (see 7.7)
2. **Utilization Matrix** — reporting-group × month heatmap over the window
   - Cell: utilization % vs target; color scale green-red; click = drill to group
3. **KPI Crosswalk** — table of month-over-month:
   - KPI (from spreadsheet) vs GL variance
   - Variance > threshold → flagged row
   - "Why is this month's revenue low?" walkthrough: compares rental days → revenue → utilization → fleet size
4. **Maintenance** — feed + methodology tiles:
   - Tiles: Preventive, Corrective, Accident, Inspection (sums)
   - Feed: date / asset / vendor / cost / status / notes
   - Top-spenders this window list
5. **Trends** — 24-month Recharts with toggles:
   - Fleet size
   - Utilization
   - Maintenance spend
   - Net additions

### 7.6 Fleetio link panel

Shows unmatched Fleetio vehicles (no matching VIN). For each row we display Fleetio's year/make/model/VIN/group and offer three actions:

1. **Link to existing asset** — Combobox filtered by entity + reporting group, ranked by year/make/model similarity. Confirming writes `fixed_assets.fleetio_vehicle_id` (single entry, unique index enforced).
2. **Create new asset** — opens the same new-asset dialog used in `[entityId]/assets/new`, prefilled with Fleetio's VIN/year/make/model and `rental_category='rental'` by default.
3. **Ignore** — marks the Fleetio vehicle as "not tracked here" and hides it from future prompts. Reversible.

Counterpart: **unlinked assets panel** — shows `fixed_assets WHERE rental_category='rental' AND fleetio_vehicle_id IS NULL` so nothing gets silently dropped from Fleetio coverage.

### 7.7 Asset detail drawer (right-side sheet)

Click any asset row → slide-in sheet with:

- Header: Year Make Model, class label, VIN, tag, entity
- Tabs: **Overview** | **Maintenance** | **Meter** | **Depreciation** | **Rentals** | **KPIs**
- **Overview**: Fleetio group, current odometer, acquisition details, status
- **Maintenance**: timeline from `rental_asset_maintenance`
- **Meter**: chart of odometer over time
- **Depreciation**: reuses the existing entity-level depreciation schedule view
- **Rentals**: recent rental contracts from RentalWorks (already integrated)
- **KPIs**: any asset-grain KPI rows for this vehicle

### 7.8 Navigation entry

Add to `src/components/layout/app-sidebar.tsx`:
- New item in the Organization section: "Rental Assets" with `lucide-react` `Car` or `Truck` icon, href `/rental-assets`.

---

## 8. Implementation Phases

Estimated effort: **10–14 sessions** depending on scope of KPI validation UI and Fleetio edge cases.

### Phase 1 — Schema + Fleetio plumbing (1–2 sessions)
- Write migration `20260422_rental_asset_fleetio_link.sql`
- Create `organization_integrations`, `fleetio_sync_state`, `fleetio_webhook_events`
- Add `fleetio_vehicle_id` + cache fields to `fixed_assets`
- Regenerate `database.types.ts`

### Phase 2 — Fleetio client + backfill (2–3 sessions)
- Build `src/lib/fleetio/client.ts` with typed OpenAPI-generated response types
- Implement `POST /api/fleetio/sync/initial` (admin-only, long-running)
- Implement `POST /api/fleetio/webhook/[orgId]` with HMAC verification
- Implement `GET /api/fleetio/sync/incremental` (Vercel cron)
- Unmatched-vehicle linking UI in Settings → Fleetio

### Phase 3 — KPI upload (1 session)
- Create `rental_asset_kpis` table
- `POST /api/rental-assets/kpis/upload` endpoint
- `GET /api/rental-assets/kpis/template` template generator
- Upload dialog component

### Phase 4 — Compute engine (1–2 sessions)
- `src/lib/utils/rental-asset-rollforward.ts` (pure TS, unit-testable)
- `src/lib/utils/rental-kpi-crosswalk.ts`
- Unit tests for roll-forward math

### Phase 5 — Dashboard UI (3–4 sessions)
- `use-rental-asset-dashboard-data.ts` hook
- `page.tsx` assembly
- Hero + composition panels
- Roll-forward table + utilization matrix
- Maintenance feed + trend chart
- KPI crosswalk panel
- Asset detail drawer

### Phase 6 — Export + polish (1 session)
- Multi-sheet Excel export (Summary, Roll-forward, Utilization, Maintenance, KPI Crosswalk, Raw assets)
- Sidebar nav entry
- Empty states, loading states, error states
- Production smoke test on `closebook.vercel.app`

### Phase 7 — Settings UI (0.5 session)
- `src/app/(app)/settings/integrations/fleetio/page.tsx`
- Connect / disconnect / test webhook / view sync health

---

## 9. Open Questions for the User

These are blockers or decisions we'd want answered before deep implementation. Defaults are annotated where we can proceed without an answer.

1. **Fleetio credentials.** Do you have the API key + Account-Token already? Plan tier confirmed (Professional or Premium)? — _Default: we stub a Settings UI and you paste when ready._
2. **Sandbox strategy.** Fleetio has no sandbox. Are you OK testing against production Fleetio, or do we need a 5-vehicle test Fleetio account ($35/mo)? — _Default: production; we gate the initial backfill behind a "dry-run" mode that only reports counts._
3. **Utilization numerator.** Is the primary utilization definition "rental days / available days" from your spreadsheet, or should we also compute it from RentalWorks contracts as a second series? — _Default: spreadsheet primary, RentalWorks as a secondary "computed" comparator._
4. **Additions/dispositions source.** Do you want the MoM change in vehicles driven by `fixed_assets.in_service_date` / `disposed_date`, or by separate purchase/sale journal entries? — _Default: in_service/disposed dates on `fixed_assets` — already populated._
5. **Non-vehicle rental assets.** Does the fleet include trailers only, or grip/lighting/studio gear too? Fleetio is vehicle-centric; trailers are fine, but grip equipment might not have Fleetio records. — _Default per user: only trucks, trailers, and container trailers are rental. Grip/lighting/studio gear lives in RentalWorks and is out of scope for this dashboard._
6. **KPI spreadsheet format.** User is sharing a January 2026 KPI sheet as the template; historical data back to Jan 2020 will be loaded in bulk at first run. Parser designed for multi-period workbooks. Column layout will be aligned to the provided sample before the parser is written.
7. **Who should see this dashboard?** Admin + controller only, or also viewer roles? — _Default: RLS mirrors debt (admin/controller/preparer write; viewer read if the role exists)._
8. **Granularity of "reporting group".** Confirm you mean the existing vehicle classification groups (Car, Cargo Van, Box Truck, Studio Box Truck, Stakebed, Passenger Van, Cast Trailer, Makeup Trailer), not the `reporting_entities` (West Coast Ops etc.). — _Default: vehicle classification groups, surfaced alongside reporting-entity scoping._
9. **Webhook subscription**: Can you create the webhook subscription in the Fleetio UI once we ship the endpoint? (Fleetio doesn't expose programmatic subscription management.)
10. **Initial rental-vs-service auto-classification.** Migration will seed all existing `fixed_assets` to `rental_category='rental'` since the register is already curated as "rental assets" (per user: they also live in NCNT and the tax-family schedules). Then the Register Settings page grows a bulk-update UI so anything that turns out to be a service vehicle can be flipped. Is this the right default, or should we import NCNT's classification signal up front to pre-flag service vehicles?
11. **Car-class cars.** Reporting group "Car" includes premium, luxury, pickups, minivans. Are all of these rental, or is some subset (e.g. an F-150 used by the shop) actually service? If there's a list of service-vehicle VINs we can load it to pre-classify.

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fleetio rate-limit storm during initial backfill | High | Medium | Concurrency cap 3; exponential backoff on 429; run backfill as Vercel cron not inline request; progress persisted per resource in `fleetio_sync_state` so it's resumable |
| Webhook auto-disable after 3 failures | Medium | High | Daily poll sweep acts as backstop; Settings UI surfaces a red indicator if `last_seen_updated_at` > 26 hours stale |
| VIN mismatch / unlinked vehicles | High | Medium | Dedicated linking UI; CSV-based bulk link; match-by-tag fallback |
| KPI spreadsheet format varies month to month | High | Medium | Flexible header matching with alias table; clear error messages per row; preview before commit |
| GPS-sourced meter entries invisible via webhooks | Confirmed | Low | Daily poll sweep picks them up |
| Fleetio API version rotation breaks client | Low | High | Pin `X-Api-Version`; monitor `Deprecation` response header; 2-year minimum support per version |
| User lacks Professional/Premium tier | Unknown | High | Check before coding; if Essential, plan is on hold until upgrade |
| Roll-forward count drifts from financial roll-forward | Medium | Medium | KPI crosswalk panel surfaces variance monthly; reuse the same depreciation util as the fixed-assets page |

---

## 11. File Manifest (what we'll create)

**Migrations**
- `supabase/migrations/20260422_rental_asset_fleetio_link.sql`
- `supabase/migrations/20260422_rental_asset_kpis.sql`
- `supabase/migrations/20260422_fleetio_integration_tables.sql`

**Libraries**
- `src/lib/fleetio/client.ts`
- `src/lib/fleetio/types.ts` (or auto-generated from OpenAPI)
- `src/lib/fleetio/webhook-verify.ts`
- `src/lib/utils/rental-asset-rollforward.ts`
- `src/lib/utils/rental-kpi-crosswalk.ts`
- `src/lib/utils/rental-asset-excel.ts`

**API routes**
- `src/app/api/fleetio/sync/initial/route.ts`
- `src/app/api/fleetio/sync/incremental/route.ts`
- `src/app/api/fleetio/webhook/[orgId]/route.ts`
- `src/app/api/fleetio/vehicles/link/route.ts`
- `src/app/api/rental-assets/kpis/route.ts`
- `src/app/api/rental-assets/kpis/upload/route.ts`
- `src/app/api/rental-assets/kpis/template/route.ts`
- `src/app/api/rental-assets/dashboard/route.ts` (optional — may be all client-side)

**Page + components**
- `src/app/(app)/rental-assets/page.tsx`
- `src/app/(app)/rental-assets/use-rental-asset-dashboard-data.ts`
- `src/app/(app)/rental-assets/control-bar.tsx`
- `src/app/(app)/rental-assets/hero-summary.tsx`
- `src/app/(app)/rental-assets/composition-panels.tsx`
- `src/app/(app)/rental-assets/fleet-roll-forward-table.tsx`
- `src/app/(app)/rental-assets/utilization-matrix.tsx`
- `src/app/(app)/rental-assets/maintenance-feed.tsx`
- `src/app/(app)/rental-assets/kpi-crosswalk-panel.tsx`
- `src/app/(app)/rental-assets/trend-chart.tsx`
- `src/app/(app)/rental-assets/kpi-upload-dialog.tsx`
- `src/app/(app)/rental-assets/fleetio-link-panel.tsx`
- `src/app/(app)/rental-assets/asset-detail-drawer.tsx`
- `src/app/(app)/rental-assets/export-dialog.tsx`

**Settings**
- `src/app/(app)/settings/integrations/fleetio/page.tsx`

**Layout**
- Edit `src/components/layout/app-sidebar.tsx` — add nav item

**Config**
- Edit `vercel.json` — add cron schedule for incremental sync
- Edit `.env.local` / Vercel env — `FLEETIO_WEBHOOK_SECRET_KEY` for encryption key (or reuse existing `TOKEN_ENCRYPTION_KEY`)

**Docs**
- This file (`docs/rental-asset-dashboard-plan.md`)
- `docs/fleetio-integration.md` — runbook after shipping

---

## 12. Success Criteria

- Org-level dashboard loads in <3 s with 500 vehicles × 24 months of KPI history.
- KPI upload round-trip (download template → edit → upload → see in dashboard) works without a manual refresh.
- Fleetio webhook-to-dashboard latency ≤60 s p50 (measured on the Activity tab's "Last synced" timestamp).
- CEO can answer: _"Why did April revenue miss by 4%?"_ in <30 s by looking at the KPI Crosswalk panel (expected output: "Utilization 68% vs target 75%, driven by Box Truck group which lost 3 net vehicles mid-month").
- Zero financial reconciliation drift: fleet count in the roll-forward matches the fixed-asset register count for the same date.

---

## 13. Where to Start

Recommended first commit (one PR):

1. **Migration** — add `rental_category` + `fleetio_vehicle_id` + odometer cache columns to `fixed_assets`; default-seed `rental_category='rental'`; create `rental_asset_kpis`, `fleetio_sync_state`, `fleetio_webhook_events`, `organization_integrations` (if absent).
2. **Bulk classification UI** in the existing Rental Asset Register (entity-level `[entityId]/assets/`) — a new column + bulk-flip action so the user can mark service vehicles before the dashboard goes live. This costs nothing on the new page side and means the dashboard's "rental-only" default is meaningful on day one.
3. **Scaffold** `src/app/(app)/rental-assets/page.tsx` showing the fleet roll-forward from existing `fixed_assets` data only (filtered to `rental_category='rental'`). No Fleetio, no KPIs yet — proves the org-level page pattern and gets a click-through demo in front of stakeholders fast.
4. **Sidebar nav entry.**

Then in order: KPI upload (once user's January 2026 template is shared) → Fleetio integration (once credentials + tier confirmed) → crosswalk panel → export → settings page.

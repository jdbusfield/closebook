# Rental Asset Dashboard — Runbook

_Date: 2026-04-22_

Step-by-step to bring the new Rental Asset Dashboard online end-to-end.

## 1. Apply the migration

Open Supabase Studio → SQL Editor → paste the contents of
`supabase/migrations/20260422_rental_asset_dashboard.sql` and run it.

What it creates:
- `fixed_assets` gets `fleetio_vehicle_id`, `fleetio_group_name`, `fleetio_last_synced_at`, `rental_category`, `rental_category_source`, `odometer_current`, `odometer_current_as_of`.
- New tables: `rental_asset_vin_bridge`, `organization_integrations`, `fleetio_sync_state`, `fleetio_webhook_events`, `rental_asset_maintenance`, `rental_asset_meter_readings`, `rental_asset_kpis`.
- RLS + indexes + triggers.

Existing rows in `fixed_assets` all default to `rental_category='rental'` (no data loss; you can reclassify later from the Register Settings page).

## 2. Backfill the VIN bridge + link Fleetio to closebook

```bash
cd "C:/Users/JDBusfield/Documents/MyProjects/Accounting App"
node scripts/backfill-vin-bridge.mjs
```

Reads `C:/Users/JDBusfield/Downloads/vtmp (79).xlsx` (Insurance Fleet Report) →
upserts into `rental_asset_vin_bridge` → walks every `fixed_assets` row with a
VIN and sets `fleetio_vehicle_id` where a matching Fleetio vehicle exists.

Expected output on first run (from our measurements):

```
Using organization: MT Studio Services (795ab24f-…)
Insurance Fleet Report rows: 509
Upserting 500 VIN bridge rows...
Fleetio vehicles: 663, with VIN: 623
Assets total:                 683
  already linked (no change): 0
  newly linked:               ~499
  VIN not in Fleetio:         172
  no VIN on asset:            12
Total fixed_assets linked to Fleetio: ~499
```

Idempotent — re-run any time.

## 3. Ingest KPI data

### First load: January 2026

```bash
node scripts/ingest-kpis.mjs "Jan 2026 utilization data.xlsx"
```

Expected:

```
── Jan 2026 utilization data.xlsx ──
  period: 2026-01, sheet: "JAN 2026 (2)"
  data rows: 451
  matched to asset: 415, collapsed (ambiguous tag): 6, equipment pool: 10, orphans: 26
```

### Historical load (Jan 2020 – Dec 2025)

Drop each monthly workbook into `scripts/kpi-history/` using a filename that
contains the period (e.g., `2020-01 utilization.xlsx` or
`Jul 2023 utilization.xlsx`). Then:

```bash
node scripts/ingest-kpis.mjs scripts/kpi-history/*.xlsx
```

Multi-period — one pass handles every month. Re-running any single month
replaces the KPIs for that period (unique constraint handles the upsert).

## 4. Open the dashboard

```
npm run dev
```

Then visit `http://localhost:3002/rental-assets`.

You should see:
- 5 hero tiles (Fleet Size EOP, Weighted DBR Utilization, Total Revenue, Maintenance, Fleetio Coverage)
- Reporting Group Breakdown with revenue / utilization / maintenance by group
- Fleet Activity tab (additions + dispositions)
- Maintenance tab (empty until step 5)
- Orphans tab with the ~26 unregistered assets

## 5. Pull Fleetio maintenance data

From the dashboard, click **Sync Fleetio** (vehicles) then **Sync Maintenance**.
Both routes are admin/controller-only. They hit Fleetio GET-only.

- **Sync Fleetio vehicles** — pulls all 663 vehicles, caches `fleetio_group_name` and odometer, links any new `fixed_assets` rows whose VIN is now in Fleetio. Incremental on subsequent runs (uses `updated_at` high-water mark).
- **Sync Maintenance** — pulls `service_entries`, `work_orders`, and `meter_entries`. For ~500 linked vehicles, expect the first pass to take several minutes (~20 req/min rate cap). Incremental after that.

Sync state (including `last_incremental_sync_at`, `last_error`) is stored in
`fleetio_sync_state` per resource and surfaced in the hero tiles.

## 6. Deploy

`git push origin main` → Vercel auto-deploys to `closebook.vercel.app`.

Before deploying, confirm the migration has been applied in the **production**
Supabase project (not just local).

Required Vercel env vars (should already be in your project):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FLEETIO_API_KEY`
- `FLEETIO_ACCOUNT_TOKEN`
- `FLEETIO_API_VERSION` (optional; defaults to `2025-05-05`)
- `FLEETIO_BASE_URL` (optional; defaults to `https://secure.fleetio.com/api`)

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard shows "Could not load dashboard" | Migration not yet applied | Run step 1 |
| All hero tiles show `—` | KPIs not yet ingested | Run step 3 |
| Fleetio Coverage shows 0 / N | Backfill hasn't been run | Run step 2 |
| Maintenance tab is empty | Maintenance sync not run | Click "Sync Maintenance" on the dashboard |
| Backfill script fails with "Missing Supabase env" | `.env.local` not loaded | Confirm file exists and script is run from project root |
| `node scripts/…` errors with `Cannot find module 'xlsx'` | `npm install` wasn't run | `npm install` |
| Ingest script says "could not detect period" | Filename doesn't include a month/year | Rename to include `"Jan 2026"` or `"2026-01"` |

## Files created in this build

### Schema
- `supabase/migrations/20260422_rental_asset_dashboard.sql`

### Libraries
- `src/lib/fleetio/client.ts` — typed read-only Fleetio API client

### API routes
- `src/app/api/fleetio/sync/vehicles/route.ts` — POST: auto-link by VIN
- `src/app/api/fleetio/sync/maintenance/route.ts` — POST: pull service_entries + work_orders + meter_entries

### UI
- `src/app/(app)/rental-assets/page.tsx` — dashboard
- `src/app/(app)/rental-assets/use-rental-asset-data.ts` — data-loader hook
- Sidebar nav entry added to `src/components/layout/nav-config.ts`

### Scripts
- `scripts/backfill-vin-bridge.mjs` — one-time + rerunnable
- `scripts/ingest-kpis.mjs` — handles multi-period workbooks
- `scripts/kpi-history/` — drop historical DBR spreadsheets here
- `scripts/match-fleetio-to-utilization.mjs` — diagnostic
- `scripts/match-with-vin-bridge.mjs` — diagnostic (used during design)
- `scripts/probe-fixed-assets.mjs` — diagnostic

### Docs
- `docs/rental-asset-dashboard-plan.md` — design plan
- `docs/rental-asset-first-pass-analysis.md` — empirical analysis
- `docs/rental-asset-dashboard-runbook.md` — this file

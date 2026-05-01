---
title: Configuration
slug: configuration
section: Configuration
order: 50
description: Environment variables and customization knobs.
---

# Configuration

Closebook reads configuration from environment variables. In local
development they live in `.env.local`; in production they are managed via
Vercel project settings.

## Supabase

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL of the Supabase project. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key used by the browser client. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin key for privileged ops. |

## RentalWorks

| Variable | Purpose |
| --- | --- |
| `RW_BASE_URL` | RentalWorks API base, e.g., `https://hdr.rentalworks.cloud`. |
| `RW_USERNAME` | Service account user. |
| `RW_PASSWORD` | Service account password. |

The RentalWorks client is in `src/lib/rentalworks/client.ts`. Auth is JWT
via `POST /api/v1/jwt`; the client reauthenticates on 401/403 and retries.

## QuickBooks Online

QBO connections are stored per-entity in Supabase (refresh tokens), so
there are no global environment variables for QBO beyond the OAuth client
credentials. See `src/lib/db/queries/` for token storage and `src/app/api`
routes for the OAuth callback handlers.

## Feature flags

Entity-level feature flags are defined in
`src/components/layout/nav-config.ts` in `getEntityFeatures()`. To toggle a
flag for additional entities, add a name match there and ship a PR.

## Customization

- **Sidebar nav** — `src/components/layout/nav-config.ts` defines both the
  org-level and entity-level navigation.
- **Wiki content** — `docs/wiki/*.md`.
- **Print layout** — `src/app/globals.css` plus per-statement print CSS.
  Statements must fit on a single 8.5x11 page.

## Pagination defaults

When querying Supabase, **always** paginate or use `.range()`. The default
limit is 1000 rows; larger queries silently truncate without it. After any
query change, verify row counts match expected totals.

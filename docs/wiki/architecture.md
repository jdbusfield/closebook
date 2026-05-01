---
title: Architecture
slug: architecture
section: Architecture
order: 60
description: How Closebook is wired — frameworks, data layer, integrations.
---

# Architecture

## Stack

- **Framework**: Next.js 16 (App Router) on React 19, TypeScript.
- **Auth + DB**: Supabase (Postgres + Row-Level Security + Auth).
- **UI**: Tailwind CSS v4 + shadcn/ui components.
- **Hosting**: Vercel (auto-deploys from `main`).

## Directory layout

```
src/
  app/
    (app)/                  # authenticated app routes (sidebar shell)
      [entityId]/           # entity-scoped routes
      close-dashboard/
      dashboard/
      debt/
      ic-eliminations/
      payroll/
      real-estate/
      reports/
      settings/
        master-gl/
        members/
        reporting-entities/
        templates/
        audit-log/
        wiki/               # Wiki section (this documentation)
        page.tsx            # Organization page
      sync/
      tb-variance/
    (auth)/                 # login / signup
    (embed)/                # embeddable views
    api/                    # route handlers
  components/
    layout/                 # sidebar, header, nav-config
    ui/                     # shadcn primitives
    dashboard/
    financial-statements/
    revenue-projection/
  lib/
    config/
    db/
    hooks/
    paylocity/
    rentalworks/
    supabase/
    types/
    utils/
    wiki/                   # Wiki loader + markdown renderer
docs/
  accounting-manager-onboarding-packet.md
  rentalworks-api/
  wiki/                     # Wiki source markdown
supabase/
  migrations/               # Numbered SQL migrations
```

## Routing

- `(app)` route group is the authenticated shell — sidebar, header, layout
  guards in `src/app/(app)/layout.tsx`.
- Org-level routes live directly under `(app)/`, e.g. `/dashboard`,
  `/close-dashboard`, `/settings/...`.
- Entity-level routes live under `(app)/[entityId]/`. The `entityId` is a
  Supabase UUID and is validated server-side before any query runs.

## Data layer

- All queries go through `src/lib/db/queries/`. They use the Supabase
  server client with the user's session cookies for RLS.
- Service-role queries (rare — admin scripts, scheduled jobs) live in
  `scripts/` and use `SUPABASE_SERVICE_ROLE_KEY`.
- Migrations are numbered SQL files under `supabase/migrations/`. A handful
  use ISO-date prefixes (e.g., `20260420_*.sql`) for migrations added after
  the integer-prefixed sequence stopped being strictly chronological.

## Integrations

- **QuickBooks Online** — per-entity OAuth, refresh tokens stored encrypted
  in Supabase. Trial balances pulled via QBO reports API and reconciled
  against Master GL mappings.
- **RentalWorks (HDR)** — JWT auth, browse + GET-by-ID endpoints. See
  `src/lib/rentalworks/client.ts` and the SOPs under
  `docs/rentalworks-api/`.
- **Paylocity** — payroll detail import; client lives in
  `src/lib/paylocity/`.

## Wiki subsystem

The wiki (this documentation) is filesystem-backed. The loader at
`src/lib/wiki/loader.ts` walks `docs/wiki/*.md`, parses YAML frontmatter,
and exposes a sorted index. The renderer at `src/lib/wiki/markdown.tsx` is
a small dependency-free Markdown -> JSX pass that handles headings, lists,
code blocks, tables, blockquotes, links, bold, italic, and inline code.

## Print layout

Financial statements must fit on a single 8.5x11 page. Portrait for <=6
columns, landscape otherwise. Print styles live in `src/app/globals.css`
and per-component scoped CSS where needed.

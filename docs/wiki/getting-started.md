---
title: Getting Started
slug: getting-started
section: Getting Started
order: 10
description: How to set up Closebook locally and complete first-use configuration.
---

# Getting Started

This page walks you through running Closebook locally and completing the
first-use configuration in production.

## Prerequisites

- Node.js 20+
- npm (the project uses `package-lock.json`)
- A Supabase project (URL + anon key + service role key)
- A QuickBooks Online developer account if you want to exercise the QBO sync
- RentalWorks API credentials for the RentalWorks integration

## Local development

```bash
# from repo root
npm install
npm run dev
```

The dev server listens on `http://localhost:3000`. If port 3000 is busy use
`npm run restart`, which kills processes on ports 3000 and 3002 before
starting Next.

## Required environment variables

Create `.env.local` in the project root with the following keys. See
[Configuration](/settings/wiki/configuration) for the complete list and
descriptions.

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

RW_BASE_URL=https://hdr.rentalworks.cloud
RW_USERNAME=...
RW_PASSWORD=...
```

## First-use walkthrough

After signing in for the first time:

1. **Create an organization** — go to *Settings -> Organization* and create
   an organization. An organization groups related entities together.
2. **Add entities** — under *Settings*, add one entity per legal company
   (e.g., one for the parent, one per subsidiary). Each entity gets its own
   chart of accounts, trial balance, and close calendar.
3. **Configure Master GL** — in *Settings -> Master GL*, define the
   consolidated chart of accounts that entity-specific accounts roll up to.
4. **Create reporting entities** (optional) — used to group entities for
   consolidated views that are not the full org-wide consolidation.
5. **Invite members** — *Settings -> Members*. Roles control what each user
   can see and change.
6. **Connect QuickBooks Online** — go to *QBO Sync* and link each entity to
   its QBO company file.

You are now ready to import a trial balance and run your first close.

## Production

Closebook's production deployment is `closebook.vercel.app`. Pushing to the
`main` branch triggers an automatic Vercel deployment.

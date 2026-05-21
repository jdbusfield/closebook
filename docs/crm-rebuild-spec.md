# MT-CRM Rebuild Spec (for Closebook / Next.js)

Source: `C:\Users\JDBusfield\Downloads\MT-CRM-extract\MT-CRM`
Stack of origin: Vite + React + wouter + TanStack Query + Express + Drizzle + Replit Auth + Replit Object Storage.
Target: Next.js App Router inside the Closebook accounting app.

Tier legend: **T1** core / **T2** important / **T3** nice-to-have / **Skip**.

---

## 1. Route table (App.tsx)

URL paths grouped by feature area. All require auth except `/` when signed-out (Landing).

### Dashboard & Reports
- `/` → Dashboard (T1)
- `/reports` → Reports list (T3 — overlaps with Production Reports)
- `/kpi-reports` → KPI revenue leaderboards (T2)
- `/status-alerts` → Productions with missing/stale dates and 399s missing coordinators (T2)
- `/production-reports` → Uploaded weekly PDF reports archive (T2)

### Clients (Productions, Studios, Corporate)
- `/clients` → Tabbed view: Productions / Studios / Corporate Companies (T1)
- `/companies/:id` → Company detail (T1)
- `/companies/:id/edit` → Edit company (T1)
- `/production-tracker` → Weekly report upload + diff + batch-import (T1, the keystone workflow)
- `/production-calendar` → Calendar view of production windows (T2)
- `/productions/:id` → Production detail (T1)
- `/edit-production/:id` → Edit production (T1)
- `/productions-by-status` → All productions grouped by status (T3)
- `/productions-by-segment` → Grouped by Avon/HDR/both (T3)
- `/avon-productions` → Filter: productions using Avon equipment (T2)
- `/hdr-productions` → Filter: productions using HDR equipment (T2)
- `/productions-399` → Union/IATSE 399 productions list (T1)
- `/productions-reality` → Reality-show productions (T2)
- `/productions-commercial` → Commercial productions list (T2 — appears legacy, see Commercial Companies)
- `/productions-other` → Productions tagged "other" (T2)
- `/productions-completed` → Completed / archived productions (T2)
- `/commercial-companies` → Commercial advertising clients list (T1)

### Contacts
- `/contacts` → Contacts list (T1)
- `/contacts/new` → Create contact (T1)
- `/contacts/import` → CSV/XLSX contact import (T2)
- `/contacts/:id` → Contact detail (T1)
- `/contacts/:id/edit-productions` → Manage many-to-many contact ↔ production links (T1)

### Opportunities
- `/opportunities` → Production-tied sales opportunities list (T1)
- `/opportunities/new` → Create opportunity (T1)
- `/opportunities/:id` → Opportunity detail (T1)
- `/opportunities/:id/edit` → Edit opportunity (T1)
- `/corporate-opportunities` → Long-cycle B2B deals list (T2)
- `/corporate-opportunities/new`, `/:id`, `/:id/edit` → CRUD (T2)

### Communications
- `/communications` → Activity feed (calls/emails/meetings) (T1)
- `/communications/new` → Log communication (T1) — also reachable via floating "Log a Communication" button

### Inventory & Calendars
- `/avon-inventory` → Avon equipment list (Skip — Closebook has assets module)
- `/hollywood-inventory` → HDR/Hollywood equipment list (Skip — same)
- `/entertainment-calendar` → Tickets/suite/event bookings for clients (T3)

### Help
- `/help/sales-guide` → Static sales playbook page (T3)

### Skip / dead code
- `Landing.tsx`, `bookings.tsx`, `commercial-opportunities.tsx`, `entertainment-calendar-simple.tsx`, `production-detail.tsx.bak`, `productions-399.tsx.bak`, `commercial-communications-view.tsx` — unreferenced from App.tsx, leftover. **Skip.**

---

## 2. Per-page summary

**Dashboard** — Top KPI cards (Avon, HDR, both-segment, prepping/shooting/wrapping counts), weekly production chart, daily status chart, California-only weekly chart, recent communications feed, rental opportunity widgets, revenue leaderboards. Pulls `/api/dashboard/stats`, `/california-status-by-week`, `/weekly-production-status`, `/daily-status-counts`. (T1)

**Clients** — Tabs for Productions / Studios / Corporate. Each tab is a filterable, sortable table with status filter, search box, Download CSV, "New Production"/"New Studio" buttons. Row click navigates to detail. (T1)

**Company / Studio Detail** — Header with name + type, lists child productions (if studio), lists contacts, lists corporate opportunities, lists communications. Edit/Delete buttons. (T1)

**Production Detail** — Tabs (overview / contacts / communications / opportunities / status history / aliases). Overview shows status badge + dropdown for transitions, dates, state, customer #, CA spend level, production type, all vendor selectors per rental category, revenue fields, rental opportunities chips. Side panel: associated contacts with quick-log-communication and "Make Opportunity" buttons. Archive button. (T1)

**Edit Production** — Form mirroring production schema; vendor dropdowns per service category; rental opportunities checkboxes; date pickers. (T1)

**Production Tracker** — Upload XLSX/CSV weekly report. Server matches rows against existing productions by name + alias. Returns a diff UI: new productions (need company assignment), name-matches with field differences (shown side-by-side, user toggles per-field acceptance), unchanged. Inline ProductionDialog / CompanyDialog to resolve missing FK. Submits batch-update + batch-import. **This is the most important workflow.** (T1)

**Production Calendar** — Month/week calendar of productions colored by status, drawn from startDate/endDate. (T2)

**Productions-399** — Filtered list of 399 productions with extra column for missing coordinator. (T1)

**Productions-Reality / Other / Completed / By-Status / By-Segment / Avon / HDR** — Variants of the productions table with preset filters. Effectively one component + filter preset. (T2; collapse into one filtered list in rebuild.)

**Status Alerts** — Three sections: productions with missing dates, prepping productions past start date, shooting productions past end date, plus 399s without coordinators. Each row links to production detail. (T2)

**Production Reports** — List of uploaded PDFs (pulse + 399 weekly reports), grouped by production or standalone; upload button, download/delete. (T2)

**KPI Reports** — Three leaderboards from `/api/dashboard/stats`: top shows by trailer revenue, top shows by vehicle revenue, top contacts by revenue. (T2)

**Contacts** — Table: name, role, phone, email, company, # productions, last-contact-date/type. Search, role filter, sort. Buttons: New, Import. Row → contact detail. (T1)

**Contact Detail** — Header (name/role/phone/email/source code/salesperson), associated productions (many-to-many), associated commercial companies, opportunities tied to contact, communications timeline. Quick-log-communication. Quick "Make Opportunity". (T1)

**Edit Contact Productions** — Add/remove join rows in `contact_productions`. (T1)

**Contact Import** — Upload XLSX/CSV, server matches contacts by email and creates/updates. (T2)

**New Contact / New Communication / New Opportunity / New Corporate Opportunity** — Standard create forms; communication form has type (call/email/meeting), date, notes, salesperson, optional opportunity-creation toggle. (T1)

**Opportunities** — List filterable by status (open / reservation_made / won / lost), segment (avon_trailers, avon_vehicles, location_services, bathroom_trailers, grip_and_lighting, production_supplies_rental, ac_equipment, rental_vehicles, rental_trailers), priority, salesperson. (T1)

**Opportunity Detail** — Shows production + contact link, segment, description, status, priority, amount, status comment, comments thread, audit. Status dropdown (open → reservation_made → won/lost) with required comment + amount on close. (T1)

**Corporate Opportunities** — Same shape as opportunities but B2B with stages (initial_contact → proposal_sent → negotiation → contract_review → closed_won/lost), types (rental_company, small_stage, supply_deal, equipment_sale, service_partnership, joint_venture), expected close date, estimated value. (T2)

**Commercial Companies** — Advertising-side accounts. Tabs for company list + open commercial opportunities. Per-company: contacts (many-to-many w/ primary flag), opportunities, communications. (T1)

**Communications** — Global activity feed, filter by type/date/contact/production/salesperson. (T1)

**Entertainment Calendar** — Lists Crypto Suite, Dodger Tickets, etc. events with capacity and bookings tied to a contact + employee. (T3)

**Avon Inventory / Hollywood Inventory** — Equipment table by segment. **Skip** in rebuild — Closebook already owns inventory.

**Sales Guide** — Static help content. (T3, port the prose only.)

**Landing** — Sign-in screen. **Skip** — Closebook auth replaces.

---

## 3. Server API surface (`server/routes.ts`)

All endpoints `isAuthenticated`-gated except a handful of public reads. Standard REST: GET list, GET one, POST create, PUT update, PATCH partial, DELETE.

**Auth / Users**
- `GET /api/auth/user`, `GET /api/users`, `GET /api/users/:id`, `POST /api/users`

**Dashboard**
- `GET /api/dashboard/stats` — KPI counts + leaderboards
- `GET /api/dashboard/california-status` and `/california-status-by-week`
- `GET /api/dashboard/weekly-production-status`
- `GET /api/dashboard/daily-status-counts`

**Companies**
- `GET|POST /api/companies`, `GET|PUT|DELETE /api/companies/:id`
- `GET /api/companies/:companyId/productions`, `/contacts`, `/corporate-opportunities`

**Productions** (the big one)
- `GET|POST /api/productions`
- `GET|PUT|PATCH|DELETE /api/productions/:id`
- `GET /api/productions/search?q=`
- `GET /api/productions/needs-status-update` — alerts source
- `GET /api/productions/399-without-coordinators`
- `GET /api/productions/download/csv`
- `GET|POST /api/productions/:id/aliases`, `DELETE /api/productions/aliases/:id`
- `GET /api/productions/:id/contacts` and `/associated-contacts`, batch endpoint `/productions/contacts/batch`
- `POST /api/productions/:productionId/contacts/:contactId` — attach contact
- `GET /api/productions/status-history/:productionId`
- **`POST /api/productions/match`** — multipart upload, parses XLSX/CSV, returns diff
- **`POST /api/productions/batch-update`** — applies user-confirmed updates from diff
- **`POST /api/productions/batch-import`** — creates new productions from diff
- `GET /api/productions/:productionId/opportunities`, `/communications`, `/bookings`, `/reports`

**Contacts**
- `GET|POST /api/contacts`, `GET|PUT|PATCH|DELETE /api/contacts/:id`
- `GET /api/contacts/search`
- `GET /api/contacts/:contactId/productions`, `/opportunities`, `/communications`, `/event-bookings`, `/commercial-companies`, `/corporate-opportunities`
- `POST /api/contact-productions`, `DELETE /api/contacts/:contactId/productions/:productionId`, `PUT /api/contacts/:contactId/productions` (replace set)
- `POST /api/contacts/import` (multipart)
- `GET /api/contacts/communications/batch`

**Equipment & Bookings** — `/api/equipment*`, `/api/bookings*`. **Skip** in rebuild.

**Opportunities**
- `GET|POST|PUT|DELETE /api/opportunities[/:id]`
- `PUT /api/opportunities/:id/status` — transition with amount + comment
- `GET|POST /api/opportunities/:id/comments`
- `GET /api/opportunities/cross-segment` — opportunities crossing segments

**Corporate Opportunities**
- Full CRUD plus `by-type/:type`, `by-stage/:stage` filters

**Commercial Companies + Opportunities**
- Full CRUD on `/api/commercial-companies` and `/api/commercial-opportunities`
- Many-to-many: `POST|DELETE /api/commercial-companies/:companyId/contacts/:contactId`, primary-flag toggle, bulk-replace endpoints
- `PUT /api/commercial-opportunities/:id/status`

**Communications**
- `GET|POST|PUT|DELETE /api/communications[/:id]`
- Scoped: `/contacts/:id/communications`, `/productions/:id/communications`, `/commercial-companies/:id/communications`

**Production Reports**
- `GET|POST /api/reports`, `GET|POST /api/production-reports`, `GET /api/reports/:id`, `DELETE /api/reports/:id`
- `POST /api/productions/:productionId/reports` (multipart)
- `POST /api/reports/cloud-upload` + `/cloud-upload/complete` — presigned Replit Object Storage URL flow (**Skip** — swap for Vercel Blob / Supabase Storage)
- `GET /api/files/:filename` — file download
- `GET /api/reports/sync-check` — reconcile DB rows vs storage

**Entertainment Events** — `/api/entertainment-events*` + `/api/event-bookings*`. (T3)

---

## 4. Key workflows

### A. Weekly production report ingestion (the most important flow)
1. User opens `/production-tracker`, picks weekly pulse XLSX or 399 XLSX.
2. `POST /api/productions/match` parses rows, normalizes Excel serial dates, extracts: production name, company, studio, status, show type, dates, state, Avon customer #, trailer/vehicle counts and revenue, total HDR revenue, rental opportunities, coordinator contact info.
3. Server matches each row to an existing production by **name OR production_alias**. Returns three buckets: exact matches with no diffs, matches with field differences (per-field old/new), and brand-new rows.
4. UI renders the diff. For new rows, user resolves missing company (inline CompanyDialog creates one). For changed rows, user can accept/reject each field (status transitions write to `production_status_history` and set `statusChangedAt`).
5. Submit fires `POST /api/productions/batch-update` (existing) and `POST /api/productions/batch-import` (new) in tandem.
6. Coordinator contact info, when present, creates/updates a contact + `contact_productions` link.

This is the bread-and-butter — most production data lives in these weekly reports. **T1, must rebuild faithfully.**

### B. Production status lifecycle
Statuses: `pre-prepping → prepping → shooting → reshoots → wrapping → completed → cancelled → archived`. Changes happen via (a) production detail dropdown, (b) batch-update from weekly diff, (c) edit-production form. Every change writes to `production_status_history` and updates `statusChangedAt`. Status Alerts page surfaces stale rows (prepping past startDate, shooting past endDate). **T1.**

### C. Production aliases (working titles)
Productions often have a working title plus the eventual show name. `production_aliases` table holds n aliases per production. The matcher in workflow A checks aliases first to avoid duplicate creation. UI on production detail (`ProductionAliases` component) lets users add/remove. **T1 — without this, the weekly diff produces dupes.**

### D. Log a communication
Floating green "Log a Communication" button in sidebar opens `QuickCommunicationDialog`. User picks contact (typeahead), type (call/email/meeting), date, notes, salesperson. Optional toggle: "this led to an opportunity" — creates linked opportunity in same submit. Updates contact's `lastContactDate`/`lastContactType`. **T1.**

### E. Opportunity status close
From opportunity detail, user moves status to won or lost. Modal requires `amount` and `statusComment`. On won, amount feeds the KPI leaderboards. Same pattern for commercial + corporate opportunities (corporate uses stages instead). **T1.**

### F. Contact ↔ production linking
Many-to-many via `contact_productions`. Set on contact detail, production detail, and as a side-effect of weekly report ingestion when coordinator info is present. `/contacts/:id/edit-productions` is the bulk editor. **T1.**

### G. Commercial company management
Separate from productions: commercial advertising clients with their own opportunity model (`commercial_opportunities`, status open/won/lost, statusChangedAt). Contacts join via `contact_commercial_companies` with `isPrimary` flag. **T1.**

---

## 5. Special UI features

- **Dashboard charts** — Weekly Production Chart, Daily Status Chart, California Weekly Status Chart, Rentals By Status. Recharts-based. (T2)
- **Status Alerts page** — automated rules for stale productions. (T2)
- **KPI revenue leaderboards** — top shows by trailer/vehicle revenue, top contacts by revenue. (T2)
- **Production Calendar** — month view colored by status. (T2)
- **Entertainment Calendar** — separate event-booking system (Crypto Suite, Dodgers, etc.). (T3)
- **Sales Guide** — static help page. (T3)
- **Production aliases inline editor** on production detail. (T1)
- **Production diff preview** in tracker — side-by-side per-field accept/reject. (T1, hardest UI piece.)
- **Floating quick-communication dialog** accessible from sidebar globally. (T1)
- **Studios-by-productions view** on Clients page — groups productions under parent studio. (T2)

---

## 6. Auth / users / permissions

- Currently **Replit Auth (OIDC)** via `server/replitAuth.ts`, session table in `sessions`, user table keyed by Replit ID string.
- `isAuthenticated` middleware on nearly every route; no role-based gating in routes — every authenticated user has full read/write.
- `users` table is upserted on login: id (string), email, firstName, lastName, profileImageUrl.
- `salesperson` is a free-text field on contacts/opportunities/communications, not a FK to users. Leaderboards aggregate by that string.
- `opportunityComments.userId` is the only real audit link to users.

**Rebuild guidance:** swap Replit Auth for Closebook's existing auth. Keep the `salesperson` string field as-is for back-compat with leaderboards; optionally migrate to user FK later. No roles to port.

---

## 7. External integrations

- **Replit Object Storage** (`server/replit_integrations/object_storage/objectStorage.ts`) — presigned upload URLs for PDF reports. **Replace** with Vercel Blob or Supabase Storage.
- **Multer** local disk uploads — `/uploads` folder for XLSX/CSV during import. Ephemeral; only used inside request lifecycle. Keep equivalent server-side temp parsing.
- **XLSX library (SheetJS)** — XLSX/CSV parsing for production tracker and contact import. Keep.
- **No RentalWorks, no email send, no Slack, no webhook integrations** in this codebase. The CRM is otherwise self-contained.

---

## 8. Things to skip

- **`Landing.tsx` and Replit OIDC flow** — replaced by Closebook auth.
- **`/avon-inventory`, `/hollywood-inventory`, equipment + bookings tables and endpoints** — Closebook accounting/assets module replaces these.
- **`bookings.tsx`, `commercial-opportunities.tsx`** (route-less), **`entertainment-calendar-simple.tsx`**, **`*.tsx.bak`** files — dead.
- **`/api/reports/cloud-upload[/complete]`** — Replit Object Storage flow; replace with chosen blob storage.
- **`ObjectUploader.tsx`** — Uppy + Replit storage; rebuild against new storage backend.
- **`/productions-by-status`, `/productions-by-segment`, `/productions-commercial`, `/avon-productions`, `/hdr-productions`, `/productions-reality`, `/productions-other`, `/productions-completed`** — collapse into **one** productions list with URL-driven filter presets rather than 8 separate pages.
- **`/reports`** route — overlaps with `/production-reports`; pick one.
- **Equipment-segment enums** (`avon` / `hollywood`) on the production table — keep the *vendor* enums, but the equipment segment system can be retired alongside inventory.
- **`storage_new.ts`** and other `_new` files — verify which is canonical before porting; some look like in-progress refactors.

---

## 9. Complexity honest-take

**Hard:** Production Tracker diff UI + matcher (workflow A). Production status history + automated alert rules. Many-to-many contact↔production sync with side-effects from weekly imports.

**Medium:** Opportunity status transitions with required-close metadata. Communication logging with optional opportunity creation. Commercial company / contact primary-flag management. CSV/XLSX contact import.

**Easy:** Almost all the list/detail/edit pages — they are standard CRUD over Drizzle tables. The 8 segment-filtered production list pages collapse to one parametrized route.

**Skip outright:** Equipment, bookings, entertainment events (defer), Replit-specific code.

---

## 10. Suggested rebuild order

1. Schemas + migrations (productions, companies, contacts, contact_productions, production_aliases, production_status_history, communications, opportunities, opportunity_comments, commercial_companies, commercial_opportunities, contact_commercial_companies, corporate_opportunities, production_reports).
2. Productions list + detail + edit + status transitions (T1 backbone).
3. Contacts list + detail + many-to-many editor + quick-log-communication global dialog.
4. Opportunities (productions-side) + opportunity status close modal.
5. **Production Tracker** (weekly diff). This unlocks data inflow.
6. Companies / Studios / Commercial Companies + their opportunities.
7. Dashboard KPIs + Status Alerts + KPI Reports.
8. Corporate opportunities, Production Reports archive, Production Calendar.
9. Entertainment Calendar + Sales Guide (defer).

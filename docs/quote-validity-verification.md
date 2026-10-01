# Quote validity fix: local verification

Prepared on JD-THINKPAD on October 1, 2026, in the isolated checkout
`C:\Users\JDBusfield\Documents\Codex\2026-10-01\task\closebook`.
Branch: `fix/quote-calendar-expiry`; base: `6ac654929bd59a1f25e0e38052bcfc56c1544258`.
The existing `_closebook_work` and `Accounting App` checkouts and their unrelated
untracked files were not modified. No app credentials were copied into this checkout.

## What changed

- One Los Angeles calendar policy for issuance, expiry, custom dates, review
  drafts, and action validation. The database owns first-save issuance and
  default expiry; saved dates cannot silently be reset.
- Both app mutation implementations and the embed route validate fresh quote
  and event data. The new database trigger protects direct writes as well.
- Builder, saved-quote controls, manual email picker, funnel previews, email
  merges, and PDFs use persisted dates. Quote re-download retains its issue
  date; invoice date/payment behavior is unchanged.
- Enroll, resume, and each funnel send reject expired/review quotes and known
  conflicting fixed-day template promises. Selected quotes stay pinned.
  Provider-confirmed quote sends mark drafts sent. Uncertain delivery or a
  post-send database failure leaves a visible review state to prevent blind retries.
- The migration changes no existing rows. See [the rollout guide](quote-validity-rollout.md)
  for mandatory legacy/template review and coordinated publication steps.

## Executed checks

All commands below ran locally from the isolated checkout unless stated otherwise.
Locked dependencies were installed with `npm ci --ignore-scripts --no-audit --no-fund
--cache ..\.npm-cache`. No lockfile or package dependency change is part of the patch.

| Check | Command | Result |
| --- | --- | --- |
| Entire repository test suite | `npm test` | **106 passed, 0 failed, 0 skipped** |
| Quote regressions, UTC process | `$env:TZ='UTC'; node node_modules/tsx/dist/cli.mjs --test 'src/lib/inquiries/__tests__/*.test.ts'` | **60 passed, 0 failed, 0 skipped** |
| Quote regressions, Auckland process | `$env:TZ='Pacific/Auckland'; node node_modules/tsx/dist/cli.mjs --test 'src/lib/inquiries/__tests__/*.test.ts'` | **60 passed, 0 failed, 0 skipped** |
| Full TypeScript check | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | **Passed, exit 0** |
| Full repository lint | `npm run lint` and ESLint JSON comparison against an untouched archive of the base commit | Both report **131 errors, 153 warnings**; **no new findings** by relative file, rule, severity and diagnostic text excluding source-location excerpts |
| Final changed-file lint | `node node_modules/eslint/bin/eslint.js --format json --output-file ..\changed-lint.json <all changed/new TS/TSX/MJS paths>` | 21 files; **4 pre-existing errors, 0 warnings, no new findings**. Existing effect errors: three in `detail-drawer.tsx`, one in `funnel-block.tsx` |
| PostgreSQL trigger/helper execution | `$env:PGLITE_MODULE=(Resolve-Path ..\quote-db-test\node_modules\@electric-sql\pglite\dist\index.js).Path; node scripts/test-quote-validity-db.mjs` | **17 passed, 0 failed, 0 skipped** in isolated in-memory PGlite 0.3.14 |
| Patch whitespace | `git diff --check` | **Passed** |
| PDF visual QA | Real jsPDF output rendered to PNG, inspected at page size | October 1/October 3 and same-day review samples are readable, single-page, without clipping |

The 60 quote regressions comprise 10 calendar-policy tests, 8 PDF/email tests,
8 app-callback tests covering both implementations, 8 actual embed-route tests,
and 26 funnel-engine/app/embed-enrollment tests. App/route/provider tests use
isolated database/transport adapters; no external email or Supabase service is
contacted. SQL tests execute the actual migration against minimal fixture tables,
including authenticated and service-role writes; this is not a production schema
or RLS deployment certification.

Coverage includes October 1 issuance/October 3 event -> October 2 expiry,
same-day and next-day events, inclusive expiry and the following LA midnight,
expired acceptance and tokenless follow-ups, default/null/custom/legacy validity,
future/invalid issuance, exact versus free-text event dates, DST and year/month
boundaries, regeneration on later days, unchanged invoice behavior, old template
terms, missing/deleted quote selections, fresh event changes, failed database
writes, provider errors, confirmed sends, and interrupted-delivery retry guards.

During verification a timezone-specific invoice-test assumption was corrected:
invoice generation intentionally retains its existing local-date behavior;
quote issuance and expiry are business-calendar dates in every process timezone.
A redundant picker condition found by typecheck was removed. Final reruns passed.

## Evidence retained beside the checkout

Under `C:\Users\JDBusfield\Documents\Codex\2026-10-01\task`:

- `final-test-results.txt`, `timezone-utc-results.txt`, `timezone-auckland-results.txt`
- `final-typecheck-results.txt` (empty on successful exit)
- `lint-results.txt`, `baseline-lint.json`, `final-lint.json`, `changed-lint.json`,
  `lint-comparison.json`, and `compare-lint.mjs`
- `db-test-results.txt` and isolated `quote-db-test` test dependencies
- `quote-review/october-1-october-3.pdf`, `quote-review/same-day-review.pdf`,
  their `-1.png` renders, and `quote-pdf-qa.ts` for reproduction

## Remaining review and publication requirements

Confirm the explicit policy interpretations: LA business calendar for all current
brands, issuance at first save rather than first send, inclusive issuance-date
plus three days, earlier custom deadlines allowed, and same-day review with no
automated override. The 24/48-hour inventory-hold decision remains unresolved and
untouched. No tax, fee, rental-duration or price assumptions were introduced.

Review stored template/funnel overrides and custom quote terms before enabling
sends. The lexical guard detects common fixed-day promises; arbitrary prose or
contradictory absolute dates still require the documented manual audit. Historical
accepted quotes are preserved; legacy invalid quotes need individual review/reissue.

Email-provider delivery and database writes cannot form one atomic transaction.
The persisted delivery claim stops automatic retries; interrupted sends require
operator reconciliation. PDF stability here means persisted issue/expiry content,
not identical file bytes or a snapshot of mutable inquiry details. No browser E2E
session, production migration, authenticated live acceptance, live provider send,
or deployment was performed. The full Next.js production build was not run.

The prepared migration must accompany the code. Publication requires a reviewed
patch, coordinated rollout, legacy remediation approval and explicit authorization
to push/deploy/change production. This task created no PR, pushed no branch,
merged nothing, sent no customer emails, and changed no live CRM records.

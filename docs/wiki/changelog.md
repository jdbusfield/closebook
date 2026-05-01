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

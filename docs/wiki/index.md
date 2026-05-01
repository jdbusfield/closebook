---
title: Closebook Wiki
slug: index
section: Overview
order: 0
description: Single source of truth for how Closebook works and how it should be used.
---

# Closebook Wiki

Welcome to the **Closebook** wiki — the single source of truth for how the
application works and how it should be used. This wiki is maintained alongside
the codebase: every merged pull request that affects user-facing behavior
should be reflected here, and a corresponding entry added to the
[Changelog](/settings/wiki/changelog).

## What is Closebook?

Closebook is a multi-entity accounting and month-end-close management
application built for groups of related operating companies (subsidiaries,
holdcos, real estate LLCs, etc.). It centralizes the financial close, trial
balance reconciliation, intercompany eliminations, fixed assets, debt, leases,
payroll accruals, rebate tracking, and consolidated financial reporting in
one place.

Closebook is deployed at **closebook.vercel.app** and is the production
accounting platform for Silverco Enterprises and its affiliated entities.

## How this wiki is organized

| Section | What you will find |
| --- | --- |
| [Overview](/settings/wiki) | This page — the "what is Closebook" introduction. |
| [Getting Started](/settings/wiki/getting-started) | Setup, prerequisites, and first-use walkthrough. |
| [Core Concepts](/settings/wiki/core-concepts) | Domain model — organizations, entities, reporting entities, close periods. |
| [Usage Guide](/settings/wiki/usage-guide) | Step-by-step instructions for common workflows. |
| [Features](/settings/wiki/features) | Reference documentation for each major feature. |
| [Configuration](/settings/wiki/configuration) | Environment variables and customization. |
| [Architecture](/settings/wiki/architecture) | System design, data flow, integrations. |
| [Troubleshooting](/settings/wiki/troubleshooting) | Common issues and fixes. |
| [Changelog](/settings/wiki/changelog) | Chronological history of every PR-driven change. |
| [Onboarding Packet](/settings/wiki/accounting-manager-onboarding-packet) | Long-form onboarding document for incoming accounting managers. |

## How to add or update wiki content

The wiki is stored as Markdown files under `docs/wiki/` in the repository.
To add a new page:

1. Create `docs/wiki/<slug>.md` with the standard frontmatter block (`title`,
   `slug`, `section`, `order`, `description`).
2. Write your content in standard Markdown.
3. The new page will appear automatically the next time the app builds and
   deploys.

To update an existing page, edit the corresponding `.md` file and ship a PR.

## When a PR is merged

The Closebook Wiki Maintainer agent reviews every merged pull request and:

1. Updates any wiki sections whose documented behavior changed.
2. Appends an entry to [Changelog](/settings/wiki/changelog) with the PR
   number, title, author, summary, user impact, and migration notes.
3. Cross-links the changelog entry from any pages it touched.

If you ship a PR and notice the wiki has not been updated, ping the agent or
file an issue — stale documentation is a defect.

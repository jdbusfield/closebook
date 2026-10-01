# Closebook

Instructions for every coding agent in this repo. The project reference
(RentalWorks API, financial model rules, Supabase rules, gotchas) is
`.claude/CLAUDE.md`. Read it before changing anything.

## How to ship (Codex and other agents)

- Name branches `codex/...`. Open a PR against `main`. Never push to `main` and
  never merge your own PR. A merge deploys to production on Vercel.
- Migrations: write SQL under `supabase/migrations/` and stop. JD applies them.
  Add new tables to `database.types.ts`.
- This repo is public. Never commit secrets, `.env` values or customer data.
- Before opening the PR: `npm run lint`, `npm test`, `npm run build`.

## Review gate

Every PR gets a **Claude Review** check (`.github/workflows/claude-review.yml`).
It reads this file, `.claude/CLAUDE.md` and the diff, leaves inline comments and
one summary comment, and labels the PR `claude: pass`, `claude: flag` or
`claude: block`.

- **block** fails the check. Fix each listed item by pushing to the same branch;
  the review reruns on every push. If you think a finding is wrong, say why in a
  PR comment and leave it for JD. Never work around the check.
- **flag** passes, but JD reads the summary before merging (migrations, money
  math, auth, deletions, judgment calls).
- **pass** is clear to merge. Only JD or a Claude Code session working for JD
  merges.

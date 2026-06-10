import { NextResponse } from "next/server";
import { startWatch } from "@/lib/google/gmail";
import {
  backfillMailbox,
  reconcileMailbox,
  watchedMailboxes,
} from "@/lib/google/gmail-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// How far the daily repair sweep looks back. Deep enough to cover a missed
// cron day; Message-Id dedupe makes re-sweeping already-recorded mail a no-op.
const DEFAULT_BACKFILL_DAYS = 3;
const MAX_BACKFILL_DAYS = 30;

// ============================================================================
// Daily Gmail watch maintenance (also the one-time init).
//
// Gmail's users.watch expires after ~7 days, so it must be re-armed regularly.
// Running daily does three things per mailbox: (a) renews the watch, (b)
// reconciles from the stored cursor (catches missed pushes), and (c) runs a
// repair backfill over the last few days of mail — the cursor path can lose a
// message permanently (e.g. a transient fetch 404), and the backfill is what
// puts it back. `?backfillDays=N` (max 30) deepens the sweep for one-time
// recovery after an incident.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. The same secret
// authorizes a manual init (e.g. the first arming after Google is wired up).
// ============================================================================

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get("backfillDays"));
  const backfillDays =
    Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.min(Math.floor(requestedDays), MAX_BACKFILL_DAYS)
      : DEFAULT_BACKFILL_DAYS;

  const mailboxes = watchedMailboxes();
  if (mailboxes.length === 0) {
    return NextResponse.json({ ok: true, message: "No watched mailboxes configured" });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const mailbox of mailboxes) {
    try {
      const watch = await startWatch(mailbox);
      const counts = await reconcileMailbox(mailbox, watch.historyId, {
        watchExpiration: watch.expiration,
      });
      const backfill = await backfillMailbox(mailbox, backfillDays);
      results.push({
        mailbox,
        ok: true,
        expiration: watch.expiration,
        ...counts,
        backfill: { days: backfillDays, ...backfill },
      });
    } catch (err) {
      console.error("[cron/gmail-watch] failed for", mailbox, err);
      results.push({
        mailbox,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ ok: true, mailboxes: mailboxes.length, results });
}

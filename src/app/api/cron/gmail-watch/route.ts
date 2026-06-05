import { NextResponse } from "next/server";
import { startWatch } from "@/lib/google/gmail";
import { reconcileMailbox, watchedMailboxes } from "@/lib/google/gmail-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================================
// Daily Gmail watch maintenance (also the one-time init).
//
// Gmail's users.watch expires after ~7 days, so it must be re-armed regularly.
// Running daily both (a) renews the watch for every mailbox and (b) reconciles
// each mailbox from its stored cursor up to the watch's fresh historyId, which
// back-fills anything a missed Pub/Sub push left behind.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. The same secret
// authorizes a manual init (e.g. the first arming after Google is wired up).
// ============================================================================

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      results.push({ mailbox, ok: true, expiration: watch.expiration, ...counts });
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

import { createAdminClient } from "@/lib/supabase/admin";
import { ingestEmailMessage } from "@/lib/inquiries/ingest-message";
import {
  HistoryGoneError,
  getMessage,
  listAddedMessageIds,
} from "@/lib/google/gmail";

// ============================================================================
// Gmail sync orchestration shared by the Pub/Sub push receiver and the daily
// watch-renewal cron. Both ultimately do the same thing: pull every message
// added to a mailbox since our stored cursor, record it in the CRM, then
// advance the cursor.
// ============================================================================

/** The mailboxes we capture, from GMAIL_WATCHED_MAILBOXES (comma-separated). */
export function watchedMailboxes(): string[] {
  return (process.env.GMAIL_WATCHED_MAILBOXES ?? "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
}

export function isWatchedMailbox(addr: string): boolean {
  return watchedMailboxes().includes(addr.trim().toLowerCase());
}

export interface SyncCounts {
  processed: number;
  recorded: number;
  deduped: number;
  skipped: number;
}

/** Fetch + ingest every message added since `startHistoryId`. */
async function processHistory(
  mailbox: string,
  startHistoryId: string
): Promise<SyncCounts> {
  const counts: SyncCounts = { processed: 0, recorded: 0, deduped: 0, skipped: 0 };
  const ids = await listAddedMessageIds(mailbox, startHistoryId);
  for (const id of ids) {
    let parsed;
    try {
      parsed = await getMessage(mailbox, id);
    } catch (err) {
      // A single unreadable message must not stall the whole batch.
      console.error(`[gmail-sync] getMessage failed ${mailbox}/${id}`, err);
      continue;
    }
    counts.processed++;
    const result = await ingestEmailMessage({
      fromAddr: parsed.fromAddr,
      toAddrs: parsed.toAddrs,
      ccAddrs: parsed.ccAddrs,
      subject: parsed.subject,
      bodyText: parsed.bodyText,
      bodyHtml: parsed.bodyHtml,
      providerMessageId: parsed.messageId,
      gmailThreadId: parsed.threadId,
      receivedAt: parsed.internalDate,
      sentAt: parsed.isSent ? parsed.internalDate : null,
      directionHint: parsed.isSent ? "outbound" : "inbound",
    });
    if (result.deduped) counts.deduped++;
    else if (result.skipped) counts.skipped++;
    else if (result.ok) counts.recorded++;
  }
  return counts;
}

/**
 * Reconcile one mailbox up to `latestHistoryId` and store it as the new cursor.
 *
 * - First time we see a mailbox (no stored cursor): just record the cursor; we
 *   start capturing from the next change (can't backfill before a known point).
 * - Cursor too old (Gmail 404s history.list): reset to latest and move on.
 */
export async function reconcileMailbox(
  mailbox: string,
  latestHistoryId: string,
  extra?: { watchExpiration?: string }
): Promise<SyncCounts & { reset?: boolean; firstSeen?: boolean }> {
  const supabase = createAdminClient();
  const key = mailbox.trim().toLowerCase();
  const nowIso = new Date().toISOString();

  const { data: state } = await supabase
    .from("gmail_sync_state")
    .select("history_id")
    .eq("email_address", key)
    .maybeSingle();

  const stored = state?.history_id ?? null;

  let counts: SyncCounts = { processed: 0, recorded: 0, deduped: 0, skipped: 0 };
  let reset = false;
  const firstSeen = !stored;

  if (stored) {
    try {
      counts = await processHistory(mailbox, stored);
    } catch (err) {
      if (err instanceof HistoryGoneError) {
        reset = true; // cursor expired — skip the gap, resume from latest
      } else {
        throw err;
      }
    }
  }

  await supabase.from("gmail_sync_state").upsert(
    {
      email_address: key,
      history_id: latestHistoryId || stored,
      last_synced_at: nowIso,
      updated_at: nowIso,
      ...(extra?.watchExpiration ? { watch_expiration: extra.watchExpiration } : {}),
    },
    { onConflict: "email_address" }
  );

  return { ...counts, reset, firstSeen };
}

import { JWT, OAuth2Client } from "google-auth-library";

// ============================================================================
// Gmail API client for the HDR email-capture pipeline.
//
// Auth: a Google Cloud service account with DOMAIN-WIDE DELEGATION. We mint an
// access token that impersonates each watched mailbox (the `subject` field) and
// call the Gmail REST API directly with fetch — no heavyweight `googleapis`
// bundle. Scope is gmail.readonly: we only ever read.
//
// Flow this supports:
//   users.watch  -> arms a Pub/Sub notification when the mailbox changes
//   history.list -> the new message ids since the last cursor
//   messages.get -> the full message (parsed to a normalized shape)
// ============================================================================

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function getCreds(): { clientEmail: string; privateKey: string } {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  // Vercel stores the PEM with literal "\n"; turn them back into newlines.
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google service account not configured (GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY)"
    );
  }
  return { clientEmail, privateKey };
}

// One impersonating JWT client per mailbox; google-auth-library caches the
// access token internally and refreshes it as needed.
const jwtCache = new Map<string, JWT>();
function clientFor(mailbox: string): JWT {
  let client = jwtCache.get(mailbox);
  if (!client) {
    const { clientEmail, privateKey } = getCreds();
    client = new JWT({
      email: clientEmail,
      key: privateKey,
      scopes: SCOPES,
      subject: mailbox,
    });
    jwtCache.set(mailbox, client);
  }
  return client;
}

/** Thrown when Gmail returns 404 on history.list — the cursor is too old. */
export class HistoryGoneError extends Error {}

async function gapi<T>(
  mailbox: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const { token } = await clientFor(mailbox).getAccessToken();
  if (!token) throw new Error(`Could not mint access token for ${mailbox}`);
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 404) {
      throw new HistoryGoneError(`Gmail 404 ${path}: ${detail.slice(0, 200)}`);
    }
    throw new Error(`Gmail API ${res.status} ${path}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// history.list — message ids added since `startHistoryId`
// ---------------------------------------------------------------------------
interface HistoryListResponse {
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
}

/**
 * Returns the distinct message ids added to INBOX/SENT since `startHistoryId`.
 * Throws HistoryGoneError if the cursor has expired (caller should re-init).
 */
export async function listAddedMessageIds(
  mailbox: string,
  startHistoryId: string
): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
    });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await gapi<HistoryListResponse>(
      mailbox,
      `/users/${encodeURIComponent(mailbox)}/history?${qs.toString()}`
    );
    for (const h of data.history ?? []) {
      for (const m of h.messagesAdded ?? []) {
        if (m.message?.id) ids.add(m.message.id);
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return [...ids];
}

// ---------------------------------------------------------------------------
// messages.get — full message, parsed
// ---------------------------------------------------------------------------
interface GmailHeader {
  name?: string;
  value?: string;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
interface GmailMessageResponse {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

export interface ParsedGmailMessage {
  id: string;
  threadId: string;
  fromAddr: string | null;
  toAddrs: string[];
  ccAddrs: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  /** RFC Message-Id header — the dedupe key. */
  messageId: string | null;
  /** ISO timestamp from Gmail internalDate. */
  internalDate: string | null;
  /** True when the SENT label is present (staff sent it → outbound). */
  isSent: boolean;
}

function headerValue(part: GmailPart | undefined, name: string): string | null {
  const lower = name.toLowerCase();
  for (const h of part?.headers ?? []) {
    if (h.name?.toLowerCase() === lower) return h.value ?? null;
  }
  return null;
}

function decodeBody(data?: string): string | null {
  if (!data) return null;
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

// Pull the first text/plain and text/html bodies out of the MIME tree.
function collectBodies(
  part: GmailPart | undefined,
  acc: { text: string | null; html: string | null }
): void {
  if (!part) return;
  const mime = part.mimeType ?? "";
  if (mime === "text/plain" && acc.text === null) {
    acc.text = decodeBody(part.body?.data);
  } else if (mime === "text/html" && acc.html === null) {
    acc.html = decodeBody(part.body?.data);
  }
  for (const child of part.parts ?? []) collectBodies(child, acc);
}

// Extract bare email addresses from a header like:  "Name" <a@b.com>, c@d.com
function parseAddrList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((token) => {
      const m = token.match(/<([^>]+)>/);
      const addr = (m ? m[1] : token).trim();
      return addr;
    })
    .filter((a) => a.includes("@"));
}

export async function getMessage(
  mailbox: string,
  id: string
): Promise<ParsedGmailMessage> {
  const msg = await gapi<GmailMessageResponse>(
    mailbox,
    `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}?format=full`
  );

  const bodies = { text: null as string | null, html: null as string | null };
  collectBodies(msg.payload, bodies);

  const internalDate =
    msg.internalDate && /^\d+$/.test(msg.internalDate)
      ? new Date(Number(msg.internalDate)).toISOString()
      : null;

  return {
    id: msg.id,
    threadId: msg.threadId,
    fromAddr: parseAddrList(headerValue(msg.payload, "From"))[0] ?? null,
    toAddrs: parseAddrList(headerValue(msg.payload, "To")),
    ccAddrs: parseAddrList(headerValue(msg.payload, "Cc")),
    subject: headerValue(msg.payload, "Subject"),
    bodyText: bodies.text,
    bodyHtml: bodies.html,
    messageId: headerValue(msg.payload, "Message-Id"),
    internalDate,
    isSent: (msg.labelIds ?? []).includes("SENT"),
  };
}

// ---------------------------------------------------------------------------
// users.watch / users.stop — arm or cancel Pub/Sub notifications
// ---------------------------------------------------------------------------
export interface WatchResult {
  historyId: string;
  /** ISO timestamp the watch expires (Gmail caps at ~7 days). */
  expiration: string;
}

export async function startWatch(mailbox: string): Promise<WatchResult> {
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) throw new Error("GMAIL_PUBSUB_TOPIC not configured");
  const data = await gapi<{ historyId?: string; expiration?: string }>(
    mailbox,
    `/users/${encodeURIComponent(mailbox)}/watch`,
    {
      method: "POST",
      body: JSON.stringify({
        topicName,
        labelIds: ["INBOX", "SENT"],
        labelFilterBehavior: "INCLUDE",
      }),
    }
  );
  return {
    historyId: data.historyId ?? "",
    expiration:
      data.expiration && /^\d+$/.test(data.expiration)
        ? new Date(Number(data.expiration)).toISOString()
        : "",
  };
}

export async function stopWatch(mailbox: string): Promise<void> {
  await gapi(mailbox, `/users/${encodeURIComponent(mailbox)}/stop`, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Pub/Sub push authentication — verify the OIDC token Google signs the push with
// ---------------------------------------------------------------------------
const oauthClient = new OAuth2Client();

/**
 * Verify a Pub/Sub push request's `Authorization: Bearer <OIDC JWT>`.
 * Confirms Google signed it AND it was issued for our push service account.
 */
export async function verifyPushToken(
  authHeader: string | null,
  expectedAudience: string | undefined
): Promise<boolean> {
  const expectedEmail = process.env.GMAIL_PUSH_SERVICE_ACCOUNT;
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: token,
      audience: expectedAudience,
    });
    const payload = ticket.getPayload();
    if (!payload) return false;
    if (payload.email_verified !== true) return false;
    if (expectedEmail && payload.email !== expectedEmail) return false;
    return true;
  } catch {
    return false;
  }
}

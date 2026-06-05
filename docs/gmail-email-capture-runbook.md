# HDR Gmail email capture → rental-inquiry CRM — setup runbook

Captures **received and sent** mail for the HDR `sales@` inbox + key reps from
Google Workspace and records every customer message on the matching rental
inquiry — automatically, in real time. This is the "Einstein Activity Capture"
pattern, scoped to HDR.

```
Gmail mailbox (sales@, rep1@, rep2@)
   │  users.watch(INBOX, SENT)  ── renewed daily (watch expires in 7 days)
   ▼
Cloud Pub/Sub topic  ──push (OIDC-signed)──►  Closebook  POST /api/webhooks/gmail
                                                  │  (service account, domain-wide
                                                  │   delegation, gmail.readonly)
                                                  ▼
                                   history.list → messages.get → parse
                                                  ▼
                            ingestEmailMessage()  (match · dedupe · classify · record)
                                                  ▼
                                   rental_inquiry_messages (thread-sticky)
```

The application code is already deployed. What remains is **(1) the DB
migration, (2) the Google Cloud wiring, (3) the env vars, (4) arming the
watch.** Steps 2–3 require a Google Workspace **super-admin**.

---

## 1. Run the database migration (do this BEFORE deploying the code)

Apply `supabase/migrations/20260604_gmail_sync.sql` to production. It adds:
- `gmail_sync_state` — one sync-cursor row per watched mailbox.
- `rental_inquiry_messages.gmail_thread_id` (+ index) — thread stickiness.

---

## 2. Google Cloud + Workspace setup

### 2a. Project & APIs
1. In the [Google Cloud Console](https://console.cloud.google.com), create or
   pick a project (e.g. `hdr-email-capture`).
2. **APIs & Services → Enable APIs**: enable **Gmail API** and **Cloud Pub/Sub API**.

### 2b. Service account (reads mail) + key
1. **IAM & Admin → Service Accounts → Create**: name it `hdr-gmail-sync`.
2. On the new SA → **Keys → Add key → JSON**. Download it. From the JSON you
   need `client_email` and `private_key` (for env vars in step 3).
3. Note the SA's **numeric Unique ID / Client ID** (shown on the SA details) —
   used for domain-wide delegation next.

### 2c. Domain-wide delegation (lets the SA read the chosen mailboxes)
1. **Google Workspace Admin** (admin.google.com) → **Security → Access and data
   control → API controls → Domain-wide delegation → Add new**.
2. **Client ID** = the SA's numeric Client ID from 2b.
3. **OAuth scopes** = `https://www.googleapis.com/auth/gmail.readonly`
4. Authorize.

> ⚠️ **Privacy:** this grants the service account **full read** of the mailboxes
> you list in `GMAIL_WATCHED_MAILBOXES` (subject + body). Internal staff↔staff
> mail is filtered out before it reaches the CRM, but the *capability* is full
> read. Give the affected reps a heads-up.

### 2d. Pub/Sub topic (Gmail publishes change notifications here)
1. **Pub/Sub → Topics → Create topic**: id `gmail-hdr-inbound`.
   Full name: `projects/<PROJECT_ID>/topics/gmail-hdr-inbound`.
2. On the topic → **Permissions → Add principal**:
   - Principal: `gmail-api-push@system.gserviceaccount.com`
   - Role: **Pub/Sub Publisher**
   (This is Google's shared Gmail push SA — it must be allowed to publish.)

### 2e. Push subscription (delivers notifications to Closebook)
1. Create a **second** service account, e.g. `gmail-push` (this is the identity
   the push request is signed with — it does NOT need delegation).
2. On the topic → **Create subscription**:
   - **Delivery type:** Push
   - **Endpoint URL:** `https://closebook.vercel.app/api/webhooks/gmail`
   - **Enable authentication:** ON
     - **Service account:** `gmail-push@<PROJECT_ID>.iam.gserviceaccount.com`
     - **Audience:** `https://closebook.vercel.app/api/webhooks/gmail`
       (set the env var `GMAIL_PUSH_AUDIENCE` to this same value)
   - **Ack deadline:** 60s; leave retry policy default.

---

## 3. Environment variables (Closebook → Vercel, Production)

| Var | Value |
| --- | --- |
| `GOOGLE_SA_CLIENT_EMAIL` | the SA `client_email` from 2b |
| `GOOGLE_SA_PRIVATE_KEY` | the SA `private_key` (keep the literal `\n`s; wrap in quotes) |
| `GMAIL_PUBSUB_TOPIC` | `projects/<PROJECT_ID>/topics/gmail-hdr-inbound` |
| `GMAIL_PUSH_SERVICE_ACCOUNT` | `gmail-push@<PROJECT_ID>.iam.gserviceaccount.com` |
| `GMAIL_PUSH_AUDIENCE` | `https://closebook.vercel.app/api/webhooks/gmail` |
| `GMAIL_WATCHED_MAILBOXES` | `sales@hdrsiteservices.com,<rep1>@hdrsiteservices.com,<rep2>@hdrsiteservices.com` |
| `INBOUND_EMAIL_SECRET` | (already set) — also the manual-test fallback |
| `CRON_SECRET` | (already set) — authorizes the watch cron |

Redeploy after setting them.

---

## 4. Arm the watch (one-time init) + ongoing renewal

- **Init now:** hit the watch endpoint once with the cron secret:
  ```
  curl -H "Authorization: Bearer $CRON_SECRET" \
       https://closebook.vercel.app/api/cron/gmail-watch
  ```
  It arms `users.watch` for each mailbox and stores the cursor + expiration.
- **Ongoing:** the Vercel cron `/api/cron/gmail-watch` runs **daily at 08:00 UTC**
  (registered in `vercel.json`) to re-arm the watch (Gmail expires it every 7
  days) and reconcile any missed pushes.

---

## 5. Verify (end-to-end)

1. **Inbound:** from an external address, email `sales@hdrsiteservices.com`
   referencing an existing inquiry's customer email (or put its `HDR-XXXXX`
   reference in the subject). Within seconds it should appear on that inquiry's
   timeline in Closebook. Reload → it persists. Send the same message again →
   **no duplicate** (Message-Id dedupe).
2. **Outbound:** a rep **replies from Gmail**. The sent copy lands on the same
   inquiry as `outbound` (thread stickiness keeps it on the right deal even if
   the subject loses the `HDR-XXXXX` tag).
3. **Noise filter:** a staff↔staff internal email is **not** recorded.
4. **Scope:** a mailbox not in `GMAIL_WATCHED_MAILBOXES` records nothing.

---

## Notes / troubleshooting

- **Nothing arriving?** Check the Vercel logs for `/api/webhooks/gmail`. A 401
  means the OIDC token/audience doesn't match — re-check the subscription's
  service account + audience vs `GMAIL_PUSH_SERVICE_ACCOUNT` / `GMAIL_PUSH_AUDIENCE`.
- **`Gmail 404` on history.list** is handled automatically: the cursor expired,
  so the sync resets to the latest history id and resumes (a small gap may be
  skipped). The daily cron keeps the cursor fresh so this is rare.
- **Resend-sent site mail** (the inquiry auto-replies) does **not** appear in the
  Gmail SENT folder — it's sent from Resend's infra — so there's no double-count
  with the existing `/api/inquiries/ingest` path.
- The old Cloudflare Email Worker (`hdr-inbound-email-worker`) is now **obsolete**
  — MX points at Google, so it never sees the mail. This pipeline replaces it.

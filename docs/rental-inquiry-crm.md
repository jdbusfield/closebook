# Rental Inquiry CRM (HDR) — setup & runbook

A lightweight CRM that tracks inbound rental inquiries from the HDR marketing
site (hdrsiteservices.com), the emails exchanged with each customer, and per-email
delivery/open status. It lives inside Closebook, scoped to the **Hollywood Depot
Rentals** entity, and is kept separate from the org-wide `crm_*` production CRM.

## What was built

**Closebook (`accounting-app`)**
- Migration `supabase/migrations/20260528_rental_inquiries.sql` — tables
  `rental_inquiries`, `rental_inquiry_messages`, `rental_inquiry_email_events`
  (entity-scoped to HDR, RLS via `user_entity_ids()`).
- `src/lib/inquiries/shared.ts` — HDR entity id, status set, reference parser.
- API routes:
  - `POST /api/inquiries/ingest` — intake from the website (Bearer `INQUIRY_INGEST_SECRET`).
  - `POST /api/webhooks/inbound-email` — captures inbox replies (header `x-inbound-secret` = `INBOUND_EMAIL_SECRET`).
  - `POST /api/webhooks/resend` — delivery/open events (Svix-signed with `RESEND_WEBHOOK_SECRET`).
  - `PATCH /api/inquiries/[id]` — in-app status / notes / RW links (session-auth, RLS-guarded).
- UI at `/{hdrEntityId}/inquiries` (list) and `/{hdrEntityId}/inquiries/{id}` (detail
  with status, email timeline, delivery/open chips). Nav item appears under **Sales**
  for HDR (feature flag `inquiries`).

**Marketing site (`hdr-landing`)**
- `app/api/inquiry/route.ts` now CCs `LEAD_CC_EMAIL`, tags sends with the reference,
  captures the Resend email ids, and forwards each inquiry to Closebook's ingest endpoint.

## Environment variables

**Closebook** (Vercel → Project → Settings → Environment Variables)
| Var | Purpose |
| --- | --- |
| `INQUIRY_INGEST_SECRET` | Shared secret for the website → ingest call. Must equal hdr-landing's `CLOSEBOOK_INGEST_SECRET`. |
| `INBOUND_EMAIL_SECRET` | Shared secret the inbound-email provider sends as `x-inbound-secret`. |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signing secret (starts with `whsec_`). |
| `HDR_ENTITY_ID` | Optional override; defaults to the HDR entity constant. |
| `LEAD_FROM_DOMAIN` | Optional; defaults to `hdrsiteservices.com` (used to classify staff vs customer replies). |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Already set — used by the admin client for webhook writes. |

**hdr-landing**
| Var | Purpose |
| --- | --- |
| `LEAD_CC_EMAIL` | Group address CC'd on every response (also the capture address). |
| `CLOSEBOOK_INGEST_URL` | e.g. `https://closebook.vercel.app/api/inquiries/ingest`. |
| `CLOSEBOOK_INGEST_SECRET` | Equals Closebook's `INQUIRY_INGEST_SECRET`. |

## External configuration (one-time)

1. **Apply the migration** to Supabase, then regenerate `database.types.ts`
   (already updated by hand here; regenerate if you change the schema).
2. **Group / capture address.** Choose the address to CC for visibility (e.g.
   `crm@hdrsiteservices.com`). Set it as `LEAD_CC_EMAIL` on hdr-landing.
3. **Inbound parsing.** Point that address at `POST /api/webhooks/inbound-email`,
   sending the shared secret as header `x-inbound-secret`. Recommended: **Resend
   Inbound** (the domain is already verified in Resend). Cloudflare Email Routing →
   Worker, or Postmark/SendGrid inbound parse work identically.
4. **Reliable reply capture (recommended).** Add a forwarding rule on the `sales@`
   mailbox that copies *all* inbound + sent mail to the capture address. This catches
   replies even when a customer hits "Reply" instead of "Reply All" (a plain reply
   would otherwise omit the CC'd group address — see Limitation below).
5. **Resend webhook.** In the Resend dashboard add a webhook → `POST /api/webhooks/resend`
   for `email.sent/delivered/opened/clicked/bounced/complained`; copy the signing
   secret to `RESEND_WEBHOOK_SECRET`. Enable open/click tracking on the sending domain.

## Matching logic

- Inbound emails are matched to an inquiry by the **`HDR-XXXXX` reference** in the
  subject (carried in every auto-reply/internal subject and preserved on in-thread
  replies). Fallback: the most recent open inquiry whose customer email is a
  participant. Unmatched mail is logged and acknowledged (no provider retry storm).
- Resend events join to a message via the stored `resend_email_id`.

## Limitation

A plain **"Reply"** (not Reply-All) by a customer omits the CC'd group address, so CC
alone would miss it. The `sales@` mailbox forwarding rule (step 4) eliminates this by
copying all mail server-side, independent of reply behavior.

## Verify end-to-end

1. Submit the form on hdrsiteservices.com → a row appears in `/{hdrEntityId}/inquiries`
   with two outbound emails on the detail timeline.
2. Reply to that thread CC'ing the capture address (keep `HDR-XXXXX` in the subject)
   → an inbound/outbound message attaches to the inquiry.
3. Open the customer email → the outbound message shows `delivered` then `opened`.
4. Change status in the dashboard → persists; a non-HDR user cannot edit (RLS).

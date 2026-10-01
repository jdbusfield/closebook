# Quote price validity: policy and rollout

This change is prepared locally for review. The SQL migration is staged as a file;
it has not been applied to production. No production quotes, templates, funnel
enrollments, or customer messages were changed. Publishing, applying migrations,
pausing production automation, correcting records, and emailing customers require
separate authorization.

## Calendar policy

- All supported brands use the `America/Los_Angeles` business calendar. This is
  an explicit implementation interpretation to confirm before publication; it
  does not use the viewer's, server process's, or event location's timezone.
- Issuance is the server timestamp of the quote's first save, persisted in
  `created_at`, including when the initial status is `draft`. Sending or
  downloading it later does not restart validity.
- The default inclusive `valid_until` date is the earlier of the issuance date
  plus three calendar days and the calendar day before the exact event start
  date. Weekends and holidays count. This is date arithmetic, not a 72-hour
  timer. Expiration occurs at the following Los Angeles midnight, including
  daylight-saving changes.
- A rep may explicitly choose an earlier date between the issuance date and
  that limit, inclusive. A later custom date is rejected. An unspecified default
  is sent to the database as `NULL`; the insertion trigger derives the saved
  date from its own issuance timestamp, avoiding browser-clock and midnight
  differences. A persisted legacy `NULL` is never unlimited validity.
- Same-day, past, missing, invalid, or free-text event dates require review.
  Such requests may be saved as drafts without validity, but cannot be sent,
  enrolled in a quote funnel, or accepted. There is no emergency override.
  Confirm the actual exact future event date and issue a new quote when the
  policy permits; do not invent or move the event date to bypass this rule.
- Saved issuance, expiry, entity, and inquiry association are immutable. Reissue
  as a new quote when a saved quote cannot satisfy policy. A review flag alone
  does not grant permission to send or accept it.

| Issued in Los Angeles | Event start | Default valid through |
| --- | --- | --- |
| October 1, 2026 | October 20, 2026 | October 4, 2026 |
| October 1, 2026 | October 3, 2026 | October 2, 2026 |
| October 1, 2026 | October 2, 2026 | October 1, 2026 |
| October 1, 2026 | October 1, 2026 | Review draft; no validity date |

The database enforces the same calendar policy for app and embed writes. Send
and acceptance paths also validate current persisted quote and event dates.
PDFs and email merges use the saved issuance and expiry; regenerated PDFs do
not issue a new quote. Existing accepted quotes remain historical acceptances;
the migration does not revoke them as time passes.

Price validity is separate from inventory or date holds. The unresolved
24-versus-48-hour hold policy is preserved for a separate decision. This change
does not authorize changes to pricing, taxes, fees, rental duration, or existing
delivery and inventory-hold commitments.

## Required legacy audit before enabling sends

The migration deliberately performs no backfill and no bulk rewrite. Changing
the code defaults does not replace database overrides. Review every applicable
entity, including inactive material that could later be resumed or restored:

1. `rental_inquiry_templates`: default overrides and custom subject/body text.
2. `rental_inquiry_funnel_steps`: every step's subject/body, including follow-ups
   without a `{quote}` token and steps in archived funnels.
3. `rental_inquiry_quotes`: `terms`, `created_at`, `valid_until`, status, and the
   linked inquiry's exact `start_date`.
4. `rental_inquiry_funnel_enrollments`: active/paused chains, their pinned quote,
   next step, and any stopped review or delivery-reconciliation state.

After approval, replace fixed promises such as "good for 3 days", "held for 14
days", or "pricing stands for fourteen days" in reusable email copy with
`{quote_validity}`. `{quote_valid_until}` and `{quote_issued_on}` are also
available; `{quote_validity}` includes the timezone. `{quote}` includes the saved
issuance and expiry with the quote totals. Check the rendered result against the
PDF before enabling the template or funnel. Preserve unrelated text, especially
inventory-hold terms. Record the reviewed IDs and exact approved changes.

The runtime regex catches common fixed-day pricing promises, not every possible
sentence. Manually inspect absolute dates, unusual wording, and contextual
promises too: "valid through October 15" can contradict a saved October 2 expiry
without matching that detector. Passing automated validation does not replace
this audit. Review existing saved quote terms rather than silently removing or
rewriting their historical commitments. Create a new quote with reviewed terms
where a legacy quote is invalid or ambiguous.

Quotes with missing issuance, missing validity, an excessive legacy expiry, an
expired deadline, or conflicting terms must not be sent or newly accepted.
Previously accepted rows are preserved. Do not mass-mark historic drafts as
sent merely because the inquiry stage is Quote Sent; reconcile actual delivery
evidence individually. Legacy quote funnels with no pinned quote need review
and explicit re-enrollment rather than silently choosing a newer quote.

The reported Natasha inquiry `HDR-4LIX9`, quote `Q1242`, illustrates the issue:
October 1 issuance for an October 3 rental should yield October 2 validity under
this policy, while the reported PDF said October 15 and the email promised three
days. This preparation does not change that live record or retract a customer
commitment. Staff must review the actual saved quote and correspondence, decide
the appropriate correction/reissue, and send any corrected email manually after
authorization. A later reissue uses its actual issuance date and must still pass
the event-date rule.

### Optional read-only audit query

This query is provided for a later authorized audit and has not been run against
production. Replace the zero UUID with one reviewed entity ID. Start with both
cursor values `NULL`, then use the last returned `source` and `id` for the next
page. Continue until no rows remain; reconcile collected counts against
`source_total` for each source. Repeat for each entity. Prefer a consistent
read-only snapshot when collecting multiple pages. Do not filter only for a
particular phrase: doing so would miss custom wording.

```sql
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS entity_id,
         NULL::text AS after_source,
         NULL::uuid AS after_id
), audit AS (
  SELECT 'template'::text AS source, t.id,
         jsonb_build_object('key', t.template_key, 'archived', t.archived,
           'subject', t.subject, 'body', t.body) AS record
  FROM public.rental_inquiry_templates t, params p
  WHERE t.entity_id = p.entity_id
  UNION ALL
  SELECT 'funnel_step', s.id,
         jsonb_build_object('funnel_id', s.funnel_id, 'day_offset', s.day_offset,
           'subject', s.subject, 'body', s.body)
  FROM public.rental_inquiry_funnel_steps s, params p
  WHERE s.entity_id = p.entity_id
  UNION ALL
  SELECT 'quote', q.id,
         jsonb_build_object('number', q.quote_number, 'inquiry_id', q.inquiry_id,
           'status', q.status, 'created_at', q.created_at,
           'valid_until', q.valid_until, 'terms', q.terms,
           'event_start', i.start_date)
  FROM public.rental_inquiry_quotes q
  LEFT JOIN public.rental_inquiries i
    ON i.id = q.inquiry_id AND i.entity_id = q.entity_id
  CROSS JOIN params p
  WHERE q.entity_id = p.entity_id
  UNION ALL
  SELECT 'enrollment', e.id,
         jsonb_build_object('inquiry_id', e.inquiry_id, 'funnel_id', e.funnel_id,
           'quote_id', e.quote_id, 'status', e.status, 'steps_sent', e.steps_sent,
           'next_send_at', e.next_send_at, 'stopped_reason', e.stopped_reason)
  FROM public.rental_inquiry_funnel_enrollments e, params p
  WHERE e.entity_id = p.entity_id
), counted AS (
  SELECT *, count(*) OVER (PARTITION BY source) AS source_total FROM audit
)
SELECT a.* FROM counted a CROSS JOIN params p
WHERE p.after_source IS NULL OR (a.source, a.id) > (p.after_source, p.after_id)
ORDER BY a.source, a.id
LIMIT 100;
```

## Coordinated publication checklist

1. Review this policy interpretation, the patch, migration
   `supabase/migrations/20261001_quote_calendar_validity.sql`, and the separate
   verification evidence. Obtain publication and production-change authorization.
2. In an isolated test database, apply the migration and exercise app, embed,
   and funnel paths. The new client relies on the server trigger for default
   expiry; publishing code without that migration is incomplete.
3. Before the production cutover, disable scheduled funnel delivery and prevent
   day-zero enrollment sends and quote mutations during the maintenance window.
   Stopping cron alone does not stop inline enrollment sends. Record the prior
   automation state so only intended, reviewed enrollments are later restored.
4. Complete the legacy audit and separately approved template/record remediation.
   Keep unresolved quotes and chains stopped for staff review.
5. Apply the migration and deploy matching code in the same controlled window.
   Verify schema/trigger installation and the deployed revision before reopening
   writes. Old code can submit the former 14-day default, which the new trigger
   rejects; avoid an extended mixed-version interval.
6. Verify saved issuance/expiry agreement across builder, email preview, PDF,
   re-download, app/embed acceptance, and a controlled delivery test with a
   designated test recipient. Customer emails require explicit authorization.
7. Restore only reviewed automation. Watch quote-review stops, delivery-pending
   states, provider delivery records, and quote/inquiry status agreement.

If a cutover fails, keep sends and writes disabled while reconciling the deployed
code/schema pair. Do not drop validity safeguards, rewrite historical expiry, or
blindly restart a backlog as an improvised rollback.

## Successful sends and interrupted delivery

A quote-bearing email marks a draft quote `sent` after provider success; failures
before delivery must not falsely mark it sent. Before contacting the provider,
the sender records a stopped `delivery_pending:<step-id>` enrollment claim and
uses a stable provider idempotency key. Normal success records the outbound
message, updates quote/activity/stage state, and advances the enrollment.

A provider timeout or a database failure after sending can leave the delivery
claim stopped for review. **Do not retry, resume, or start a replacement funnel
to clear that condition.** Check the provider result, recipient, enrollment and
step IDs, idempotency key, and CRM outbound history first. Reconcile any missing
message, quote status, and cursor only through an explicitly approved repair;
preserve evidence of delivery. Do not rely on provider idempotency indefinitely.
If sending happened across the expiry boundary, review the actual customer
message and saved state rather than extending the quote to make an update pass.

## Regression evidence

The prepared regression suites cover the calendar helper, PDF/email rendering
and re-download stability, app quote mutations, embed route writes, and funnel
quote validation/delivery behavior under
`src/lib/inquiries/__tests__/`. Review exact commands, results, SQL validation,
and remaining environment limitations in the task's verification evidence;
this runbook does not certify an unexecuted production rollout.

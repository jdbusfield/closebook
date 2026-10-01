/**
 * Offline PostgreSQL regression tests. PGlite runs entirely in memory; this
 * script never reads app credentials, connects to Supabase, or updates a file DB.
 *
 * Install the isolated test dependency outside the checkout:
 * npm install --prefix ../quote-db-test --ignore-scripts --no-package-lock @electric-sql/pglite@0.3.14
 * PowerShell:
 * $env:PGLITE_MODULE = (Resolve-Path ../quote-db-test/node_modules/@electric-sql/pglite/dist/index.js).Path
 * node scripts/test-quote-validity-db.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const moduleName = process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href
  : '@electric-sql/pglite';
const { PGlite } = await import(moduleName);
const db = new PGlite();
const migration = await readFile(new URL('../supabase/migrations/20261001_quote_calendar_validity.sql', import.meta.url), 'utf8');
const entity = '10000000-0000-0000-0000-000000000001';
const otherEntity = '10000000-0000-0000-0000-000000000002';

await db.exec(`
  CREATE TABLE public.rental_inquiries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_id uuid NOT NULL, start_date text
  );
  CREATE TABLE public.rental_inquiry_quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_id uuid NOT NULL,
    inquiry_id uuid NOT NULL REFERENCES rental_inquiries(id),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
    valid_until date, terms text, created_at timestamptz DEFAULT now(), accepted_at timestamptz
  );
  CREATE ROLE authenticated;
  CREATE ROLE service_role BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
`);

const row = async (sql, values = []) => (await db.query(sql, values)).rows[0];
const today = (await row("SELECT (statement_timestamp() AT TIME ZONE 'America/Los_Angeles')::date::text AS day")).day;
const addDays = (day, count) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
};
const day = count => addDays(today, count);
const inquiry = async start => (await row(
  'INSERT INTO rental_inquiries (entity_id,start_date) VALUES ($1,$2) RETURNING id', [entity, start],
)).id;
const quote = async (start, { valid = null, issued = null, status = 'draft', terms = null } = {}) => {
  const inquiryId = await inquiry(start);
  return row(`INSERT INTO rental_inquiry_quotes (entity_id,inquiry_id,valid_until,created_at,status,terms)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,inquiry_id,valid_until::text,created_at::text,status,accepted_at::text`,
  [entity, inquiryId, valid, issued, status, terms]);
};
const setStatus = (id, status) => db.query('UPDATE rental_inquiry_quotes SET status=$2 WHERE id=$1', [id, status]);
const check = (issued, expires, event, clock, terms = null) => db.query(
  'SELECT assert_rental_quote_calendar_validity($1::timestamptz,$2::date,$3::text,$4::text,$5::timestamptz)',
  [issued, expires, event, terms, clock],
);
const fails = (fn, message) => assert.rejects(fn, error => error.code === '23514' && message.test(error.message));

// Representative legacy data predates the migration, including null dates and
// currently inconsistent rows. Nothing should be backfilled or silently fixed.
const legacyNull = await quote(day(10));
const legacyExpired = await quote(day(10), { valid: day(-2), issued: `${day(-5)}T12:00:00Z` });
const legacyLong = await quote(day(20), { valid: day(14), issued: `${today}T12:00:00Z` });
const legacyAccepted = await quote(day(-1), { valid: day(-7), issued: `${day(-10)}T12:00:00Z`, status: 'accepted' });
await db.query('UPDATE rental_inquiry_quotes SET accepted_at=$2 WHERE id=$1', [legacyAccepted.id, `${day(-9)}T12:00:00Z`]);
const legacyFuture = await quote(day(10), { valid: day(4), issued: `${day(1)}T12:00:00Z` });
const before = (await db.query('SELECT * FROM rental_inquiry_quotes ORDER BY id')).rows;

await test('migration preserves legacy rows and is safely repeatable', async () => {
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await db.query('SELECT * FROM rental_inquiry_quotes ORDER BY id')).rows, before);
});

await test('October 1 / October 3 expires October 2; distant event expires October 4', async () => {
  assert.equal((await row("SELECT rental_quote_validity_limit('2026-10-01','2026-10-03')::text AS expiry")).expiry, '2026-10-02');
  assert.equal((await row("SELECT rental_quote_validity_limit('2026-10-01','2026-10-20')::text AS expiry")).expiry, '2026-10-04');
});

await test('next-day expires on issuance; same-day, past, missing and ambiguous dates require review', async () => {
  assert.equal((await row("SELECT rental_quote_validity_limit('2026-10-01','2026-10-02')::text AS expiry")).expiry, '2026-10-01');
  for (const event of ['2026-10-01', '2026-09-30', null, '', '10/03/2026', '2026-10-03T09:00:00Z', '2026-02-30']) {
    assert.equal((await row("SELECT rental_quote_validity_limit('2026-10-01',$1)::text AS expiry", [event])).expiry, null, `${event}`);
  }
});

await test('inclusive expiry switches at Los Angeles midnight, independently of session timezone', async () => {
  for (const zone of ['UTC', 'Pacific/Auckland']) {
    await db.exec(`SET TIME ZONE '${zone}'`);
    await check('2026-10-01T12:00:00Z', '2026-10-01', '2026-10-20', '2026-10-02T06:59:59Z');
    await fails(() => check('2026-10-01T12:00:00Z', '2026-10-01', '2026-10-20', '2026-10-02T07:00:00Z'), /expired/);
    // UTC October 1 is still September 30 in the business calendar.
    await fails(() => check('2026-10-01T00:00:00Z', '2026-10-04', '2026-10-20', '2026-10-01T12:00:00Z'), /policy/);
  }
  await db.exec("SET TIME ZONE 'UTC'");
});

await test('DST transitions use calendar days rather than 72 hours', async () => {
  await check('2026-11-01T06:30:00Z', '2026-11-03', '2026-11-20', '2026-11-04T07:59:59Z');
  await fails(() => check('2026-11-01T06:30:00Z', '2026-11-03', '2026-11-20', '2026-11-04T08:00:00Z'), /expired/);
  await check('2026-03-07T20:00:00Z', '2026-03-10', '2026-03-20', '2026-03-11T06:59:59Z');
  await fails(() => check('2026-03-07T20:00:00Z', '2026-03-10', '2026-03-20', '2026-03-11T07:00:00Z'), /expired/);
});

await test('new null-validity draft is server-stamped with the event-capped default', async () => {
  const saved = await quote(day(2), { issued: '2099-01-01T00:00:00Z' });
  assert.equal(saved.valid_until, day(1));
  assert.equal((await row('SELECT abs(extract(epoch FROM (created_at-statement_timestamp()))) < 5 AS fresh FROM rental_inquiry_quotes WHERE id=$1', [saved.id])).fresh, true);
  assert.equal((await quote(day(20))).valid_until, day(3));
  const nextDay = await quote(day(1));
  assert.equal(nextDay.valid_until, today);
  await setStatus(nextDay.id, 'sent');
});

await test('earlier custom validity is preserved, but validity before issuance or beyond cap is rejected', async () => {
  assert.equal((await quote(day(20), { valid: day(1) })).valid_until, day(1));
  await fails(() => quote(day(20), { valid: day(-1) }), /validity must/);
  await fails(() => quote(day(20), { valid: day(4) }), /validity must/);
  await fails(() => quote(day(2), { valid: day(2) }), /validity must/);
});

await test('review drafts persist null and cannot be sent or accepted', async () => {
  for (const start of [today, day(-1), null, '', '10/03/2026', '2026-02-30']) {
    const saved = await quote(start);
    assert.equal(saved.valid_until, null);
    await fails(() => setStatus(saved.id, 'sent'), /review required/);
    await fails(() => setStatus(saved.id, 'accepted'), /review required/);
    await fails(() => quote(start, { valid: today }), /validity must/);
  }
});

await test('inserts directly into sent or accepted are validated and acceptance is server-stamped', async () => {
  await fails(() => quote(today, { status: 'sent' }), /review required/);
  await fails(() => quote(today, { status: 'accepted' }), /review required/);
  const accepted = await quote(day(10), { status: 'accepted' });
  assert.ok(accepted.accepted_at);
  assert.equal((await row('SELECT abs(extract(epoch FROM (accepted_at-statement_timestamp()))) < 5 AS fresh FROM rental_inquiry_quotes WHERE id=$1', [accepted.id])).fresh, true);
});

await test('saved dates and parent are immutable, including null legacy issuance', async () => {
  const saved = await quote(day(10));
  for (const sql of [
    'UPDATE rental_inquiry_quotes SET created_at=statement_timestamp() WHERE id=$1',
    'UPDATE rental_inquiry_quotes SET created_at=NULL WHERE id=$1',
    'UPDATE rental_inquiry_quotes SET valid_until=NULL WHERE id=$1',
    "UPDATE rental_inquiry_quotes SET valid_until=valid_until+1 WHERE id=$1",
  ]) await fails(() => db.query(sql, [saved.id]), /cannot be changed/);
  await fails(() => db.query('UPDATE rental_inquiry_quotes SET created_at=now() WHERE id=$1', [legacyNull.id]), /cannot be changed/);
  const otherInquiry = await inquiry(day(10));
  await fails(() => db.query('UPDATE rental_inquiry_quotes SET inquiry_id=$2 WHERE id=$1', [saved.id, otherInquiry]), /cannot be changed/);
  await fails(() => db.query('UPDATE rental_inquiry_quotes SET entity_id=$2 WHERE id=$1', [saved.id, otherEntity]), /cannot be changed/);
});

await test('expired, null, overlong and future-issued legacy quotes cannot be accepted', async () => {
  for (const saved of [legacyNull, legacyExpired, legacyLong, legacyFuture]) {
    await fails(() => setStatus(saved.id, 'accepted'), /issuance|policy|expired/);
    await fails(() => setStatus(saved.id, 'sent'), /issuance|policy|expired/);
  }
});

await test('fresh inquiry dates are rechecked before acceptance and repeated sent updates', async () => {
  const saved = await quote(day(10));
  await setStatus(saved.id, 'sent');
  await db.query('UPDATE rental_inquiries SET start_date=$2 WHERE id=$1', [saved.inquiry_id, day(2)]);
  await fails(() => setStatus(saved.id, 'accepted'), /policy/);
  await fails(() => setStatus(saved.id, 'sent'), /policy/);
  await db.query('UPDATE rental_inquiries SET start_date=$2 WHERE id=$1', [saved.inquiry_id, today]);
  await fails(() => setStatus(saved.id, 'accepted'), /review required/);
});

await test('expired and declined quotes cannot be revived through draft status', async () => {
  for (const status of ['expired', 'declined']) {
    const saved = await quote(day(10), { status });
    for (const next of ['draft', 'sent', 'accepted']) await fails(() => setStatus(saved.id, next), /new quote/);
  }
});

await test('historical accepted saves remain idempotent and preserve original acceptance timestamp', async () => {
  const old = await row('SELECT created_at::text,valid_until::text,accepted_at::text FROM rental_inquiry_quotes WHERE id=$1', [legacyAccepted.id]);
  await db.query("UPDATE rental_inquiry_quotes SET status='accepted',accepted_at=statement_timestamp() WHERE id=$1", [legacyAccepted.id]);
  assert.deepEqual(await row('SELECT created_at::text,valid_until::text,accepted_at::text FROM rental_inquiry_quotes WHERE id=$1', [legacyAccepted.id]), old);
});

await test('fixed-day pricing promises block sending, while inventory holds and exact dates remain unchanged', async () => {
  for (const terms of ['Quote valid for 14 days.', 'Pricing is good for three calendar days.', '<p>Prices are guaranteed for 3 days.</p>', 'Rates held for fourteen days.', 'Pricing stands for 14 days.']) {
    const saved = await quote(day(10), { terms });
    await fails(() => setStatus(saved.id, 'sent'), /legacy quote terms/);
    await fails(() => setStatus(saved.id, 'accepted'), /legacy quote terms/);
    assert.equal((await row('SELECT terms FROM rental_inquiry_quotes WHERE id=$1', [saved.id])).terms, terms);
  }
  for (const terms of ['Inventory held for 24 hours.', 'Inventory held for 48 hours.', 'Equipment hold for three days.', `Pricing valid through ${day(3)} (America/Los_Angeles).`]) {
    const saved = await quote(day(10), { terms });
    await setStatus(saved.id, 'sent');
    assert.equal((await row('SELECT terms FROM rental_inquiry_quotes WHERE id=$1', [saved.id])).terms, terms);
  }
});

await test('authenticated app writes and service-role embed writes both execute the guard', async () => {
  for (const role of ['authenticated', 'service_role']) {
    const saved = await quote(day(10));
    await db.exec(`SET ROLE ${role}`);
    try {
      await fails(() => setStatus(legacyExpired.id, 'accepted'), /expired/);
      await fails(() => setStatus(legacyNull.id, 'sent'), /issuance/);
      await fails(() => db.query('UPDATE rental_inquiry_quotes SET valid_until=NULL WHERE id=$1', [saved.id]), /cannot be changed/);
      await setStatus(saved.id, 'accepted');
      assert.equal((await row('SELECT status FROM rental_inquiry_quotes WHERE id=$1', [saved.id])).status, 'accepted');
    } finally {
      await db.exec('RESET ROLE');
    }
  }
});

await test('cross-entity inquiry association is rejected on insert', async () => {
  const parent = await inquiry(day(10));
  await fails(() => db.query('INSERT INTO rental_inquiry_quotes (entity_id,inquiry_id) VALUES ($1,$2)', [otherEntity, parent]), /not found in this entity/);
});

await db.close();

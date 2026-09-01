-- OpenAI (ChatGPT Ads) attribution on rental_inquiries.
--
-- Mirrors the Google (20260616) and Meta (20260826) loops: the website captures
-- the ChatGPT click id (oppref) into a first-party cookie and forwards it with
-- the lead. Stored here so the lead card can show its paid source and so a
-- future offline-conversion upload can match the click when the deal books
-- (the OpenAI Conversions API takes oppref for click matching).

alter table rental_inquiries
  add column if not exists oppref text;

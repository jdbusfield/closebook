-- Greeting-name override for the {first} email merge token. The default
-- greeting takes the first whitespace-separated word of the customer's name,
-- which mangles multi-word first names ("La Trina" -> "Hi La,"). When set,
-- this value is used verbatim in the greeting instead. Null -> keep the
-- first-word default.
alter table rental_inquiries add column if not exists greeting_name text;

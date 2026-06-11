-- When a rep confirms the customer accepted a quote, we stamp the moment so
-- the regenerated "accepted" PDF can show the acceptance date.
alter table rental_inquiry_quotes
  add column if not exists accepted_at timestamptz;

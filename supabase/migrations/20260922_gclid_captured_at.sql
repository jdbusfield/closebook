-- When the website captured a lead's Google click id. A gclid carries no
-- readable time (Meta's fbc and ChatGPT's oppref do), so without this a lead
-- holding clicks from two platforms can't be ordered. The CRM gives the lead
-- to the latest click (last touch) and counts earlier clicks as assists.
ALTER TABLE rental_inquiries ADD COLUMN IF NOT EXISTS gclid_at timestamptz;

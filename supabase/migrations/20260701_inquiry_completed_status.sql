-- ============================================================================
-- Add a terminal "completed" status to rental_inquiries.
--
-- A booked order that's fully closed out gets archived off the pipeline board
-- (like "lost", but a positive outcome) and reviewed in its own Completed view.
-- Distinct from "returned", which stays an active board stage. NOTE: "completed"
-- was an OLD alias for what is now "returned" (migration 20260529), later renamed
-- in 20260602 — no rows currently use it, so re-introducing it as a fresh
-- terminal archive is a clean additive change.
-- ============================================================================

ALTER TABLE rental_inquiries DROP CONSTRAINT IF EXISTS rental_inquiries_status_check;
ALTER TABLE rental_inquiries ADD CONSTRAINT rental_inquiries_status_check
  CHECK (status IN ('new', 'quoted', 'followup', 'confirmed', 'out', 'returned', 'completed', 'lost'));

-- Keep the Google Ads conversion trigger (20260616) correct for the new status:
-- "completed" is a WON, fulfilled order, so moving into it must NOT cancel a
-- still-pending conversion. Add 'completed' to the retained won-stage set on the
-- "pulled back out of a won stage" guard.
create or replace function mark_inquiry_conversion_pending()
returns trigger as $$
begin
  if NEW.status in ('confirmed', 'out')
     and (OLD.status is distinct from NEW.status)
     and NEW.conversion_status = 'none'
     and (NEW.email is not null or NEW.phone is not null) then
    NEW.conversion_status := 'pending';
    NEW.conversion_value  := coalesce(NEW.estimated_value, NEW.deposit, NEW.conversion_value);
  end if;

  if NEW.status not in ('confirmed', 'out', 'returned', 'completed')
     and NEW.conversion_status = 'pending' then
    NEW.conversion_status := 'skipped';
  end if;

  return NEW;
end;
$$ language plpgsql;

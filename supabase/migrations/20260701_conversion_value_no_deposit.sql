-- ============================================================================
-- Google Ads conversion value: never seed from the deposit.
--
-- The `mark_inquiry_conversion_pending` trigger (20260616) seeds
-- conversion_value when a deal is first moved to a won stage. It previously fell
-- back to the DEPOSIT when no estimated_value was set — but the deposit is a
-- partial auth hold, not the sale amount, so it undervalued the conversion in
-- Google Ads (a $750 deposit showing up as the whole "booking").
--
-- The offline uploader now resolves the true value at upload time (accepted
-- quote total -> estimated_value), so this trigger only needs to seed a sensible
-- starting value from estimated_value and otherwise leave it null. Deposit is
-- removed from the chain entirely.
-- ============================================================================

create or replace function mark_inquiry_conversion_pending()
returns trigger as $$
begin
  if NEW.status in ('confirmed', 'out') and (OLD.status is distinct from NEW.status) and NEW.conversion_status = 'none' and (NEW.email is not null or NEW.phone is not null) then
    NEW.conversion_status := 'pending';
    NEW.conversion_value := coalesce(NEW.estimated_value, NEW.conversion_value);
  end if;
  if NEW.status not in ('confirmed', 'out', 'returned', 'completed') and NEW.conversion_status = 'pending' then
    NEW.conversion_status := 'skipped';
  end if;
  return NEW;
end;
$$ language plpgsql;

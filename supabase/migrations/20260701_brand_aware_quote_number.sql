-- ============================================================================
-- Brand-aware quote numbers: Versatile inquiries get VS-Q####, HDR gets HDR-Q####.
--
-- The original column DEFAULT (20260605_inquiry_quotes.sql) hardcoded the 'HDR-Q'
-- prefix, so Versatile quotes came out as HDR-Q#### even though the PDFs are
-- Versatile-branded. A column DEFAULT can't reference another column (inquiry_id),
-- so numbering moves into a BEFORE INSERT trigger that picks the prefix from the
-- parent inquiry's brand. The numeric part still comes from the shared
-- rental_inquiry_quote_seq, so numbers stay globally unique across both brands and
-- never collide; only the prefix varies. Existing quotes are NOT renumbered.
-- ============================================================================

-- Let the trigger fully own numbering (avoids the default + trigger both calling
-- nextval, which would skip numbers).
ALTER TABLE rental_inquiry_quotes ALTER COLUMN quote_number DROP DEFAULT;

CREATE OR REPLACE FUNCTION set_inquiry_quote_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
BEGIN
  -- Only auto-assign when a number wasn't explicitly provided.
  IF NEW.quote_number IS NULL THEN
    -- Brand mirrors the app's resolveBrand/brandOf logic: source='versatile' OR a
    -- VS- reference => Versatile; everything else (incl. HDR) keeps HDR-Q.
    SELECT CASE
             WHEN i.source = 'versatile' OR i.reference LIKE 'VS-%' THEN 'VS-Q'
             ELSE 'HDR-Q'
           END
      INTO v_prefix
      FROM rental_inquiries i
     WHERE i.id = NEW.inquiry_id;

    NEW.quote_number := COALESCE(v_prefix, 'HDR-Q')
      || lpad(nextval('rental_inquiry_quote_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_inquiry_quote_number ON rental_inquiry_quotes;
CREATE TRIGGER trg_set_inquiry_quote_number
  BEFORE INSERT ON rental_inquiry_quotes
  FOR EACH ROW
  EXECUTE FUNCTION set_inquiry_quote_number();

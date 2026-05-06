CREATE OR REPLACE FUNCTION public.generate_global_lead_id(email_address text)
RETURNS text AS $$
BEGIN
  IF email_address IS NULL OR trim(email_address) = '' THEN
    RETURN NULL;
  END IF;

  RETURN encode(extensions.digest(convert_to(lower(trim(email_address)), 'utf8'), 'sha256'::text), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

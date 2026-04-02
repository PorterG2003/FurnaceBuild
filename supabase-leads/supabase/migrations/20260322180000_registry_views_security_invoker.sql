-- Recreate Layer 3 views with security_invoker so PostgREST callers (anon/authenticated)
-- are subject to underlying table RLS. Default views behave like SECURITY DEFINER and can
-- bypass RLS — see Supabase "UNRESTRICTED" / "Secure your View" warning.

DROP VIEW IF EXISTS current_company_entity_matches;
DROP VIEW IF EXISTS current_entity_owners;

CREATE VIEW current_entity_owners
WITH (security_invoker = true)
AS
SELECT *
FROM entity_owners
WHERE is_current = true;

CREATE VIEW current_company_entity_matches
WITH (security_invoker = true)
AS
SELECT *
FROM company_entity_matches
WHERE is_current = true;

COMMENT ON VIEW current_entity_owners IS 'Owners with is_current = true; prefer append+close updates on entity_owners.';
COMMENT ON VIEW current_company_entity_matches IS 'Match rows with is_current = true.';

-- normalized_key is a matching aid, not a global identity; allow collisions after dedupe/clustering.
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_normalized_key_key;

CREATE INDEX IF NOT EXISTS idx_companies_normalized_key ON companies (normalized_key)
WHERE normalized_key IS NOT NULL;

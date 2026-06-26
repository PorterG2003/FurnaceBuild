ALTER TABLE accounts DROP COLUMN IF EXISTS webhook_url_verified_at;
ALTER TABLE campaigns DROP COLUMN IF EXISTS webhook_url_override_verified_at;

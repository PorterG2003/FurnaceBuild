ALTER TABLE public.flux_campaign_templates
ADD COLUMN IF NOT EXISTS chat_state JSONB;

-- Remove legacy leads.status column; soft delete uses deleted_at, lifecycle uses enrollments.

DROP INDEX IF EXISTS public.idx_leads_status;
DROP INDEX IF EXISTS public.idx_leads_campaign_status;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE public.leads
  DROP COLUMN IF EXISTS status;

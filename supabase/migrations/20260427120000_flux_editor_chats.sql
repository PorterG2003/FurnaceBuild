-- Dedicated Flux editor chat threads (campaign template + prospect page).

CREATE TABLE public.flux_editor_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('campaign_template', 'prospect_page')),
  subject_id UUID NOT NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT flux_editor_chats_subject_unique UNIQUE (subject_type, subject_id)
);

CREATE INDEX idx_flux_editor_chats_account_id ON public.flux_editor_chats (account_id);

ALTER TABLE public.flux_editor_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flux_editor_chats_select"
  ON public.flux_editor_chats FOR SELECT
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_editor_chats_insert"
  ON public.flux_editor_chats FOR INSERT
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_editor_chats_update"
  ON public.flux_editor_chats FOR UPDATE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE POLICY "flux_editor_chats_delete"
  ON public.flux_editor_chats FOR DELETE
  USING (account_id IN (SELECT account_id FROM public.account_users WHERE user_id = auth.uid()));

CREATE TRIGGER flux_editor_chats_updated_at
  BEFORE UPDATE ON public.flux_editor_chats
  FOR EACH ROW EXECUTE FUNCTION public.flux_update_updated_at();

-- Backfill from legacy template.chat_state
INSERT INTO public.flux_editor_chats (account_id, subject_type, subject_id, state)
SELECT c.account_id, 'campaign_template', t.id, t.chat_state
FROM public.flux_campaign_templates t
INNER JOIN public.flux_campaigns c ON c.id = t.campaign_id
WHERE t.chat_state IS NOT NULL
  AND t.chat_state != 'null'::jsonb
ON CONFLICT (subject_type, subject_id) DO NOTHING;

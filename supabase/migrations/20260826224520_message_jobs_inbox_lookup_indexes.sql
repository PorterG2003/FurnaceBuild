-- Inbox-checker reply matching: canonical Message-ID equality (matches JS
-- normalizeMessageId) plus a mailbox recency index for the 90-day best-guess path.
-- Expression indexes avoid stored generated columns (no heap rewrite).

CREATE OR REPLACE FUNCTION public.normalize_rfc5322_message_id(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_raw IS NULL THEN NULL
    WHEN btrim(p_raw) = '' THEN NULL
    ELSE (
      SELECT CASE
        WHEN canonical = '' OR position('@' IN canonical) = 0 THEN NULL
        ELSE canonical
      END
      FROM (
        SELECT lower(btrim(
          CASE
            WHEN right(stripped_lead, 1) = '>' THEN left(stripped_lead, char_length(stripped_lead) - 1)
            ELSE stripped_lead
          END
        )) AS canonical
        FROM (
          SELECT CASE
            WHEN left(v, 1) = '<' THEN substr(v, 2)
            ELSE v
          END AS stripped_lead
          FROM (SELECT btrim(p_raw) AS v) AS trimmed
        ) AS unbracket_lead
      ) AS unbracket_both
    )
  END;
$$;

COMMENT ON FUNCTION public.normalize_rfc5322_message_id(text) IS
  'Canonical RFC 5322 Message-ID: trim, strip one leading < and one trailing >, lower-case. NULL if empty or missing @. Matches JS normalizeMessageId.';

REVOKE ALL ON FUNCTION public.normalize_rfc5322_message_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_rfc5322_message_id(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_rfc5322_message_id(text) TO service_role;

CREATE INDEX IF NOT EXISTS idx_message_jobs_account_provider_msgid_norm_sent
  ON public.message_jobs (
    account_id,
    (public.normalize_rfc5322_message_id(provider_message_id))
  )
  WHERE status = 'sent' AND provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_jobs_account_submitted_msgid_norm_sent
  ON public.message_jobs (
    account_id,
    (public.normalize_rfc5322_message_id(submitted_message_id))
  )
  WHERE status = 'sent' AND submitted_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_jobs_mailbox_sent_at_sent
  ON public.message_jobs (mailbox_id, sent_at DESC)
  WHERE status = 'sent';

CREATE OR REPLACE FUNCTION public.find_sent_jobs_by_message_ids(
  p_account_id uuid,
  p_search_ids text[],
  p_limit integer DEFAULT 40
)
RETURNS TABLE (
  id uuid,
  account_id uuid,
  enrollment_id uuid,
  campaign_id uuid,
  lead_id uuid,
  mailbox_id uuid,
  node_id uuid,
  message_type text,
  status text,
  sent_at timestamptz,
  created_at timestamptz,
  provider_message_id text,
  submitted_message_id text,
  message_data jsonb,
  campaigns jsonb,
  leads jsonb,
  mailboxes jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH normalized AS (
    SELECT DISTINCT public.normalize_rfc5322_message_id(search_id) AS nid
    FROM unnest(COALESCE(p_search_ids, '{}'::text[])) AS search_id
    WHERE public.normalize_rfc5322_message_id(search_id) IS NOT NULL
  )
  SELECT
    mj.id,
    mj.account_id,
    mj.enrollment_id,
    mj.campaign_id,
    mj.lead_id,
    mj.mailbox_id,
    mj.node_id,
    mj.message_type,
    mj.status,
    mj.sent_at,
    mj.created_at,
    mj.provider_message_id,
    mj.submitted_message_id,
    mj.message_data,
    CASE
      WHEN c.id IS NULL THEN NULL
      ELSE jsonb_build_object('name', c.name)
    END AS campaigns,
    CASE
      WHEN l.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'email', l.email,
        'name', l.name,
        'first_name', l.first_name,
        'last_name', l.last_name
      )
    END AS leads,
    CASE
      WHEN m.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'account_id', m.account_id,
        'email_address', m.email_address
      )
    END AS mailboxes
  FROM public.message_jobs mj
  LEFT JOIN public.campaigns c ON c.id = mj.campaign_id
  LEFT JOIN public.leads l ON l.id = mj.lead_id
  LEFT JOIN public.mailboxes m ON m.id = mj.mailbox_id
  WHERE mj.account_id = p_account_id
    AND mj.status = 'sent'
    AND EXISTS (SELECT 1 FROM normalized)
    AND (
      public.normalize_rfc5322_message_id(mj.provider_message_id) IN (SELECT nid FROM normalized)
      OR public.normalize_rfc5322_message_id(mj.submitted_message_id) IN (SELECT nid FROM normalized)
    )
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 40);
$$;

COMMENT ON FUNCTION public.find_sent_jobs_by_message_ids(uuid, text[], integer) IS
  'Inbox-checker: sent message_jobs whose provider or submitted Message-ID matches any search id after normalize_rfc5322_message_id. Account-scoped. Slim columns plus campaigns/leads/mailboxes JSON.';

REVOKE ALL ON FUNCTION public.find_sent_jobs_by_message_ids(uuid, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_sent_jobs_by_message_ids(uuid, text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_sent_jobs_by_message_ids(uuid, text[], integer) TO service_role;

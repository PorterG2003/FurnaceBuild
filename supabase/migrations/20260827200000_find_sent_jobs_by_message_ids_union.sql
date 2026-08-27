-- Rewrite find_sent_jobs_by_message_ids so each Message-ID column is an
-- equality join. OR-ing both expressions in one WHERE made Postgres scan
-- all sent jobs for the account instead of using the expression indexes.

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
  ),
  ids AS (
    (
      SELECT mj.id
      FROM normalized n
      INNER JOIN public.message_jobs mj
        ON mj.account_id = p_account_id
       AND mj.status = 'sent'
       AND mj.provider_message_id IS NOT NULL
       AND public.normalize_rfc5322_message_id(mj.provider_message_id) = n.nid
      UNION
      SELECT mj.id
      FROM normalized n
      INNER JOIN public.message_jobs mj
        ON mj.account_id = p_account_id
       AND mj.status = 'sent'
       AND mj.submitted_message_id IS NOT NULL
       AND public.normalize_rfc5322_message_id(mj.submitted_message_id) = n.nid
    )
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 40)
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
  FROM ids
  INNER JOIN public.message_jobs mj ON mj.id = ids.id
  LEFT JOIN public.campaigns c ON c.id = mj.campaign_id
  LEFT JOIN public.leads l ON l.id = mj.lead_id
  LEFT JOIN public.mailboxes m ON m.id = mj.mailbox_id;
$$;

COMMENT ON FUNCTION public.find_sent_jobs_by_message_ids(uuid, text[], integer) IS
  'Inbox-checker: sent message_jobs whose provider or submitted Message-ID matches any search id after normalize_rfc5322_message_id. UNION of two expression-index joins. Account-scoped. Slim columns plus campaigns/leads/mailboxes JSON.';

REVOKE ALL ON FUNCTION public.find_sent_jobs_by_message_ids(uuid, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_sent_jobs_by_message_ids(uuid, text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_sent_jobs_by_message_ids(uuid, text[], integer) TO service_role;

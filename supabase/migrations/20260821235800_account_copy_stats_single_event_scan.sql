-- One index-only event scan for totals and attributed stats. Hash to stamped
-- jobs so unattributed sends never hit message_jobs.

CREATE OR REPLACE FUNCTION public.account_copy_stats(
  p_account_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_group_by text DEFAULT 'archetype'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = force_custom_plan
SET statement_timeout = '30s'
AS $$
DECLARE
  v_payload jsonb;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'p_account_id is required';
  END IF;
  IF p_kind IS NOT NULL
     AND p_kind NOT IN ('subject', 'hook', 'problem', 'proof', 'offer', 'cta') THEN
    RAISE EXCEPTION 'Invalid p_kind: %', p_kind;
  END IF;
  IF p_group_by NOT IN ('archetype', 'piece') THEN
    RAISE EXCEPTION 'Invalid p_group_by: %', p_group_by;
  END IF;

  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    v_start := p_start_date::timestamp AT TIME ZONE 'UTC';
    v_end := (p_end_date + 1)::timestamp AT TIME ZONE 'UTC';
  ELSE
    v_start := '-infinity'::timestamptz;
    v_end := 'infinity'::timestamptz;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.account_users au
    WHERE au.user_id = auth.uid()
      AND au.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  WITH campaign_scope AS (
    SELECT c.id, c.name
    FROM public.campaigns c
    WHERE c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND c.source IS DISTINCT FROM 'smartlead'
      AND (
        p_campaign_ids IS NULL
        OR COALESCE(cardinality(p_campaign_ids), 0) = 0
        OR c.id = ANY (p_campaign_ids)
      )
  ),
  attributed_jobs AS MATERIALIZED (
    SELECT
      mj.id AS job_id,
      mj.copy_rendering_id,
      mj.message_type,
      mj.node_id,
      COALESCE(NULLIF(btrim(n.node_data->>'label'), ''), 'Email step') AS node_label
    FROM public.copy_renderings cr
    INNER JOIN public.message_jobs mj ON mj.copy_rendering_id = cr.id
    LEFT JOIN public.nodes n ON n.id = mj.node_id
    WHERE cr.account_id = p_account_id
      AND EXISTS (
        SELECT 1 FROM campaign_scope cs WHERE cs.id = mj.campaign_id
      )
  ),
  scoped_events AS MATERIALIZED (
    SELECT
      e.event_type,
      e.campaign_id,
      cs.name AS campaign_name,
      e.message_job_id AS job_id
    FROM unnest(ARRAY['sent', 'replied', 'bounced']::text[]) AS et(event_type)
    CROSS JOIN LATERAL (
      SELECT ev.event_type, ev.campaign_id, ev.message_job_id
      FROM public.events ev
      WHERE ev.account_id = p_account_id
        AND ev.event_type = et.event_type
        AND ev.created_at >= v_start
        AND ev.created_at < v_end
      OFFSET 0
    ) e
    INNER JOIN campaign_scope cs ON cs.id = e.campaign_id
  ),
  job_events AS MATERIALIZED (
    SELECT
      aj.job_id,
      se.campaign_id,
      se.campaign_name,
      aj.copy_rendering_id,
      aj.message_type,
      aj.node_id,
      aj.node_label,
      bool_or(
        se.event_type = 'sent'
        AND public.is_campaign_outbound_message_type(aj.message_type)
      ) AS was_sent,
      bool_or(
        se.event_type = 'replied'
        AND public.is_paced_campaign_message_type(aj.message_type)
      ) AS was_replied,
      bool_or(
        se.event_type = 'bounced'
        AND public.is_campaign_outbound_message_type(aj.message_type)
      ) AS was_bounced
    FROM attributed_jobs aj
    INNER JOIN scoped_events se ON se.job_id = aj.job_id
    GROUP BY
      aj.job_id,
      se.campaign_id,
      se.campaign_name,
      aj.copy_rendering_id,
      aj.message_type,
      aj.node_id,
      aj.node_label
  ),
  reply_flags AS MATERIALIZED (
    SELECT
      je.job_id,
      bool_or(
        COALESCE(et.out_of_office, false) = true
        OR et.category = 'Auto Reply'
      ) AS was_ooo_reply,
      bool_or(
        COALESCE((reply_e.event_data->>'is_positive')::boolean, false)
      ) AS was_positive_reply
    FROM job_events je
    LEFT JOIN public.email_threads et
      ON et.message_job_id = je.job_id
    LEFT JOIN public.events reply_e
      ON reply_e.message_job_id = je.job_id
     AND reply_e.event_type = 'replied'
    WHERE je.was_replied
    GROUP BY je.job_id
  ),
  piece_events AS MATERIALIZED (
    SELECT
      je.job_id,
      je.campaign_id,
      je.campaign_name,
      je.node_id,
      je.node_label,
      cr.content_id,
      cp.id AS piece_id,
      cp.kind,
      cp.raw_text,
      cp.display_text,
      ca.id AS archetype_id,
      ca.name AS archetype_name,
      ca.description AS archetype_description,
      CASE WHEN p_group_by = 'piece' THEN cp.id ELSE ca.id END AS group_id,
      CASE WHEN p_group_by = 'piece' THEN cp.display_text ELSE ca.name END AS group_name,
      CASE WHEN p_group_by = 'piece' THEN NULL::text ELSE ca.description END AS group_description,
      je.was_sent,
      je.was_replied,
      (je.was_replied AND COALESCE(rf.was_ooo_reply, false)) AS was_ooo_reply,
      (je.was_replied AND COALESCE(rf.was_positive_reply, false)) AS was_positive_reply,
      je.was_bounced
    FROM job_events je
    INNER JOIN public.copy_renderings cr
      ON cr.id = je.copy_rendering_id
     AND cr.account_id = p_account_id
    INNER JOIN public.copy_rendering_pieces crp
      ON crp.rendering_id = cr.id
    INNER JOIN public.copy_pieces cp
      ON cp.id = crp.piece_id
     AND cp.account_id = p_account_id
    INNER JOIN public.copy_archetypes ca
      ON ca.id = cp.archetype_id
     AND ca.account_id = p_account_id
    LEFT JOIN reply_flags rf ON rf.job_id = je.job_id
    WHERE p_kind IS NULL OR cp.kind = p_kind
  ),
  group_core AS (
    SELECT
      pe.group_id,
      MIN(pe.kind) AS kind,
      MIN(pe.group_name) AS name,
      MIN(pe.group_description) AS description,
      COUNT(DISTINCT pe.job_id) FILTER (WHERE pe.was_sent)::bigint AS sent,
      COUNT(DISTINCT pe.job_id) FILTER (WHERE pe.was_replied)::bigint AS replied,
      COUNT(DISTINCT pe.job_id) FILTER (WHERE pe.was_ooo_reply)::bigint AS ooo_replied,
      COUNT(DISTINCT pe.job_id) FILTER (WHERE pe.was_positive_reply)::bigint AS positive_reply,
      COUNT(DISTINCT pe.job_id) FILTER (WHERE pe.was_bounced)::bigint AS bounce,
      COUNT(DISTINCT pe.campaign_id)::bigint AS campaigns,
      COUNT(DISTINCT pe.content_id)::bigint AS distinct_contents,
      COUNT(DISTINCT pe.node_id)::bigint AS distinct_nodes
    FROM piece_events pe
    GROUP BY pe.group_id
  ),
  group_campaign_sent AS (
    SELECT
      pe.group_id,
      pe.campaign_id,
      COUNT(DISTINCT pe.job_id) FILTER (WHERE pe.was_sent)::bigint AS sent_count
    FROM piece_events pe
    GROUP BY pe.group_id, pe.campaign_id
  ),
  top_campaign AS (
    SELECT
      gcs.group_id,
      MAX(gcs.sent_count)::bigint AS top_campaign_sent
    FROM group_campaign_sent gcs
    GROUP BY gcs.group_id
  ),
  wording_rows AS (
    SELECT DISTINCT
      pe.group_id,
      pe.piece_id,
      pe.raw_text,
      pe.display_text
    FROM piece_events pe
  ),
  group_wordings AS (
    SELECT
      wr.group_id,
      jsonb_agg(jsonb_build_object(
        'piece_id', wr.piece_id,
        'raw_text', wr.raw_text,
        'display_text', wr.display_text
      ) ORDER BY wr.display_text, wr.piece_id) AS wordings
    FROM wording_rows wr
    GROUP BY wr.group_id
  ),
  campaign_rows AS (
    SELECT DISTINCT pe.group_id, pe.campaign_name
    FROM piece_events pe
    WHERE pe.campaign_name IS NOT NULL
  ),
  group_campaigns AS (
    SELECT
      cr.group_id,
      jsonb_agg(cr.campaign_name ORDER BY cr.campaign_name) AS campaign_names
    FROM campaign_rows cr
    GROUP BY cr.group_id
  ),
  node_rows AS (
    SELECT DISTINCT pe.group_id, pe.node_label
    FROM piece_events pe
    WHERE pe.node_label IS NOT NULL
  ),
  group_nodes AS (
    SELECT
      nr.group_id,
      jsonb_agg(nr.node_label ORDER BY nr.node_label) AS node_labels
    FROM node_rows nr
    GROUP BY nr.group_id
  ),
  grouped AS (
    SELECT
      gc.group_id,
      gc.kind,
      gc.name,
      gc.description,
      gc.sent,
      gc.replied,
      gc.ooo_replied,
      gc.positive_reply,
      gc.bounce,
      gc.campaigns,
      gc.distinct_contents,
      gc.distinct_nodes,
      COALESCE(tc.top_campaign_sent, 0)::bigint AS top_campaign_sent,
      COALESCE(gw.wordings, '[]'::jsonb) AS wordings,
      COALESCE(gca.campaign_names, '[]'::jsonb) AS campaign_names,
      COALESCE(gn.node_labels, '[]'::jsonb) AS node_labels
    FROM group_core gc
    LEFT JOIN top_campaign tc ON tc.group_id = gc.group_id
    LEFT JOIN group_wordings gw ON gw.group_id = gc.group_id
    LEFT JOIN group_campaigns gca ON gca.group_id = gc.group_id
    LEFT JOIN group_nodes gn ON gn.group_id = gc.group_id
  ),
  stats_rows AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', g.group_id,
          'kind', g.kind,
          'name', g.name,
          'description', g.description,
          'sent', g.sent,
          'replied', g.replied,
          'ooo_replied', g.ooo_replied,
          'positive_reply', g.positive_reply,
          'bounce', g.bounce,
          'campaigns', g.campaigns,
          'distinct_contents', g.distinct_contents,
          'distinct_nodes', g.distinct_nodes,
          'top_campaign_sent', g.top_campaign_sent,
          'wordings', g.wordings,
          'campaign_names', g.campaign_names,
          'node_labels', g.node_labels
        )
        ORDER BY
          CASE WHEN g.sent >= 100 THEN
            g.positive_reply::numeric / NULLIF(g.sent, 0)
          END DESC NULLS LAST,
          g.sent DESC,
          g.name
      ),
      '[]'::jsonb
    ) AS rows
    FROM grouped g
    WHERE g.sent > 0 OR g.replied > 0 OR g.positive_reply > 0 OR g.bounce > 0
  ),
  sent_totals AS (
    SELECT
      COUNT(*) FILTER (
        WHERE se.event_type = 'sent'
      )::bigint AS total_sent,
      COUNT(*) FILTER (
        WHERE se.event_type = 'sent'
          AND aj.job_id IS NOT NULL
      )::bigint AS attributed_sends
    FROM scoped_events se
    LEFT JOIN attributed_jobs aj ON aj.job_id = se.job_id
  ),
  backlog AS (
    SELECT
      (
        SELECT COUNT(*)::bigint
        FROM public.copy_contents cc
        WHERE cc.account_id = p_account_id
          AND cc.parse_status IN ('queued', 'processing')
      ) + (
        SELECT COUNT(*)::bigint
        FROM public.campaign_flow_versions cfv
        WHERE cfv.account_id = p_account_id
          AND cfv.copy_registered_at IS NULL
      ) AS copy_backlog,
      (
        SELECT COUNT(*)::bigint
        FROM public.copy_contents cc
        WHERE cc.account_id = p_account_id
          AND cc.parse_status = 'failed'
      ) AS failed_contents
  )
  SELECT jsonb_build_object(
    'rows', sr.rows,
    'attributed_sends', st.attributed_sends,
    'unattributed_sends', st.total_sent - st.attributed_sends,
    'copy_backlog', b.copy_backlog,
    'failed_contents', b.failed_contents
  )
  INTO v_payload
  FROM stats_rows sr
  CROSS JOIN sent_totals st
  CROSS JOIN backlog b;

  RETURN v_payload;
END;
$$;

COMMENT ON FUNCTION public.account_copy_stats(uuid, date, date, uuid[], text, text) IS
  'Copy-piece performance. Stamped jobs from copy_renderings, then date-scoped events, then pieces.';

REVOKE ALL ON FUNCTION
  public.account_copy_stats(uuid, date, date, uuid[], text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.account_copy_stats(uuid, date, date, uuid[], text, text)
TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

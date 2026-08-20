-- Copy structure analytics: durable registration, parse queue, and account stats.

ALTER TABLE public.campaign_flow_versions
  ADD COLUMN IF NOT EXISTS copy_registered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_campaign_flow_versions_copy_registration_backlog
  ON public.campaign_flow_versions (account_id, changed_at, id)
  WHERE copy_registered_at IS NULL;

CREATE TABLE IF NOT EXISTS public.copy_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'campaign_email'
    CHECK (source IN ('campaign_email')),
  content_hash text NOT NULL,
  subject text NOT NULL DEFAULT '',
  template text NOT NULL DEFAULT '',
  body_text text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  parse_status text NOT NULL DEFAULT 'queued'
    CHECK (parse_status IN ('queued', 'processing', 'done', 'failed')),
  parse_attempts integer NOT NULL DEFAULT 0 CHECK (parse_attempts >= 0),
  parse_error text,
  parse_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  parse_claimed_at timestamptz,
  parsed_at timestamptz,
  parse_model text,
  parse_prompt_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, content_hash),
  UNIQUE (id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_copy_contents_parse_backlog
  ON public.copy_contents (account_id, parse_next_attempt_at, created_at, id)
  WHERE parse_status IN ('queued', 'processing');

CREATE TABLE IF NOT EXISTS public.copy_variant_content_map (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  flow_node_id text NOT NULL,
  variant_id uuid NOT NULL,
  flow_version_number integer NOT NULL CHECK (flow_version_number > 0),
  content_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, flow_version_number, flow_node_id, variant_id),
  FOREIGN KEY (campaign_id, flow_version_number)
    REFERENCES public.campaign_flow_versions(campaign_id, version_number)
    ON DELETE CASCADE,
  FOREIGN KEY (content_id, account_id)
    REFERENCES public.copy_contents(id, account_id)
    ON DELETE CASCADE
);

-- A pre-release draft used (variant_id, flow_version_number), but production
-- data reuses those pairs across campaigns and even across nodes. This table is
-- derivative and empty before launch, so rebuild its key before registration.
ALTER TABLE public.copy_variant_content_map
  ADD COLUMN IF NOT EXISTS flow_node_id text;
TRUNCATE TABLE public.copy_variant_content_map;
ALTER TABLE public.copy_variant_content_map
  DROP CONSTRAINT IF EXISTS copy_variant_content_map_pkey;
ALTER TABLE public.copy_variant_content_map
  ALTER COLUMN flow_node_id SET NOT NULL;
ALTER TABLE public.copy_variant_content_map
  ADD CONSTRAINT copy_variant_content_map_pkey
  PRIMARY KEY (campaign_id, flow_version_number, flow_node_id, variant_id);

CREATE INDEX IF NOT EXISTS idx_copy_variant_content_map_account_content
  ON public.copy_variant_content_map (account_id, content_id);

CREATE TABLE IF NOT EXISTS public.copy_archetypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('subject', 'hook', 'problem', 'proof', 'offer', 'cta')),
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  is_manual boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, kind, slug),
  UNIQUE (id, account_id, kind)
);

CREATE TABLE IF NOT EXISTS public.copy_pieces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('subject', 'hook', 'problem', 'proof', 'offer', 'cta')),
  fingerprint text NOT NULL,
  raw_text text NOT NULL,
  display_text text NOT NULL,
  archetype_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, kind, fingerprint),
  UNIQUE (id, account_id),
  FOREIGN KEY (archetype_id, account_id, kind)
    REFERENCES public.copy_archetypes(id, account_id, kind)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_copy_pieces_account_archetype
  ON public.copy_pieces (account_id, archetype_id);

CREATE TABLE IF NOT EXISTS public.copy_piece_occurrences (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  content_id uuid NOT NULL,
  piece_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_id, piece_id, position),
  FOREIGN KEY (content_id, account_id)
    REFERENCES public.copy_contents(id, account_id)
    ON DELETE CASCADE,
  FOREIGN KEY (piece_id, account_id)
    REFERENCES public.copy_pieces(id, account_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_copy_piece_occurrences_account_piece
  ON public.copy_piece_occurrences (account_id, piece_id, content_id);

COMMENT ON TABLE public.copy_contents IS
  'Account-scoped source copy and durable parse state. A distinct raw content hash is parsed once.';
COMMENT ON TABLE public.copy_variant_content_map IS
  'Attribution map from a sent message variant/version pair to the exact saved copy content.';
COMMENT ON TABLE public.copy_pieces IS
  'Verbatim reusable copy spans such as hooks, proof, offers, and CTAs.';
COMMENT ON TABLE public.copy_archetypes IS
  'Reusable ideas grouping differently worded copy pieces at read time.';
COMMENT ON TABLE public.copy_piece_occurrences IS
  'Validated appearances of a copy piece in a distinct source content.';

ALTER TABLE public.copy_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copy_variant_content_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copy_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copy_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copy_piece_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copy_contents_select_member ON public.copy_contents;
CREATE POLICY copy_contents_select_member
  ON public.copy_contents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = copy_contents.account_id
        AND au.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS copy_variant_content_map_select_member ON public.copy_variant_content_map;
CREATE POLICY copy_variant_content_map_select_member
  ON public.copy_variant_content_map FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = copy_variant_content_map.account_id
        AND au.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS copy_archetypes_select_member ON public.copy_archetypes;
CREATE POLICY copy_archetypes_select_member
  ON public.copy_archetypes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = copy_archetypes.account_id
        AND au.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS copy_pieces_select_member ON public.copy_pieces;
CREATE POLICY copy_pieces_select_member
  ON public.copy_pieces FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = copy_pieces.account_id
        AND au.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS copy_piece_occurrences_select_member ON public.copy_piece_occurrences;
CREATE POLICY copy_piece_occurrences_select_member
  ON public.copy_piece_occurrences FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = copy_piece_occurrences.account_id
        AND au.user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE
  public.copy_contents,
  public.copy_variant_content_map,
  public.copy_archetypes,
  public.copy_pieces,
  public.copy_piece_occurrences
FROM anon, authenticated;

GRANT SELECT ON TABLE
  public.copy_contents,
  public.copy_variant_content_map,
  public.copy_archetypes,
  public.copy_pieces,
  public.copy_piece_occurrences
TO authenticated;

GRANT ALL ON TABLE
  public.copy_contents,
  public.copy_variant_content_map,
  public.copy_archetypes,
  public.copy_pieces,
  public.copy_piece_occurrences
TO service_role;

CREATE OR REPLACE FUNCTION public.register_copy_for_flow_version(
  p_flow_version_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version public.campaign_flow_versions%ROWTYPE;
  v_node jsonb;
  v_variant jsonb;
  v_variants jsonb;
  v_variant_id uuid;
  v_content_id uuid;
  v_content_hash text;
  v_subject text;
  v_template text;
  v_body_text text;
  v_body_html text;
  v_registered integer := 0;
  v_legacy_variant_id constant uuid := 'a0000000-0000-4000-8000-000000000001';
BEGIN
  SELECT *
  INTO v_version
  FROM public.campaign_flow_versions cfv
  WHERE cfv.id = p_flow_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_flow_version % not found', p_flow_version_id;
  END IF;

  IF jsonb_typeof(COALESCE(v_version.flow_data->'nodes', '[]'::jsonb)) <> 'array' THEN
    UPDATE public.campaign_flow_versions
    SET copy_registered_at = now()
    WHERE id = v_version.id;
    RETURN 0;
  END IF;

  FOR v_node IN
    SELECT value FROM jsonb_array_elements(
      COALESCE(v_version.flow_data->'nodes', '[]'::jsonb)
    )
  LOOP
    IF v_node->>'type' IS DISTINCT FROM 'email'
       OR NULLIF(btrim(v_node->>'id'), '') IS NULL THEN
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_node->'data'->'variants') = 'array'
       AND jsonb_array_length(v_node->'data'->'variants') > 0 THEN
      v_variants := v_node->'data'->'variants';
    ELSE
      v_variants := jsonb_build_array(
        jsonb_build_object(
          'id', v_legacy_variant_id::text,
          'subject', COALESCE(v_node->'data'->>'subject', ''),
          'template', COALESCE(v_node->'data'->>'template', ''),
          'body_text', COALESCE(v_node->'data'->>'body_text', ''),
          'body_html', COALESCE(v_node->'data'->>'body_html', '')
        )
      );
    END IF;

    FOR v_variant IN SELECT value FROM jsonb_array_elements(v_variants)
    LOOP
      IF COALESCE(v_variant->>'id', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE WARNING
          'copy registration skipped invalid variant id "%" in flow version %',
          v_variant->>'id',
          v_version.id;
        CONTINUE;
      END IF;

      v_variant_id := (v_variant->>'id')::uuid;
      v_subject := COALESCE(v_variant->>'subject', '');
      v_template := COALESCE(v_variant->>'template', '');
      v_body_text := COALESCE(v_variant->>'body_text', '');
      v_body_html := COALESCE(v_variant->>'body_html', '');

      IF btrim(v_subject) = ''
         AND btrim(v_template) = ''
         AND btrim(v_body_text) = ''
         AND btrim(v_body_html) = '' THEN
        CONTINUE;
      END IF;

      v_content_hash := md5(
        v_subject || chr(31) ||
        v_template || chr(31) ||
        v_body_text || chr(31) ||
        v_body_html
      );

      INSERT INTO public.copy_contents (
        account_id,
        source,
        content_hash,
        subject,
        template,
        body_text,
        body_html
      )
      VALUES (
        v_version.account_id,
        'campaign_email',
        v_content_hash,
        v_subject,
        v_template,
        v_body_text,
        v_body_html
      )
      ON CONFLICT (account_id, content_hash) DO NOTHING
      RETURNING id INTO v_content_id;

      IF v_content_id IS NULL THEN
        SELECT cc.id
        INTO v_content_id
        FROM public.copy_contents cc
        WHERE cc.account_id = v_version.account_id
          AND cc.content_hash = v_content_hash;
      END IF;

      INSERT INTO public.copy_variant_content_map (
        account_id,
        campaign_id,
        flow_node_id,
        variant_id,
        flow_version_number,
        content_id
      )
      VALUES (
        v_version.account_id,
        v_version.campaign_id,
        v_node->>'id',
        v_variant_id,
        v_version.version_number,
        v_content_id
      )
      ON CONFLICT (campaign_id, flow_version_number, flow_node_id, variant_id) DO UPDATE
      SET
        account_id = EXCLUDED.account_id,
        campaign_id = EXCLUDED.campaign_id,
        content_id = EXCLUDED.content_id;

      v_registered := v_registered + 1;
      v_content_id := NULL;
    END LOOP;
  END LOOP;

  UPDATE public.campaign_flow_versions
  SET copy_registered_at = now()
  WHERE id = v_version.id;

  RETURN v_registered;
END;
$$;

REVOKE ALL ON FUNCTION public.register_copy_for_flow_version(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_copy_for_flow_version(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.register_copy_for_flow_version_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.register_copy_for_flow_version(NEW.id);
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING
      'copy registration failed for campaign_flow_version %: %',
      NEW.id,
      SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS register_copy_for_flow_version_after_write
  ON public.campaign_flow_versions;
CREATE TRIGGER register_copy_for_flow_version_after_write
  AFTER INSERT OR UPDATE OF flow_data
  ON public.campaign_flow_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.register_copy_for_flow_version_trigger();

CREATE OR REPLACE FUNCTION public.reconcile_copy_versions(
  p_account_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (registered_versions integer, remaining_versions bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_registered integer := 0;
BEGIN
  FOR v_id IN
    SELECT cfv.id
    FROM public.campaign_flow_versions cfv
    WHERE cfv.copy_registered_at IS NULL
      AND (p_account_id IS NULL OR cfv.account_id = p_account_id)
    ORDER BY cfv.changed_at, cfv.id
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.register_copy_for_flow_version(v_id);
      v_registered := v_registered + 1;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'copy reconcile failed for version %: %', v_id, SQLERRM;
    END;
  END LOOP;

  RETURN QUERY
  SELECT
    v_registered,
    COUNT(*)::bigint
  FROM public.campaign_flow_versions cfv
  WHERE cfv.copy_registered_at IS NULL
    AND (p_account_id IS NULL OR cfv.account_id = p_account_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_copy_versions(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_copy_versions(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_copy_contents_to_parse(
  p_account_id uuid,
  p_limit integer DEFAULT 25
)
RETURNS SETOF public.copy_contents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'p_account_id is required';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT cc.id
    FROM public.copy_contents cc
    WHERE cc.account_id = p_account_id
      AND cc.parse_status IN ('queued', 'processing')
      AND cc.parse_next_attempt_at <= now()
    ORDER BY cc.parse_next_attempt_at, cc.created_at, cc.id
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.copy_contents cc
  SET
    parse_status = 'processing',
    parse_attempts = cc.parse_attempts + 1,
    parse_claimed_at = now(),
    parse_next_attempt_at = now() + interval '15 minutes',
    updated_at = now()
  FROM candidates c
  WHERE cc.id = c.id
  RETURNING cc.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_copy_contents_to_parse(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_copy_contents_to_parse(uuid, integer) TO service_role;

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
AS $$
DECLARE
  v_payload jsonb;
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
  scoped_events AS (
    SELECT
      e.id AS event_id,
      e.event_type,
      e.event_data,
      e.message_job_id,
      e.campaign_id,
      cs.name AS campaign_name,
      mj.id AS job_id,
      mj.variant_id,
      mj.flow_version_number,
      mj.node_id,
      mj.message_type,
      n.flow_node_id,
      COALESCE(NULLIF(btrim(n.node_data->>'label'), ''), 'Email step') AS node_label
    FROM public.events e
    INNER JOIN campaign_scope cs ON cs.id = e.campaign_id
    LEFT JOIN public.message_jobs mj ON mj.id = e.message_job_id
    LEFT JOIN public.nodes n ON n.id = mj.node_id
    WHERE e.event_type IN ('sent', 'replied', 'bounced')
      AND (
        p_start_date IS NULL
        OR p_end_date IS NULL
        OR (e.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
      )
  ),
  attributed AS (
    SELECT
      se.*,
      cvcm.content_id,
      cp.id AS piece_id,
      cp.kind,
      cp.raw_text,
      cp.display_text,
      ca.id AS archetype_id,
      ca.name AS archetype_name,
      ca.description AS archetype_description,
      CASE WHEN p_group_by = 'piece' THEN cp.id ELSE ca.id END AS group_id,
      CASE WHEN p_group_by = 'piece' THEN cp.display_text ELSE ca.name END AS group_name,
      CASE WHEN p_group_by = 'piece' THEN NULL::text ELSE ca.description END AS group_description
    FROM scoped_events se
    INNER JOIN public.copy_variant_content_map cvcm
      ON cvcm.campaign_id = se.campaign_id
     AND cvcm.flow_node_id = se.flow_node_id
     AND cvcm.variant_id = se.variant_id
     AND cvcm.flow_version_number = se.flow_version_number
     AND cvcm.account_id = p_account_id
    INNER JOIN public.copy_piece_occurrences cpo
      ON cpo.content_id = cvcm.content_id
     AND cpo.account_id = p_account_id
    INNER JOIN public.copy_pieces cp
      ON cp.id = cpo.piece_id
     AND cp.account_id = p_account_id
    INNER JOIN public.copy_archetypes ca
      ON ca.id = cp.archetype_id
     AND ca.account_id = p_account_id
    WHERE p_kind IS NULL OR cp.kind = p_kind
  ),
  group_campaign_sent AS (
    SELECT
      a.group_id,
      a.campaign_id,
      COUNT(DISTINCT a.job_id)::bigint AS sent_count
    FROM attributed a
    WHERE a.event_type = 'sent'
      AND public.is_campaign_outbound_message_type(a.message_type)
    GROUP BY a.group_id, a.campaign_id
  ),
  top_campaign AS (
    SELECT gcs.group_id, MAX(gcs.sent_count)::bigint AS top_campaign_sent
    FROM group_campaign_sent gcs
    GROUP BY gcs.group_id
  ),
  grouped AS (
    SELECT
      a.group_id,
      MIN(a.kind) AS kind,
      MIN(a.group_name) AS name,
      MIN(a.group_description) AS description,
      COUNT(DISTINCT a.job_id) FILTER (
        WHERE a.event_type = 'sent'
          AND public.is_campaign_outbound_message_type(a.message_type)
      )::bigint AS sent,
      COUNT(DISTINCT a.job_id) FILTER (
        WHERE a.event_type = 'replied'
          AND public.is_paced_campaign_message_type(a.message_type)
      )::bigint AS replied,
      COUNT(DISTINCT a.job_id) FILTER (
        WHERE a.event_type = 'replied'
          AND COALESCE((a.event_data->>'is_positive')::boolean, false)
          AND public.is_paced_campaign_message_type(a.message_type)
      )::bigint AS positive_reply,
      COUNT(DISTINCT a.job_id) FILTER (
        WHERE a.event_type = 'bounced'
          AND public.is_campaign_outbound_message_type(a.message_type)
      )::bigint AS bounce,
      COUNT(DISTINCT a.campaign_id)::bigint AS campaigns,
      COUNT(DISTINCT a.content_id)::bigint AS distinct_contents,
      COUNT(DISTINCT a.node_id)::bigint AS distinct_nodes,
      COALESCE(tc.top_campaign_sent, 0)::bigint AS top_campaign_sent,
      COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'piece_id', a.piece_id,
          'raw_text', a.raw_text,
          'display_text', a.display_text
        )) FILTER (WHERE a.piece_id IS NOT NULL),
        '[]'::jsonb
      ) AS wordings,
      COALESCE(
        jsonb_agg(DISTINCT a.campaign_name)
          FILTER (WHERE a.campaign_name IS NOT NULL),
        '[]'::jsonb
      ) AS campaign_names,
      COALESCE(
        jsonb_agg(DISTINCT a.node_label)
          FILTER (WHERE a.node_label IS NOT NULL),
        '[]'::jsonb
      ) AS node_labels
    FROM attributed a
    LEFT JOIN top_campaign tc ON tc.group_id = a.group_id
    GROUP BY a.group_id, tc.top_campaign_sent
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
          AND EXISTS (
            SELECT 1
            FROM public.copy_variant_content_map cvcm
            INNER JOIN public.copy_piece_occurrences cpo
              ON cpo.content_id = cvcm.content_id
            WHERE cvcm.campaign_id = se.campaign_id
              AND cvcm.flow_node_id = se.flow_node_id
              AND cvcm.variant_id = se.variant_id
              AND cvcm.flow_version_number = se.flow_version_number
              AND cvcm.account_id = p_account_id
          )
      )::bigint AS attributed_sends
    FROM scoped_events se
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
  'Account-scoped copy-piece performance over event timestamps, with exact total reconciliation and parse backlog.';

REVOKE ALL ON FUNCTION
  public.account_copy_stats(uuid, date, date, uuid[], text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.account_copy_stats(uuid, date, date, uuid[], text, text)
TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

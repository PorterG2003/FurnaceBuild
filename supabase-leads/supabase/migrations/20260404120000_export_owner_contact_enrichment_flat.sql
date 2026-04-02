-- Flatten latest accepted contact enrichment per (company_id, entity_owner_id) for exports.
-- Match selection: latest attempt by performed_at, tie-break match created_at.
-- JSON in decision_metadata is defensive: non-array ranked_candidates / ambiguity_reason_codes
-- and invalid total_score strings must not break the view.

CREATE OR REPLACE FUNCTION export_safe_numeric(p_text text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_text IS NULL OR btrim(p_text) = '' THEN NULL
    WHEN btrim(p_text) !~ '^-?[0-9]+(\.[0-9]*)?$' THEN NULL
    ELSE btrim(p_text)::numeric
  END
$$;

CREATE VIEW export_owner_contact_enrichment_flat
WITH (security_invoker = true)
AS
WITH winning AS (
  SELECT DISTINCT ON (a.company_id, a.entity_owner_id)
    m.id AS match_id,
    a.company_id,
    a.entity_owner_id,
    a.decision_metadata,
    a.performed_at
  FROM contact_enrichment_matches m
  INNER JOIN contact_enrichment_attempts a ON a.id = m.attempt_id
  WHERE a.entity_owner_id IS NOT NULL
  ORDER BY a.company_id, a.entity_owner_id, a.performed_at DESC NULLS LAST, m.created_at DESC
)
SELECT
  w.company_id,
  w.entity_owner_id,
  em.contact_email_1,
  em.contact_email_2,
  em.contact_email_3,
  ph.contact_phone_1,
  ph.contact_phone_1_type,
  ph.contact_phone_2,
  ph.contact_phone_2_type,
  ph.contact_phone_3,
  ph.contact_phone_3_type,
  CASE
    WHEN COALESCE(export_safe_numeric(w.decision_metadata->'ranked_candidates'->0->>'total_score'), 0) >= 6
      AND (
        CASE
          WHEN jsonb_typeof(COALESCE(w.decision_metadata #> '{ranked_candidates}', '[]'::jsonb)) = 'array'
          THEN jsonb_array_length(COALESCE(w.decision_metadata #> '{ranked_candidates}', '[]'::jsonb))
          ELSE 0
        END
        < 2
        OR COALESCE(export_safe_numeric(w.decision_metadata->'ranked_candidates'->0->>'total_score'), 0)
        - COALESCE(export_safe_numeric(w.decision_metadata->'ranked_candidates'->1->>'total_score'), 0) >= 2
      )
    THEN 'High'
    ELSE 'Standard'
  END AS contact_confidence_tier,
  export_safe_numeric(w.decision_metadata->'ranked_candidates'->0->>'total_score') AS contact_enrichment_top_score,
  CASE
    WHEN jsonb_typeof(COALESCE(w.decision_metadata #> '{ranked_candidates}', '[]'::jsonb)) = 'array'
      AND jsonb_array_length(COALESCE(w.decision_metadata #> '{ranked_candidates}', '[]'::jsonb)) >= 2
    THEN export_safe_numeric(w.decision_metadata->'ranked_candidates'->0->>'total_score')
      - export_safe_numeric(w.decision_metadata->'ranked_candidates'->1->>'total_score')
    ELSE NULL
  END AS contact_enrichment_score_margin,
  (
    SELECT NULLIF(string_agg(value, ', '), '')
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(COALESCE(w.decision_metadata #> '{ambiguity_reason_codes}', '[]'::jsonb)) = 'array'
        THEN COALESCE(w.decision_metadata #> '{ambiguity_reason_codes}', '[]'::jsonb)
        ELSE '[]'::jsonb
      END
    ) AS codes(value)
  ) AS contact_enrichment_reason_summary
FROM winning w
LEFT JOIN LATERAL (
  SELECT
    MAX(email_address) FILTER (WHERE rn = 1) AS contact_email_1,
    MAX(email_address) FILTER (WHERE rn = 2) AS contact_email_2,
    MAX(email_address) FILTER (WHERE rn = 3) AS contact_email_3
  FROM (
    SELECT e.email_address, ROW_NUMBER() OVER (ORDER BY e.raw_rank, e.id) AS rn
    FROM contact_enrichment_match_emails e
    WHERE e.match_id = w.match_id
  ) ranked
  WHERE rn <= 3
) em ON true
LEFT JOIN LATERAL (
  SELECT
    MAX(phone) FILTER (WHERE rn = 1) AS contact_phone_1,
    MAX(phone_type) FILTER (WHERE rn = 1) AS contact_phone_1_type,
    MAX(phone) FILTER (WHERE rn = 2) AS contact_phone_2,
    MAX(phone_type) FILTER (WHERE rn = 2) AS contact_phone_2_type,
    MAX(phone) FILTER (WHERE rn = 3) AS contact_phone_3,
    MAX(phone_type) FILTER (WHERE rn = 3) AS contact_phone_3_type
  FROM (
    SELECT
      COALESCE(p.e164_format, p.local_format) AS phone,
      p.phone_type,
      ROW_NUMBER() OVER (ORDER BY p.raw_rank, p.id) AS rn
    FROM contact_enrichment_match_phones p
    WHERE p.match_id = w.match_id
  ) ranked
  WHERE rn <= 3
) ph ON true;

COMMENT ON VIEW export_owner_contact_enrichment_flat IS
  'Latest promoted contact enrichment per company/owner: top 3 emails and phones, tier/scores from attempt decision_metadata.';

CREATE VIEW export_company_owner_leads_with_contacts
WITH (security_invoker = true)
AS
SELECT
  l.*,
  f.contact_email_1,
  f.contact_email_2,
  f.contact_email_3,
  f.contact_phone_1,
  f.contact_phone_1_type,
  f.contact_phone_2,
  f.contact_phone_2_type,
  f.contact_phone_3,
  f.contact_phone_3_type,
  f.contact_confidence_tier,
  f.contact_enrichment_top_score,
  f.contact_enrichment_score_margin,
  f.contact_enrichment_reason_summary
FROM export_company_owner_leads l
LEFT JOIN export_owner_contact_enrichment_flat f
  ON f.company_id = l.company_id
  AND f.entity_owner_id = l.entity_owner_id;

COMMENT ON VIEW export_company_owner_leads_with_contacts IS
  'export_company_owner_leads plus optional flattened contact enrichment columns.';

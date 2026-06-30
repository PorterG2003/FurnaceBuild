-- Investigation Query for Metrics vs Leads Page Discrepancy
-- Run this in your Supabase SQL editor to understand the difference

-- Replace these values:
-- '<ACCOUNT_ID>': Your account UUID
-- '<START_DATE>': Start date from metrics page (e.g., '2026-06-01')
-- '<END_DATE>': End date from metrics page (e.g., '2026-06-30')
-- '<CAMPAIGN_IDS>': Array of campaign UUIDs if filtering by campaign (e.g., '{uuid1,uuid2}')

\set account_id '<ACCOUNT_ID>'
\set start_date '<START_DATE>'
\set end_date '<END_DATE>'

-- Step 1: Replicate Metrics Page "Leads Reached" count
WITH metrics_reached AS (
  SELECT COUNT(DISTINCT COALESCE(ev.lead_id, en.lead_id))::bigint AS count_lead_ids,
         COUNT(DISTINCT l.global_lead_id)::bigint AS count_global_ids
  FROM public.events ev
  INNER JOIN public.campaigns c ON c.id = ev.campaign_id
  LEFT JOIN public.enrollments en ON en.id = ev.enrollment_id AND en.deleted_at IS NULL
  LEFT JOIN public.leads l ON l.id = COALESCE(ev.lead_id, en.lead_id)
  WHERE c.account_id = :'account_id'::uuid
    AND c.deleted_at IS NULL
    AND c.source IS DISTINCT FROM 'smartlead'
    -- Add campaign filter if needed:
    -- AND c.id = ANY(:'campaign_ids'::uuid[])
    AND ev.event_type = 'sent'
    AND (ev.created_at AT TIME ZONE 'UTC')::date BETWEEN :'start_date'::date AND :'end_date'::date
    AND COALESCE(ev.lead_id, en.lead_id) IS NOT NULL
)
SELECT 
  'Metrics Page - Leads Reached' as metric,
  count_lead_ids as count_by_lead_id,
  count_global_ids as count_by_global_lead_id,
  count_lead_ids - count_global_ids as difference
FROM metrics_reached;

-- Step 2: Replicate Metrics Page "Leads in Queue" count
WITH metrics_queue AS (
  SELECT COUNT(DISTINCT e.lead_id)::bigint AS count_lead_ids,
         COUNT(DISTINCT l.global_lead_id)::bigint AS count_global_ids
  FROM public.enrollments e
  INNER JOIN public.campaigns c ON c.id = e.campaign_id
  LEFT JOIN public.leads l ON l.id = e.lead_id
  WHERE c.account_id = :'account_id'::uuid
    AND c.deleted_at IS NULL
    AND c.status = 'running'
    AND c.source IS DISTINCT FROM 'smartlead'
    -- Add campaign filter if needed:
    -- AND c.id = ANY(:'campaign_ids'::uuid[])
    AND e.deleted_at IS NULL
    AND e.state = 'active'
    AND e.lead_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.message_jobs mj
      WHERE mj.enrollment_id = e.id
        AND mj.status = 'sent'
        AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
    )
)
SELECT 
  'Metrics Page - Leads in Queue' as metric,
  count_lead_ids as count_by_lead_id,
  count_global_ids as count_by_global_lead_id,
  count_lead_ids - count_global_ids as difference
FROM metrics_queue;

-- Step 3: Replicate Leads Page total count (account_lead_people)
WITH leads_page AS (
  SELECT COUNT(*)::bigint AS total_count
  FROM public.account_lead_people alp
  WHERE alp.account_id = :'account_id'::uuid
    -- Add campaign filter if needed (this is how leads page filters by campaign):
    -- AND EXISTS (
    --   SELECT 1
    --   FROM public.leads l
    --   WHERE l.account_id = :'account_id'::uuid
    --     AND l.global_lead_id = alp.global_lead_id
    --     AND l.deleted_at IS NULL
    --     AND l.campaign_id = ANY(:'campaign_ids'::uuid[])
    -- )
)
SELECT 
  'Leads Page - Total People' as metric,
  total_count as count,
  'N/A' as note
FROM leads_page;

-- Step 4: Find people enrolled in multiple campaigns (potential source of discrepancy)
WITH multi_campaign_people AS (
  SELECT 
    l.global_lead_id,
    COUNT(DISTINCT l.campaign_id) as campaign_count,
    STRING_AGG(DISTINCT c.name, ', ' ORDER BY c.name) as campaign_names
  FROM public.leads l
  INNER JOIN public.campaigns c ON c.id = l.campaign_id
  WHERE l.account_id = :'account_id'::uuid
    AND l.deleted_at IS NULL
    AND c.deleted_at IS NULL
    AND c.source IS DISTINCT FROM 'smartlead'
    -- Add campaign filter if needed:
    -- AND c.id = ANY(:'campaign_ids'::uuid[])
  GROUP BY l.global_lead_id
  HAVING COUNT(DISTINCT l.campaign_id) > 1
)
SELECT 
  'People in Multiple Campaigns' as metric,
  COUNT(*) as count_of_people,
  SUM(campaign_count - 1) as extra_lead_id_counts,
  'Each person counted once in Leads Page, multiple times in Metrics if in multiple campaigns' as note
FROM multi_campaign_people;

-- Step 5: Check for campaign tags to understand "Revenue Strategy" filter
SELECT 
  ct.id,
  ct.name,
  ct.color,
  COUNT(DISTINCT cct.campaign_id) as campaign_count
FROM public.campaign_tags ct
LEFT JOIN public.campaign_campaign_tags cct ON cct.tag_id = ct.id
WHERE ct.account_id = :'account_id'::uuid
  AND ct.deleted_at IS NULL
  AND ct.name ILIKE '%revenue%'
GROUP BY ct.id, ct.name, ct.color
ORDER BY ct.name;

-- Step 6: Summary comparison
SELECT 
  'SUMMARY COMPARISON' as section,
  COALESCE(
    (SELECT count_lead_ids FROM (
      SELECT COUNT(DISTINCT COALESCE(ev.lead_id, en.lead_id))::bigint AS count_lead_ids
      FROM public.events ev
      INNER JOIN public.campaigns c ON c.id = ev.campaign_id
      LEFT JOIN public.enrollments en ON en.id = ev.enrollment_id AND en.deleted_at IS NULL
      WHERE c.account_id = :'account_id'::uuid
        AND c.deleted_at IS NULL
        AND c.source IS DISTINCT FROM 'smartlead'
        AND ev.event_type = 'sent'
        AND (ev.created_at AT TIME ZONE 'UTC')::date BETWEEN :'start_date'::date AND :'end_date'::date
        AND COALESCE(ev.lead_id, en.lead_id) IS NOT NULL
    ) mr), 0
  ) as metrics_reached,
  COALESCE(
    (SELECT count_lead_ids FROM (
      SELECT COUNT(DISTINCT e.lead_id)::bigint AS count_lead_ids
      FROM public.enrollments e
      INNER JOIN public.campaigns c ON c.id = e.campaign_id
      WHERE c.account_id = :'account_id'::uuid
        AND c.deleted_at IS NULL
        AND c.status = 'running'
        AND c.source IS DISTINCT FROM 'smartlead'
        AND e.deleted_at IS NULL
        AND e.state = 'active'
        AND e.lead_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.message_jobs mj
          WHERE mj.enrollment_id = e.id
            AND mj.status = 'sent'
            AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
        )
    ) mq), 0
  ) as metrics_in_queue,
  COALESCE(
    (SELECT COUNT(*)::bigint FROM public.account_lead_people alp
     WHERE alp.account_id = :'account_id'::uuid), 0
  ) as leads_page_total,
  COALESCE(
    (SELECT count_lead_ids FROM (
      SELECT COUNT(DISTINCT COALESCE(ev.lead_id, en.lead_id))::bigint AS count_lead_ids
      FROM public.events ev
      INNER JOIN public.campaigns c ON c.id = ev.campaign_id
      LEFT JOIN public.enrollments en ON en.id = ev.enrollment_id AND en.deleted_at IS NULL
      WHERE c.account_id = :'account_id'::uuid
        AND c.deleted_at IS NULL
        AND c.source IS DISTINCT FROM 'smartlead'
        AND ev.event_type = 'sent'
        AND (ev.created_at AT TIME ZONE 'UTC')::date BETWEEN :'start_date'::date AND :'end_date'::date
        AND COALESCE(ev.lead_id, en.lead_id) IS NOT NULL
    ) mr), 0
  ) + COALESCE(
    (SELECT count_lead_ids FROM (
      SELECT COUNT(DISTINCT e.lead_id)::bigint AS count_lead_ids
      FROM public.enrollments e
      INNER JOIN public.campaigns c ON c.id = e.campaign_id
      WHERE c.account_id = :'account_id'::uuid
        AND c.deleted_at IS NULL
        AND c.status = 'running'
        AND c.source IS DISTINCT FROM 'smartlead'
        AND e.deleted_at IS NULL
        AND e.state = 'active'
        AND e.lead_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.message_jobs mj
          WHERE mj.enrollment_id = e.id
            AND mj.status = 'sent'
            AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
        )
    ) mq), 0
  ) as metrics_total,
  COALESCE(
    (SELECT COUNT(*)::bigint FROM public.account_lead_people alp
     WHERE alp.account_id = :'account_id'::uuid), 0
  ) - (
    COALESCE(
      (SELECT count_lead_ids FROM (
        SELECT COUNT(DISTINCT COALESCE(ev.lead_id, en.lead_id))::bigint AS count_lead_ids
        FROM public.events ev
        INNER JOIN public.campaigns c ON c.id = ev.campaign_id
        LEFT JOIN public.enrollments en ON en.id = ev.enrollment_id AND en.deleted_at IS NULL
        WHERE c.account_id = :'account_id'::uuid
          AND c.deleted_at IS NULL
          AND c.source IS DISTINCT FROM 'smartlead'
          AND ev.event_type = 'sent'
          AND (ev.created_at AT TIME ZONE 'UTC')::date BETWEEN :'start_date'::date AND :'end_date'::date
          AND COALESCE(ev.lead_id, en.lead_id) IS NOT NULL
      ) mr), 0
    ) + COALESCE(
      (SELECT count_lead_ids FROM (
        SELECT COUNT(DISTINCT e.lead_id)::bigint AS count_lead_ids
        FROM public.enrollments e
        INNER JOIN public.campaigns c ON c.id = e.campaign_id
        WHERE c.account_id = :'account_id'::uuid
          AND c.deleted_at IS NULL
          AND c.status = 'running'
          AND c.source IS DISTINCT FROM 'smartlead'
          AND e.deleted_at IS NULL
          AND e.state = 'active'
          AND e.lead_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.message_jobs mj
            WHERE mj.enrollment_id = e.id
              AND mj.status = 'sent'
              AND (mj.message_type = 'campaign' OR mj.message_type IS NULL)
          )
      ) mq), 0
    )
  ) as discrepancy;

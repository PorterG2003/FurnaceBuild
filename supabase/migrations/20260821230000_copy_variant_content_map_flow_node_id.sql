-- Prod launched copy_variant_content_map without flow_node_id (CREATE TABLE IF NOT
-- EXISTS skipped the rebuilt key). Send-worker stamping and copy backfill both
-- look up by flow_node_id, so add the column and fill it from sent jobs.

ALTER TABLE public.copy_variant_content_map
  ADD COLUMN IF NOT EXISTS flow_node_id text;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.copy_variant_content_map'::regclass
      AND contype IN ('p', 'u')
  LOOP
    EXECUTE format(
      'ALTER TABLE public.copy_variant_content_map DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;
END $$;

WITH node_keys AS (
  SELECT
    mj.campaign_id,
    mj.variant_id,
    mj.flow_version_number,
    n.flow_node_id
  FROM public.message_jobs mj
  INNER JOIN public.nodes n ON n.id = mj.node_id
  WHERE mj.variant_id IS NOT NULL
    AND mj.flow_version_number IS NOT NULL
    AND n.flow_node_id IS NOT NULL
    AND btrim(n.flow_node_id) <> ''
  GROUP BY 1, 2, 3, 4
),
unique_triples AS (
  SELECT
    campaign_id,
    variant_id,
    flow_version_number,
    min(flow_node_id) AS flow_node_id
  FROM node_keys
  GROUP BY 1, 2, 3
  HAVING count(*) = 1
)
UPDATE public.copy_variant_content_map m
SET flow_node_id = u.flow_node_id
FROM unique_triples u
WHERE m.flow_node_id IS NULL
  AND m.campaign_id = u.campaign_id
  AND m.variant_id = u.variant_id
  AND m.flow_version_number = u.flow_version_number;

WITH node_keys AS (
  SELECT
    mj.campaign_id,
    mj.variant_id,
    mj.flow_version_number,
    n.flow_node_id,
    row_number() OVER (
      PARTITION BY mj.campaign_id, mj.variant_id, mj.flow_version_number
      ORDER BY n.flow_node_id
    ) AS rn
  FROM public.message_jobs mj
  INNER JOIN public.nodes n ON n.id = mj.node_id
  WHERE mj.variant_id IS NOT NULL
    AND mj.flow_version_number IS NOT NULL
    AND n.flow_node_id IS NOT NULL
    AND btrim(n.flow_node_id) <> ''
  GROUP BY 1, 2, 3, 4
)
INSERT INTO public.copy_variant_content_map (
  account_id,
  campaign_id,
  variant_id,
  flow_version_number,
  content_id,
  created_at,
  flow_node_id
)
SELECT
  m.account_id,
  m.campaign_id,
  m.variant_id,
  m.flow_version_number,
  m.content_id,
  m.created_at,
  nk.flow_node_id
FROM public.copy_variant_content_map m
INNER JOIN node_keys nk
  ON nk.campaign_id = m.campaign_id
 AND nk.variant_id = m.variant_id
 AND nk.flow_version_number = m.flow_version_number
WHERE m.flow_node_id IS NULL
  AND nk.rn > 1;

WITH node_keys AS (
  SELECT
    mj.campaign_id,
    mj.variant_id,
    mj.flow_version_number,
    n.flow_node_id,
    row_number() OVER (
      PARTITION BY mj.campaign_id, mj.variant_id, mj.flow_version_number
      ORDER BY n.flow_node_id
    ) AS rn
  FROM public.message_jobs mj
  INNER JOIN public.nodes n ON n.id = mj.node_id
  WHERE mj.variant_id IS NOT NULL
    AND mj.flow_version_number IS NOT NULL
    AND n.flow_node_id IS NOT NULL
    AND btrim(n.flow_node_id) <> ''
  GROUP BY 1, 2, 3, 4
)
UPDATE public.copy_variant_content_map m
SET flow_node_id = nk.flow_node_id
FROM node_keys nk
WHERE m.flow_node_id IS NULL
  AND nk.rn = 1
  AND m.campaign_id = nk.campaign_id
  AND m.variant_id = nk.variant_id
  AND m.flow_version_number = nk.flow_version_number;

CREATE UNIQUE INDEX IF NOT EXISTS copy_variant_content_map_node_key
  ON public.copy_variant_content_map (
    campaign_id,
    flow_version_number,
    flow_node_id,
    variant_id
  )
  WHERE flow_node_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

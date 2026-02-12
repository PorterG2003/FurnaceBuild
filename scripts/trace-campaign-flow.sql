-- Trace campaign 192fa894-caef-4f9d-abbd-1ea03907141c: first email sent, second never came.
-- Run each block in Supabase SQL Editor and compare with the possible causes below.

-- 1) Campaign
SELECT id, status, sending_interval_seconds, last_completed_interval_time,
  jsonb_array_length(flow_data->'edges') AS edge_count,
  flow_data->'edges' AS edges
FROM campaigns
WHERE id = '192fa894-caef-4f9d-abbd-1ea03907141c';

-- 2) Nodes (email nodes order matters: first vs second email)
SELECT id, flow_node_id, node_type, created_at
FROM nodes
WHERE campaign_id = '192fa894-caef-4f9d-abbd-1ea03907141c'
ORDER BY created_at;

-- 3) Enrollments
SELECT id, lead_id, current_node_id, state, next_run_at, next_run_at <= NOW() AS claim_ready, updated_at
FROM enrollments
WHERE campaign_id = '192fa894-caef-4f9d-abbd-1ea03907141c';

-- 4) Message jobs (which node, status, scheduled_at, sent_at)
SELECT mj.id, mj.enrollment_id, mj.node_id, n.flow_node_id, n.node_type,
  mj.status, mj.message_type, mj.scheduled_at, mj.sent_at, mj.interval_id, mj.created_at
FROM message_jobs mj
LEFT JOIN nodes n ON n.id = mj.node_id AND n.campaign_id = mj.campaign_id
WHERE mj.campaign_id = '192fa894-caef-4f9d-abbd-1ea03907141c'
ORDER BY mj.created_at;

-- 5) Campaign intervals (first 20)
SELECT id, interval_time, status, locked_at, locked_by
FROM campaign_intervals
WHERE campaign_id = '192fa894-caef-4f9d-abbd-1ea03907141c'
ORDER BY interval_time
LIMIT 20;

-- Possible causes to check:
-- A) campaigns.status != 'running' -> claim_enrollments_ready and claim_message_jobs_ready skip this campaign.
-- B) Enrollment stuck at first email node (current_node_id = first email node), first job sent, no second job
--    -> Scheduler didn't re-run after send (next_run_at not set?) or didn't advance to second node.
-- C) Enrollment at second email node but no message_job for that node
--    -> batch_assign_jobs_to_interval didn't create it (no interval, or filter).
-- D) Second message_job exists but scheduled_at in future or status pending -> not claimed by send worker.
-- E) flow_data.edges: no path from first email to second (e.g. via wait node) -> flow evaluation returns no next node.
-- F) sending_interval_seconds IS NULL -> batch interval assignment skips campaign.

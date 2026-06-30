# Metrics vs Leads Page Discrepancy Analysis

## The Numbers

- **Metrics Page (Revenue Strategy)**: 4,400 reached + 780 in queue = 5,180 total
- **Leads Page**: 4,594 total
- **Discrepancy**: 586 leads (4,594 - 5,180 = **-586**)

## Root Cause

The metrics page and leads page use **completely different counting methods** with different filters:

### Metrics Page (`account_outreach_metrics`)

**Location**: `supabase/migrations/20260515160000_account_outreach_metrics_campaign_filter.sql`

**What it counts**:

1. **Leads Reached** (4,400):
   - Counts `DISTINCT lead_id` from the `events` table
   - WHERE `event_type = 'sent'`
   - **AND date is within the selected date range** (e.g., last 30 days)
   - AND campaign is NOT from Smartlead
   - AND (optionally) campaign is in the selected campaign filter

2. **Leads in Queue** (780):
   - Counts `DISTINCT lead_id` from `enrollments` table
   - WHERE enrollment `state = 'active'`
   - AND campaign `status = 'running'`
   - AND campaign is NOT from Smartlead
   - **AND the lead has NO sent campaign message_job yet** (snapshot, no date filter)
   - AND (optionally) campaign is in the selected campaign filter

**Key SQL for Reached**:
```sql
SELECT COUNT(DISTINCT x.lid)::bigint AS dcnt
FROM (
  SELECT COALESCE(ev.lead_id, en.lead_id) AS lid
  FROM public.events ev
  INNER JOIN public.campaigns c ON c.id = ev.campaign_id
  WHERE c.account_id = p_account_id
    AND c.deleted_at IS NULL
    AND c.source IS DISTINCT FROM 'smartlead'
    AND (p_campaign_ids IS NULL OR c.id = ANY (p_campaign_ids))
    AND ev.event_type = 'sent'
    AND (ev.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
) x
WHERE x.lid IS NOT NULL
```

**Key SQL for In Queue**:
```sql
SELECT COUNT(DISTINCT e.lead_id)::bigint AS inq
FROM public.enrollments e
INNER JOIN public.campaigns c ON c.id = e.campaign_id
WHERE c.account_id = p_account_id
  AND c.deleted_at IS NULL
  AND c.status = 'running'
  AND c.source IS DISTINCT FROM 'smartlead'
  AND (p_campaign_ids IS NULL OR c.id = ANY (p_campaign_ids))
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
```

### Leads Page (`account_lead_people_page`)

**Location**: `supabase/migrations/20260531120000_persist_zero_campaign_lead_people.sql`

**What it counts**:

- Queries the `account_lead_people` **rollup table**
- This table is **incrementally maintained** and contains one row per unique person (`global_lead_id`)
- **NO date range filter** - includes ALL people ever imported or enrolled
- **Includes people with ZERO active campaigns** (e.g., removed from all campaigns)
- Can filter by campaign (checks if person has any lead in that campaign), but this is NOT a date-based filter

**Key SQL**:
```sql
SELECT
  filtered.global_lead_id,
  filtered.email,
  ...
  COUNT(*) OVER()::bigint AS total_count
FROM public.account_lead_people alp
WHERE alp.account_id = p_account_id
  -- Campaign filter checks EXISTS in leads table, not date-based
  AND (
    COALESCE(array_length(p_campaign_ids, 1), 0) = 0
    OR EXISTS (
      SELECT 1
      FROM public.leads l
      WHERE l.account_id = p_account_id
        AND l.global_lead_id = alp.global_lead_id
        AND l.deleted_at IS NULL
        AND l.campaign_id = ANY(p_campaign_ids)
    )
  )
```

## Why the Numbers Don't Match

The **-586 discrepancy** (leads page shows FEWER) could happen if:

1. **Date Range on Metrics Page**: The metrics page is likely filtering to a specific date range (e.g., "Last 30 days"). The 4,400 "reached" only counts leads sent TO within that range.

2. **Campaign Filter on Metrics Page**: If "Revenue Strategy" is a campaign filter, then:
   - Metrics page: Shows 4,400 reached + 780 queued = 5,180 in that campaign/tag
   - Leads page: Shows 4,594 if filtered to the same campaign

3. **The 586 extra leads in the metrics total** likely come from:
   - **Duplicates across campaigns**: A single person (`global_lead_id`) can have multiple campaign memberships. The metrics page counts by `lead_id` (campaign-specific), while the leads page counts by `global_lead_id` (deduplicated person). If 586 people were added to multiple campaigns in the "Revenue Strategy" tag, they'd be counted multiple times in metrics but once in leads.

## Example Scenario

Let's say:
- Person A has email `person@example.com` with `global_lead_id = "abc123"`
- Person A was added to:
  - Campaign 1 (Revenue Strategy) → `lead_id = "lead-001"` → sent on June 15
  - Campaign 2 (Revenue Strategy) → `lead_id = "lead-002"` → sent on June 20

**Metrics Page (filtered to "Revenue Strategy" campaigns, June 1-30)**:
- Counts `lead-001` as reached ✓
- Counts `lead-002` as reached ✓
- **Total reached for this person: 2**

**Leads Page (filtered to "Revenue Strategy" campaigns)**:
- Counts `global_lead_id = "abc123"` once
- **Total for this person: 1**

If 586 people were enrolled in an average of 2 campaigns each within the Revenue Strategy tag, that would explain the discrepancy:
- **586 people × 2 enrollments** = 1,172 extra lead_id counts
- But wait, the math shows metrics is HIGHER, not lower...

## Alternative Explanation

Actually, if the leads page shows FEWER (4,594) than metrics total (5,180), the most likely reasons are:

1. **Metrics includes leads from MULTIPLE campaigns**: If no campaign filter is applied on the metrics page, it might be counting across ALL campaigns, while the leads page might have a filter.

2. **Date Range**: If the metrics page has a wider date range or NO date range, it could capture more historical data.

3. **Deleted Leads**: The `account_lead_people` rollup can retain people even after all their leads are soft-deleted, but the count might be lower if some rollup entries were purged.

## Recommendations to Verify

Run these queries to investigate:

```sql
-- 1. Count distinct global_lead_ids in events (matches leads page logic)
SELECT COUNT(DISTINCT l.global_lead_id)
FROM events ev
JOIN leads l ON l.id = ev.lead_id
JOIN campaigns c ON c.id = ev.campaign_id
WHERE c.account_id = '<ACCOUNT_ID>'
  AND c.deleted_at IS NULL
  AND c.source IS DISTINCT FROM 'smartlead'
  AND ev.event_type = 'sent'
  AND (ev.created_at AT TIME ZONE 'UTC')::date BETWEEN '<START_DATE>' AND '<END_DATE>';

-- 2. Count lead_ids (matches metrics page "reached" logic)
SELECT COUNT(DISTINCT ev.lead_id)
FROM events ev
JOIN campaigns c ON c.id = ev.campaign_id
WHERE c.account_id = '<ACCOUNT_ID>'
  AND c.deleted_at IS NULL
  AND c.source IS DISTINCT FROM 'smartlead'
  AND ev.event_type = 'sent'
  AND (ev.created_at AT TIME ZONE 'UTC')::date BETWEEN '<START_DATE>' AND '<END_DATE>';

-- 3. Find leads enrolled in multiple campaigns
SELECT l.global_lead_id, COUNT(DISTINCT l.campaign_id) as campaign_count
FROM leads l
JOIN campaigns c ON c.id = l.campaign_id
WHERE l.account_id = '<ACCOUNT_ID>'
  AND l.deleted_at IS NULL
  AND c.deleted_at IS NULL
  AND c.source IS DISTINCT FROM 'smartlead'
GROUP BY l.global_lead_id
HAVING COUNT(DISTINCT l.campaign_id) > 1
ORDER BY campaign_count DESC;
```

## Summary

**The core issue**: Metrics page counts **lead memberships** (`lead_id`) while the leads page counts **unique people** (`global_lead_id`). The metrics page also applies date filters while the leads page does not by default.

To get matching numbers:
1. Ensure both pages have the same campaign filter applied (or none)
2. Note that the metrics date range doesn't apply to the leads page
3. Understand that people enrolled in multiple campaigns will inflate the metrics numbers relative to the leads page

# Changes Required: Intervals with Singular Time

## Current System (Incorrect)
- Intervals have `interval_start` and `interval_end` (time range)
- Jitter is calculated within the range
- Scheduled time is clamped to range boundaries
- Cannot schedule before `interval_start` (no negative jitter)

## Desired System (Correct)
- Intervals have `interval_time` (single timestamp - base time)
- Jitter is calculated from `interval_time ± (interval_duration * jitter_percentage / 2)`
- Scheduled time can be BEFORE `interval_time` (allows negative jitter)
- `interval_duration` comes from `campaigns.sending_interval_seconds`

## Example
- Campaign: `sending_interval_seconds = 300` (5 minutes)
- Jitter: `jitter_percentage = 10%`
- Interval time: `10:00 AM`

Calculation:
- Jitter range = `300 * 0.10 = 30 seconds`
- Scheduled time = `10:00 AM ± 30 seconds`
- Range: `9:59:30 AM` to `10:00:30 AM` ✅ (allows negative jitter)

## Required Changes

### 1. Database Schema Migration

**File**: `supabase/migrations/YYYYMMDDHHMMSS_change_intervals_to_singular_time.sql`

```sql
-- Change campaign_intervals from start/end to singular time
ALTER TABLE campaign_intervals 
  DROP COLUMN IF EXISTS interval_end,
  ADD COLUMN IF NOT EXISTS interval_time TIMESTAMPTZ;

-- Migrate existing data: use interval_start as interval_time
UPDATE campaign_intervals 
SET interval_time = interval_start 
WHERE interval_time IS NULL;

-- Make interval_time NOT NULL after migration
ALTER TABLE campaign_intervals 
  ALTER COLUMN interval_time SET NOT NULL;

-- Drop old constraint
ALTER TABLE campaign_intervals 
  DROP CONSTRAINT IF EXISTS campaign_intervals_time_check;

-- Update unique constraint
ALTER TABLE campaign_intervals 
  DROP CONSTRAINT IF EXISTS campaign_intervals_campaign_id_interval_start_key;
  
ALTER TABLE campaign_intervals 
  ADD CONSTRAINT campaign_intervals_campaign_id_interval_time_key 
  UNIQUE(campaign_id, interval_time);

-- Update indexes
DROP INDEX IF EXISTS idx_campaign_intervals_campaign_start;
DROP INDEX IF EXISTS idx_campaign_intervals_status_start;

CREATE INDEX IF NOT EXISTS idx_campaign_intervals_campaign_time 
  ON campaign_intervals(campaign_id, interval_time);

CREATE INDEX IF NOT EXISTS idx_campaign_intervals_status_time 
  ON campaign_intervals(status, interval_time) 
  WHERE status = 'available';

-- Update comments
COMMENT ON COLUMN campaign_intervals.interval_time IS 'Base time for this interval. Jitter is calculated from this time using campaign sending_interval_seconds. Scheduled times can be before this time (negative jitter).';
```

### 2. Update `assign_message_job_to_interval` Function

**Changes needed:**
- Remove `interval_start` and `interval_end` variables
- Add `interval_time` variable
- Get `sending_interval_seconds` from campaign
- Calculate jitter: `interval_time ± (sending_interval_seconds * jitter_percentage / 2)`
- Remove clamping to range (allow negative jitter)
- Update sequential check to use `interval_time` instead of `interval_end`

**New jitter calculation:**
```sql
-- Get campaign interval duration
SELECT sending_interval_seconds INTO v_interval_duration_seconds
FROM campaigns
WHERE id = p_campaign_id;

-- Calculate jitter range
v_jitter_range_seconds := v_interval_duration_seconds * (p_jitter_percentage / 100.0);

-- Random jitter: -jitter_range to +jitter_range
v_jitter_offset_seconds := (RANDOM() * 2 - 1) * v_jitter_range_seconds;

-- Scheduled time = interval_time + jitter (can be before interval_time)
v_scheduled_at := v_interval_time + (v_jitter_offset_seconds || ' seconds')::INTERVAL;

-- NO CLAMPING - allow negative jitter
```

### 3. Update Sequential Processing

**In `assign_message_job_to_interval`:**
- Change sequential check from `interval_start >= last_processed_interval_end` to `interval_time >= last_processed_interval_end`
- Update `last_processed_interval_end` to use `interval_time` instead of `interval_end`

**In `check_and_update_processed_intervals`:**
- Change from `interval_end` to `interval_time`
- Update `last_processed_interval_end` to use `interval_time`

### 4. Update Interval Maintenance

**File**: `workers/scheduler-worker/src/interval-management.ts`

**Changes:**
- `createCampaignIntervals`: Create intervals with `interval_time` instead of `interval_start`/`interval_end`
- Each interval: `interval_time = previous_interval_time + interval_seconds`
- Remove `interval_end` calculation

**New logic:**
```typescript
let currentTime = new Date(startFrom);

for (let i = 0; i < count; i++) {
  intervals.push({
    campaign_id: campaignId,
    interval_time: currentTime.toISOString(), // Single time
    status: 'available'
  });
  
  // Next interval is interval_seconds later
  currentTime = new Date(currentTime.getTime() + (intervalSeconds * 1000));
}
```

### 5. Update UI (ScheduleTab)

**File**: `lib/test/campaign-flow/components/ScheduleTab.tsx`

**Changes:**
- Update `MessageJob.interval` interface: remove `interval_start`/`interval_end`, add `interval_time`
- Update query: select `interval_time` instead of `interval_start`/`interval_end`
- Update display: show `interval_time` instead of range

**New display:**
```typescript
render: (item) => {
  if (item.type === 'message_job' && item.interval) {
    return (
      <View>
        <Text className="text-white font-instrument text-sm" numberOfLines={1}>
          {format(new Date(item.interval.interval_time), 'h:mm a')}
        </Text>
        <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
          {item.interval.status}
        </Text>
      </View>
    );
  }
  return <Text className="text-gray-500 font-instrument text-sm">—</Text>;
}
```

### 6. Update Backfill Migration

**File**: `supabase/migrations/20260106201848_backfill_last_processed_interval_end.sql`

**Changes:**
- Change from `MAX(ci.interval_end)` to `MAX(ci.interval_time)`

### 7. Update Interval Management Query

**File**: `workers/scheduler-worker/src/interval-management.ts`

**In `ensureCampaignIntervals`:**
- Change from `interval_end` to `interval_time` in queries
- Update `startFrom` calculation to use `interval_time`

## Migration Order

1. **Schema migration** - Change table structure
2. **Function migration** - Update `assign_message_job_to_interval`
3. **Function migration** - Update `check_and_update_processed_intervals`
4. **Backfill migration** - Update existing `last_processed_interval_end` values
5. **Code updates** - Update TypeScript files (interval-management.ts, ScheduleTab.tsx)

## Testing Checklist

- [ ] Intervals created with single `interval_time`
- [ ] Jitter allows negative values (scheduled before interval_time)
- [ ] Sequential processing works with `interval_time`
- [ ] UI displays `interval_time` correctly
- [ ] All mailboxes get jobs in same interval
- [ ] Intervals processed when all jobs sent/failed


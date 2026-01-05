# Email Node Re-Evaluation: Alternative Approaches

## Current Proposed Approach (Polling Based on scheduled_at)

**Approach**: In `evaluateFlow()`, when email node's message hasn't been sent:
1. Check `message_job.scheduled_at`
2. Set `enrollment.next_run_at` to `scheduled_at + 1 minute` (or `NOW() + 30s` if past)
3. Return empty array
4. Worker reloads enrollment, sees `next_run_at` is set, doesn't mark as completed
5. Enrollment is picked up again when `next_run_at <= NOW()`

**Pros**:
- Simple to implement
- Uses existing polling infrastructure
- Respects campaign schedule (via `scheduled_at`)

**Cons**:
- **Polling overhead**: Still requires periodic database queries
- **Delayed detection**: Only checks when `next_run_at` arrives (could be minutes/hours later)
- **Failed emails**: If email fails to send, we'll keep checking indefinitely
- **Complexity in evaluateFlow**: Mixes flow evaluation with enrollment state management
- **Edge cases**: What if `scheduled_at` is far in the future? What if send worker is slow?

## Alternative 1: Event-Driven (Send Worker Updates Enrollment)

**Approach**: When send worker successfully sends an email:
1. Update `message_job.sent_at` (already done)
2. **Also update `enrollment.next_run_at` to NOW()** (or short time in future)
3. Scheduler picks up enrollment immediately (or very soon)
4. `evaluateFlow()` checks if email is sent, finds it is, proceeds to next node

**Pros**:
- **Immediate**: Enrollment is picked up as soon as email is sent
- **No polling delay**: No waiting for `next_run_at` to arrive
- **Event-driven**: More reactive, less wasteful
- **Simpler evaluateFlow**: Doesn't need to manage `next_run_at`
- **Explicit and visible**: Update is in code, easy to see and debug
- **Error handling**: Can add try/catch, logging, retry logic
- **Already has enrollment_id**: Send worker already knows about enrollments (has `enrollment_id` in message_job)

**Cons**:
- **Two updates**: Send worker updates both `message_job` and `enrollment` (but in same transaction?)
- **Failed emails**: Still need to handle failures (maybe set `next_run_at` after retry timeout?)
- **What if update fails?**: If enrollment update fails, email is sent but enrollment not re-evaluated (but trigger has same issue)

**Implementation**:
```typescript
// In send worker, after successfully sending email:
await supabase
  .from('message_jobs')
  .update({ sent_at: new Date().toISOString(), status: 'sent' })
  .eq('id', messageJob.id);

// Also update enrollment to trigger re-evaluation
await supabase
  .from('enrollments')
  .update({ next_run_at: new Date().toISOString() }) // Check immediately
  .eq('id', messageJob.enrollment_id);
```

## Alternative 2: Database Trigger

**Approach**: Create a database trigger that fires when `message_jobs.sent_at` is updated:
1. Trigger fires on `UPDATE message_jobs SET sent_at = ...`
2. Trigger updates `enrollment.next_run_at` to NOW()
3. Scheduler picks up enrollment immediately

**Pros**:
- **Automatic**: No code changes needed in send worker
- **Immediate**: Enrollment updated as soon as email is sent
- **Decoupled**: Send worker doesn't need to know about enrollments
- **Database-level**: Guaranteed to run (can't be missed, runs in same transaction)

**Cons**:
- **Database complexity**: Adds trigger logic to database (harder to version control, test, debug)
- **Debugging**: Harder to debug trigger behavior (no stack traces, less visible)
- **Failed emails**: Still need to handle failures
- **"Magic" behavior**: Less explicit, developers might not know it exists
- **Performance**: Trigger runs on every `sent_at` update (even if already set)
- **Transaction overhead**: Adds UPDATE to enrollment table in same transaction

**Implementation**:
```sql
CREATE OR REPLACE FUNCTION trigger_enrollment_reevaluation()
RETURNS TRIGGER AS $$
BEGIN
  -- When message_job is marked as sent, update enrollment to trigger re-evaluation
  IF NEW.sent_at IS NOT NULL AND OLD.sent_at IS NULL THEN
    UPDATE enrollments
    SET next_run_at = NOW()
    WHERE id = NEW.enrollment_id
      AND state = 'active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER message_job_sent_trigger
  AFTER UPDATE ON message_jobs
  FOR EACH ROW
  WHEN (NEW.sent_at IS NOT NULL AND OLD.sent_at IS NULL)
  EXECUTE FUNCTION trigger_enrollment_reevaluation();
```

## Alternative 3: Hybrid (Event-Driven + Polling Fallback)

**Approach**: Combine event-driven with polling fallback:
1. Send worker updates `enrollment.next_run_at` when email is sent (event-driven)
2. `evaluateFlow()` also sets `next_run_at` based on `scheduled_at` as fallback
3. If event-driven update happens, enrollment is picked up immediately
4. If event-driven update fails/misses, polling fallback ensures we still check

**Pros**:
- **Best of both**: Immediate when possible, reliable fallback
- **Resilient**: Works even if send worker update fails

**Cons**:
- **Complexity**: Two mechanisms to maintain
- **Redundancy**: Might check twice (once from event, once from polling)

## Alternative 4: Check in Worker Before Processing Nodes

**Approach**: Instead of checking in `evaluateFlow()`, check in worker before processing nodes:
1. `evaluateFlow()` returns next nodes normally (doesn't check email status)
2. Worker checks if any returned nodes follow an email node
3. If yes, check if that email node's message_job has been sent
4. If not sent, update `next_run_at` and skip processing

**Pros**:
- **Separation of concerns**: `evaluateFlow()` stays pure (just returns nodes)
- **Explicit**: Worker explicitly handles the dependency

**Cons**:
- **Complex worker logic**: Worker needs to understand node dependencies
- **Still polling**: Same polling issues as current approach

## Comparison Table

| Approach | Immediate | Complexity | Reliability | Polling Overhead |
|----------|-----------|------------|-------------|------------------|
| **Current (scheduled_at polling)** | ❌ Delayed | Medium | Medium | High |
| **Event-driven (send worker)** | ✅ Immediate | Low | High | Low |
| **Database trigger** | ✅ Immediate | Medium | Very High | Low |
| **Hybrid** | ✅ Immediate | High | Very High | Medium |
| **Worker check** | ❌ Delayed | High | Medium | High |

## Recommendation

**Option: Send Worker Updates Enrollment (Alternative 1)**

**Why**:
1. **Immediate**: Enrollment is picked up as soon as email is sent (no polling delay)
2. **Explicit and visible**: Update is in code, easy to see, debug, and reason about
3. **Error handling**: Can add try/catch, logging, retry logic around enrollment update
4. **Already coupled**: Send worker already has `enrollment_id` - not really adding coupling
5. **Easier to maintain**: Code is easier to version control, test, and modify than database triggers
6. **Same reliability**: Can use database transaction to ensure both updates succeed together
7. **Better debugging**: If enrollment update fails, we see it in send worker logs

**Tradeoff**: 
- Database trigger is more "automatic" and decoupled
- But send worker approach is more explicit, maintainable, and debuggable
- The "coupling" isn't really a problem since send worker already knows about enrollments

**Implementation**:
- Create trigger that fires when `message_jobs.sent_at` is set
- Trigger updates `enrollment.next_run_at` to NOW()
- `evaluateFlow()` still checks if email is sent (for safety), but doesn't need to manage `next_run_at`
- Worker still reloads enrollment to check if `next_run_at` was updated

**Edge Cases to Handle**:
1. **Failed emails**: Don't update `next_run_at` if `status = 'failed'` (or update after retry timeout?)
2. **Multiple message_jobs**: Only update if this is the most recent message_job for the enrollment
3. **Enrollment state**: Only update if `enrollment.state = 'active'`

## Questions to Consider

1. **What if email fails to send?**
   - Should we wait for retries?
   - Should we set a maximum wait time?
   - Should we advance anyway after N failures?

2. **What if send worker is slow?**
   - Should we have a timeout?
   - Should we check periodically as fallback?

3. **What if multiple emails are queued?**
   - Should we wait for all emails to be sent?
   - Or just the current email node's email?

4. **Performance concerns?**
   - How many enrollments will be waiting for emails?
   - How often will this trigger fire?
   - Is database trigger overhead acceptable?


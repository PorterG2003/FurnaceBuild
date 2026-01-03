# Test System Fixes - Implementation Plan

## Overview

This document outlines the fixes needed to make the scheduler test system fully functional and error-free. The test system currently has several critical issues that prevent proper testing of the scheduler worker.

## Critical Issues (Must Fix)

### 1. Auto-Verify Not Implemented
**Problem**: The `autoVerify` toggle exists but doesn't actually poll the database.

**Solution**:
- Add `useEffect` hook that sets up interval when `autoVerify` is true
- Poll `verifyTest()` every 5-10 seconds when auto-verify is enabled
- Clean up interval on unmount or when `autoVerify` is disabled
- Show visual indicator that auto-verify is active

**Files to modify**:
- `app/(main)/test/scheduler.tsx`

**Implementation**:
```typescript
useEffect(() => {
  if (autoVerify && enrollmentId) {
    const interval = setInterval(() => {
      verifyTest();
    }, 5000); // Poll every 5 seconds
    
    setAutoVerifyInterval(interval);
    
    return () => {
      if (interval) clearInterval(interval);
    };
  } else {
    if (autoVerifyInterval) {
      clearInterval(autoVerifyInterval);
      setAutoVerifyInterval(null);
    }
  }
}, [autoVerify, enrollmentId]);
```

---

### 2. Enrollment Creation Logic Issue
**Problem**: Test sets `current_node_id` to first email node, but `evaluateFlow` expects `null` for entry point handling.

**Solution**:
- Set `current_node_id = null` when creating enrollment
- Let `evaluateFlow` handle entry point detection automatically
- This ensures proper flow traversal from the beginning

**Files to modify**:
- `app/(main)/test/scheduler.tsx` (line ~467)

**Implementation**:
```typescript
const { data: enrollment, error: enrollmentError } = await supabase
  .from('enrollments')
  .insert({
    campaign_id: campaign.id,
    lead_id: lead.id,
    current_node_id: null, // Let evaluateFlow handle entry point
    state: 'active',
    next_run_at: new Date().toISOString(), // Process immediately
    flow_position: {},
  })
  .select()
  .single();
```

**Remove**:
- The code that finds `firstNode` and `firstNodeData` (lines ~449-465)
- This is no longer needed since we're using entry point detection

---

### 3. Race Condition / Timing Issues
**Problem**: Enrollment created with `next_run_at = NOW()`, but scheduler polls every 5 seconds, causing delay.

**Solution**:
- Add visual indicator showing "Waiting for scheduler..." when enrollment is created
- Show estimated time until next scheduler poll
- Add manual "Force Check" button that doesn't wait for poll interval
- Show last poll time in verification section

**Files to modify**:
- `app/(main)/test/scheduler.tsx`

**Implementation**:
- Add state: `const [waitingForScheduler, setWaitingForScheduler] = useState(false);`
- After enrollment creation, set `waitingForScheduler = true`
- Show message: "Enrollment created. Scheduler polls every 5 seconds. Next check in ~X seconds."
- After first verification shows message jobs, set `waitingForScheduler = false`

---

### 4. No Cleanup Mechanism
**Problem**: Test data accumulates in database with no way to clean it up.

**Solution**:
- Add "Cleanup Test Data" button on complete screen
- Delete: enrollment, message_jobs, nodes, lead, campaign (in that order due to foreign keys)
- Show confirmation dialog before cleanup
- After cleanup, reset form and return to step 1

**Files to modify**:
- `app/(main)/test/scheduler.tsx`

**Implementation**:
```typescript
const handleCleanup = async () => {
  if (!campaignId) return;
  
  try {
    setLoading(true);
    
    // Delete in order: message_jobs -> enrollments -> nodes -> leads -> campaign
    if (enrollmentId) {
      await supabase.from('message_jobs').delete().eq('enrollment_id', enrollmentId);
      await supabase.from('enrollments').delete().eq('id', enrollmentId);
    }
    
    await supabase.from('nodes').delete().eq('campaign_id', campaignId);
    if (leadId) {
      await supabase.from('leads').delete().eq('id', leadId);
    }
    await supabase.from('campaigns').delete().eq('id', campaignId);
    
    // Reset state
    setCampaignId(null);
    setLeadId(null);
    setEnrollmentId(null);
    setVerificationData(null);
    setCurrentStep('flow');
    setError(null);
  } catch (err) {
    setError(`Cleanup failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    setLoading(false);
  }
};
```

---

## Medium Issues (Should Fix)

### 5. Missing Validations

#### 5.1 Campaign Status Validation
**Problem**: No check if campaign status is 'running' before creating enrollment.

**Solution**:
- After campaign creation, verify status is 'running'
- If not, show warning and set status to 'running'

**Implementation**:
```typescript
// After campaign creation
if (campaign.status !== 'running') {
  console.warn('Campaign status is not running, updating...');
  await updateCampaign(campaign.id, { status: 'running' });
  campaign.status = 'running';
}
```

#### 5.2 Jitter Percentage Validation
**Problem**: Jitter can be empty string or invalid value.

**Solution**:
- Validate jitter is number between 0-100
- Show error if invalid
- Default to 10 if empty when enabled

**Implementation**:
```typescript
if (enableJitter) {
  const jitter = parseFloat(jitterPercentage);
  if (isNaN(jitter) || jitter < 0 || jitter > 100) {
    setError('Jitter percentage must be between 0 and 100');
    return;
  }
  campaignData.jitter_percentage = jitter;
}
```

#### 5.3 Schedule Validation
**Problem**: No validation for schedule configuration.

**Solution**:
- Validate start_hour < end_hour
- Validate timezone is valid (basic check)
- Validate at least one day selected
- Show clear error messages

**Implementation**:
```typescript
if (enableSchedule) {
  if (scheduleStartHour >= scheduleEndHour) {
    setError('Start hour must be before end hour');
    return;
  }
  if (scheduleDays.length === 0) {
    setError('Select at least one day of the week');
    return;
  }
  // Basic timezone validation (check if it's a known timezone)
  try {
    Intl.DateTimeFormat(undefined, { timeZone: scheduleTimezone });
  } catch (e) {
    setError(`Invalid timezone: ${scheduleTimezone}`);
    return;
  }
}
```

#### 5.4 Mailbox Validation
**Problem**: Test mailbox has fake credentials that will fail.

**Solution**:
- Check if mailbox has valid credentials (or mark as test-only)
- Show warning if using test mailbox
- Optionally: Allow user to select existing mailbox or create new one

**Implementation**:
```typescript
// After mailbox creation/selection
if (mailbox.email_address === 'test@example.com') {
  updateStep('mailbox', 'success', `Using test mailbox (⚠️ Will fail on actual send)`);
} else {
  updateStep('mailbox', 'success', `Using mailbox: ${mailbox.email_address}`);
}
```

---

### 6. Verification Gaps

#### 6.1 Flow Traversal Verification
**Problem**: Can't verify that flow is traversing correctly.

**Solution**:
- Show expected flow path vs actual path
- Display node sequence: Email 1 → Wait → Email 2
- Highlight which node is currently being processed
- Show if flow completed successfully

**Implementation**:
- Add section showing "Expected Flow Path"
- Add section showing "Actual Flow Progress"
- Compare and highlight differences

#### 6.2 Schedule Enforcement Verification
**Problem**: Can't verify schedule is being enforced.

**Solution**:
- Show campaign schedule configuration
- Show when each message_job was scheduled
- Highlight if scheduled time is within schedule constraints
- Show timezone conversion

**Implementation**:
```typescript
// In verification display
{verificationData.enrollment.campaign?.schedule && (
  <View>
    <Text>Schedule: {schedule.start_hour}:00 - {schedule.end_hour}:00 {schedule.timezone}</Text>
    <Text>Days: {schedule.days_of_week.join(', ')}</Text>
    {verificationData.messageJobs.map(job => {
      const scheduledTime = new Date(job.scheduled_at);
      const isWithinSchedule = checkIfWithinSchedule(scheduledTime, schedule);
      return (
        <Text style={{ color: isWithinSchedule ? 'green' : 'red' }}>
          {job.scheduled_at} - {isWithinSchedule ? '✓ Within schedule' : '✗ Outside schedule'}
        </Text>
      );
    })}
  </View>
)}
```

#### 6.3 Jitter Application Verification
**Problem**: Can't verify jitter is being applied.

**Solution**:
- Show base scheduled time (without jitter)
- Show actual scheduled time (with jitter)
- Calculate and display jitter amount
- Show jitter percentage used

**Implementation**:
- Calculate expected time without jitter
- Compare with actual scheduled time
- Display difference as jitter amount

---

### 7. Error Handling Gaps

#### 7.1 Scheduler Failure Detection
**Problem**: No indication if scheduler fails to process enrollment.

**Solution**:
- Add timeout detection (if enrollment not processed after X minutes, show warning)
- Check enrollment state changes
- Show error if enrollment is marked 'stopped' unexpectedly

**Implementation**:
```typescript
// In verification
if (verificationData.enrollment.state === 'stopped' && 
    verificationData.messageJobs.length === 0) {
  // Enrollment stopped without creating jobs - likely an error
  setError('Enrollment was stopped without processing. Check scheduler logs.');
}
```

#### 7.2 Timeout Handling
**Problem**: No timeout if scheduler never processes enrollment.

**Solution**:
- Set timeout (e.g., 2 minutes for test waits)
- Show warning if enrollment not processed within timeout
- Provide "Retry" option to reset enrollment state

**Implementation**:
```typescript
useEffect(() => {
  if (enrollmentId && !verificationData?.messageJobs.length) {
    const timeout = setTimeout(() => {
      setError('Enrollment not processed within expected time. Scheduler may be down or there may be an error.');
    }, 120000); // 2 minutes
    
    return () => clearTimeout(timeout);
  }
}, [enrollmentId, verificationData]);
```

---

### 8. Flow Evaluation Edge Case
**Problem**: Enrollment creation sets `current_node_id` incorrectly.

**Solution**: Already covered in Critical Issue #2.

---

## Minor Issues (Nice to Have)

### 9. UI/UX Improvements

#### 9.1 Loading States
- Show loading spinner while waiting for scheduler
- Show "Processing..." indicator when enrollment is being processed
- Add estimated time until next check

#### 9.2 Time Display
- Clearly label UTC times
- Show local time alongside UTC
- Add timezone indicator

#### 9.3 Campaign/Flow Visualization
- Show full flow structure in verification section
- Highlight current position in flow
- Show completed vs pending nodes

---

### 10. Test Mailbox Credentials
**Problem**: Fake credentials will cause send failures.

**Solution**:
- Add clear warning that test mailbox won't actually send emails
- Optionally: Allow user to select real mailbox from account
- Show which mailbox is being used

---

### 11. Schedule Validation
**Problem**: No validation for schedule inputs.

**Solution**: Already covered in Medium Issue #5.3.

---

### 12. Jitter Description
**Problem**: Description says "wait time" but jitter is only for email sends.

**Solution**:
- Update description: "Random delay up to X% applied to email send times (not wait nodes)"
- Make it clear jitter only affects email scheduling

---

## Implementation Order

### Phase 1: Critical Fixes (Must Do First)
1. ✅ Fix enrollment creation (`current_node_id = null`)
2. ✅ Implement auto-verify polling
3. ✅ Add cleanup mechanism
4. ✅ Add timing/race condition handling

### Phase 2: Validation & Error Handling
5. ✅ Add all validations (campaign status, jitter, schedule, mailbox)
6. ✅ Add error detection and timeout handling
7. ✅ Improve error messages

### Phase 3: Enhanced Verification
8. ✅ Add flow traversal verification
9. ✅ Add schedule enforcement verification
10. ✅ Add jitter application verification

### Phase 4: UI/UX Polish
11. ✅ Improve loading states and time displays
12. ✅ Add flow visualization
13. ✅ Fix descriptions and warnings

---

## Testing Checklist

After implementing fixes, verify:

- [ ] Auto-verify polls every 5 seconds when enabled
- [ ] Enrollment is created with `current_node_id = null`
- [ ] Flow traversal works correctly from entry point
- [ ] Cleanup deletes all test data correctly
- [ ] Validations prevent invalid inputs
- [ ] Error messages are clear and helpful
- [ ] Schedule enforcement is verified
- [ ] Jitter application is verified
- [ ] Timeout detection works
- [ ] UI shows appropriate loading states
- [ ] All edge cases are handled gracefully

---

## Files to Modify

1. `app/(main)/test/scheduler.tsx` - Main test page (all fixes)
2. Potentially create helper utilities:
   - `lib/test-helpers/schedule-validation.ts` - Schedule validation
   - `lib/test-helpers/verification.ts` - Verification helpers

---

## Notes

- Keep test system simple but functional
- Focus on making it reliable for testing scheduler behavior
- Don't over-engineer - this is a testing tool, not production code
- Ensure all fixes maintain backward compatibility with existing test data


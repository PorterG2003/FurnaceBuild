# Test Persistence Analysis

## Problem Statement
Tests can take days to complete (due to wait nodes, schedule restrictions, large lead counts). Users need to be able to view their test campaigns and monitor their progress.

## Current State

### What Gets Created
When a test is created, the system creates:
1. **Campaign** - Contains flow_data, schedule, status, name
2. **Mailboxes** - Test mailboxes with pattern `test-mailbox-{N}@furnace.test`
3. **Leads** - Test leads with pattern `test-lead-{N}@furnace.test`
4. **Enrollments** - One per lead, tracks progress through flow
5. **Message Jobs** - Created by scheduler as flow progresses

### Current Identification
- Test mailboxes/leads identified by email pattern (`@furnace.test`)
- No explicit test entity or grouping mechanism
- No way to list test campaigns
- Test state exists only in React component state (lost on refresh)

## Solution: Query Existing Tables

Tests are just normal campaigns with test mailboxes/leads. We can identify test campaigns by querying for campaigns that have test mailboxes or leads (email pattern `@furnace.test`). No new table needed.

### Identifying Test Campaigns

A campaign is a test if it has:
- Mailboxes with email pattern `@furnace.test` assigned via `campaign_mailboxes`, OR
- Leads with email pattern `@furnace.test`

### Listing User's Tests

```sql
-- Find campaigns that have test mailboxes
SELECT DISTINCT c.*
FROM campaigns c
JOIN campaign_mailboxes cm ON c.id = cm.campaign_id
JOIN mailboxes m ON cm.mailbox_id = m.id
WHERE c.owner_id = $1 
  AND m.email_address LIKE '%@furnace.test'
ORDER BY c.created_at DESC;

-- OR find campaigns that have test leads
SELECT DISTINCT c.*
FROM campaigns c
JOIN leads l ON c.id = l.campaign_id
WHERE c.owner_id = $1 
  AND l.email LIKE '%@furnace.test'
ORDER BY c.created_at DESC;

-- Combined (campaigns with test mailboxes OR test leads)
SELECT DISTINCT c.*
FROM campaigns c
WHERE c.owner_id = $1
  AND (
    EXISTS (
      SELECT 1 FROM campaign_mailboxes cm
      JOIN mailboxes m ON cm.mailbox_id = m.id
      WHERE cm.campaign_id = c.id
        AND m.email_address LIKE '%@furnace.test'
    )
    OR EXISTS (
      SELECT 1 FROM leads l
      WHERE l.campaign_id = c.id
        AND l.email LIKE '%@furnace.test'
    )
  )
ORDER BY c.created_at DESC;
```

### Viewing a Test Campaign

When opening a test campaign (given campaign_id):

1. **Query campaign**: `SELECT * FROM campaigns WHERE id = $1`

2. **Query test mailboxes**: 
   ```sql
   SELECT m.* 
   FROM mailboxes m 
   JOIN campaign_mailboxes cm ON m.id = cm.mailbox_id 
   WHERE cm.campaign_id = $1 
     AND m.email_address LIKE '%@furnace.test'
   ```

3. **Query test leads**: 
   ```sql
   SELECT * 
   FROM leads 
   WHERE campaign_id = $1 
     AND email LIKE '%@furnace.test'
   ```

4. **Query enrollments**: `SELECT * FROM enrollments WHERE campaign_id = $1`

5. **Query message_jobs**: `SELECT * FROM message_jobs WHERE campaign_id = $1`

## Data Flow

### Creating a Test

1. **Create Entities** (campaign, mailboxes, leads, enrollments):
   - Create campaign with flow_data, schedule, name
   - Create test mailboxes (pattern: test-mailbox-{N}@furnace.test)
   - Assign mailboxes to campaign via campaign_mailboxes
   - Create test leads (pattern: test-lead-{N}@furnace.test)
   - Create enrollments for each lead

2. **No additional storage needed** - Campaign is automatically identifiable as a test by the test mailboxes/leads

### Viewing a Test

1. **List User's Test Campaigns**: Query campaigns with test mailboxes/leads (see queries above)

2. **Open Test Campaign**: Query campaign, mailboxes, leads, enrollments, message_jobs by campaign_id

3. **Display test monitoring interface** (similar to current 'complete' step)

## UI Implications

### Test List View
New page or section: "Test Campaigns"
- List all campaigns for current user that have test mailboxes/leads
- Show: campaign name, created at
- Actions: View, Delete

### Viewing a Test
1. User clicks on a test campaign
2. Query campaign, mailboxes, leads, enrollments, message_jobs by campaign_id
3. Display test monitoring interface (shows current state, progress, results)
4. Start monitoring enrollments/message_jobs

### Creation Flow
1. User completes wizard → Click "Create Test"
2. Create entities (campaign, mailboxes, leads, enrollments)
3. Navigate to test monitoring interface
4. Start monitoring enrollments/message_jobs
5. Campaign is automatically identifiable as a test (no additional storage)

## Query Performance

- **Listing tests**: Queries use existing indexes on campaigns.owner_id, campaign_mailboxes.campaign_id, mailboxes.email_address, leads.campaign_id, leads.email
- **Pattern matching**: LIKE '%@furnace.test' uses indexes on email columns
- **Loading test state**: All queries use indexed columns (campaign_id)
- Performance is acceptable for reasonable numbers of campaigns

## Cleanup Strategy

- Test campaigns identified by pattern matching
- Manual cleanup button to delete test campaigns (and cascade deletes mailboxes, leads, enrollments, message_jobs)
- Or: Query and delete campaigns with test mailboxes/leads older than X days

## Implementation

1. **Listing Query**: Create function/query to list test campaigns for a user
2. **View Test Query**: Query all test data by campaign_id when viewing
3. **Test List UI**: Page/component that lists test campaigns and allows viewing them

## Summary

**No new table needed**. Identify test campaigns by querying existing tables for campaigns that have test mailboxes or leads (email pattern `@furnace.test`). This approach:
- **No schema changes** (uses existing tables)
- **No duplicate data** (everything already exists)
- **Leverages existing indexes** (all queries use indexed columns)
- **Simple queries** (pattern matching on email addresses)
- **Automatic identification** (campaigns with test data are automatically test campaigns)

Tests are just campaigns with test data, so we identify them by the test data patterns. Users can view their test campaigns and monitor progress, just like viewing any other campaign.

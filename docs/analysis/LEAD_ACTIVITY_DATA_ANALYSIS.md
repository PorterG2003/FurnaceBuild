# Lead Activity Data Analysis

## Overview
This document analyzes what data is available for tracking activity per lead, including emails sent, node progression, and engagement events.

## Available Data Sources

### 1. **Enrollments Table** - Current Position & State
**Purpose**: Tracks where each lead is in the campaign flow

**Key Fields**:
- `current_node_id` (UUID) - References `nodes.id` - the current node the lead is at
- `state` ('active' | 'paused' | 'stopped' | 'completed') - Enrollment state
- `next_run_at` (TIMESTAMPTZ) - When scheduler will evaluate this enrollment next
- `flow_position` (JSONB) - Snapshot of current position in flow graph
- `created_at`, `updated_at` - Timestamps

**Query Pattern**:
```sql
SELECT 
  e.*,
  n.flow_node_id,
  n.node_type,
  n.node_data
FROM enrollments e
LEFT JOIN nodes n ON e.current_node_id = n.id
WHERE e.lead_id = :lead_id
  AND e.campaign_id = :campaign_id
```

**Provides**:
- Current node the lead is at (with node type and configuration)
- Enrollment state (active, paused, stopped, completed)
- When the lead will be processed next
- Flow position snapshot

---

### 2. **Message Jobs Table** - Email Send History
**Purpose**: Tracks all emails that have been sent (or attempted) to the lead

**Key Fields**:
- `node_id` (UUID) - References `nodes.id` - the email node that was executed
- `status` ('pending' | 'reserved' | 'sending' | 'sent' | 'failed' | 'cancelled')
- `scheduled_at` (TIMESTAMPTZ) - When email was scheduled to send
- `sent_at` (TIMESTAMPTZ) - When email was actually sent (NULL if not sent)
- `message_data` (JSONB) - Contains `subject`, `body`, template variables
- `enrollment_id`, `campaign_id`, `lead_id` - Relationships
- `mailbox_id` - Which mailbox sent the email
- `provider_message_id` - SMTP Message-ID (for reply detection)
- `error_message` - Error details if failed
- `created_at`, `updated_at` - Timestamps

**Query Pattern**:
```sql
SELECT 
  mj.*,
  n.flow_node_id,
  n.node_type,
  n.node_data->>'label' as node_label,
  mb.email_address as mailbox_email
FROM message_jobs mj
LEFT JOIN nodes n ON mj.node_id = n.id
LEFT JOIN mailboxes mb ON mj.mailbox_id = mb.id
WHERE mj.lead_id = :lead_id
  AND mj.campaign_id = :campaign_id
ORDER BY mj.created_at ASC
```

**Provides**:
- All emails sent to the lead (with subject, scheduled time, sent time)
- Which email node each message corresponds to
- Email status (sent, failed, pending)
- Which mailbox was used
- Email content metadata (subject, body from message_data)

---

### 3. **Events Table** - Engagement & Activity Events
**Purpose**: Tracks all events related to the lead (sent, opened, clicked, replied, etc.)

**Key Fields**:
- `event_type` ('sent' | 'delivered' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed')
- `event_data` (JSONB) - Metadata, timestamps, provider data
- `message_job_id` (UUID) - Links to the message_job that triggered this event
- `enrollment_id`, `campaign_id`, `lead_id` - Relationships
- `created_at` - Event timestamp

**Query Pattern**:
```sql
SELECT 
  e.*,
  mj.node_id,
  n.flow_node_id,
  n.node_data->>'label' as node_label
FROM events e
LEFT JOIN message_jobs mj ON e.message_job_id = mj.id
LEFT JOIN nodes n ON mj.node_id = n.id
WHERE e.lead_id = :lead_id
  AND e.campaign_id = :campaign_id
ORDER BY e.created_at ASC
```

**Provides**:
- Email sent events
- Email opened events
- Link clicked events
- Reply events
- Bounce events
- Unsubscribe events
- All linked to the specific message_job (and thus the email node)

---

### 4. **Nodes Table** - Node Information
**Purpose**: Provides node metadata (label, type, configuration)

**Key Fields**:
- `flow_node_id` (TEXT) - React Flow node ID (e.g., "email-1", "waitTime-1")
- `node_type` ('leadSource' | 'email' | 'waitTime' | 'aiCategorizer' | 'dataSender')
- `node_data` (JSONB) - Node configuration (includes `label`, subject, body, etc.)
- `campaign_id` - Which campaign this node belongs to

**Provides**:
- Node labels/names (e.g., "Email 1", "Wait 2 Min")
- Node type for filtering/grouping
- Node configuration (subject for email nodes, duration for wait nodes)

---

### 5. **Email Threads/Messages** - Reply Tracking (Optional)
**Purpose**: Tracks email conversations and replies

**Key Tables**:
- `email_threads` - Conversation threads
- `email_messages` - Individual messages (sent/received)

**Key Fields**:
- `message_job_id` - Links to original sent message
- `direction` ('sent' | 'received')
- `subject`, `body_text`, `body_html`
- `received_at` - Message timestamp
- `has_reply` - Whether thread has replies

**Provides**:
- Full email conversation history
- Reply messages from leads
- Thread context

---

## Combined Activity Log Query

To create a comprehensive activity log, we can combine multiple sources:

```sql
-- Option 1: Combine message_jobs and events chronologically
WITH activity_items AS (
  -- Message job creation (when email was scheduled)
  SELECT 
    mj.created_at as timestamp,
    'email_scheduled' as activity_type,
    n.node_data->>'label' as node_label,
    n.flow_node_id,
    mj.message_data->>'subject' as subject,
    mj.status,
    NULL as event_type,
    NULL as event_data
  FROM message_jobs mj
  JOIN nodes n ON mj.node_id = n.id
  WHERE mj.lead_id = :lead_id
    AND mj.campaign_id = :campaign_id
  
  UNION ALL
  
  -- Message job sent
  SELECT 
    mj.sent_at as timestamp,
    'email_sent' as activity_type,
    n.node_data->>'label' as node_label,
    n.flow_node_id,
    mj.message_data->>'subject' as subject,
    mj.status,
    NULL as event_type,
    NULL as event_data
  FROM message_jobs mj
  JOIN nodes n ON mj.node_id = n.id
  WHERE mj.lead_id = :lead_id
    AND mj.campaign_id = :campaign_id
    AND mj.sent_at IS NOT NULL
  
  UNION ALL
  
  -- Engagement events
  SELECT 
    e.created_at as timestamp,
    'engagement' as activity_type,
    n.node_data->>'label' as node_label,
    n.flow_node_id,
    mj.message_data->>'subject' as subject,
    NULL as status,
    e.event_type,
    e.event_data
  FROM events e
  JOIN message_jobs mj ON e.message_job_id = mj.id
  JOIN nodes n ON mj.node_id = n.id
  WHERE e.lead_id = :lead_id
    AND e.campaign_id = :campaign_id
)
SELECT *
FROM activity_items
ORDER BY timestamp ASC
```

---

## Recommended Activity Log Structure

For displaying activity per lead, we could show:

### Timeline Items:

1. **Enrollment Started**
   - Timestamp: `enrollments.created_at`
   - Type: "enrollment_started"
   - Node: Entry point (leadSource node)

2. **Email Scheduled**
   - Timestamp: `message_jobs.created_at`
   - Type: "email_scheduled"
   - Node: Email node (from `nodes.flow_node_id`, `nodes.node_data->>'label'`)
   - Details: Subject (from `message_data->>'subject'`)
   - Status: "pending"

3. **Email Sent**
   - Timestamp: `message_jobs.sent_at`
   - Type: "email_sent"
   - Node: Email node
   - Details: Subject, mailbox used
   - Status: "sent"

4. **Email Opened**
   - Timestamp: `events.created_at` (where `event_type = 'opened'`)
   - Type: "email_opened"
   - Node: Email node (via `message_job_id`)
   - Details: Email subject

5. **Link Clicked**
   - Timestamp: `events.created_at` (where `event_type = 'clicked'`)
   - Type: "link_clicked"
   - Node: Email node
   - Details: Clicked URL (from `event_data`)

6. **Replied**
   - Timestamp: `events.created_at` (where `event_type = 'replied'`)
   - Type: "replied"
   - Node: Email node
   - Details: Reply message (from `email_messages`)

7. **Node Progress**
   - Timestamp: `enrollments.updated_at`
   - Type: "node_progress"
   - Node: Current node (from `enrollments.current_node_id`)
   - Details: State change (active → completed, etc.)

8. **Wait Node**
   - Timestamp: `enrollments.next_run_at` (when wait completes)
   - Type: "wait_completed"
   - Node: Wait node
   - Details: Duration waited

---

## Implementation Considerations

### Data Queries Needed:
1. **Get enrollment for lead** - to show current position
2. **Get all message_jobs for lead** - to show email history
3. **Get all events for lead** - to show engagement
4. **Join with nodes table** - to get node labels/types
5. **Combine and sort chronologically** - for timeline display

### Performance:
- Indexes already exist on `lead_id` for all relevant tables
- Can query message_jobs and events separately and combine in application
- Or use a UNION query for combined timeline

### UI Considerations:
- Show chronological timeline (newest first or oldest first)
- Group by date
- Show node type icons (email, wait, etc.)
- Show email subjects
- Show engagement indicators (opened, clicked, replied)
- Highlight current node position
- Show email status (sent, failed, pending)

---

## Summary

We have comprehensive data to build an activity log showing:
- ✅ Which emails have been sent (message_jobs table)
- ✅ What node the lead is currently at (enrollments.current_node_id)
- ✅ Email engagement (events table - opened, clicked, replied)
- ✅ Node progression timeline (enrollments + message_jobs)
- ✅ Email content (message_data JSONB with subject, body)
- ✅ Node details (nodes table with labels and types)

The data is well-structured with proper indexes for efficient querying by `lead_id` and `campaign_id`.


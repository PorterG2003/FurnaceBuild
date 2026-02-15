# Inbox Search and Filters — Implementation

**Parent**: [MASTER_INBOX_UI_PLAN.md](./MASTER_INBOX_UI_PLAN.md) Step 5  
**Purpose**: Document search and filter implementation for the master inbox thread list.

---

## Backend

### `getThreadsByAccount` options

Extended in [lib/supabase/services/inbox.ts](../../../lib/supabase/services/inbox.ts):

- `mailboxId` — filter by mailbox
- `campaignId` — filter by campaign
- `unreadOnly` — threads with at least one unread received message (subquery)
- `dateFrom` / `dateTo` — filter on `last_message_at`
- `searchQuery` — `ilike` on `subject` (MVP; participants search would need RPC)
- `limit` / `offset` — pagination
- `includeUnreadCount` — return `unread_count` per thread (extra query)

### Mark as read

- `markThreadMessagesRead(threadId)` — sets `read_at` on received messages in the thread

---

## UI

- Filter chips: Unread, Last 7 days, Last 30 days, Mailbox, Campaign, Clear filters
- Search bar: debounced 400ms, server-side subject search
- Load more: pagination with THREAD_PAGE_SIZE (50)

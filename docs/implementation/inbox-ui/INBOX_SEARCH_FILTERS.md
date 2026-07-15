# Inbox Search and Filters — Implementation

**Parent**: [MASTER_INBOX_UI_PLAN.md](./MASTER_INBOX_UI_PLAN.md) Step 5  
**Purpose**: Document search and filter implementation for the master inbox thread list.

---

## Backend

### `list_account_inbox_threads` RPC

Migration: `supabase/migrations/20260715180000_inbox_thread_search.sql`

- Adds `email_threads.search_vector` (trigger-maintained) and `email_messages.search_vector` (trigger-maintained from subject, addresses, `body_text`)
- GIN indexes on both vectors
- Query helper `inbox_search_to_tsquery` builds a `simple`-config prefix `tsquery` (tokens AND’d with `:*`)
- Unified list RPC used by both app and Client API

**Thread vector weights**

| Weight | Fields |
|--------|--------|
| A | subject; lead `name` / `first_name` / `last_name` |
| B | lead email, `participants`, lead `company_name` |
| C | campaign name, assigned thread tag names |

**Message vector weights**

| Weight | Fields |
|--------|--------|
| A | message subject |
| B | from/to/cc emails and names |
| D | `body_text` (HTML not indexed) |

### Callers

- App: [`lib/supabase/services/inbox/threads.ts`](../../../lib/supabase/services/inbox/threads.ts) `getThreadsByAccount` → RPC (returns `{ threads, totalCount }`)
- Client API: [`lib/client-api/inbox/threads.ts`](../../../lib/client-api/inbox/threads.ts) `listAccountThreads` → same RPC; `GET /v1/threads?q=`

### Filter options (RPC params)

- `p_mailbox_id`, `p_campaign_ids` (TS resolves campaign tags → ids), `p_unread_only`, `p_date_from` / `p_date_to`
- `p_category` (`__no_category__` or `no_category` → uncategorized). When omitted, all categories are included (null-safe; does not collapse to “uncategorized only”).
- `p_conversation_status`, `p_has_reply_only`, `p_limit` / `p_offset`
- `p_search` — min 2 chars after trim ([`normalizeInboxSearchQuery`](../../../lib/inbox/normalizeInboxSearchQuery.ts))

### Mark as read

- `markThreadMessagesRead(threadId)` — sets `read_at` on received messages in the thread

---

## UI

- Filter chips via `InboxFilterDropdown` (Unread, date, mailbox, campaign, category, tags)
- Search bar: debounced 400ms; placeholder “Search…”; clear (X) control
- Empty states distinguish “no conversations”, search miss, and filter miss
- When searching, shows total conversation count from RPC; load more uses `offset + len < totalCount`
- Page size: `THREAD_PAGE_SIZE` (50)

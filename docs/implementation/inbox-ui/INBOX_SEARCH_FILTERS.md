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
- `p_category` (`text[]`). Empty/null means all categories. Named values match `t.category = ANY (...)`. `__no_category__` or `no_category` also include uncategorized (`t.category IS NULL`). Mixed selections are OR’d. Client API still accepts a single `?category=` and wraps it as a one-element array.
- `p_conversation_status`, `p_has_reply_only`, `p_limit` / `p_offset`
- `p_search` — min 2 chars after trim ([`normalizeInboxSearchQuery`](../../../lib/inbox/normalizeInboxSearchQuery.ts))
- `p_sort` — `newest` (default), `open_first`, `oldest`, `unread_first`. When `p_search` is set, search rank stays the primary `ORDER BY` key and sort applies after. Unknown values coerce to `newest`. Added in `supabase/migrations/20260716160000_inbox_thread_list_sort.sql`.

### Mark as read

- `markThreadMessagesRead(threadId)` — sets `read_at` on received messages in the thread

---

## UI

- Filter popup via `InboxFilterDropdown` (Unread, Sort, date, conversation status, mailbox, campaign, category, thread tags, campaign tags)
- Sort control (does not affect funnel badge): Newest / Open first / Oldest / Unread first; Clear all resets to Newest
- Search bar: debounced 400ms; placeholder “Search…”; clear (X) control
- Empty states distinguish “no conversations”, search miss, and filter miss
- When searching, shows total conversation count from RPC; load more uses `offset + len < totalCount`
- Page size: `THREAD_PAGE_SIZE` (50)
- Client API: `GET /v1/threads?sort=` accepts the same sort values

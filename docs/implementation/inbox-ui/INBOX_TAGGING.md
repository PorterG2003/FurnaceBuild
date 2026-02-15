# Inbox Thread Tagging — Implementation

**Parent**: [MASTER_INBOX_UI_PLAN.md](./MASTER_INBOX_UI_PLAN.md) Step 7  
**Purpose**: Document thread tagging implementation.

---

## Schema

- `thread_tags`: account-level tag definitions (id, account_id, name, color)
- `thread_tag_assignments`: many-to-many (thread_id, tag_id)

See [supabase/migrations/20260214100000_create_thread_tags.sql](../../../supabase/migrations/20260214100000_create_thread_tags.sql).

---

## Service

**File**: [lib/supabase/services/thread-tags.ts](../../../lib/supabase/services/thread-tags.ts)

- `getThreadTags(accountId)` — list tags for account
- `createThreadTag(accountId, { name, color })`
- `addTagToThread(threadId, tagId)`
- `removeTagFromThread(threadId, tagId)`
- `getTagsForThread(threadId)` — tags for one thread
- `getTagsForThreads(threadIds)` — batch fetch for display

---

## Integration

- `getThreadsByAccount` accepts `tagIds?: string[]` to filter threads by tag (OR: thread has any of the tags)
- Thread list shows tag pills on each thread row
- Message panel header: add/remove tags, create new tag
- Filter chip: "Tag" opens modal to select tags for filtering

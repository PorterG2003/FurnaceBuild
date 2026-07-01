# Inbox Thread Categorization — Implementation

**Parent**: [MASTER_INBOX_UI_PLAN.md](./MASTER_INBOX_UI_PLAN.md) Step 8  
**Purpose**: Document thread categorization implementation.

---

## Schema

`email_threads` columns:

- `category` TEXT — e.g. "Lead replied", "Meeting set", "Not interested"
- `category_source` — 'user' | 'system' | 'ai'
- `handling_metadata.suggestion_version` — version of the smart-handling logic
  the user saw when the thread was classified

Version-scoped feedback analysis lives in
`docs/implementation/inbox-ui/SMART_HANDLING_FEEDBACK.md`.

See [supabase/migrations/20260214100001_add_category_to_email_threads.sql](../../../supabase/migrations/20260214100001_add_category_to_email_threads.sql).

---

## Service

- `updateThreadCategory(threadId, category)` — sets category and category_source='user'
- Category changes emit a `reply.categorized` webhook via DB trigger on `email_threads.category` (see [CLIENT_API_WEBHOOKS.md](../../../infrastructure/CLIENT_API_WEBHOOKS.md))
- `getThreadsByAccount` accepts `category` filter

---

## UI

- Category badge on thread row
- Filter chip: "Category" opens modal with preset options
- Message panel header: "Set category" — current category + options to add/clear

---

## Preset categories

- Interested
- Not Interested

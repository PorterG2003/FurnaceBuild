# Inbox Thread Categorization — Implementation

**Parent**: [MASTER_INBOX_UI_PLAN.md](./MASTER_INBOX_UI_PLAN.md) Step 8  
**Purpose**: Document thread categorization implementation.

---

## Schema

`email_threads` columns:

- `category` TEXT — e.g. "Lead replied", "Meeting set", "Not interested"
- `category_source` — 'user' | 'system' | 'ai'

See [supabase/migrations/20260214100001_add_category_to_email_threads.sql](../../../supabase/migrations/20260214100001_add_category_to_email_threads.sql).

---

## Service

- `updateThreadCategory(threadId, category)` — sets category and category_source='user'
- `getThreadsByAccount` accepts `category` filter

---

## UI

- Category badge on thread row
- Filter chip: "Category" opens modal with preset options
- Message panel header: "Set category" — current category + options to add/clear

---

## Preset categories

- Lead replied
- Meeting set
- Not interested
- Follow up

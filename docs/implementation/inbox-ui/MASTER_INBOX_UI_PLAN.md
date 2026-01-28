# Master Inbox UI — Step-by-Step Implementation Plan

**Last updated**: January 28, 2026  
**Current progress**: Step 1 complete (read-only inbox connected to backend)

---

## Overview

The master inbox shows campaign reply threads and messages. This plan is ordered so each step builds on the previous one. Expand a step into a separate doc when you implement it (e.g. `INBOX_REPLY.md`, `INBOX_ATTACHMENTS.md`).

| Step | Scope | Status |
|------|--------|--------|
| 1 | Thread Panel + Message Panel (read-only, real data) | ✅ Done |
| 2 | Reply support | Todo |
| 3 | Attachments (receive, then send) | Todo |
| 4 | Forward support | Todo |
| 5 | Search and filtering | Todo |
| 6 | Block list | Todo |
| 7 | Thread tagging | Todo |
| 8 | Thread categorization | Todo |

---

## Step 1: Thread Panel + Message Panel (read-only) — ✅ Done

**Goal**: Replace mock data with real backend data; two-panel layout with loading, empty, and error states.

### Accomplished

- **Backend**
  - Added Supabase types for `email_threads` and `email_messages` in `lib/supabase/types/database.ts`.
  - Exported `EmailThread`, `EmailMessage` (and Insert/Update) from `lib/supabase/types/index.ts`.
  - Added `lib/supabase/services/inbox.ts`:
    - `getThreadsByAccount(accountId, options?)` — list threads by account, `last_message_at` desc; optional `hasReplyOnly`, `limit`.
    - `getThreadById(threadId)` — fetch one thread.
    - `getMessagesByThread(threadId)` — list messages by thread, `received_at` asc.
  - Services exported from `lib/supabase/services/index.ts`.
- **UI** (`app/(main)/inbox.tsx`)
  - Account resolution: user → `getUserByExternalId` → `getAccountMembershipsForUser` → primary account.
  - Thread Panel: loads via `getThreadsByAccount(accountId, { hasReplyOnly: true })`. Shows subject, participants, relative time, message count. Selection drives Message Panel.
  - Message Panel: loads via `getMessagesByThread(selectedThreadId)`. Shows sender (name or email), “Sent” badge for sent messages, formatted date, body (plain text or stripped HTML).
  - Loading: `LoadingState` for threads (initial) and messages (on thread select).
  - Empty: `EmptyState` when no threads (“No conversations yet”); “Select a conversation” when no selection.
  - Error: `Alert` with Retry for thread load and message load.
  - Pull-to-refresh on thread list.
  - Auto-select first thread when list loads; clear/reset selection when list is empty or selected thread no longer in list.

### Optional follow-ups (Step 1 polish)

- Unread count per thread (e.g. count received messages with `read_at` null) and unread badge in Thread Panel.
- Mark as read: when user views a thread, call API to set `read_at` on received messages (and optionally expose in inbox service).
- Last message preview snippet in thread row (would require backend change or join to get last message body).
- Responsive layout: collapse thread list on small screens / show message panel full width.

---

## Step 2: Reply support — Todo

**Goal**: Compose and send a reply in the same thread with correct In-Reply-To / References.

**Deep dive**: **[INBOX_REPLY.md](./INBOX_REPLY.md)** — Context, caveats, and decisions. **Chosen**: Option B — send-worker, same `message_jobs` table with **message type** (`'campaign'` | `'inbox_reply'` | `'inbox_forward'`); manual jobs claimed first.

- **Backend**
  - **Send path**: Reply (and forward) jobs are **message_jobs** with `message_type = 'inbox_reply'`/`'inbox_forward'`; send-worker claims **manual-type jobs first**, then campaign jobs.
  - Schema: add `message_type` to `message_jobs`; `interval_id = NULL`, `node_id` nullable for reply/forward; `message_data` holds thread_id, in_reply_to_message_id, subject, body, to, cc, headers.
  - Worker: for reply jobs, skip template merge, send via SMTP (same throttle), insert `email_messages`, update `email_threads`; skip enrollment/interval/event.
  - Create `email_messages` row (direction = sent) with To + Cc; set `message_id`, `in_reply_to`, `message_references`; link `message_job_id` to the reply job.
  - Update `email_threads` (last_message_at, message_count, participants).
- **UI**
  - Reply action opens composer (inline or modal) with **To + Cc** support.
  - Prefill to/from/cc (e.g. “Reply to all” from thread), subject (“Re: …”), focus body.
  - Send calls API (or enqueues job); on success refresh thread/messages (or optimistically add sent message).

---

## Step 3: Attachments — Todo

**Goal**: View and download attachments on received messages; attach files when sending (reply/forward).

- **Receiving**
  - Backend: API that, given `email_message_id` (and part/imap_uid), fetches attachment binary using mailbox IMAP (inbox-checker or dedicated attachment-fetch service). Return signed URL or stream.
  - UI: Show attachment list per message (from `attachments` JSONB); “Download” calls API and opens/saves file.
- **Sending**
  - Backend: Accept file upload (e.g. Supabase Storage or S3) or base64 in API; send-worker attaches to outgoing email via SMTP. Optionally store attachment metadata on sent `email_messages` row.
  - UI: Composer file picker; show chosen files; send with reply/forward.
- **Expand**: Create `INBOX_ATTACHMENTS.md` when implementing.

---

## Step 4: Forward support — Todo

**Goal**: Forward a message (or thread) to new recipients.

- **Backend**: Reuse same send path as reply. Decide: forward as new thread (send only, no thread link) vs same-thread; keep simple at first (send only).
- **UI**: Forward action; composer with subject “Fwd: …”, body with quoted original (and optional attachment list). Recipient field; send.
- **Expand**: Create `INBOX_FORWARD.md` when implementing.

---

## Step 5: Search and filtering — Todo

**Goal**: Search thread subject/participants/body; filter by mailbox, campaign, date range, read/unread.

- **Backend**: Full-text search on `email_threads` (and optionally `email_messages`) or external search later. Add filters to thread list API: `mailbox_id`, `campaign_id`, read/unread, date range. Pagination when filtering.
- **UI**: Search bar (debounced), filter chips/dropdowns. Thread list updates from list API with params. Optional: URL/state for shareable filters.
- **Expand**: Create `INBOX_SEARCH_FILTERS.md` when implementing.

---

## Step 6: Block list — Todo

**Goal**: Block senders/domains; hide or flag threads from blocked addresses; optionally affect ingestion/sending.

- **Backend**: New table (e.g. `block_list`: account_id, email_or_domain, type email|domain). RLS by account. Thread list API filters or marks threads matching block list. Optionally inbox-checker/send path checks block list.
- **UI**: “Block sender/domain” from thread or message; settings list of blocked entries and “Unblock”.
- **Expand**: Create `INBOX_BLOCK_LIST.md` when implementing.

---

## Step 7: Thread tagging — Todo

**Goal**: User-defined labels on threads (e.g. “Follow up”, “Urgent”); filter by tag.

- **Backend**: New table(s): e.g. `thread_tags` (account_id, name, color?) and `thread_tag_assignments` (thread_id, tag_id), or JSONB `tags` on `email_threads`. List/filter APIs include tags.
- **UI**: Add/remove tags on thread (dropdown/autocomplete); show tags on thread row and message header; filter by tag in Thread Panel.
- **Expand**: Create `INBOX_TAGGING.md` when implementing.

---

## Step 8: Thread categorization — Todo

**Goal**: System- or user-driven categories (e.g. “Lead replied”, “Meeting set”); optional sync with AI Categorizer node.

- **Backend**: Add `category`/`labels` to `email_threads` or separate `thread_categories` table. Inbox-checker or job sets category when processing replies; user can override. List/filter APIs include category.
- **UI**: Category badge on thread row; filter by category; if AI-driven, “Suggested: X” and confirm/override.
- **Expand**: Create `INBOX_CATEGORIZATION.md` when implementing.

---

## Conventions

- **Backend**: Supabase (Postgres, RLS, Edge Functions if needed), workers, or small services.
- **UI**: React Native / Expo in `app/(main)/inbox.tsx` and any components or screens you split out.
- **Data model**: `email_threads` and `email_messages` — see `supabase/migrations/20251229205236_create_email_threads_and_messages.sql`.

# Master Inbox UI — Step-by-Step Implementation Plan

**Last updated**: February 11, 2026  
**Current progress**: Steps 1–6 complete; Step 5 partial (client-side search only)

---

## Overview

The master inbox shows campaign reply threads and messages. This plan is ordered so each step builds on the previous one. Expand a step into a separate doc when you implement it (e.g. `INBOX_REPLY.md`, `INBOX_ATTACHMENTS.md`).

| Step | Scope | Status |
|------|--------|--------|
| 1 | Thread Panel + Message Panel (read-only, real data) | ✅ Done |
| 2 | Reply support | ✅ Done |
| 3 | Attachments (receive, then send) | ✅ Done |
| 4 | Forward support | ✅ Done |
| 5 | Search and filtering | Partial |
| 6 | Block list | Done |
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
  - Message Panel: loads via `getMessagesByThread(selectedThreadId)`. Shows sender (name or email), "Sent" badge for sent messages, formatted date, body (plain text or stripped HTML).
  - Loading: `LoadingState` for threads (initial) and messages (on thread select).
  - Empty: `EmptyState` when no threads ("No conversations yet"); "Select a conversation" when no selection.
  - Error: `Alert` with Retry for thread load and message load.
  - Pull-to-refresh on thread list.
  - Auto-select first thread when list loads; clear/reset selection when list is empty or selected thread no longer in list.

### Optional follow-ups (Step 1 polish)

- Unread count per thread (e.g. count received messages with `read_at` null) and unread badge in Thread Panel.
- Mark as read: when user views a thread, call API to set `read_at` on received messages (and optionally expose in inbox service).
- Last message preview snippet in thread row (would require backend change or join to get last message body).
- Responsive layout: collapse thread list on small screens / show message panel full width.

---

## Step 2: Reply support — ✅ Done

**Goal**: Compose and send a reply in the same thread with correct In-Reply-To / References.

**Deep dive**: **[INBOX_REPLY.md](./INBOX_REPLY.md)** — Context, caveats, and decisions. **Chosen**: Option B — send-worker, same `message_jobs` table with **message type** (`'campaign'` | `'inbox_reply'` | `'inbox_forward'`); manual jobs claimed first.

### Accomplished

- **Backend**
  - Schema: `message_type` on `message_jobs`; `create_inbox_reply_job` RPC; `claim_manual_message_jobs_ready` (manual jobs first).
  - Send-worker: processes `inbox_reply` jobs, sends via SMTP (same throttle), inserts `email_messages`, updates `email_threads`; skips enrollment/interval/event.
- **UI** (`app/(main)/inbox.tsx`)
  - Reply action opens right-side composer panel with To, Cc, Subject, Message.
  - Prefill: To (from replied-to message), Cc (participants excluding To and self), subject (Re: …).
  - Send creates reply job via `createReplyJob`; optimistic "Sending…" bubble with pulse; polling until sent; retry on failure.


---

## Step 3: Attachments — ✅ Done

**Goal**: View and download attachments on received messages; attach files when sending (reply/forward).

**Deep dive**: [INBOX_ATTACHMENTS.md](./INBOX_ATTACHMENTS.md)

### Accomplished

- **Receiving**
  - Backend: `amplify/functions/fetchEmailAttachment` Lambda with Function URL; fetches attachment via IMAP given `email_message_id` and `part`; returns binary. JWT auth, RLS via account membership.
  - Inbox service: `fetchAttachment(emailMessageId, part)` in `lib/supabase/services/inbox.ts`.
  - UI: `MessageAttachments` component; attachment list from `message.attachments`; Download button; image preview for image types; graceful handling of missing `part`/`imapUid`.
- **Sending**
  - Backend: `create_inbox_reply_job` and `create_inbox_forward_job` accept `p_attachments` (base64 in `message_data`); send-worker merges with inline images, passes to nodemailer; limits: 10 files, 5 MB total, 2 MB per file.
  - UI: `ComposerAttachments` component; file picker (web + native); chosen files list with remove; limits enforced; attachments passed to reply/forward on send.

---

## Step 4: Forward support — ✅ Done

**Goal**: Forward a message (or thread) to new recipients.

### Accomplished

- **Backend**: Reuses same send path as reply (`message_type = 'inbox_forward'`); `create_inbox_forward_job` RPC; send-worker processes forward jobs; send only (no thread link).
- **UI** (`app/(main)/inbox.tsx`): Forward action opens composer with subject "Fwd: …", body with quoted original via `buildQuotedForwardThreadHtml`; To/Cc fields; attachments supported via `ComposerAttachments`; optimistic UI and polling.

---

## Step 5: Search and filtering — Partial

**Goal**: Search thread subject/participants/body; filter by mailbox, campaign, date range, read/unread.

### Done

- Client-side thread search: `threadSearchQuery` filters threads by subject and participants (case-insensitive); shows "X of Y" result count in search bar.

### Todo

- **Backend**: Full-text search on `email_threads` (and optionally `email_messages`) or external search later. Add filters to `getThreadsByAccount`: `mailbox_id`, `campaign_id`, read/unread, date range. Pagination when filtering.
- **UI**: Filter chips/dropdowns for mailbox/campaign/date/read. Thread list updates from list API with params. Optional: URL/state for shareable filters.
- **Expand**: Create `INBOX_SEARCH_FILTERS.md` when implementing.

---

## Step 6: Block list — Done

**Goal**: Block senders/domains to prevent campaign emails; show blocked status per email; allow manual replies with confirmation.

**Deep dive**: [INBOX_BLOCK_LIST.md](./INBOX_BLOCK_LIST.md)

### Accomplished

- **Backend**: `block_list` table (account_id, value, type email|domain). Block list service: getBlockList, addBlockEntry, removeBlockEntry, isEmailBlocked, isEmailBlockedByEntries. Send-worker checks block list before sending campaign jobs; cancels job if lead email is blocked.
- **UI**: Per-email blocked badge in MessagePanelHeader; Block button opens BlockSenderModal with participant list (Block email | Block domain). Reply/forward checks all recipients (To, Cc); shows confirmation if any blocked. Account page: Inbox / Block list section with Unblock.

---

## Step 7: Thread tagging — Todo

**Goal**: User-defined labels on threads (e.g. "Follow up", "Urgent"); filter by tag.

- **Backend**: New table(s): e.g. `thread_tags` (account_id, name, color?) and `thread_tag_assignments` (thread_id, tag_id), or JSONB `tags` on `email_threads`. List/filter APIs include tags.
- **UI**: Add/remove tags on thread (dropdown/autocomplete); show tags on thread row and message header; filter by tag in Thread Panel.
- **Expand**: Create `INBOX_TAGGING.md` when implementing.

---

## Step 8: Thread categorization — Todo

**Goal**: System- or user-driven categories (e.g. "Lead replied", "Meeting set"); optional sync with AI Categorizer node.

- **Backend**: Add `category`/`labels` to `email_threads` or separate `thread_categories` table. Inbox-checker or job sets category when processing replies; user can override. List/filter APIs include category.
- **UI**: Category badge on thread row; filter by category; if AI-driven, "Suggested: X" and confirm/override.
- **Expand**: Create `INBOX_CATEGORIZATION.md` when implementing.

---

## Conventions

- **Backend**: Supabase (Postgres, RLS, Edge Functions if needed), workers, or small services.
- **UI**: React Native / Expo in `app/(main)/inbox.tsx` and any components or screens you split out.
- **Data model**: `email_threads` and `email_messages` — see `supabase/migrations/20251229205236_create_email_threads_and_messages.sql`.

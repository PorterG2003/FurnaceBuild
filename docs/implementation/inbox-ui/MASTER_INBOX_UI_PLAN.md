# Master Inbox UI — Step-by-Step Implementation Plan

**Last updated**: February 15, 2026  
**Current progress**: Steps 1–8 complete  
**Status**: Plan complete as of Feb 2026. Optional polish and future steps may be added below.

---

## Overview

The master inbox shows campaign reply threads and messages. This plan is ordered so each step builds on the previous one. Expand a step into a separate doc when you implement it (e.g. `INBOX_REPLY.md`, `INBOX_ATTACHMENTS.md`).

| Step | Scope | Status |
|------|--------|--------|
| 1 | Thread Panel + Message Panel (read-only, real data) | ✅ Done |
| 2 | Reply support | ✅ Done |
| 3 | Attachments (receive, then send) | ✅ Done |
| 4 | Forward support | ✅ Done |
| 5 | Search and filtering | ✅ Done |
| 6 | Block list | ✅ Done |
| 7 | Thread tagging | ✅ Done |
| 8 | Thread categorization | ✅ Done |

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
- **UI** (`app/(main)/inbox.tsx`): Forward action opens composer with subject "Fwd: …", body with quoted original via `buildForwardedConversationHtml` (Gmail-style blocks for the full conversation up to the clicked message, so forwarding a later bubble includes the earlier chain without pulling in newer replies); To/Cc fields; attachments supported via `ComposerAttachments`; optimistic UI and polling.

---

## Step 5: Search and filtering — ✅ Done

**Goal**: Search thread subject/participants/body; filter by mailbox, campaign, date range, read/unread.

**Deep dive**: [INBOX_SEARCH_FILTERS.md](./INBOX_SEARCH_FILTERS.md)

### Accomplished

- **Backend** (`lib/supabase/services/inbox.ts`): `getThreadsByAccount` options: `mailboxId`, `campaignId`, `unreadOnly` (subquery for threads with unread received messages), `dateFrom`/`dateTo`, `searchQuery` (ilike on subject), `tagIds`, `category` (including `NO_CATEGORY_FILTER` for no category), `limit`/`offset` (pagination), `includeUnreadCount`. `markThreadMessagesRead(threadId)` for mark-as-read.
- **UI**: `InboxFilterDropdown` with Unread only toggle; Date (All / Last 7 days / Last 30 days); Mailbox, Campaign, Category, Tag (multi-select) with search; Clear all. Search bar with debounced server-side subject search. Thread list loads with filter params; pagination (e.g. load more). Client-side thread search also filters by subject/participants with "X of Y" result count.

---

## Step 6: Block list — Done

**Goal**: Block senders/domains to prevent campaign emails; show blocked status per email; allow manual replies with confirmation.

**Deep dive**: [INBOX_BLOCK_LIST.md](./INBOX_BLOCK_LIST.md)

### Accomplished

- **Backend**: `block_list` table (account_id, value, type email|domain). Block list service: getBlockList, addBlockEntry, removeBlockEntry, isEmailBlocked, isEmailBlockedByEntries. Send-worker checks block list before sending campaign jobs; cancels job if lead email is blocked.
- **UI**: Per-email blocked badge in MessagePanelHeader; Block button opens BlockSenderModal with participant list (Block email | Block domain). Reply/forward checks all recipients (To, Cc); shows confirmation if any blocked. Account page: Inbox / Block list section with Unblock.

---

## Step 7: Thread tagging — ✅ Done

**Goal**: User-defined labels on threads (e.g. "Follow up", "Urgent"); filter by tag.

**Deep dive**: [INBOX_TAGGING.md](./INBOX_TAGGING.md)

### Accomplished

- **Backend**: `thread_tags` (account_id, name, color) and `thread_tag_assignments` (thread_id, tag_id). Service `lib/supabase/services/thread-tags.ts`: getThreadTags, createThreadTag, updateThreadTag, deleteThreadTag, addTagToThread, removeTagFromThread, getTagsForThread, getTagsForThreads. `getThreadsByAccount` accepts `tagIds` to filter threads by tag (OR).
- **UI**: TagsPanelModal to add/remove tags on thread and create new tag; EditTagModal, CreateTagModal. Tags shown on thread row (ThreadItem) and in MessagePanelHeader. Filter dropdown includes Tag multi-select (SearchAndSelectMulti) with account tags.

---

## Step 8: Thread categorization — ✅ Done

**Goal**: System- or user-driven categories (e.g. "Lead replied", "Meeting set"); optional sync with AI Categorizer node.

**Deep dive**: [INBOX_CATEGORIZATION.md](./INBOX_CATEGORIZATION.md)

### Accomplished

- **Backend**: `email_threads.category` (TEXT) and `category_source` ('user' | 'system' | 'ai'). `getThreadsByAccount` accepts `category` filter (and `NO_CATEGORY_FILTER` for threads with no category). `updateThreadCategory(threadId, category)` sets category and category_source='user'.
- **UI**: Category badge on thread row; InboxFilterDropdown includes Category select (All, No category, plus preset categories e.g. Interested, Not Interested) with category colors. Message panel header supports setting/clearing category.

---

## Conventions

- **Backend**: Supabase (Postgres, RLS, Edge Functions if needed), workers, or small services.
- **UI**: React Native / Expo in `app/(main)/inbox.tsx` and any components or screens you split out.
- **Data model**: `email_threads` and `email_messages` — see `supabase/migrations/20251229205236_create_email_threads_and_messages.sql`.

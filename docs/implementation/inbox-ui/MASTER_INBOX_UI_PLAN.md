# Master Inbox UI — Implementation Plan (Draft)

**Date**: January 28, 2026  
**Status**: High-level draft — expand each section as you implement  
**Current state**: Inbox screen (`app/(main)/inbox.tsx`) uses mock data only; backend tables `email_threads` and `email_messages` exist and are populated by the inbox-checker worker.

---

## Current State

- **UI**: Two-panel layout (thread list left, message list right). Local types `EmailThread` / `EmailMessage` and hardcoded `mockThreads`. No backend calls.
- **Backend**: `email_threads` and `email_messages` (see `supabase/migrations/20251229205236_create_email_threads_and_messages.sql`). Threads have `account_id`, `campaign_id`, `lead_id`, `mailbox_id`, `subject`, `participants`, `last_message_at`, `message_count`, `has_reply`. Messages have `thread_id`, `direction` (sent/received), from/to, subject, body_text/body_html, `message_id`, `in_reply_to`, `received_at`, `read_at`, `attachments` (JSONB), `imap_uid`.
- **Gaps**: No Supabase TypeScript types for these tables, no `lib/supabase/services` for threads/messages, no API or UI for sending (reply/forward) or attachments.

---

## 1. Thread Panel

- **Scope**: Left column — list of conversations for the current account (and optionally mailbox/campaign filters).
- **Backend**: Add Supabase types for `email_threads` (and related). Add service(s) to list threads by `account_id` (and optional filters), ordered by `last_message_at`, with pagination/cursor.
- **UI**: Replace mock data with API: load threads, show subject, participants, last message preview, timestamp, unread indicator (e.g. from `read_at` on latest message). Selection drives Message Panel. Consider pull-to-refresh and infinite scroll.
- **Polish**: Loading/empty/error states; responsive layout (e.g. collapse thread list on small screens).

---

## 2. Message Panel

- **Scope**: Right column — header (subject, participants) + scrollable list of messages in the selected thread.
- **Backend**: Service to fetch messages by `thread_id`, ordered by `received_at`. Return fields needed for display (from/to, body, timestamp, direction, attachments metadata).
- **UI**: Replace mock messages with API. Render each message (sender, date, body text/HTML). Differentiate sent vs received (e.g. alignment or styling). Mark as read when viewed (update `read_at` via API if desired).
- **Polish**: Date grouping, “load more” if you add pagination for long threads.

---

## 3. Reply Support

- **Scope**: Compose and send a reply in the same thread (correct In-Reply-To / References).
- **Backend**: Either (a) API route that uses mailbox SMTP (with credentials from backend only), or (b) backend job that enqueues a “reply” message for the send-worker. Need to create an `email_messages` row (direction = sent) and optionally link to campaign/enrollment if you track that. Set `message_id`, `in_reply_to`, `message_references` from the message being replied to.
- **UI**: Reply button opens composer (inline or modal). Prefill to/from and subject (“Re: …”). Body focus. Send triggers API; on success refresh thread/messages and optionally optimistically add the sent message.
- **Considerations**: Which mailbox “from” address to use (e.g. thread’s `mailbox_id`); rate limits and error handling.

---

## 4. Forward Support

- **Scope**: Forward a message (or whole thread) to new recipients.
- **Backend**: Same sending path as reply (API or send-worker). Forwarded message may be a new thread or a new `email_messages` row depending on product choice (e.g. “forward as new thread” vs “forward and keep in same thread”). If new thread, may need a separate “forwarded” thread type or a new table — keep it simple at first (e.g. send only, no thread linking).
- **UI**: Forward button; composer with subject “Fwd: …”, body containing original message (and optionally attachment list). Recipient field; send.
- **Considerations**: Quoted body formatting; attachments (see below).

---

## 5. Attachment Sending / Receiving

- **Receiving**: Messages already have `attachments` JSONB (metadata: filename, contentType, size, part, imapUid). Add an API that, given `email_message_id` (and part/imap_uid), fetches binary from your backend; backend uses mailbox IMAP credentials to FETCH the part (inbox-checker or a small “attachment fetch” service). Return signed URL or stream. UI: show attachment list per message; “Download” calls API and opens/saves file.
- **Sending**: Composer allows adding files (pick from device). Upload to storage (e.g. Supabase Storage or S3) or pass base64 to backend; backend (or send-worker) attaches to outgoing email via SMTP. Store attachment metadata on the sent `email_messages` row if you want to show “sent attachments” in the UI.
- **Considerations**: Size limits, virus scanning (later), and not storing raw credentials in the client.

---

## 6. Block List Support

- **Scope**: Let users block senders (or domains); hide or flag threads from blocked addresses; optionally auto-reject future emails from them.
- **Backend**: New table (e.g. `block_list`: account_id, email_or_domain, type “email”|“domain”, created_at). RLS by account. Inbox list API filters out (or marks) threads whose participants match block list. Optionally inbox-checker or send path checks block list before creating thread or sending.
- **UI**: Settings or thread/message action: “Block sender/domain”. List of blocked entries and “Unblock”.
- **Considerations**: Domain vs exact-email; whether blocking affects only UI or also ingestion/sending.

---

## 7. Thread Search and Filtering

- **Scope**: Search thread subject/participants/body; filter by mailbox, campaign, date range, read/unread, etc.
- **Backend**: Search: use Postgres full-text search on `email_threads` + `email_messages` (e.g. `to_tsvector` on subject, participants, and optionally message bodies) or an external search engine later. Filters: add query params to thread list API (mailbox_id, campaign_id, has_reply, read/unread, from/to date).
- **UI**: Search bar (debounced) and filter chips/dropdowns. Thread list updates from same list API with params. URL or state for “current search/filters” so it’s shareable or back-navigable.
- **Considerations**: Indexes for full-text; pagination when filtering.

---

## 8. Thread Tagging

- **Scope**: User-defined labels/tags on threads (e.g. “Follow up”, “Urgent”).
- **Backend**: New table (e.g. `thread_tags`: id, account_id, name, color?) and `thread_tag_assignments` (thread_id, tag_id). Or a JSONB `tags` array on `email_threads`. List API returns tags; filter API filters by tag.
- **UI**: Add/remove tags from thread (dropdown or autocomplete). Show tags on thread row and in message header. Filter by tag in Thread Panel.
- **Considerations**: Per-account tag set vs global; ordering of tags.

---

## 9. Thread Categorization

- **Scope**: System- or user-driven categories (e.g. “Lead replied”, “Meeting set”, “Unsubscribed”). May overlap with campaign/AI logic (e.g. AI categorizer node).
- **Backend**: Either (a) add `category` (or `labels`) to `email_threads` and optionally back it with campaign/flow metadata, or (b) separate `thread_categories` table keyed by thread + category type. Inbox-checker or a separate job can set category when processing replies; user may override. List and filter APIs include category.
- **UI**: Show category badge on thread row; filter by category. If AI-driven, show “Suggested: X” and allow confirm/override.
- **Considerations**: Sync with builder “AI Categorizer” node if you want categories to drive flow branching.

---

## Suggested Order of Work

1. **Connect existing UI to backend**: Types + services for threads and messages; Thread Panel and Message Panel wired to real data (read-only).  
2. **Reply**: Backend send path + composer UI for reply.  
3. **Attachments**: Receive (download) first; then send (composer attachments).  
4. **Forward**: After reply is stable.  
5. **Search and filtering**: List API params + UI (search bar, filters).  
6. **Block list**: Table + API + UI.  
7. **Tagging**: Table(s) + API + UI.  
8. **Categorization**: Schema + optional integration with AI/flow; then UI.

---

## Doc Conventions

- **Backend** = Supabase (Postgres, RLS, Edge Functions if needed), workers, or small services.  
- **UI** = React Native / Expo in `app/(main)/inbox.tsx` and any new components or screens you split out.  
- Expand each section into its own doc or ADR when you implement (e.g. “MASTER_INBOX_REPLY.md”, “MASTER_INBOX_ATTACHMENTS.md”).

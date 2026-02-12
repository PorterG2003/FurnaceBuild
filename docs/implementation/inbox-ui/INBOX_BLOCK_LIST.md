# Inbox Block List — Implementation

**Parent**: [MASTER_INBOX_UI_PLAN.md](./MASTER_INBOX_UI_PLAN.md) Step 6  
**Purpose**: Document block list implementation — prevents campaign emails to blocked addresses/domains; manual inbox sends allowed with confirmation.

---

## Design decisions

- **Scope**: Block list prevents **campaign/automated emails** only. Manual inbox replies and forwards are always allowed (with a confirmation dialog when replying to a blocked address).
- **Thread visibility**: Show blocked status **per prospect email** (e.g. "Blocked" badge next to each blocked address). Do not hide threads. Allow replies and forwards. Caveat: "No automated emails will be sent to blocked addresses."
- **Ingestion**: No changes to IMAP/inbox-checker. Block list does not affect what gets stored.
- **Enforcement**: Send-worker checks block list at send time for campaign jobs; if blocked, cancel job (do not send).
- **Block target**: Both exact email and domain. User chooses which when adding.
- **Block action**: Message panel header only (next to prospect emails).
- **Block modal**: List of all participant emails on the thread; user selects which to block and chooses "Block this email" or "Block this domain" for each.
- **Settings**: Account page — "Inbox / Block list" section for viewing and unblocking.
- **Manual send to blocked**: Check all recipients (To, Cc, Bcc). If any is blocked, show confirmation before sending.

---

## Database schema

**Table: `block_list`**

```sql
CREATE TABLE block_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email', 'domain')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, value, type)
);
```

- **value**: Email (e.g. spam@example.com) or domain (e.g. spammer.com). Stored lowercase.
- **type**: `email` = exact match; `domain` = blocks *@value.

---

## Block list service

**File**: `lib/supabase/services/block-list.ts`

- `getBlockList(accountId)` — list all entries
- `addBlockEntry(accountId, { value, type })` — insert; enforces unique
- `removeBlockEntry(accountId, entryId)` — delete by id
- `isEmailBlocked(accountId, email)` — async check (fetches list)
- `isEmailBlockedByEntries(email, entries)` — sync check given entries (for client-side)

---

## Send-worker integration

**File**: `workers/send-worker/src/worker.ts`

After `loadJobData`, before throttle check, for campaign jobs only:
1. Get `account_id` from `campaigns` via `messageJob.campaign_id`
2. Call `isEmailBlocked(accountId, lead.email)`
3. If blocked: update `message_jobs` status to `cancelled`, `error_message = 'Lead blocked'`; return without sending

---

## UI components

- **MessagePanelHeader**: `blockedEmails`, `onBlock`, `showBlockButton` props. Per-email "Blocked" badge; Block button; caveat text.
- **BlockSenderModal**: List of participant emails with "Block email" / "Block domain" actions per row.
- **Account page**: "Inbox / Block list" section; list entries with type badge; Unblock button.

---

## Reply/forward confirmation

Before `createReplyJob` or `createForwardJob`: collect To + Cc, check each against block list. If any blocked, show confirmation: "This lead has been blocked. No automatic emails will be sent to them, but you can send messages to them manually without unblocking if you wish. Confirm to proceed." On confirm, proceed with send.

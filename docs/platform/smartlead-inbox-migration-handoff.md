# Smartlead → Furnace handoff (150 mailboxes + replies)

## Goal

Get **live reply detection** working for 150 InboxAlways mailboxes migrated from Smartlead.

---

## Two imports

| | Path | Does what |
|---|------|-----------|
| **150 mailboxes** | Senders → Upload CSV | SMTP/IMAP credentials only |
| **Campaigns / leads / history** | Smartlead migration wizard | Campaigns, enrollments, optional conversation backfill |

Both are required for a full cutover. CSV does not import threads.

---

## Reply headers — what we actually know

### Confirmed (code review, not tested on these mailboxes)

Furnace matches inbound replies via **`In-Reply-To` / `References`** → `message_jobs.provider_message_id` or `email_messages.message_id`. No subject-only matching. No "Untracked Replies" UI.

Outbound sends get a generated `Message-ID` stored as `provider_message_id` (`workers/send-worker/src/email.ts`). Inbox-checker reads headers in `thread-manager.ts` → `handleReply()`.

### Confirmed (runtime, this session)

- **150 InboxAlways mailboxes** imported to prod under **Foot Traffic Co** (`account_id: 40a23e97-8fa7-4668-bbd5-287f50fa2745`).
- All 150 on `clinicfoottrafficcocom.austin.inboxalways.com`.
- SMTP + IMAP credentials valid; CSV connection tests pass (~149–150/150).
- **Production inbox-checker IMAP fix deployed** — `openImapInbox()` works on InboxAlways hosts.

### Confirmed (IMAP header audit, 2026-06-09 — Foot Traffic Co)

Ran `npm run audit:inboxalways-headers` against all **150 Foot Traffic Co mailboxes**. Polled **5,154 recent messages** (last 40 per mailbox, 90 days).

| Classification | Count | % of reply-like |
|----------------|------:|----------------:|
| Has `In-Reply-To` (normal) | 3,434 | 98.96% |
| `References` only (no `In-Reply-To`) | 30 | 0.86% |
| Headerless but `Re:`/`Fwd:` subject | 6 | 0.17% |
| **Would miss `isReply()` gate** | **36** | **1.04%** |

- **0 IMAP connection failures** across all 150 mailboxes.
- **Normal replies are fine** — 99% carry `In-Reply-To`.
- **`References`-only replies are more common here than expected** (~0.9%). Subjects often don't say `Re:` (e.g. "Sprint Retrospective") but `References` points at the outbound message. These would be skipped by `isReply()` today even though `handleReply()` could match them.
- **Truly headerless `Re:` replies are rare** (~0.2%).
- Re-run:
  ```bash
  SELF_RECOVERY_TARGET_ENV=prod npm run audit:inboxalways-headers -- \
    --account-id 40a23e97-8fa7-4668-bbd5-287f50fa2745 \
    --mailbox-limit 150 --messages 40 --days 90
  ```

**Still not done:** one live Furnace send → reply → thread match (needs a test send from Furnace so `provider_message_id` exists).

### Known code gap (minor, now quantified)

`isReply()` only checks `In-Reply-To`; `handleReply()` also searches `References`. On Foot Traffic Co, **30 messages (0.86%)** have `References` only and would be skipped. Expanding `isReply()` to include `References` would recover those; the 6 headerless `Re:` subjects (~0.2%) still won't match without subject-based fallback.

---

## What blocks replies today

1. ~~**Deploy inbox-checker prod**~~ — done; polling works on InboxAlways hosts.

2. ~~**Import 150 mailboxes**~~ — done (Foot Traffic Co).

3. **Send from Furnace** (not Smartlead) so `provider_message_id` exists for matching.

4. **Smartlead wizard** if you need historical threads or replies to pre-cutover sends to link up.

5. **(Optional) Fix `isReply()`** to also check `References` — recovers ~0.9% of replies on this account.

---

## Cutover expectations

| Lead replies to… | Will Furnace match? |
|------------------|---------------------|
| Furnace send after cutover | Yes, if headers normal + inbox-checker polling |
| Smartlead send before cutover | Only if history imported and headers reference a known message ID |
| Email with no threading headers | No (by design; same as Smartlead) |
| Reply with `References` only | **No today** — skipped by `isReply()` gate (~0.9% of replies here) |

---

## Verify after deploy

- [x] Import 150 mailboxes to prod (Foot Traffic Co)
- [x] Header audit on Foot Traffic Co mailboxes — 99% have `In-Reply-To`; ~1% would miss `isReply()` gate
- [x] Inbox-checker IMAP connect works on all 150 mailboxes (0 connection failures)
- [ ] One Furnace send → one normal reply → appears in Furnace thread

---

## Key files

| | |
|---|---|
| CSV import | `components/senders/UploadMailboxesCSVModal.tsx` |
| IMAP fix | `lib/mailbox/imapInbox.ts` |
| Inbox polling | `workers/inbox-checker-worker/src/imap-client.ts` |
| Reply matching | `workers/inbox-checker-worker/src/thread-manager.ts` |
| Outbound Message-ID | `workers/send-worker/src/email.ts` |
| Smartlead import | `lib/smartlead/migration.ts` |
| Deploy | `infra/workers/package.json` |
| Header audit script | `scripts/audit-inboxalways-reply-headers.ts` (`npm run audit:inboxalways-headers`) |

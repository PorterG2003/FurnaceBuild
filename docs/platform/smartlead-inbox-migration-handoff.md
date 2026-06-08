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

- **150 InboxAlways mailboxes**: SMTP + IMAP credentials valid; CSV connection tests pass (~149–150/150).
- **Production inbox-checker IMAP fix deployed** — `openImapInbox()` works on InboxAlways hosts.
- **The 150 migration mailboxes are not imported to prod yet** — credentials exist in CSV only.

### Not confirmed (original Smartlead header concern)

We have **not** inspected inbound mail on the 150 migration mailboxes. An earlier audit accidentally scanned **existing customer mailboxes already in prod** (Scroll, Workflow Academy, 1956 US) — useful as a rough signal for InboxAlways hosts in general, but **not** validation of the migration account.

**To confirm on the right mailboxes:** run the header audit against the Smartlead CSV (no prod import required):

```bash
npm run audit:inboxalways-headers -- --csv /path/to/smartlead-mailboxes.csv --mailbox-limit 150 --messages 40 --days 90
```

Then, after import: one Furnace send → one normal reply → verify it lands in Furnace.

### Known code gap (minor)

`isReply()` only checks `In-Reply-To`; `handleReply()` also searches `References`. Replies with **References only** may be skipped. Not tested on the 150 migration mailboxes.

---

## What blocks replies today

1. ~~**Deploy inbox-checker prod**~~ — done; `openImapInbox()` fix is live.

2. **Import 150 mailboxes** via CSV (not done yet).

3. **Send from Furnace** (not Smartlead) so `provider_message_id` exists for matching.

4. **Smartlead wizard** if you need historical threads or replies to pre-cutover sends to link up.

---

## Cutover expectations

| Lead replies to… | Will Furnace match? |
|------------------|---------------------|
| Furnace send after cutover | Yes, if headers normal + inbox-checker polling |
| Smartlead send before cutover | Only if history imported and headers reference a known message ID |
| Email with no threading headers | No (by design; same as Smartlead) |

---

## Verify after deploy

- [ ] Header audit on the Smartlead CSV (not other prod accounts)
- [ ] Import 150 mailboxes to prod
- [ ] Inbox-checker logs: successful poll on migration mailboxes (no "Command failed")
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

# IMAP: UID vs sequence numbers, and the “Invalid messageset” fix

## Basics — how messages are identified in IMAP

In IMAP, each message in a mailbox can be referred to in two different ways:

### 1. **Sequence number** (message number)

- **What it is**: A 1‑based index into the **current** view of the mailbox: 1 = first message, 2 = second, … N = last.
- **Changes when**: Messages are added, deleted, or expunged. For example, if you have messages 1–10 and message 5 is deleted, what was “6” becomes “5”, etc.
- **Scope**: Only valid for the current mailbox session and current state of the mailbox.
- **Typical range**: 1 to N where N = number of messages in the mailbox.

### 2. **UID** (Unique Identifier)

- **What it is**: A positive integer assigned by the server that **does not change** for the lifetime of that message in that mailbox (as long as UIDVALIDITY is unchanged).
- **Stable across**: Deletes, appends, and other clients. UID 3523 is always the same message until it’s removed and the mailbox’s UIDVALIDITY hasn’t changed.
- **Typical range**: Can be large (e.g. 3523, 10000) and is **not** 1..N. A mailbox with 10 messages might have UIDs like 3490–3499.
- **Used for**: Syncing, “messages since last time”, and any logic that must refer to the same message across sessions.

So:

- **Sequence number** = “message #3 in the mailbox right now.”
- **UID** = “the message that has unique id 3523 in this mailbox.”

Commands that take a “message set” can be issued in two forms:

- **FETCH 3,5,7** → “fetch by **sequence numbers** 3, 5, 7”
- **UID FETCH 3523,3525,3527** → “fetch by **UIDs** 3523, 3525, 3527”

If you send **FETCH 3523** when 3523 is a UID (and the mailbox only has a few dozen messages), the server interprets 3523 as a **sequence number**. There is no 3523rd message, so you get **“Invalid messageset”**.

---

## What was going wrong in our worker

1. We run **SEARCH** with `{ since: lastSyncedAt }` and `{ uid: true }` → the server returns **UIDs** (e.g. `[3523]`).
2. We loop over those and call **fetchOne(3523, { source: true, uid: true, bodyStructure: true })**.
3. ImapFlow’s **fetchOne(seq, query, options)** uses:
   - **seq** = “which message(s)” (our 3523),
   - **query** = what to return (source, uid, bodyStructure),
   - **options** = how to interpret **seq**:
     - **options.uid === true** → send **UID FETCH 3523** (correct),
     - **options.uid** missing/false → send **FETCH 3523** (treat 3523 as sequence number).
4. We never passed the **third** argument **options**, so `options.uid` was undefined. ImapFlow therefore sent **FETCH 3523** (sequence), not **UID FETCH 3523**. The server then rejected 3523 as an invalid sequence number → **“Error in IMAP command FETCH: Invalid messageset”**.

The “3523” in the error is the UID we correctly got from SEARCH; the bug was using it in a FETCH that the library sent as **sequence-number** FETCH.

---

## Fix

When calling **fetchOne** with a value that is a **UID** (e.g. from SEARCH with `{ uid: true }`), pass **{ uid: true }** as the **third** argument so the library sends **UID FETCH**:

```ts
const message = await client.fetchOne(uid, {
  source: true,
  uid: true,
  bodyStructure: true,
}, { uid: true });  // ← use UID FETCH; uid in query is “include UID in response”
```

Here:

- The second argument is the **fetch query** (what to return); `uid: true` there means “include UID in the response.”
- The third argument is **options** for the FETCH command; `uid: true` there means “treat the first argument as a UID,” i.e. send **UID FETCH**.

After this change, the client sends **UID FETCH 3523 (...)** and the server accepts it.

---

## Call sites checked (UID/sequence safety)

| Location | Uses ImapFlow fetch/download? | Status |
|----------|-----------------------------|--------|
| `workers/inbox-checker-worker/src/imap-client.ts` | Yes: `search`, `fetchOne`, `download` | Fixed: `fetchOne(..., { uid: true })`, `download(uid, undefined, { uid: true })` |
| `amplify/functions/inboxChecker/handler.ts` | Historical only | Superseded by the ECS inbox checker worker; this repo no longer contains an active Amplify inbox checker function. |
| `amplify/functions/testMailboxConnection/handler.ts` | No: only `connect()` and `mailboxOpen('INBOX')` | No change needed |
| `lib/services/email.ts` | No: calls Lambda via client, no direct ImapFlow | No change needed |

When adding new ImapFlow code that fetches by message set, use **`{ uid: true }`** in the **options** argument for `fetchOne`, `fetch`, or `download` whenever the range/seq value comes from **SEARCH with `{ uid: true }`** (or any other source of UIDs).

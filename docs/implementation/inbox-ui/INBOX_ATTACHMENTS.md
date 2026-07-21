# Inbox Attachments — Implementation Plan

**Parent**: [MASTER_INBOX_UI_PLAN.md](./MASTER_INBOX_UI_PLAN.md) Step 3  
**Purpose**: Plan for viewing/downloading attachments on received messages and attaching files when sending (reply/forward).

---

## Current model (upload-first outbound)

| Direction | Bytes live where | Metadata on `email_messages.attachments` | Download |
|-----------|------------------|------------------------------------------|----------|
| **Received** | IMAP mailbox | `{ filename, contentType, size, part, imapUid }` | `fetchEmailAttachment` action `fetch` → IMAP stream |
| **Sent (outbound)** | Supabase Storage bucket `inbox-attachments` | `{ filename, contentType, size, storagePath }` | same Lambda → short-lived signed GET; client always returns `Blob` |

### Bucket & tracking

- Private bucket `inbox-attachments` (service_role only; no member Storage RLS).
- Object key: `{account_id}/{thread_id}/{upload_id}/{safeFilename}`.
- Table `inbox_attachment_uploads`: `pending` → `claimed` (job created) → `sent`.
- Table `inbox_attachment_gc_queue` + DELETE triggers enqueue Storage paths on message/thread wipe; send-worker idle loop drains GC.

### Composer / jobs / worker

1. Composer calls Lambda `prepare_upload` → signed PUT → holds `{ filename, contentType, size, storagePath }` (no base64).
2. Explicit remove → `delete_upload` (pending only).
3. `create_inbox_reply_job` / `create_inbox_forward_job` accept thin refs only; reject `content`; claim uploads.
4. Send-worker downloads from Storage for SMTP, persists same `storagePath` on `email_messages`, marks uploads `sent`. Legacy in-flight base64 still sends once.

### Client download API

```ts
fetchAttachment(url, token, emailMessageId, attachmentIndex): Promise<Blob>
```

UI does not branch on IMAP vs Storage.

### Backfill

`scripts/backfill-sent-attachment-storage.ts` promotes historical job base64 → Storage. **Do not run on production threads until the new-send path is verified on dev.**

---

## Overview (original phases)

| Phase | Scope | Status |
|-------|--------|--------|
| 3a | Receiving: view and download attachments | Done (IMAP) |
| 3b | Sending: attach files to reply/forward | Done (base64 v1 → Storage upload-first) |

---

## Phase 3a: Receiving Attachments

### Current state

- **Data model**: `email_messages.attachments` is a JSONB array of:
  ```ts
  { filename: string; contentType: string; size: number; part: string; imapUid: number }
  ```
- `part` = MIME part identifier (e.g. `"1"`, `"1.2"`) for IMAP `BODY.PEEK[part]`.
- `email_messages.imap_uid` = message UID for the mailbox.
- Inbox-checker stores this metadata when ingesting; raw attachment bytes are **not** stored — they stay on the IMAP server.
- To get an attachment: connect to the mailbox (IMAP credentials from `mailboxes`), `SELECT` the mailbox, `FETCH` the message by UID, get the MIME part.

### Backend: Fetch attachment API

**Goal**: Given `email_message_id` and attachment index (or `part`), return the attachment binary.

**Chosen**: **Amplify Lambda with Function URL**.

- Lambda invoked via **Function URL** (not API Gateway) — avoids the 29s integration timeout; Lambda can run up to 15 minutes for large attachments.
- Short-lived IMAP connection per request: connect → `SELECT` mailbox → `FETCH BODY.PEEK[part]` → disconnect.
- Fits existing Amplify backend; deploys with `amplify push`.

**Flow**:

1. Client calls the Lambda Function URL (e.g. `POST` or `GET` with query params) with `{ email_message_id, part }` (or `attachment_index`). Sends `Authorization: Bearer <supabase_jwt>`.
2. Lambda:
   - Verifies Supabase JWT; extracts user.
   - Loads `email_messages` row by id; validates user has account access (thread → account → membership).
   - Loads `mailboxes` for that message’s `mailbox_id`; gets IMAP credentials.
   - Connects to IMAP, selects mailbox, fetches `BODY.PEEK[part]` for the message’s `imap_uid`, disconnects.
   - Returns binary (base64-encoded body with `isBase64Encoded: true`, or binary if Function URL supports it) with `Content-Type` and `Content-Disposition: attachment; filename="..."`.
3. Client: `fetch` → create blob URL → trigger download (web) or save to device (native).

**Security**:

- RLS: `email_messages` and `mailboxes` must be scoped by account; user must be account member.
- Rate limit: consider per-user limits to avoid abuse.
- Mailbox credentials: stored in DB; Lambda reads them. Ensure they are not logged.

**Errors**:

- Message not found / access denied → 404.
- Mailbox disconnected / IMAP error → 502 with clear message.
- Part invalid → 400.

### UI: Attachment list and download

**Location**: `MessageBubble` component (or a child `MessageAttachments` component).

**Data**: `message.attachments` from `EmailMessage` — already typed as `Json`; cast to `Array<{ filename, contentType, size, part?, imapUid? }>`.

**Layout**:

- Below `MessageBody`, show an attachment list when `attachments?.length > 0`.
- Each item: icon (by content type), filename, size (e.g. `12 KB`), “Download” button.
- Styling: compact row, consistent with message bubble (dark theme, gray text).

**Download flow**:

- **Web**: `fetch(lambdaFunctionUrl, { body: JSON.stringify({ email_message_id, part }), headers: { Authorization: 'Bearer ' + supabaseToken } })` → `blob()` → `URL.createObjectURL(blob)` → `<a download={filename} href={url}>` click.
- **Native**: Same fetch; use `expo-file-system` or similar to write to cache and open/share, or open in external viewer.

**Edge cases**:

- Missing `part` or `imapUid` in older rows: show filename + size but disable Download with tooltip “Attachment unavailable”.
- Very long filenames: truncate with ellipsis; full filename in tooltip or on tap.

---

## Phase 3b: Sending Attachments

### Backend: Accept attachments in reply/forward

**Current**:

- `create_inbox_reply_job` and `create_inbox_forward_job` RPCs take `body_text`, `body_html`, etc. — no attachments.
- `message_data` in `message_jobs` has no `attachments` field.
- Send-worker’s `sendReplyEmail` already handles inline images (data URLs → CID) and passes `attachments` to nodemailer for those.

**Goal**: Allow explicit file attachments (PDFs, docs, etc.) in addition to inline images.

### Storage strategy

| Option | Pros | Cons |
|--------|------|------|
| **A. Base64 in message_data** | Simple; no extra storage | Large payloads; DB bloat; size limit needed |
| **B. Supabase Storage** | Scales; no DB bloat; signed URLs for worker | Extra upload step; cleanup of temp files |
| **C. S3 presigned upload** | Same as B if using AWS | Extra infra |

**Recommendation**: **Option B — Supabase Storage** for files over a threshold (e.g. 256 KB), **Option A** for small files (e.g. &lt; 256 KB) to avoid upload round-trip for tiny images/docs.

Simpler alternative: **Option A only** with a strict limit (e.g. 5 MB total per message, 2 MB per file). Easier to implement; reassess if users hit limits.

**Decided for v1**: **Option A — base64 in message_data** with limits:
- Max 5 MB total attachments per message.
- Max 2 MB per file.
- Max 10 files per message.

If we hit issues, migrate to Storage later.

### Schema / API changes

**RPC**: Extend `create_inbox_reply_job` and `create_inbox_forward_job`:

```sql
p_attachments JSONB DEFAULT NULL
-- Array of { filename: string, contentType: string, content: string } where content is base64
```

**message_data**: Add `attachments` array to the JSONB built for the worker:

```json
{
  "attachments": [
    { "filename": "doc.pdf", "contentType": "application/pdf", "content": "<base64>" }
  ]
}
```

**Client**: `createReplyJob` and `createForwardJob` accept `attachments?: Array<{ filename: string; contentType: string; content: string }>`.

### Send-worker changes

**`sendReplyEmail`** (and the forward equivalent):

- Read `message_data.attachments` (explicit file attachments).
- Decode base64 → Buffer.
- Combine with inline-image attachments from `processInlineImagesForEmail(bodyHtml)`.
- Pass merged `attachments` array to nodemailer.

**Nodemailer attachment shape**:

```ts
{ filename: string; content: Buffer; contentType?: string }
```

### UI: Composer attachment picker

**Location**: Reply/Forward composer panel (same place as To, Cc, Subject, Message).

**Components**:

- “Attach file” button (paperclip icon).
- File input (hidden): `accept` per platform (web: `*/*` or common types; native: document picker).
- Chosen files list: filename, size, remove (X) per file.
- Enforce: max 10 files, 5 MB total, 2 MB per file. Show error if exceeded.

**Data flow**:

- On file pick: read file (FileReader / expo-document-picker); convert to base64.
- Store in component state: `attachments: Array<{ filename, contentType, content }>`.
- On Send: pass `attachments` to `createReplyJob` / `createForwardJob`.

**Forward with original attachments** (future):

- Option: “Include attachments from original” checkbox.
- If checked: fetch each attachment via fetch-email-attachment, convert to base64, add to `attachments` before send.
- Defer to v2; v1 = user manually re-attaches if desired.

---

## Implementation checklist

### Phase 3a: Receiving

- [ ] **Amplify Lambda** (Function URL) `fetch-email-attachment`:
  - [ ] Add Lambda + Function URL to Amplify backend.
  - [ ] Auth: verify Supabase JWT.
  - [ ] Load `email_messages` by id; verify user has account access.
  - [ ] Load mailbox; connect IMAP; fetch `BODY.PEEK[part]` for `imap_uid`; disconnect.
  - [ ] Return binary (base64 + `isBase64Encoded: true` or native binary) with correct headers.
  - [ ] Handle errors (404, 502).
- [ ] **Inbox service**: `fetchAttachment(emailMessageId, part)` that calls the Lambda Function URL.
- [ ] **UI** `MessageAttachments` (or in `MessageBubble`):
  - [ ] Render attachment list from `message.attachments`.
  - [ ] Download button → call API → trigger download (web/native).
  - [ ] Graceful handling of missing `part`/`imapUid`.

### Phase 3b: Sending

- [ ] **Schema**: Add `p_attachments JSONB` to `create_inbox_reply_job` and `create_inbox_forward_job`; include in `message_data`.
- [ ] **Inbox service**: Extend `CreateReplyJobParams` and `CreateForwardJobParams` with `attachments?: Array<{ filename, contentType, content }>`.
- [ ] **Send-worker**: Merge `message_data.attachments` (base64) with inline-image attachments; pass to nodemailer.
- [ ] **UI** composer:
  - [ ] File picker (Attach button + hidden input / document picker).
  - [ ] Chosen files list with remove.
  - [ ] Enforce limits (10 files, 5 MB total, 2 MB per file).
  - [ ] Pass attachments to `createReplyJob` / `createForwardJob` on Send.

---

## Conventions

- **Attachment metadata** in `email_messages.attachments`: `{ filename, contentType, size, part?, imapUid? }`.
- **Sending attachments** in `message_data`: `{ filename, contentType, content }` (content = base64).
- **Limits**: 10 files, 5 MB total, 2 MB per file for sent attachments.
- **Inline images** (data URLs in body) remain handled by `processInlineImagesForEmail`; no change.

---

## Open questions

1. **Forward with original attachments**: Include in v1 or defer? (Recommend: defer.)
2. **Preview**: In-browser preview for images/PDFs on received attachments? (Recommend: defer; start with download only.)
3. **Rate limit** on fetch-email-attachment: per-user per-minute? (Recommend: add simple limit in v1.)

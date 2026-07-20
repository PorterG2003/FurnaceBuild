# Inbox Reply Support — Deep Dive

**Parent**: [MASTER_INBOX_UI_PLAN.md](./MASTER_INBOX_UI_PLAN.md) Step 2  
**Purpose**: Clarify how inbox replies fit (or don’t) with the existing message_jobs/send-worker pipeline and what must be decided before implementation.

---

## Decision: Option B with message type

**Send path**: Reply (and later forward) jobs are consumed by the **existing send-worker**, using the **same `message_jobs` table** with a **message type** to distinguish campaign vs manual sends.

- **Message type**: Add a `message_type` (or `job_type`) column on `message_jobs`: e.g. `'campaign'` | `'inbox_reply'` | `'inbox_forward'`. Default `'campaign'` for existing rows. Reply/forward rows use `message_type = 'inbox_reply'` or `'inbox_forward'`.
- **Same table**: No separate `reply_jobs` table. Reply jobs are `message_jobs` with `message_type = 'inbox_reply'`, `interval_id = NULL`, and `node_id` nullable (migration: allow NULL when `message_type != 'campaign'`). `message_data` carries the reply payload: `thread_id`, `in_reply_to_message_id`, `subject`, `body_text`/`body_html`, `to_email`/`to_name`, `cc` (array or string), `in_reply_to` (header), `message_references` (header), plus optional `lead_id`/`mailbox_id`/`campaign_id`/`enrollment_id` from thread for context.
- **Priority**: Worker claims **manual-type jobs first** (e.g. `message_type IN ('inbox_reply','inbox_forward')`), then campaign jobs. Implement via: two-phase poll (claim manual, then claim campaign) or a single claim that orders by `message_type` so manual rows are returned first.
- **Worker behavior for reply jobs**: When `message_type = 'inbox_reply'`: load mailbox + thread + replied-to message from `message_data`; skip template merge (use raw subject/body from message_data); set To/Cc, In-Reply-To, References; send via SMTP; run throttle (same `check_mailbox_throttle_and_reserve`); on success insert `email_messages` (direction = sent), update `email_threads` (last_message_at, message_count, participants); set message_job to `sent`; **do not** update enrollment, **do not** call `check_and_update_processed_intervals`, **do not** create campaign `events` (optional: create `event_type = 'inbox_reply'` for analytics).

---

## Current sending pipeline (campaign emails)

1. **Scheduler** assigns enrollments to campaign intervals and creates **message_jobs** (enrollment_id, campaign_id, lead_id, mailbox_id, node_id, interval_id, scheduled_at, message_data with node_config subject/body templates).
2. **Send worker** polls via `claim_message_jobs_ready` (status = `queued`, scheduled_at ≤ NOW()), claims jobs as `reserved`.
3. For each job: **throttle** via `check_mailbox_throttle_and_reserve(p_message_job_id)` (uses mailbox_throttles; on failure job is set to `cancelled`).
4. Worker loads lead, mailbox, node config; **merges templates** (subject/body from node_config + lead data); sends via **SMTP**; sets message_job to `sent`, updates **enrollment** `next_run_at`, runs **check_and_update_processed_intervals**, creates **event**.
5. Worker does **not** insert into `email_messages` or `email_threads` — those are created/updated by the **inbox-checker** when replies are detected (thread created/updated, received messages stored).

So: campaign sends are **message_job → send worker → SMTP → message_job + enrollment + interval + event**. Inbox threads/messages are a separate path (inbox-checker writing email_threads / email_messages).

---

## What an inbox reply needs

- **From**: thread’s mailbox (thread.mailbox_id).
- **To**: the address we’re replying to (usually the lead, or the “from” of the message we’re replying to).
- **Cc**: support CC in composer (e.g. “Reply to all” prefill from thread participants, or user-added CC). All manual sends (replies, forwards) support To + Cc.
- **Subject**: “Re: &lt;existing subject&gt;” (thread.subject or the message’s subject).
- **Body**: user-written (no template).
- **Headers**: `Message-ID` (new), `In-Reply-To` (message_id of the message we’re replying to), `References` (thread history from that message).
- **Persistence**: insert `email_messages` (direction = sent) with to/cc as needed; update `email_threads` (last_message_at, message_count, participants if needed). Schema may need CC storage (e.g. `cc` column or headers) for sent messages.
- **Throttle**: same mailbox as campaign sends — reply must still count toward mailbox daily/hourly/min-gap usage, but reply-lane sends no longer wait on the daily cap.
- **Priority**: Manual sends (replies, forwards) **take priority over campaign sends**. When throttle or send capacity is constrained, manual sends are processed first; campaign jobs wait or yield. Implementation: e.g. worker claims manual/reply jobs before campaign `message_jobs`, or direct API for replies bypasses the job queue and gets first access to throttle.

---

## Caveats and design choices

### 1. Send path — **Chosen: Option B with message type**

- **Option A — Direct API** *(not chosen)*  
  - Would have kept reply logic in an API/Edge Function; throttle enforced there. Rejected in favor of reusing the worker.

- **Option B — Reply jobs in send-worker, same table with message type** *(chosen)*  
  - **Same `message_jobs` table**; new column `message_type`: `'campaign'` | `'inbox_reply'` | `'inbox_forward'`. Reply rows: `message_type = 'inbox_reply'`, `interval_id = NULL`, `node_id` nullable. Payload in `message_data` (thread_id, in_reply_to_message_id, subject, body, to, cc, headers).  
  - Worker is extended to: (1) claim manual-type jobs first (priority), then campaign; (2) when processing a job with `message_type = 'inbox_reply'`, skip template merge, use message_data for To/Cc/subject/body and In-Reply-To/References, send via SMTP, then insert `email_messages`, update `email_threads`; skip enrollment/interval/event updates.  
  - **Pros**: Single queue, shared throttle, one code path for SMTP; manual jobs naturally take priority by claim order.

### 2. Throttle (mailbox limits)

- Campaign sends and replies share the same mailbox, and all successful sends still update **mailbox_throttles** (daily, hourly, min gap).
- **Reply-lane daily exemption**: `inbox_reply`, `inbox_forward`, `campaign_priority`, and legacy `campaign_reply` never wait for the daily mailbox cap. Only dedicated `campaign` sends defer until tomorrow.
- **Hourly + min-gap still apply**: reply-lane sends can still be delayed by hourly throttles, an existing in-flight mailbox send, or the minimum-gap floor.
- **Manual sends take priority over campaign sends**: when capacity is constrained, manual inbox sends are claimed first. `campaign_priority` also rides the reply lane, so it is processed before dedicated campaign sends.
- **Send now**: the manual inbox UI can set `throttle_bypass_next_attempt` on queued `inbox_reply` / `inbox_forward` jobs. That bypass skips hourly/min-gap waiting once, but it does not bypass accounting: the successful send still increments the mailbox's daily and hourly counters in `finalize_message_job_sent`.

### 3. Enrollment / campaign flow

- Today, when the worker sends a **campaign** email it updates **enrollment.next_run_at** and **check_and_update_processed_intervals** so the flow can advance.
- **Inbox reply is not a manual step.** When the user replies from the inbox, the campaign flow is irrelevant. Do **not** advance the enrollment (no `next_run_at` update), do **not** run interval processing, do **not** treat the reply as part of the flow. Worker must skip enrollment and interval updates for reply jobs.

### 4. “To” and “Cc”

- **To**: usually the **from_email** of the message we’re replying to (the lead or whoever sent that message).
- **Cc**: supported for replies (and all manual sends). “Reply to all” can prefill To + Cc from the message’s To/Cc or thread participants; user can add or remove CC addresses in the composer.

### 5. Message-ID, In-Reply-To, References

- **Message-ID**: unique per sent message (e.g. `<timestamp.random@furnace.build>`). Stored on `email_messages.message_id`.
- **In-Reply-To**: single value, the `message_id` of the email we’re replying to (from `email_messages.message_id` of that row).
- **References**: full thread chain; typically the replied-to message’s `message_references` + its `message_id`, or built from thread order. Must be correct so clients thread the reply.

### 6. Creating the sent `email_messages` row

- After send: insert `email_messages` (thread_id, direction = sent, from_email/from_name = mailbox, to_email/to_name = reply-to, subject, body_text/body_html, message_id, in_reply_to, message_references, received_at = NOW(), message_job_id = NULL unless we used a message_job). Include **Cc** if supported — current schema may only have to_email/to_name; add a `cc` column (e.g. TEXT[] or JSONB) or store in headers for sent messages with CC.
- Update `email_threads`: last_message_at = NOW(), message_count += 1; optionally refresh participants (including any CC’d addresses).

### 7. Errors and retries

- If send fails (SMTP error, throttle exceeded): don’t insert `email_messages`; return clear error to UI; optionally retry logic (e.g. “Try again” only, or queue for worker if we go that path).

### 8. Permissions and RLS

- Only users who can access the thread (e.g. account members) should be able to send a reply. API or RLS must enforce: thread belongs to user’s account, mailbox belongs to account.

---

## Questions for product / implementation

Answer these so the implementation can be specified precisely.

### Send path *(decided: Option B, same table with message type)*

1. ~~Preferred send path~~ → **Decided**: Send-worker; same `message_jobs` table with `message_type` column (`'campaign'` | `'inbox_reply'` | `'inbox_forward'`).

2. ~~Same table vs separate table~~ → **Decided**: Same table; reply/forward rows use `message_type`, `interval_id = NULL`, `node_id` nullable.

### Throttle

1. **Should inbox replies share the same mailbox throttle (daily/hourly/min gap) as campaign sends?**  
   - **Decided**: yes for accounting, but reply-lane sends (`inbox_reply`, `inbox_forward`, `campaign_priority`, and legacy `campaign_reply`) skip the daily wait. Dedicated `campaign` sends still defer on the daily cap.

2. ~~If direct API: how to reserve throttle~~ → **N/A**: Using worker; throttle is `check_mailbox_throttle_and_reserve` for both; priority is via claim order (manual jobs claimed first).

3. **Priority implementation** *(aligned with Option B)*: Worker claims **manual-type jobs first** (e.g. `message_type IN ('inbox_reply','inbox_forward')`), then campaign jobs — via two-phase poll (claim manual, then claim campaign) or one claim that orders by `message_type` so manual rows are returned first.

### Campaign flow

1. ~~When a user sends an inbox reply, should that advance the enrollment?~~ **Decided**: No. Inbox reply is not a manual step; the flow is irrelevant. Do not update enrollment or intervals for reply jobs.

2. **Should we create an `events` row for inbox replies (e.g. event_type = ‘inbox_reply’)?**  
   - Useful for analytics and “replied” state in the builder; not required for threading.

### Recipients and threading

1. **Cc**: Support CC in composer (confirmed). Prefill “Reply to all” from message To/Cc or thread participants? Store CC on `email_messages` (schema change) or only in headers?

2. ~~Who can send a reply?~~ **Decided**: Any account member.

### Data model

1. **For the sent reply, `email_messages.message_job_id`**: Set to the **message_job id** of the reply job (we use the worker and create a message_job for the reply). Enables “sent by user” reporting and traceability.

2. ~~Should the thread’s `participants` array be updated when we send a reply?~~ **Decided**: Yes. Add To + Cc recipients if not already in participants; keeps participants in sync for display/filtering.

---

## Implementation checklist (Option B with message type)

- **Schema**: Add `message_type` to `message_jobs` (`'campaign'` | `'inbox_reply'` | `'inbox_forward'`); default `'campaign'`; make `node_id` nullable when `message_type != 'campaign'` (or allow NULL for reply/forward). Optional: add `cc` to `email_messages` for sent messages.
- **Claim**: Extend (or add) claim so worker gets manual jobs first: e.g. `claim_message_jobs_ready` with optional filter/order by `message_type`, or separate `claim_manual_message_jobs_ready()` that the worker calls before the campaign claim.
- **Create reply job**: API or app service: given thread_id, message_id (replied-to), subject, body, to, cc — load thread + message for In-Reply-To/References; insert `message_jobs` (message_type = 'inbox_reply', interval_id = NULL, node_id = NULL, enrollment_id/campaign_id/lead_id/mailbox_id from thread, scheduled_at = NOW(), message_data = { thread_id, in_reply_to_message_id, subject, body_text, body_html, to_email, to_name, cc, in_reply_to, message_references }).
- **Worker**: In `processMessageJob`, if `message_type === 'inbox_reply'`: load mailbox + thread + replied-to message; use message_data for subject/body/To/Cc/headers; send via SMTP (reuse throttle); insert `email_messages`, update `email_threads`; set job `sent`; skip enrollment/interval/event (or add optional inbox_reply event).
- **UI**: Composer (To + Cc), prefill, submit creates reply job via API; poll or refresh thread/messages to show sent message.

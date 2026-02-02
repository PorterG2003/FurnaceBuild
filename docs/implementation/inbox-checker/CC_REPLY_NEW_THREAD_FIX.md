# CC Reply Creating New Thread — Cause and Fix

## What happened

When a **CC'd person** replied to the thread, the inbox checker created a **new thread** instead of adding their reply to the existing one.

## Root cause

Threads are keyed by **one** `message_job_id`: the **campaign** send that started the conversation.

1. **Campaign send** → message_job **A** (provider_message_id = e.g. `<abc@mail.gmail.com>`). When the **To** (prospect) replies, we match that reply to job A, call `getOrCreateThread(A)`, and create the thread with `message_job_id = A`.

2. **We send an inbox reply** → a **different** message_job **B** (inbox_reply, provider_message_id = e.g. `<xyz@furnace.build>`). The send-worker correctly **updates the existing thread** (inserts the sent message into `email_messages`, updates `email_threads`). The thread still has `message_job_id = A`.

3. **CC'd person replies.** Their client sets **In-Reply-To** (and/or References) to the **last message they received** — which is **our inbox reply**, i.e. the Message-ID from job B.

4. Inbox checker searches **message_jobs** by `provider_message_id` → finds **job B** (our inbox reply).

5. It then calls **getOrCreateThread(B)**. That function looks for a thread where `message_job_id = B`. **No such thread exists** (the thread has `message_job_id = A`). So it **creates a new thread** for B and adds the CC'd reply there.

So the bug: when we match a **sent** message via `message_jobs`, we always call `getOrCreateThread(foundJob)`. For **inbox reply** jobs, the thread was already created for the **campaign** job; the inbox reply job has `message_data.thread_id` pointing to that existing thread. We must use that thread instead of creating one by job B’s id.

## Fix

In `handleReply`, when we find a matching **message_job** (`foundJob`):

- If the job is an **inbox reply** (or forward): `message_type === 'inbox_reply'` or `message_data?.source === 'inbox_reply'` (and similarly for forward). Then the thread is **message_data.thread_id** — load that thread and use it.
- Otherwise (campaign send): keep current behavior and call `getOrCreateThread(foundJob)`.

This way, when a CC'd person replies to our inbox reply, we find job B, see it’s an inbox reply, load the thread from `message_data.thread_id`, and add the CC'd reply to that same thread.

# Phase 4 — Send-Side and Matching Logic Audit

**Generated:** 2026-06-11

## 4A. `provider_message_id` completeness — PASS

| Metric | Value |
|--------|------:|
| Total sent jobs | 3,351 |
| Missing `provider_message_id` | **0** |

Every June Training send has a matchable Message-ID stored. Send path in [`workers/send-worker/src/worker.ts`](../../workers/send-worker/src/worker.ts) persists provider ID on successful SMTP send.

## 4B. Matching query fidelity — PASS

Replicated inbox-checker `handleReply` logic in [`scripts/audit-june-training-replies.ts`](../../scripts/audit-june-training-replies.ts):
- Normalize: strip `<>`, lowercase
- Match: `provider_message_id` ilike `%searchId%` scoped to same `mailbox_id`

**IMAP ground truth (64 mailboxes, since 2026-06-09):**

| Bucket | Count | Meaning |
|--------|------:|---------|
| `ingested` | 16 | Matchable reply already in Furnace (15 threads + 1 ingested during audit) |
| **`missed_matchable`** | **0** | Headers match a sent job but not in DB — **actionable gap** |
| `unmatchable_no_headers` | 0 | Re: subject without threading headers |
| `unmatchable_no_job` | 2,558 | Has In-Reply-To but no matching June Training job on that mailbox |
| `unrelated` | 0 | — |

### Sample analysis of `unmatchable_no_job` (2,558 messages)

Manual review of CSV samples shows these are **not** missed June Training replies. They thread to Message-IDs on the mailbox domain (e.g. `@getnexttherapisttoday.com`) with generic warmup-style subjects ("RE: Customer Service Improvement", "RE: Sprint Retrospective"). These are:
- Warmup / deliverability traffic on shared mailboxes
- Replies to prior non–June-Training sends on the same domain
- Not linkable to June Training `message_jobs` in Furnace

**Jun 10–11 send cohort:** 2,927 sent jobs; only **1** has any received message on its thread — consistent with near-zero human reply rate for that cohort, not a matching bug.

### Ingested reply header linking (DB sample)

All sampled threads show `email_messages.in_reply_to` containing the normalized `message_jobs.provider_message_id` — linking verification PASS per [`verify_inbox_checker.sql`](../../verify_inbox_checker.sql).

## 4C. Headerless reply gap — NOT OBSERVED

| Header class | Count in IMAP audit |
|--------------|-------------------:|
| `in_reply_to` | 2,574 |
| `references_only` | 0 |
| `headerless_reply_like` | **0** |
| `headerless_other` | 0 |

No human-looking `Re:` messages lacked threading headers in the Jun 9–11 IMAP window. Headerless detection gap is **not** explaining the low rate for this campaign during this window.

## Phase 4 conclusion

- Matching logic works when replies exist with valid headers.
- **Zero `missed_matchable`** across full 64-mailbox IMAP scan proves we are **not** sitting on a large pool of recoverable June Training replies in IMAP.
- The 2,558 `unmatchable_no_job` messages are mailbox noise (warmup/other sends), not evidence of a send-side ID bug.

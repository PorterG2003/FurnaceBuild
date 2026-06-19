# IMAP conversation recovery — Lead Magnet + Scraped Emails 2

Handoff for recovering historical reply conversations on two Foot Traffic Co Smartlead campaigns. **Use this doc to continue in a new session.**

---

## Context (read first)

Foot Traffic Co migrated off Smartlead because **Smartlead's inbox checker failed** — replies landed in sender mailboxes but Smartlead never attributed them (master inbox empty, analytics `replied: 0`).

| Layer | Status |
|-------|--------|
| Furnace migration wizard | **Worked** — leads, enrollments, sent/bounce stats imported |
| Smartlead conversation APIs | **Empty** — same broken pipeline; re-running wizard does not help |
| Real reply data | **Likely in IMAP** on 150 InboxAlways mailboxes |

**Recovery approach:** one-off script — scan IMAP (Sent + INBOX), match using **campaign lead lists + email copy (subjects)**, import `email_threads` / `email_messages`.

**Not in scope:** inbox-checker backfill alone (`message_jobs = 0` for these campaigns), June Training audit script, Smartlead API bulk sweeps.

Related docs: [`smartlead-migration-fix-handoff.md`](./smartlead-migration-fix-handoff.md) · [`smartlead-inbox-migration-handoff.md`](./smartlead-inbox-migration-handoff.md)

---

## Target campaigns

| Campaign | Furnace ID | Smartlead ID | Leads | Default `--since` |
|----------|------------|-------------:|------:|-------------------|
| Foot Traffic - Apollo Contacts (Lead Magnet) | `315e72b5-3ca0-4258-9307-b5e786e6868a` | 3295280 | 3933 | `2026-05-06` |
| Foot Traffic - Scraped Emails 2 | `eecac452-8248-4809-8a45-26761b5c5a31` | 3332649 | 2752 | `2026-05-13` |

- **Account:** `40a23e97-8fa7-4668-bbd5-287f50fa2745`
- **Mailboxes:** 150 × InboxAlways (`clinicfoottrafficcocom.austin.inboxalways.com`); creds in `mailboxes` table
- **Cross-campaign overlap:** **27 lead emails** in both campaigns → matching **must** use copy/subjects, not lead email alone
- **Shared send pool:** Smartlead rotated across all 150 boxes; no `campaign_mailboxes` or `message_jobs` in Furnace

---

## Inputs: have vs need

| Input | Where | Status |
|-------|-------|--------|
| Lead lists | `leads` + `enrollments` by `campaign_id` | **Have** (migration) |
| IMAP/SMTP | `mailboxes` | **Have** — fix **20 / 150** with `status = error` before full scan |
| Email copy (subjects per step) | Client / Smartlead UI | **Need** — migration did not import flow (`nodes = 0`) |
| Send log | `message_jobs` | **None** |

---

## Work order (new session)

1. **Obtain copy JSON** for both campaigns (subjects per sequence step; optional body fingerprints).
2. **Spike Sent folder** on 2–3 mailboxes — confirm Smartlead outbounds appear in Sent with Message-IDs.
3. **Fix error mailboxes** → 150 connected.
4. **Implement** `scripts/recover-smartlead-imap-conversations.ts` (spec below).
5. **Audit run** per campaign → review `*-candidates.json`.
6. **Import** with `APPLY=true` and `--min-confidence` after operator sign-off.
7. **Validate** SQL + Master Inbox spot-checks; update `campaign_stats`.

---

## Script to build

**File:** `scripts/recover-smartlead-imap-conversations.ts`  
**Pattern:** [`scripts/repair-campaign-reply-inbox-rows.ts`](../../scripts/repair-campaign-reply-inbox-rows.ts) — dry-run default, `APPLY=true` to write.

### Commands

```bash
# Audit → candidates JSON (run per campaign)
SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/recover-smartlead-imap-conversations.ts \
  --campaign-id 315e72b5-3ca0-4258-9307-b5e786e6868a \
  --copy tmp/audit/foot-traffic/lead-magnet-copy.json \
  --since 2026-05-06 \
  --output tmp/audit/foot-traffic/lead-magnet-candidates.json

SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/recover-smartlead-imap-conversations.ts \
  --campaign-id eecac452-8248-4809-8a45-26761b5c5a31 \
  --copy tmp/audit/foot-traffic/scraped-emails-2-copy.json \
  --since 2026-05-13 \
  --output tmp/audit/foot-traffic/scraped-emails-2-candidates.json

# Import after review
SELF_RECOVERY_TARGET_ENV=prod APPLY=true npx tsx scripts/recover-smartlead-imap-conversations.ts \
  --campaign-id 315e72b5-3ca0-4258-9307-b5e786e6868a \
  --input tmp/audit/foot-traffic/lead-magnet-candidates.json \
  --min-confidence 80
```

**Env:** `SELF_RECOVERY_TARGET_ENV=prod` + `infra/workers/.env.local` (`PROD_SUPABASE_URL`, `PROD_SECRET_SSM_PREFIX`). See [`scripts/self-recovery-env.ts`](../../scripts/self-recovery-env.ts).

Suggested flags: `--concurrency 5`, `--until` (cutover date), `--limit-mailboxes N` for dev runs.

---

## Copy input (`--copy`)

Place files under `tmp/audit/foot-traffic/` (gitignored — never commit client audit artifacts).

```json
{
  "campaignId": "315e72b5-3ca0-4258-9307-b5e786e6868a",
  "name": "Foot Traffic - Apollo Contacts (Lead Magnet)",
  "steps": [
    {
      "label": "email_1",
      "subject": "Subject line from Smartlead step 1",
      "bodyFingerprints": ["optional unique phrase from body"]
    },
    {
      "label": "followup_1",
      "subject": "Follow-up subject pattern"
    }
  ]
}
```

**Subject matching:** normalize (strip `Re:` / `Fwd:`, lowercase, collapse whitespace). IMAP subject matches if it **contains** the step subject core (or fuzzy threshold). Body fingerprints break ties when two campaigns share subjects.

---

## Matching algorithm

Smartlead sent from a **shared pool** with no Furnace send log. Anchor: **lead ∈ campaign list** + **subject matches that campaign's copy**.

```
1. Load lead index from DB     (email → lead_id, enrollment_id, smartlead_lead_id)
2. Load copy steps from JSON
3. For each account mailbox:
   a. SENT (since --since)
      - Index: message_id, to, subject, date, body snippet
      - Tag outbound when: to-email ∈ leads AND subject matches a copy step
   b. INBOX (since --since), reply-like only (In-Reply-To OR References)
      - thread_anchor:  reply refs → Sent index on same mailbox → tagged outbound
      - subject_lead:   from ∈ leads AND reply subject matches copy (no Sent parent)
      - review:         from ∈ leads only, weak/no subject match
4. Dedupe by (campaign_id, lead_id, received message_id)
5. Emit audit JSON OR import rows ≥ min-confidence
```

### Confidence tiers

| Score | Type | Action |
|------:|------|--------|
| **90+** | `thread_anchor` — INBOX reply chains to Sent outbound tagged to this campaign | Auto-import |
| **75** | `subject_lead` — lead + reply subject matches copy; no Sent parent | Auto if `--min-confidence 75` |
| **40–74** | Weak subject / ambiguous shared lead | **Review bucket only** — do not auto-import |
| **<40** | Warmup / unrelated | Drop |

Identical subjects across both campaigns → those rows stay in review unless body fingerprint disambiguates.

### IMAP implementation notes

- Reuse: [`scripts/audit-inboxalways-reply-headers.ts`](../../scripts/audit-inboxalways-reply-headers.ts) (connect, parse, classify).
- **Sent folder discovery:** `client.list()` → try `Sent`, `[Gmail]/Sent Mail`, `INBOX.Sent`; log resolved path per host.
- **Message-IDs:** normalize like [`thread-manager.ts`](../../workers/inbox-checker-worker/src/thread-manager.ts) (strip `<>`, lowercase).
- **Performance:** ~150 mailboxes × 2 folders; use `p-limit` concurrency (~5); expect long audit runs.

---

## Audit output (`--output`)

JSON should include:

```json
{
  "campaignId": "...",
  "scannedMailboxes": 150,
  "sentIndexSize": 0,
  "candidates": [
    {
      "confidence": 95,
      "matchType": "thread_anchor",
      "leadEmail": "lead@example.com",
      "leadId": "uuid",
      "mailboxEmail": "sender@clinicfoottrafficco.com",
      "receivedAt": "2026-05-20T...",
      "subject": "Re: ...",
      "messageId": "<...>",
      "inReplyTo": "<...>",
      "sentMessageId": "<...>"
    }
  ],
  "review": [],
  "dropped": 0,
  "errors": []
}
```

Operator reviews `candidates` + all `review` rows before `APPLY`.

---

## Import writes (`APPLY=true`)

Mirror Smartlead migration thread shape ([`lib/smartlead/migration.ts`](../../lib/smartlead/migration.ts)):

| Table | Fields |
|-------|--------|
| `email_threads` | `campaign_id`, `lead_id`, `enrollment_id`, `account_id`, `mailbox_id`, `has_reply: true`, `participants`, `subject`, `last_message_at` |
| `email_messages` | Sent row(s) from index + received row; real MIME `message_id`; `headers.source: 'imap_recovery'` |

**Idempotency:** skip if thread exists for `(campaign_id, lead_id)` or received `message_id` already in DB.

**Stats:** update `campaign_stats.replied_count` to match imported thread count (positive/category manual or later pass).

**After import:** inbox-checker can match **new** replies to seeded `email_messages.message_id`.

---

## What not to do

| Don't | Why |
|-------|-----|
| Re-run migration wizard for conversations | Smartlead API empty for these campaigns |
| Bulk import from lead-email-only | Wrong campaign for 27 shared leads; warmup false positives |
| `audit:june-training-replies` | Requires `message_jobs` + `campaign_mailboxes` |
| Reset `last_synced_at` without seeding threads | Inbox-checker has nothing to match |
| Auto-import review-tier rows without operator sign-off | Cross-campaign mis-attribution risk |

---

## Validation

**After import:**

```sql
SELECT c.name, cs.replied_count,
       COUNT(*) FILTER (WHERE t.has_reply) AS reply_threads
FROM campaigns c
JOIN campaign_stats cs ON cs.campaign_id = c.id
LEFT JOIN email_threads t ON t.campaign_id = c.id
WHERE c.id IN (
  '315e72b5-3ca0-4258-9307-b5e786e6868a',
  'eecac452-8248-4809-8a45-26761b5c5a31'
)
GROUP BY c.id, c.name, cs.replied_count;

-- Sample imported threads
SELECT t.id, l.email, t.subject, t.message_count, m.direction, m.message_id
FROM email_threads t
JOIN leads l ON l.id = t.lead_id
JOIN email_messages m ON m.thread_id = t.id
WHERE t.campaign_id = '315e72b5-3ca0-4258-9307-b5e786e6868a'
  AND m.headers->>'source' = 'imap_recovery'
ORDER BY t.last_message_at DESC
LIMIT 10;
```

**Human:** spot-check 5 threads per campaign in Master Inbox (correct lead, outbound + reply present, not warmup).

---

## Checklist

- [ ] Copy JSON: Lead Magnet
- [ ] Copy JSON: Scraped Emails 2
- [ ] Sent-folder spike (2–3 mailboxes)
- [ ] Fix 20 error mailboxes
- [ ] Implement `recover-smartlead-imap-conversations.ts`
- [ ] Audit both campaigns → review JSON
- [ ] APPLY import (per campaign, agreed `--min-confidence`)
- [ ] Stats + spot-check

---

## Code to reuse

| File | Use |
|------|-----|
| [`scripts/audit-inboxalways-reply-headers.ts`](../../scripts/audit-inboxalways-reply-headers.ts) | IMAP connect, parse, header classification |
| [`scripts/audit-june-training-replies.ts`](../../scripts/audit-june-training-replies.ts) | Audit JSON structure, concurrency patterns (ignore job matching) |
| [`scripts/self-recovery-env.ts`](../../scripts/self-recovery-env.ts) | Prod Supabase + SSM |
| [`scripts/repair-campaign-reply-inbox-rows.ts`](../../scripts/repair-campaign-reply-inbox-rows.ts) | APPLY / preview pattern |
| [`lib/smartlead/migration.ts`](../../lib/smartlead/migration.ts) | Thread + message row shape |
| [`workers/inbox-checker-worker/src/thread-manager.ts`](../../workers/inbox-checker-worker/src/thread-manager.ts) | Message-ID normalization |

---

## Implementation status

| Item | Status |
|------|--------|
| Handoff / matching spec | **Done** (this doc) |
| Copy JSON files | **Blocked** — client / operator |
| `recover-smartlead-imap-conversations.ts` | **Not started** |
| Prod import | **Not started** |

**Next session starts at:** obtain copy JSON → Sent spike → implement script → audit → review → import.

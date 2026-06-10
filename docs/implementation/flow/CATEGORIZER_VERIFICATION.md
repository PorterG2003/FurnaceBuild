# Categorizer Pre-Prod Gate Verification

Companion to the `categorizer-flow` seed scenario (`scripts/seed/scenarios/categorizer-flow/`).
This is the one place the **real** OpenRouter classify path is exercised before production:
the seed parks replied enrollments at the categorizer via the real
`park_or_advance_enrollment_on_reply` RPC, and the **live dev scheduler worker** classifies
them with an actual cheap-model call.

Spec: [CATEGORIZER_IMPLEMENTATION.md](./CATEGORIZER_IMPLEMENTATION.md)

---

## Prerequisites

1. Dev scheduler worker running with `OPENROUTER_API_KEY` set (and optionally
   `OPENROUTER_CATEGORIZER_MODEL`, default `google/gemini-2.5-flash-lite`).
2. Dev send worker running (test mailboxes `@furnace.test` skip real SMTP).
3. Seed env: `SEED_ACCOUNT_ID`, `SEED_OWNER_USER_ID`
   (optional `SEED_CATEGORIZER_CAMPAIGN_ID`, default `f0000000-0000-4000-8000-00000000c701`).

```bash
npx tsx scripts/seed/index.ts --scenario=categorizer-flow
```

The scenario seeds 6 leads in one running campaign
(`email-1 [sent] -> waitTime-1 -> email-2 [queued] -> Categorizer (AI on)` with all
three branch edges):

| Case | Reply | Expected outcome |
| ---- | ----- | ---------------- |
| `interested` | "very relevant ... send pricing" | AI -> `Interested`, held `email-2` cancelled, branch to `email-3` (in-thread reply, `message_type='campaign_reply'`) |
| `neutral` | "share more details ... next quarter" | AI -> `Neutral`, branch to `email-4` (in-thread reply) |
| `not_interested` | "not interested, remove me" | AI -> `Not Interested`, branch to `email-5` (new-thread breakup) |
| `ooo_dated` | headerless OOO with explicit return date (~10 days out) | AI -> `Auto Reply`, held `email-2` **restored** at the return date |
| `ooo_system` | pre-stamped `Auto Reply` / `category_source='system'`, no date in body | extraction finds no date -> held `email-2` restored **now** |
| `no_reply` | none | control: never parked; `email-2` proceeds on the normal path |

Replace the campaign id below if you used `SEED_CATEGORIZER_CAMPAIGN_ID`.

---

## 1. Immediately after seeding (before the scheduler ticks)

All 5 replied enrollments parked at the categorizer with the follow-up held:

```sql
SELECT l.email, e.state, n.flow_node_id AS current_node, e.next_run_at,
       hn.flow_node_id AS held_node, e.held_next_run_at, e.reply_thread_id
FROM enrollments e
JOIN leads l ON l.id = e.lead_id
JOIN nodes n ON n.id = e.current_node_id
LEFT JOIN nodes hn ON hn.id = e.held_node_id
WHERE e.campaign_id = 'f0000000-0000-4000-8000-00000000c701'
ORDER BY l.email;
```

Expect: 5 rows on `aiCategorizer-1` with `held_node = 'email-2'`, `next_run_at ~ now`,
`reply_thread_id IS NULL`; the `no-reply` control still on `email-2` with `next_run_at ~ +2h`.

```sql
SELECT l.email, n.flow_node_id, mj.status, mj.status_reason, mj.scheduled_at
FROM message_jobs mj
JOIN leads l ON l.id = mj.lead_id
JOIN nodes n ON n.id = mj.node_id
WHERE mj.campaign_id = 'f0000000-0000-4000-8000-00000000c701'
  AND n.flow_node_id = 'email-2'
ORDER BY l.email;
```

Expect: 5 `held` + 1 `queued` (control).

## 2. After the scheduler classifies (~1 minute)

### Thread categories (the real LLM output)

```sql
SELECT l.email, et.category, et.category_source, et.updated_at
FROM email_threads et
JOIN leads l ON l.id = et.lead_id
WHERE et.campaign_id = 'f0000000-0000-4000-8000-00000000c701'
ORDER BY l.email;
```

Expect: `Interested`/`Neutral`/`Not Interested` with `category_source='ai'` for the three
human replies; `Auto Reply` for both OOO cases (`ai` for `ooo_dated`, `system` for `ooo_system`).

### Branch advancement

```sql
SELECT l.email, e.state, n.flow_node_id AS current_node, e.reply_thread_id IS NOT NULL AS branched
FROM enrollments e
JOIN leads l ON l.id = e.lead_id
JOIN nodes n ON n.id = e.current_node_id
WHERE e.campaign_id = 'f0000000-0000-4000-8000-00000000c701'
ORDER BY l.email;
```

Expect: `interested` -> `email-3`, `neutral` -> `email-4`, `not_interested` -> `email-5`
(all `branched = true`); both OOO cases back on `email-2` (restored, `branched = false`).

### Hold hygiene

```sql
SELECT l.email, n.flow_node_id, mj.status, mj.status_reason, mj.scheduled_at, mj.message_type
FROM message_jobs mj
JOIN leads l ON l.id = mj.lead_id
LEFT JOIN nodes n ON n.id = mj.node_id
WHERE mj.campaign_id = 'f0000000-0000-4000-8000-00000000c701'
  AND mj.status <> 'sent'
ORDER BY l.email, mj.created_at;
```

Expect:

- Branched cases: `email-2` job `cancelled` (`status_reason='reply_categorized'`).
- `ooo_dated`: `email-2` job back to `queued` with `scheduled_at` ≈ the return date (~10 days out).
- `ooo_system`: `email-2` job `queued` with `scheduled_at` ≈ now (then `sent` once the send worker claims it).
- **No `held` jobs remain.**

### In-thread reply jobs (campaign_reply)

```sql
SELECT l.email, mj.status, mj.message_type,
       mj.message_data->>'subject' AS subject,
       mj.message_data->>'in_reply_to' AS in_reply_to,
       mj.message_data->>'thread_id' AS thread_id
FROM message_jobs mj
JOIN leads l ON l.id = mj.lead_id
WHERE mj.campaign_id = 'f0000000-0000-4000-8000-00000000c701'
  AND mj.message_type = 'campaign_reply';
```

Expect: rows for `interested` and `neutral` with `Re:`-prefixed subject, `in_reply_to`
pointing at the lead's reply Message-ID, and the correct `thread_id`. After the send worker
runs, `status='sent'` and a new `sent` message appears **in the same thread**:

```sql
SELECT em.direction, em.subject, em.in_reply_to, em.received_at
FROM email_messages em
JOIN email_threads et ON et.id = em.thread_id
WHERE et.campaign_id = 'f0000000-0000-4000-8000-00000000c701'
ORDER BY et.id, em.received_at;
```

### Stats sync

```sql
SELECT positive_reply_count, reply_count FROM campaign_stats
WHERE campaign_id = 'f0000000-0000-4000-8000-00000000c701';
```

Expect: `reply_count = 5`, `positive_reply_count = 1` (the `interested` case), and the
matching replied event flipped:

```sql
SELECT l.email, ev.is_positive
FROM events ev JOIN leads l ON l.id = ev.lead_id
WHERE ev.campaign_id = 'f0000000-0000-4000-8000-00000000c701'
  AND ev.event_type = 'replied';
```

## 3. Sweep / parked-population health

```sql
SELECT * FROM get_categorizer_health();
```

Expect `parked_count` to drop to 0 for this campaign once all cases resolve
(no enrollment left behind). The periodic sweep
(`sweep_parked_categorizer_enrollments`) must NOT wake the restored OOO
enrollments again.

## 4. Logs and alerting

```bash
npm run check:logs
```

- Scheduler: `[CATEGORIZER ...] AI classified thread ... as '...'`, `Branched '...' -> node ...`,
  `Auto Reply: outbound sequence restored (resume at ...)`.
- No Slack alerts on the happy path. To verify alert wiring, temporarily unset
  `OPENROUTER_API_KEY` and re-seed: after 3 consecutive failures per enrollment the
  scheduler posts `categorizer LLM classification failing repeatedly` (warning tier),
  and enrollments defer-retry every 15 minutes instead of advancing.

## 5. Master Inbox spot checks

- All 5 replied threads visible; the two OOO threads show the `Auto Reply` category chip.
- Re-categorizing a thread manually (e.g. `neutral` -> `Interested`) must NOT re-branch the
  already-branched enrollment (`reply_thread_id` guard) — verify `current_node_id` is unchanged.

## Re-runs and cleanup

Re-running the scenario deletes and recreates only the seed-owned campaign slice
(events, stats, threads, messages, jobs, enrollments, leads, mailbox links, intervals)
for the dedicated campaign id.

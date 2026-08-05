# Smart Handling Feedback

Use this runbook to collect, analyze, and rotate smart-handling feedback from
real inbox triage actions.

## What gets recorded

The `inbox_interactions` table stores append-only user and Client API triage
decisions with:

- actor metadata: `actor_type`, `actor_user_id`, `actor_api_key_id`
- action metadata: `action`, `source`, `intent`, `changes`
- snapshot context: thread, lead, and trigger message data at click time
- smart-handling metadata: `suggestion_mode`, `suggestion_version`,
  `classification_completed_at`

Included paths:

- smart handling bar actions
- smart handling dismiss
- category picker changes
- out-of-office modal completions
- replace-lead flow completions
- thread header close/reopen
- block sender modal
- composer reply/forward sends
- Client API thread patch/reply/forward

Out of scope:

- read/unread changes outside Client API patch logging
- tag add/remove
- worker-only mutations
- a full audit log of every thread update

## Versioning

The classify pipeline stamps `handling_metadata.suggestion_version` at
classification time.

Current constants live in `lib/inbox/smartHandlingVersion.ts`:

- `MANUAL_SMART_HANDLING_VERSION` for heuristic/manual smart handling changes
- `CATEGORIZER_PROMPT_VERSION` for AI prompt/parser/model contract changes
  (currently `categorizer-v2`: prior-outbound CTA context + decline-precedence /
  empty-body Neutral rubric)

When to bump:

- bump `MANUAL_SMART_HANDLING_VERSION` when manual metadata heuristics change
  in `amplify/functions/classifyReply/handler.ts`
- bump `CATEGORIZER_PROMPT_VERSION` when categorizer prompt/parser behavior
  changes in `lib/categorizer/` and the worker mirror

Interaction rows copy `suggestion_mode` and `suggestion_version` from the
thread snapshot, so later re-classification does not rewrite past feedback.

## Iteration workflow

1. Update heuristics or categorizer logic.
2. Bump the matching version constant in `lib/inbox/smartHandlingVersion.ts`.
3. Deploy the classify handler and any worker changes.
4. Re-backfill open threads if you want existing backlog to carry the new
   version stamp.
5. Collect new interactions.
6. Analyze mismatches for the current version only.
7. Batch-fix the dominant failure modes.
8. Optionally archive or prune stale versions once they are no longer useful.

## Analysis commands

From repo root:

```bash
npx tsx scripts/analyze-inbox-interaction-mismatches.ts
```

Filter to one version:

```bash
npx tsx scripts/analyze-inbox-interaction-mismatches.ts --version=2026.06.22
```

Filter to AI-only rows and export CSV:

```bash
npx tsx scripts/analyze-inbox-interaction-mismatches.ts --mode=ai --export-csv=/tmp/inbox-interactions-ai.csv
```

Show all historical versions:

```bash
npx tsx scripts/analyze-inbox-interaction-mismatches.ts --version=all
```

Useful SQL for manual inspection:

```sql
SELECT
  suggestion_version,
  intent->>'suggested_primary' AS suggested_primary,
  intent->>'suggested_category' AS suggested_category,
  action,
  source,
  COUNT(*) AS mismatch_count
FROM inbox_interactions
WHERE intent->>'matched_suggestion' = 'false'
GROUP BY 1, 2, 3, 4, 5
ORDER BY mismatch_count DESC
LIMIT 50;
```

```sql
SELECT
  suggestion_version,
  intent->>'suggested_category' AS suggested_category,
  COUNT(*) FILTER (WHERE action = 'thread.dismiss_suggestion') AS dismiss_count,
  COUNT(*) AS total_rows
FROM inbox_interactions
GROUP BY 1, 2
ORDER BY suggestion_version DESC, dismiss_count DESC;
```

Optional prune step for stale data:

```sql
DELETE FROM inbox_interactions
WHERE suggestion_version = 'old-version';
```

## Backfill note

If you bump a version and want old open threads to participate in the new eval
window, rerun the backfill after the deploy so `handling_metadata` picks up the
new stamp.

See `docs/implementation/inbox-ui/SMART_HANDLING_BACKFILL.md` for the
backfill workflow.

# Phase 5 — Downstream Pipeline Audit

**Campaign:** June Training  
**Generated:** 2026-06-11

## 5A. Categorizer coverage — PASS

All 15 detected reply threads have a category assigned:

| Category | Count |
|----------|------:|
| Interested | 13 |
| Neutral | 1 |
| Not Interested | 1 |
| Uncategorized / null | 0 |

Campaign uses AI categorizer flow (`use_ai: true`). OpenRouter was missing on scheduler until Jun 11 deploy; threads ingested before that (Alexa, Clint) were categorized successfully after recovery.

## 5B. Enrollment stopping — PASS (categorizer flow)

| Metric | Count |
|--------|------:|
| Reply threads | 15 |
| Enrollment state `completed` | 15 |
| Enrollment state `stopped` | 0 |
| `replied` event present | 15 / 15 |

**Note:** This campaign uses `park_or_advance_enrollment_on_reply` RPC (categorizer flow), which routes enrollments to `completed` via categorizer branch — not legacy `stopped` + `stopped_reason='replied'`. See [`thread-manager.ts`](../../workers/inbox-checker-worker/src/thread-manager.ts) lines 497–562.

No replies detected with enrollment still actively sending.

## Pipeline completeness

| Stage | Count | Status |
|-------|------:|--------|
| Detected (`has_reply`) | 15 | PASS |
| Categorized | 15 | PASS |
| `replied` event | 15 | PASS |
| Enrollment halted (`completed`) | 15 | PASS |

## Phase 5 conclusion

Downstream pipeline is healthy for all **detected** replies. The gap is entirely in **detection** (Phase 1/3), not classification or enrollment handling.

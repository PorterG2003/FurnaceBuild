# Pause / Resume Semantics

This is the runtime contract for campaign pause and resume.

## Ownership

- `campaigns.status` is the global execution gate.
- `enrollments.state` owns whether a lead is still active in the flow.
- `message_jobs.status` describes one send attempt only.

## Pause

- Pausing a campaign sets `campaigns.status = 'paused'`.
- Queued campaign `message_jobs` stay `pending`.
- Already claimed `reserved` jobs are allowed to finish naturally.
- Pause does not rewrite resumable jobs to `cancelled`.

## Resume

- Resume retimes overdue `pending` campaign jobs forward onto the next future schedule anchor.
- Resume sets `campaigns.status = 'running'` last.
- Legacy `cancelled / Campaign paused` rows are historical data and should be handled by the dedicated repair script, not by the runtime resume path.

## Terminal semantics

- `cancelled` is terminal-only for the send attempt that owns that row.
- `cancelled` must never mean "skip this node and continue."
- If a send attempt becomes a real terminal cancellation, the enrollment must also be moved to an enrollment-level terminal state.
- `skipped` is not part of this redesign. If product wants explicit node bypass later, it should be introduced as its own concept.

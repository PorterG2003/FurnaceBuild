# Pause / Resume Semantics

This is the runtime contract for campaign pause and resume.

## Ownership

- `campaigns.status` is the global execution gate.
- `enrollments.state` owns whether a lead is still active in the flow.
- `message_jobs.status` describes one send attempt only.

## Pause

- Pausing a campaign sets `campaigns.status = 'paused'`.
- `sending` campaign attempts are allowed to finish naturally.
- `queued` and `reserved` campaign attempts are rewritten to `deferred + campaign_paused`.
- Existing throttle-driven deferred attempts remain unchanged.
- Pause does not use `cancelled` as a pause surrogate.
- Affected enrollments have `next_run_at` cleared until resume.

## Resume

- Resume explicitly re-arms only enrollments whose unfinished work is `deferred + campaign_paused`.
- Throttle-driven deferred attempts keep their own retry timing and are not force-resumed.
- Resume sets `campaigns.status = 'running'` as part of the same runtime path.
- Legacy `cancelled / Campaign paused` rows are historical data and should be handled by the dedicated repair script, not by the runtime resume path.

## Terminal semantics

- `cancelled` is terminal-only for the send attempt that owns that row.
- `cancelled` must never mean "skip this node and continue."
- If a send attempt becomes a real terminal cancellation, the enrollment must also be moved to an enrollment-level terminal state.
- `skipped` is not part of this redesign. If product wants explicit node bypass later, it should be introduced as its own concept.

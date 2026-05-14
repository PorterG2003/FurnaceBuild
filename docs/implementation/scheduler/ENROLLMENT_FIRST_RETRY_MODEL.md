# Enrollment-First Retry Model

This document is the runtime contract for campaign email retries after the throttle scheduling regression fix.

## Philosophy

- `enrollments` own unfinished campaign workflow obligations.
- `message_jobs` are historical attempt rows, not the long-lived owner of an email step.
- The send worker records attempt outcomes.
- The scheduler owns future retry timing, interval assignment, and fresh attempt creation.
- Retryable work should re-enter the same scheduling discipline as first-attempt work instead of mutating an old row back into a live state.

## Core Lifecycle

1. An enrollment reaches an email node.
2. The scheduler assigns a valid campaign interval and creates one `message_jobs` row for that concrete attempt.
3. The send worker claims that attempt and tries to send it.
4. The attempt ends in one of four ways:
   - `sent`
   - `deferred`
   - `failed`
   - `cancelled`
   - `blocked`
5. If the attempt is `deferred`, the enrollment remains active and is re-armed for later scheduler processing.
6. If the attempt is `sent`, the enrollment can advance.
7. If the attempt is `failed`, `cancelled`, or `blocked`, the enrollment stops in v1.

## Status Model

Primary `message_jobs.status` values:

- `queued`
- `reserved`
- `sending`
- `sent`
- `deferred`
- `failed`
- `cancelled`
- `blocked`

`status_reason` makes historical outcomes precise without overloading the primary status.

## Allowed Status Pairs

- `queued` -> `NULL`
- `reserved` -> `NULL`
- `sending` -> `NULL`
- `sent` -> `sent_successfully`
- `deferred` -> `daily_throttle_limit`, `hourly_throttle_limit`, `min_gap_not_met`, `campaign_paused`, `transient_read_error`
- `failed` -> `provider_error`, `template_render_error`, `uncertain_send_state`
- `cancelled` -> `campaign_deleted`, `mailbox_deleted`, `lead_deleted`, `enrollment_deleted`, `node_deleted`, `enrollment_not_active`, `manually_cancelled`
- `blocked` -> `lead_blocked`, `mailbox_blocked`

## Outcome Semantics

### Live attempt states

- `queued`, `reserved`, and `sending` are live in-flight states.
- These states block duplicate attempt creation for the same enrollment/node pair.
- `reserved` is lease-backed. If the lease expires before send execution completes, the attempt should move to `deferred + transient_read_error` so the scheduler can create a fresh retry row later.
- `sending` means the worker crossed the send boundary. If the send outcome becomes uncertain after that point, the attempt should become terminal (`failed + uncertain_send_state`) instead of being retried automatically.

### Successful completion

- `sent + sent_successfully` means the attempt fulfilled the email obligation.
- The enrollment may advance to the next node after flow evaluation sees the sent attempt.

### Deferred attempts

- `deferred` is the only retryable historical outcome in v1.
- The deferred row remains an immutable attempt record tied to its original `interval_id`.
- A retry creates a brand new `message_jobs` row with a fresh `interval_id`.
- The enrollment stays on the same email node until a later attempt is sent or a terminal outcome stops it.
- Retryable pre-send infrastructure/read failures should land here as `transient_read_error`, not as terminal `failed`.

### Terminal attempts

- `failed` means execution reached real send work and failed.
- `cancelled` means the attempt was invalidated or intentionally abandoned before it should count as a send failure.
- `blocked` preserves the existing policy/safety meaning.
- In v1, `failed`, `cancelled`, and `blocked` all stop the enrollment.

## Retry Ownership

### Send worker responsibilities

- Reserve and execute the claimed attempt.
- Record the final attempt outcome on the current `message_jobs` row.
- For retryable throttle outcomes, mark the row `deferred` and re-arm the enrollment through `next_run_at`.
- For retryable pre-send infrastructure/read failures, mark the row `deferred + transient_read_error` and re-arm the enrollment through `next_run_at`.
- Do not choose the next campaign `scheduled_at` timestamp for a retry.

### Scheduler responsibilities

- Decide when an enrollment is due again.
- Run the normal flow evaluation for that enrollment.
- Recreate a fresh attempt only when the latest attempt for that enrollment/node is `deferred`.
- Assign the retry into a valid future campaign interval that still respects timezone, campaign schedule, jitter, and mailbox pacing.

## Dedupe Rules

The following attempt states block fresh attempt creation for the same enrollment/node in v1:

- `queued`
- `reserved`
- `sending`
- `sent`
- `failed`
- `cancelled`
- `blocked`

Only `deferred` allows the scheduler to create a fresh replacement attempt.

## Pause And Resume

### Pause

- Pausing a campaign sets `campaigns.status = 'paused'`.
- `sending` attempts are allowed to finish.
- `queued` and `reserved` campaign attempts become `deferred + campaign_paused`.
- Existing throttle-driven deferred attempts remain unchanged.
- Affected enrollments have `next_run_at` cleared while the campaign is paused.

### Resume

- Resuming a campaign sets `campaigns.status = 'running'`.
- Only enrollments whose latest unfinished attempt is `deferred + campaign_paused` are explicitly re-armed.
- Throttle-driven deferred attempts keep their own retry timing and are not force-resumed.

## Attempt History

In v1, attempt history is row-based:

- each `message_jobs` row is one attempt
- previous attempts remain queryable for audit and support work
- retries do not overwrite attempt history in place

There is no JSON attempt-history column in this version.

## Scope Boundary

- This redesign is campaign-job focused in v1.
- Manual inbox reply/forward jobs keep their existing retry shape unless a shared-path compatibility change is unavoidable.

## Coverage Checklist

Any future lifecycle change should be checked against this matrix:

- `queued -> reserved -> sending -> sent`
- throttle outcomes become `deferred`
- lease-expired `reserved` attempts become `deferred + transient_read_error`
- deferred attempts recreate a fresh row later
- retries land in valid campaign schedule windows
- pause converts queued/reserved attempts to `deferred + campaign_paused`
- resume only re-arms pause-driven deferred attempts
- stale `sending` attempts become `failed + uncertain_send_state` and are not auto-retried
- `failed`, `cancelled`, and `blocked` stop the enrollment
- duplicate attempt creation remains blocked for every status except `deferred`

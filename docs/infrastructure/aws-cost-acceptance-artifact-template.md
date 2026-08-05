# AWS cost wins — acceptance artifact template

Copy this file per wave (e.g. `wave-scheduler-logging-dev-2026-08-05.md`) and fill numbers. Never claim savings from unlike traffic windows.

## Wave metadata

- Wave name:
- Environment: `dev` | `prod`
- Deployed at (UTC):
- Prior task definition revisions:
- Exact rollback command:

## Baseline window

- Start / end (UTC):
- Workload count (enrollments / messages / mailbox checks):
- Log bytes / events by log group:
- Queue age p95 / depth:
- Error / duplicate / restart rates:
- ECS desired / running counts:
- Container Insights setting:
- Cost Explorer service/usage-type totals (if cost wave):

## Comparison window

- Start / end (UTC):
- Workload count:
- Same metrics as baseline:

## Normalized metrics (required if workload differs by >20%)

- `bytes / processed item`:
- `errors / 1,000 processed items`:
- `cost / 1,000 processed items` (cost waves):

## Pass / fail gates

| Gate | Threshold | Result |
| --- | --- | --- |
| Warnings/errors retained | 100% of injected failure cases | |
| Scheduler byte reduction | ≥85% vs comparable baseline | |
| Inbox byte reduction | ≥70% fixture / ≥60% live comparable | |
| Failed/duplicate business outcomes | no increase | |
| Desired counts after stack action | prod 1/1/1 | |
| Lease DLQ | empty | |
| Graceful shutdown | ≤120s; no post-SIGTERM claims | |

## Decision

- [ ] Pass — promote / continue
- [ ] Revise — did not meet savings purpose
- [ ] Rollback — safety/business regression

Rollback executed? (yes/no + command):

## Notes


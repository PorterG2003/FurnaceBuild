# Acceptance artifact — wave: WorkerStack-Dev lease + logging infra

- Wave name: `workerstack-dev-lease-logging-2026-08-04`
- Environment: `dev`
- Deployed at (UTC): 2026-08-05 ~01:17 (CDK) + image push ~01:20 + lease start ~01:23
- Prior task definition revisions (pre-change):
  - Scheduler `:9`, Send `:9`, Inbox `:7`
- Exact rollback command:
  - `cd infra/workers && npm run scale:down:dev`
  - Restore prior task defs via ECS console / previous CFN revision if needed
  - Disable schedules: `npm run lease:dev:stop` then delete remaining schedules if any

## Baseline window

See `baseline-freeze-pre-implementation.md`. Live pre-deploy desired counts were manually `1/1/1` while CFN desired was `0`.

## Comparison / validation performed

| Check | Result |
| --- | --- |
| Dev isolation (Supabase/SSM/queues) | Pass — separate projects and `*-dev` queues |
| Synth prod desired counts | Pass — 1/1/1 |
| Synth Container Insights | Pass — dev `disabled`, prod `enabled` |
| Deploy WorkerStack-Dev | Pass — lease group/role/DLQ + stopTimeout + log env + smaller send task |
| `npm run test` (infra) | Pass — 17 |
| `npm run test:workers` | Pass — includes scheduler |
| Scheduler/send/inbox unit tests | Pass |
| `lease:dev --for 30m` | Pass — 3 schedules created with ActionAfterCompletion=DELETE via AWS SDK; workers scaled to 1/1/1 |
| `lease:dev:status` | Pass — shows remaining times + extension allowed |
| Amplify enrollmentMetric code | Ready (15m schedule + plain SUPABASE_URL) — **Amplify host deploy not run** (sandbox/prod gated separately) |
| Prod worker deploy | **Not run** — requires explicit prod OK |

## Decision

- [x] Pass — continue (dev validated)
- [ ] Prod logging / worker deploy — wait for explicit approval

## Notes

- Local AWS CLI 2.11 lacks `ActionAfterCompletion`; lease CLI uses `@aws-sdk/client-scheduler` instead.
- Dev services reconciled to desired `0` on CDK deploy, then lease brought them back to `1` for a 30m window.
- 7/30-day Cost Explorer realized savings still pending after traffic settles.

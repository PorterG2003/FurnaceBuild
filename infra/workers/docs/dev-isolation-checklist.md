# Dev isolation checklist

Use this before running `npm run lease:dev` or scaling dev workers. Dev must never share production data paths or mailboxes.

## AWS / ECS

- [x] AWS CLI credentials resolve to account **`686255981838`** (`aws sts get-caller-identity`)
- [x] ECS cluster is **`furnace-cluster-dev`** only (not `furnace-cluster-prod`)
- [x] `npm run lease:dev` / `lease-dev.sh` refuse any target name containing `prod` (case-insensitive)
- [x] WorkerStack-Dev is deployed; lease CLI reads **`WorkerStack-Dev`** outputs only

## Supabase / secrets

- [x] **`DEV_SUPABASE_URL`** points at the dev Supabase project (not prod) — verified live task env `hibwbebpcwbstqbjeviq` vs prod `lrfonoslwzodzijzdyiy`
- [x] **`DEV_SECRET_SSM_PREFIX`** is distinct from **`PROD_SECRET_SSM_PREFIX`** — `/amplify/furnacebuild/porter-sandbox-…` vs `/amplify/shared/d1jtp0rz0l9mcn`
- [ ] Leads URL (`DEV_LEADS_SUPABASE_URL`) is dev-only when used

## Queues & Amplify

- [x] SQS queues from WorkerStack-Dev exports (`NotificationEvents`, `ClassifyReply`) are dev-scoped — live inbox env uses `*-dev` queue URLs only
- [ ] Amplify sandbox / dev branch uses dev worker task ARNs and dev queue URLs

## Operational safety

- [x] No shared mailboxes or live campaigns between dev workers and prod — separate Supabase projects
- [x] Dev lease shutdown schedules live in the dev schedule group (`DevLeaseScheduleGroupName` output)
- [ ] After dev work: `npm run lease:dev:status` shows schedules draining, or run `npm run lease:dev:stop`
- [ ] Prefer **`lease:dev:stop`** or waiting for scheduled scale-down over leaving dev at 1/1/1 overnight

Verified 2026-08-04 against live ECS task definitions.

## Quick verification commands

```bash
aws sts get-caller-identity --query Account --output text
aws ecs describe-clusters --clusters furnace-cluster-dev --query 'clusters[0].clusterName'
npm run lease:dev:status
```

# AWS cost wins — rollout measurement checklist

## Allowed without extra approval

- Code + tests in this PR/branch
- `infra/workers` synth/diff for **dev and prod** (read-only diffs)
- `npm run deploy:dev` / `build:dev` / `lease:dev` after tests pass
- Freezing baseline CloudWatch / Cost Explorer evidence (read-only)

## Requires explicit production OK (stop and ask)

- `build:prod`, `deploy:prod`, `restart:prod`
- Any Amplify production / `main` ship
- ALB/EIP/secret deletion
- Promoting logging changes to prod workers

## Measurement cadence

1. Freeze baseline **before** behavior changes (fixture line/byte counts + 7-day log groups + queue health + CE totals)
2. Deploy to **dev**, exercise a short lease, compare 2–4 hour lease metrics
3. Ask for prod OK with blast radius before each prod wave
4. Prod logging waves are separate (scheduler, then inbox); with one task these are rollouts, not true canaries
5. Re-check Cost Explorer at 7 days and 30 days; update savings canvas with realized numbers
6. Success target: normalized monthly run rate ≤ **$255** before optional ALB cleanup, CloudWatch processing ≥80% below July baseline, with safety gates overriding the cost target

## Commands (pre-deploy)

```bash
npm run test:workers
npm run test:campaign:integration   # when DB available
npm run test:core                   # when full suite intended
cd infra/workers && npm run test && npm run build && npm run synth:dev && npm run synth:prod && npm run diff:dev && npm run diff:prod
```

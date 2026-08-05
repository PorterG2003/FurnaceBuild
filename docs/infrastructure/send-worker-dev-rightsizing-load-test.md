# Send-worker rightsizing (dev-only) load-test checklist

Dev send-worker task size is now **0.25 vCPU / 0.5 GB** in `infra/workers/lib/worker-stack.ts`.
Production remains **0.5 vCPU / 1 GB** and must not be changed in this plan.

## When exercising a lease

1. Start lease: `cd infra/workers && npm run lease:dev -- --for 2h`
2. Confirm send task definition CPU/memory are 256/512
3. Watch for ≥30 minutes of representative send traffic (or synthetic enqueue):
   - CPU p95 < 70%; no sustained 5-minute period > 90%
   - Memory p95 < 70%; zero OOM / restart
   - Queue age/depth and p95 latency ≤20% above baseline
   - Zero duplicate/terminal send regressions
4. Record results in an acceptance artifact
5. Do **not** promote this size to prod without a separate proposal and true canary mechanism

Expected production saving from this plan item: **$0**.

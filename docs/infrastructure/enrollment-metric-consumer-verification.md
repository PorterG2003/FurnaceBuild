# EnrollmentsReadyToProcess consumer verification

Date: 2026-08-04  
Metric: `Furnace/Scheduler` / `EnrollmentsReadyToProcess`  
Publisher: `amplify/functions/enrollmentMetric`

## Finding

No in-repo consumer was found for this metric:

- No CloudWatch Alarm / Dashboard constructs under `infra/`
- ECS worker services use fixed `desiredCount` from IaC (`infra/workers/lib/desired-counts.ts`); no Application Auto Scaling target/policy references this metric
- Docs historically described the metric as intended for autoscaling, but live worker CDK never wired it

## Action taken (observation period)

- Slowed schedule from **every 1m → every 15m**
- Stopped resolving the public Supabase URL via Amplify `secret()`; inject `SUPABASE_URL` as a plain environment value from `EXPO_PUBLIC_SUPABASE_URL` at synth time
- Kept `SUPABASE_SECRET_KEY` as a secret

## Follow-up

After one observation period with no alarms/dashboards/autoscaling gaps:

1. Inventory Amplify sandboxes/branches still running every-minute legacy copies and identify owners before deleting stale backends
2. Consider deleting the production function entirely if still unused
3. Do **not** change broad Lambda log retention as part of this cost wave (~$1.28/month storage is not worth losing forensic history without a retention policy decision)

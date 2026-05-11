# May 8 / May 11 Incident Review Pack

Generated at: `2026-05-11 16:01:53` CT

## Files

- `stale-jobs.enriched.csv`: every stale live `message_jobs` row with incident bucket, review bucket, priority, recommended action, and rationale.
- `manual-repair-review.enriched.csv`: every retryable `stopped` enrollment with whether a live job still exists and what to do next.
- `may-8-11-affected-campaigns.enriched.json`: combined structured export for scripting/filtering.

## Action Buckets

### 1. `stranded_retryable_stopped_enrollment`
- What it means: enrollment is stopped for a retryable DB/read error and there is no live campaign job left.
- Action: `reactivate_enrollment`.
- Why: this prospect is stranded; nothing in the current queue will resume it on its own.

### 2. `retryable_stopped_with_live_job`
- What it means: enrollment is stopped, but a live `queued`/`reserved`/`sending` job still exists.
- Action: `resolve_live_job_before_reactivating`.
- Why: reactivating first could create duplicate or conflicting work if the stale job is later reset.

### 3. `stale_job_on_active_enrollment`
- What it means: enrollment is still active, but the live job looks abandoned.
- Action: `reset_or_cancel_stale_job`.
- Why: the enrollment itself is not dead, but progress is blocked behind a stale attempt.

### 4. `stale_job_attached_to_retryable_stopped_enrollment`
- What it means: same lead appears in both worlds: stopped enrollment plus stale live job.
- Action: `review_job_and_enrollment_together`.
- Why: these need coordinated cleanup, not one-sided reactivation or one-sided job reset.

### 5. `stale_sending_job`
- What it means: the job reached `sending`, not just `reserved`.
- Action: `manual_eyeball_before_any_reset`.
- Why: higher duplicate-send risk; confirm whether the message might have partially or fully gone out.

## Campaign Summary

| Campaign | Stale jobs | Stale `sending` | Stale+stopped overlap | Stranded enrollments | Stopped with live job |
| --- | ---: | ---: | ---: | ---: | ---: |
| Scroll - Epoxy 1 | 18 | 0 | 1 | 6 | 1 |
| WFA - CEO's (Migration) | 26 | 1 | 5 | 11 | 5 |
| WFA - CFO's (Migration) | 9 | 1 | 1 | 8 | 1 |

## Bucket Counts

- Stale jobs: `other_stale_job` / `may_11_incident` = 1
- Stale jobs: `stale_job_attached_to_retryable_stopped_enrollment` / `may_11_incident` = 5
- Stale jobs: `stale_job_attached_to_retryable_stopped_enrollment` / `may_8_incident` = 2
- Stale jobs: `stale_job_on_active_enrollment` / `may_11_incident` = 4
- Stale jobs: `stale_job_on_active_enrollment` / `may_8_incident` = 39
- Stale jobs: `stale_sending_job` / `may_11_incident` = 1
- Stale jobs: `stale_sending_job` / `may_8_incident` = 1
- Manual review: `retryable_stopped_with_live_job` / `may_11_incident` = 5
- Manual review: `retryable_stopped_with_live_job` / `may_8_incident` = 2
- Manual review: `stranded_retryable_stopped_enrollment` / `may_11_incident` = 22
- Manual review: `stranded_retryable_stopped_enrollment` / `may_8_incident` = 3

## Suggested Review Flow

1. Review `manual-repair-review.enriched.csv` filtered to `recommended_action = reactivate_enrollment`.
2. Review `manual-repair-review.enriched.csv` filtered to `recommended_action = resolve_live_job_before_reactivating`.
3. Review `stale-jobs.enriched.csv` filtered to `recommended_action = manual_eyeball_before_any_reset`.
4. Review remaining stale-job rows by `incident_bucket` (`may_11_incident`, `may_8_incident`, `legacy_pre_incident`).

## Sample Rows By Bucket

### `other_stale_job`
- `Scroll - Epoxy 1` | `tyler@shakerpainting.com` | `Shaker Painting` | `may_11_incident` | `reset_or_cancel_stale_job`

### `retryable_stopped_with_live_job`
- `Scroll - Epoxy 1` | `roper@greenfieldflooring.com` | `Surface Design Solutions` | `may_11_incident` | `resolve_live_job_before_reactivating`
- `WFA - CEO's (Migration)` | `mthomas@accu-serv.com` | `Accuserv Lighting & Equipment` | `may_11_incident` | `resolve_live_job_before_reactivating`
- `WFA - CEO's (Migration)` | `andy.herell@elementchemicals.net` | `Element Chemicals` | `may_11_incident` | `resolve_live_job_before_reactivating`

### `stale_job_attached_to_retryable_stopped_enrollment`
- `Scroll - Epoxy 1` | `roper@greenfieldflooring.com` | `Surface Design Solutions` | `may_11_incident` | `review_job_and_enrollment_together`
- `WFA - CEO's (Migration)` | `truocchio@avidrp.com` | `Avid Radiopharmaceuticals` | `may_8_incident` | `review_job_and_enrollment_together`
- `WFA - CEO's (Migration)` | `marklooi@looiconsulting.com` | `Looi Consulting` | `may_8_incident` | `review_job_and_enrollment_together`

### `stale_job_on_active_enrollment`
- `Scroll - Epoxy 1` | `annette@otneighoff.com` | `O.T. Neighoff & Sons` | `may_8_incident` | `reset_or_cancel_stale_job`
- `Scroll - Epoxy 1` | `joe@wegrindharder.com` | `Deluxe Industries` | `may_8_incident` | `reset_or_cancel_stale_job`
- `Scroll - Epoxy 1` | `katherine.james@garagekings.com` | `Garage Kings` | `may_8_incident` | `reset_or_cancel_stale_job`

### `stale_sending_job`
- `WFA - CEO's (Migration)` | `s.carter@upperechelonproducts.com` | `Upper Echelon Products` | `may_11_incident` | `manual_eyeball_before_any_reset`
- `WFA - CFO's (Migration)` | `sboebel@barcoproducts.com` | `Barco Products` | `may_8_incident` | `manual_eyeball_before_any_reset`

### `stranded_retryable_stopped_enrollment`
- `Scroll - Epoxy 1` | `khannaford@kaloutas.com` | `Kaloutas` | `may_11_incident` | `reactivate_enrollment`
- `Scroll - Epoxy 1` | `joel@coxconcrete.us` | `Cox Concrete Chattanooga` | `may_11_incident` | `reactivate_enrollment`
- `Scroll - Epoxy 1` | `jim@wahlenworks.com` | `Wahlen Works` | `may_11_incident` | `reactivate_enrollment`


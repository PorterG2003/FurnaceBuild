# Enrollment (Per-Lead) Pause / Resume Semantics

This is the runtime contract for **manual** pause and resume of individual leads within a campaign. It is **orthogonal** to [campaign pause / resume](./PAUSE_RESUME_SEMANTICS.md).

## Ownership

| Layer | Field | Campaign pause | Enrollment (per-lead) pause |
|-------|--------|----------------|----------------------------|
| Campaign gate | `campaigns.status` | Set to `paused` | **Unchanged** |
| Lead in flow | `enrollments.state` | Stays `active` | Set to `paused` |
| Scheduling | `enrollments.next_run_at` | Cleared for affected rows | Cleared (`NULL`) |
| Send attempt | `message_jobs.status` + `status_reason` | `deferred` + `campaign_paused` | `deferred` + `enrollment_paused` |

- `campaigns.status` is the **global** execution gate for the whole campaign.
- `enrollments.state = 'paused'` means **this person** was manually held in the flow.
- `message_jobs` rows describe **one send attempt**; defer reasons label which resume path owns them.

## Pause (manual, per lead)

RPC: `pause_enrollments_for_leads(account_id, campaign_id, global_lead_ids[])`

**Allowed when:** campaign is native (not Smartlead); leads exist in the campaign; enrollment is `active`.

**Single transaction — order matters:**

1. Resolve scope: account members, native campaign, non-deleted `leads` matching `global_lead_id`s.
2. **Defer jobs** while enrollment is still `active`:
   - `message_jobs` with `status IN ('queued', 'reserved')` and campaign message type → `deferred` + `status_reason = 'enrollment_paused'`.
   - Clear `reserved_at`, `send_wait_reason`, `error_message`.
3. **Pause enrollments:** `state = 'paused'`, `next_run_at = NULL` where `state = 'active'`.

**Do not update:**

- `sending` jobs (in-flight send may complete — same as campaign pause).
- Throttle deferrals (`daily_throttle_limit`, etc.).
- `deferred` + `campaign_paused` rows.
- Terminal enrollments (`stopped`, `completed`).

Per-lead pause is allowed when `campaigns.status` is `draft`, `running`, or `paused`.

## Resume (manual, per lead)

RPC: `resume_enrollments_for_leads(account_id, campaign_id, global_lead_ids[])`

**Requires:** `campaigns.status = 'running'`. Blocked when campaign is `paused`, `stopped`, or `draft`.

**Single transaction:**

1. Guard campaign is `running`.
2. **Re-activate:** `enrollments.state = 'active'`, `next_run_at = NOW()` where `state = 'paused'`.
3. **Re-arm jobs:** only `deferred` + `status_reason = 'enrollment_paused'` → `queued`, `status_reason = NULL`, `scheduled_at = NOW() + 30 seconds`.

**Never update:** `campaign_paused`, throttle deferrals, or `sending` rows.

v1 resume uses a simple `scheduled_at` bump, not full campaign anchor scheduling (see campaign resume RPC for anchor behavior).

## Interaction matrix

| Campaign status | Enrollment state | Scheduler | Send worker (reserved job) |
|-----------------|------------------|-----------|----------------------------|
| `running` | `active` | Normal | Normal |
| `paused` | `active` | Skips; may bump `next_run_at` | Defers → `campaign_paused` |
| `running` | `paused` | Does not claim (`state != active`) | Defers → `enrollment_paused` |
| `paused` | `paused` | Does not claim | Defers per campaign or enrollment reason |

**Campaign resume** (`resume_campaign_and_reschedule_jobs`) re-arms only `campaign_paused` jobs for **`active`** enrollments. Manually `paused` enrollments stay paused until `resume_enrollments_for_leads`.

**Enrollment resume** re-arms only `enrollment_paused` jobs. It does not change `campaigns.status`.

## Expected final state (support checklist)

### After pause (active lead, queued email, campaign running)

- `campaigns.status` = `running`
- `enrollments.state` = `paused`, `next_run_at` = null
- Job: `deferred`, `status_reason` = `enrollment_paused`

### After pause (sending job present)

- Job stays `sending`
- Other queued/reserved jobs → `enrollment_paused`
- Enrollment `paused`

### After resume (campaign running)

- `enrollments.state` = `active`, `next_run_at` set
- `enrollment_paused` jobs → `queued`, reason cleared

### Wrong state (bug indicators)

- `cancelled` + `Enrollment not active (paused)` on a campaign job → pause path raced send worker without defer; see send-worker defer-on-paused.
- `campaign_paused` jobs revived by enrollment resume → resume RPC scope bug.

## Worker contract

- **Scheduler:** claims only `enrollments.state = 'active'` with due `next_run_at` and `campaigns.status = 'running'`.
- **Send worker:** when `enrollment.state = 'paused'` and job is `reserved`, defer with `enrollment_paused` (do not cancel). Still cancel for `stopped` / `completed` / deleted enrollments.

## UI / filters

Explorer filter **Paused** matches `enrollments.state = 'paused'` only. Leads on a **campaign-paused** campaign still show **In Progress** until manually paused.

## RPCs and jobs

| RPC | Purpose |
|-----|---------|
| `pause_enrollments_review_summary` | Counts for pause confirmation UI |
| `resume_enrollments_review_summary` | Counts for resume confirmation UI |
| `pause_enrollments_for_leads` | Sync mutation |
| `resume_enrollments_for_leads` | Sync mutation |
| `start_pause_enrollments_job` / `start_resume_enrollments_job` | Async bulk by global_lead_ids |
| `start_pause_enrollments_job_for_list` / `start_resume_enrollments_job_for_list` | Async bulk by saved list |

## Webhooks (Client API)

- `enrollment.pause_completed` — after sync pause or async job completion (job-level summary for bulk).
- `enrollment.resume_completed` — after sync resume or async job completion.

See also: [PAUSE_RESUME_SEMANTICS.md](./PAUSE_RESUME_SEMANTICS.md).

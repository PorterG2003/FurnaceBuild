# Database seed CLI

TypeScript runner under `scripts/seed/` for inserting **dev/staging** fixture data into Supabase. It now supports three complementary layers of campaign test data:

- **Unit fixtures**: plain campaign-domain builders and lightweight tests that do not touch the database.
- **Integration fixtures**: DB-backed harnesses that materialize only the campaign slice a test needs, using strict namespacing and scoped cleanup.
- **Scenario seeds**: richer account slices for manual QA, demos, and reproducing edge cases.

The seed CLI is the **scenario seed** layer. Most new automated tests should prefer unit fixtures or DB-backed integration fixtures instead of depending on a full seed run.

## Requirements

- **Non-production** Supabase project (this repo’s cloud workers may process claimable rows if they point at the same project).
- **Service role** credentials only — not the anon / publishable key (`auth.admin` and many inserts expect elevated access).

## Environment

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_URL` | Yes | Project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` | Yes | Service role JWT |
| `SEED_PROJECT_REF` | No | If set, must equal the `<ref>` in `https://<ref>.supabase.co` (guards wrong project) |
| `SEED_WIPE_CONFIRM` | When using `--wipe` | Must be `1` or wipe is refused |

### Campaign integration test overrides

DB-backed campaign tests may use a separate non-prod project from the general app `.env.local` target.

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `CAMPAIGN_TEST_SUPABASE_URL` | Preferred | Dedicated API URL for `lib/test/campaign/*` |
| `CAMPAIGN_TEST_SUPABASE_SERVICE_ROLE_KEY` | Preferred | Matching service-role JWT for the campaign test database |
| `CAMPAIGN_TEST_PROJECT_REF` | No | If set, must equal the `<ref>` in the campaign test URL |
| `CAMPAIGN_TEST_ACCOUNT_ID` | No | Existing account UUID to reuse; otherwise the harness creates one |
| `CAMPAIGN_TEST_OWNER_USER_ID` | No | Existing owner user UUID to reuse; otherwise the harness creates one |
| `CAMPAIGN_TEST_ALLOW_PROD` | No | Must be `1` to intentionally allow DB-backed campaign tests against a protected prod ref |

If the harness resolves to the protected production project and `CAMPAIGN_TEST_ALLOW_PROD` is not set, campaign integration tests fail fast instead of seeding the wrong database.

### `dev-default` scenario

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `SEED_ACCOUNT_ID` | Yes | Existing account UUID (`accounts.id`) that will own the seeded campaigns and rows |
| `SEED_OWNER_USER_ID` | Yes | Existing user UUID (`users.id`) for `campaigns.owner_id` and `mailboxes.user_id` |

Creates a production-like campaign account slice attached to the existing seed account/user:

- 5 campaigns with a believable spread of statuses,
- 50 connected mailboxes shared across the seeded campaign slice,
- roughly 1.2k total leads,
- active, paused, stopped/replied, completed, and draft-style slices,
- a mix of `pending`, `reserved`, and historical `sent` campaign jobs,
- about 10 inbox conversations, with OOO-focused cases concentrated in a small realistic subset.

This is the default `npm run seed` scenario. It is intentionally broad enough for manual QA while still keeping the conversation history and edge-case richness focused on a modest number of leads.

```bash
npx tsx scripts/seed/index.ts --scenario=dev-default --dry-run
```

### `campaign-smoke` scenario

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `SEED_ACCOUNT_ID` | Yes | Account UUID (`accounts.id`) for the seed campaign and rows |
| `SEED_OWNER_USER_ID` | Yes | `users.id` (same as Supabase Auth user id) for `campaigns.owner_id` and `mailboxes.user_id` |
| `SEED_CAMPAIGN_ID` | No | Fixed campaign UUID for idempotent re-runs; defaults to the constant in [`constants/campaignSmoke.ts`](./constants/campaignSmoke.ts) |

Creates a **running** campaign with Fallout-inspired fictional copy (see [`theme/falloutCopy.ts`](./theme/falloutCopy.ts)), two `@furnace.test` mailboxes, two leads/enrollments, a deterministic `campaign_intervals` row, then calls **`batch_assign_jobs_to_interval`** (same RPC as the scheduler). Modeled on [`lib/devtools/email-variants-harness/index.ts`](../lib/devtools/email-variants-harness/index.ts).

```bash
npx tsx scripts/seed/index.ts --scenario=campaign-smoke --dry-run
```

Use a **dedicated** seed campaign id so re-runs do not touch unrelated campaigns; the scenario deletes and recreates leads/enrollments (and linked `message_jobs`) for that campaign id.

### `ooo-mixed-inbox` scenario

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `SEED_ACCOUNT_ID` | Yes | Account UUID (`accounts.id`) for the seeded inbox data |
| `SEED_OWNER_USER_ID` | Yes | `users.id` used for `campaigns.owner_id` and `mailboxes.user_id` |
| `SEED_OOO_CAMPAIGN_ID` | No | Dedicated campaign UUID for the OOO inbox scenario; falls back to `SEED_CAMPAIGN_ID`, then a built-in constant |

Creates a bulk mixed inbox fixture set with Fallout-themed fictional threads/messages:

- 20 deterministic threads in one campaign (8 normal + 4 per OOO resume case),
- a real two-email campaign flow (`email-1 -> waitTime-1 -> email-2`),
- a balanced mix of normal, OOO-only, future-resume, and due-resume cases,
- OOO enrollments parked on the wait step after email 1 so resume can advance them toward email 2,
- multiple unread threads plus deeper back-and-forth on normal conversations,
- parseable return-date text in inbound auto-replies for OOO modal prefill.

The scenario seeds in **two phases** inside `oooInbox_baseGraph`:

1. **Historical email-1** — Uses deterministic far-future `campaign_intervals` (same RPC path as prod: `batch_assign_jobs_to_interval`), marks jobs `sent`, refreshes interval progress, and records sent/replied metrics in later modules. `message_jobs.interval_id` is then cleared so intervals can be replaced safely.
2. **Runtime-ready intervals** — Deletes completed historical intervals, resets `campaigns.last_completed_interval_time`, and inserts ~28 near-future `campaign_intervals` (`interval_time > now`, `status = available`) spaced by the campaign’s `sending_interval_seconds`. **No `email-2` `message_jobs` are inserted**; after you resume an OOO enrollment, the real **scheduler** (`claim_enrollments_ready` / flow eval) and **`batchAssignIntervalJobs`** should create the second job, then the **send worker** can claim it.

Subject prefixes map to behavior: **`[NORMAL]`** (active enrollment on `email-1` — not on the OOO resume path to `email-2`). **`[OOO ONLY]`**, **`[RESUME LATER]`**, and **`[RESUME NOW]`** match `ooo_only`, `ooo_future`, and `ooo_due` leads respectively; those are the **only** enrollments seeded onto `waitTime-1` / stopped so they can produce **`email-2`** after resume. OOO threads are hidden in inbox unless **Include out of office** is enabled. **`[RESUME NOW]`** is the quickest manual check (past `ooo_resume_at` + `ooo_resume_requested`).

#### Timing / workers

- Instant resume RPC can return immediately; **email-2** still depends on **scheduler** tick (~5s poll in dev), **batch interval assignment** (~30s in scheduler worker), and **send worker** when jobs exist.
- **`[RESUME LATER]`** threads use a far-future `ooo_resume_at` in seed data; treat them as “not due” unless you change the return date / mark instant resume in the UI.

#### Verifying email-2 via the real path (manual + SQL)

After seeding, confirm OOO enrollments are parked on the wait node (replace `campaign_id` if using `SEED_OOO_CAMPAIGN_ID`):

```sql
select e.id, e.state, e.stopped_reason, n.flow_node_id
from enrollments e
join nodes n on n.id = e.current_node_id
where e.campaign_id = 'f0000000-0000-4000-8000-00000000d101'
  and n.flow_node_id = 'waitTime-1'
  and e.state = 'stopped';
```

Pick one thread whose subject includes `[RESUME NOW — due / instant]` (fastest), or any row tagged `[OOO ONLY — manual resume]` / `[RESUME LATER — future date]` and use instant resume where needed. Enable **Include out of office** if OOO threads are hidden. After resume and workers run, expect **`state = 'active'`**, **`current_node_id`** on the **`email-2`** node, a new **`message_jobs`** row for that node, then status toward **`sent`**:

```sql
select e.id, e.state, n.flow_node_id, mj.status, mj.id as message_job_id
from enrollments e
join nodes n on n.id = e.current_node_id
left join message_jobs mj on mj.enrollment_id = e.id and mj.node_id = n.id
where e.campaign_id = 'f0000000-0000-4000-8000-00000000d101'
  and n.flow_node_id = 'email-2';
```

Success: **`message_jobs`** for **`email-2`** appears only after resume + scheduler path, not from the seed script.

Unit check for runtime interval spacing: `npx tsx --test scripts/seed/constants/oooMixedInbox.runtime.test.ts`

The scenario seeds a real campaign/mailbox/lead/enrollment/message-job graph first, then inserts `email_threads` and `email_messages`, then applies OOO flags. It is designed for UI testing and OOO scheduler verification on a dev database.

```bash
npx tsx scripts/seed/index.ts --scenario=ooo-mixed-inbox --dry-run
```

Re-runs clean and replace only the seed-owned slice for that dedicated campaign id (`email_messages`, `email_threads`, linked `message_jobs`, `enrollments`, `leads`, and `campaign_mailboxes`).

The CLI loads [`dotenv`](https://github.com/motdotla/dotenv) from the repo root in this order:

1. `.env`
2. `.env.local` with `override: true`

This means local machine values in `.env.local` win over `.env`, which is usually what you want for seed runs.

### `categorizer-flow` scenario

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `SEED_ACCOUNT_ID` | Yes | Account UUID (`accounts.id`) for the seeded campaign |
| `SEED_OWNER_USER_ID` | Yes | `users.id` for `campaigns.owner_id` and `mailboxes.user_id` |
| `SEED_CATEGORIZER_CAMPAIGN_ID` | No | Dedicated campaign UUID; defaults to a built-in constant |

Pre-prod gate for the **Categorizer node** — the one place the real OpenRouter classify
path is exercised before production. Seeds a running campaign whose flow contains a
categorizer (AI on, all three branch edges, in-thread reply emails), one lead per reply
type (interested / neutral / not interested / dated OOO / header-stamped OOO / no-reply
control), real replied threads, then routes each replied enrollment through the real
`park_or_advance_enrollment_on_reply` RPC so the **live dev scheduler** classifies them
with an actual cheap-model call.

Requires the dev scheduler worker to run with `OPENROUTER_API_KEY`. Expected outcomes and
verification SQL: [`docs/implementation/flow/CATEGORIZER_VERIFICATION.md`](../../docs/implementation/flow/CATEGORIZER_VERIFICATION.md).

```bash
npx tsx scripts/seed/index.ts --scenario=categorizer-flow --dry-run
```

Re-runs clean and replace only the seed-owned slice for the dedicated campaign id.

### `smart-handling-flow` scenario

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `SEED_ACCOUNT_ID` | Yes | Account UUID (`accounts.id`) for the seeded inbox data |
| `SEED_OWNER_USER_ID` | Yes | `users.id` used for `campaigns.owner_id` and `mailboxes.user_id` |
| `SEED_SMART_HANDLING_MANUAL_CAMPAIGN_ID` | No | Dedicated manual-categorizer campaign UUID; defaults to a built-in constant |
| `SEED_SMART_HANDLING_AI_CAMPAIGN_ID` | No | Dedicated AI-categorizer campaign UUID; defaults to a built-in constant |
| `SEED_SMART_HANDLING_LIVE` | No | Set to `1` to route selected cases through `ThreadManager.handleReply()` and `classifyReply` inline instead of stamping metadata directly |

Creates a deterministic inbox QA slice specifically for the Master Inbox Smart Handling bar:

- one **manual** campaign (`use_ai = false`) plus one **AI** campaign (`use_ai = true`)
- one visible thread per Smart Handling profile, including:
  - `[SH INTERESTED]`
  - `[SH NEUTRAL]`
  - `[SH NOT INTERESTED]`
  - `[SH OOO DATED]`
  - `[SH OOO NO DATE]`
  - `[SH WRONG CONTACT]`
  - `[SH AI INTERESTED]`
  - `[SH PENDING]`
  - `[SH CLOSED]`
- realistic sent/replied message history for every thread
- durable `email_threads` state for:
  - `conversation_status`
  - `classification_status`
  - `classification_requested_at`
  - `classification_completed_at`
  - `handling_metadata`

Default mode is deterministic and immediately renders every Smart Handling UI state without relying on external worker timing.

Optional live mode still avoids queue/LLM flakiness by reusing the **real app code paths inline**:

1. seed outbound history and queued follow-up jobs
2. call `ThreadManager.handleReply()` for selected cases
3. invoke `classifyReply` inline with a mocked OpenRouter response

That means live mode exercises the same inbox-checker and classify code used by the app, but remains deterministic for manual QA.

```bash
npx tsx scripts/seed/index.ts --scenario=smart-handling-flow --dry-run
```

Re-runs clean and replace only the two dedicated Smart Handling seed campaigns (manual + AI).

### `platform-invite-preview` scenario

Creates deterministic draft platform invitations for admin-only preview QA, including:

- Bronze / Silver / Gold
- Website traffic sourcing variants
- Reply handling variants
- Combined add-on variants

It prints direct embedded preview URLs for each seeded invitation using `/admin-invite-preview?embedded=1`. Normal admin review now happens inside the embedded preview panels on the client-signing wizard and invitation detail page.

Optional:

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `SEED_PREVIEW_ORIGIN` | No | Base origin to prepend to printed preview paths, e.g. `http://localhost:8081` |

```bash
npx tsx scripts/seed/index.ts --scenario=platform-invite-preview
```

## npm scripts

```bash
npm run seed              # default scenario (dev-default)
npm run seed:reset        # delete known seed slices from the dev DB
npm run seed:wipe         # same with --wipe (still needs SEED_WIPE_CONFIRM=1)
npm run seed:help         # print flags and env
```

Direct:

```bash
npx tsx scripts/seed/index.ts --scenario=dev-default --dry-run
```

## Flags

| Flag | Description |
| ---- | ----------- |
| `--scenario=<id>` / `--scenario <id>` | Which scenario to run (default: `dev-default`) |
| `--wipe` | Run wipe step before modules; requires `SEED_WIPE_CONFIRM=1` |
| `--dry-run` | Modules should skip writes (scaffold logs only) |
| `--help`, `-h` | Usage (no DB connection) |

## Reset command

Use the dedicated reset command when you want to remove seeded dev data without reseeding immediately.

```bash
npm run seed:reset -- --dry-run
npm run seed:reset -- --scope=dev-default --dry-run
npm run seed:reset -- --scope=campaign-smoke --dry-run
npm run seed:reset -- --scope=ooo-mixed-inbox --dry-run
npm run seed:reset -- --scope=smart-handling-flow --dry-run
```

Destructive runs require:

- `SEED_ACCOUNT_ID`
- `SEED_RESET_CONFIRM=1` (or `SEED_WIPE_CONFIRM=1`)

Optional:

- `SEED_CAMPAIGN_ID` for the `campaign-smoke` slice
- `SEED_OOO_CAMPAIGN_ID` for the `ooo-mixed-inbox` slice
- `SEED_SMART_HANDLING_MANUAL_CAMPAIGN_ID` / `SEED_SMART_HANDLING_AI_CAMPAIGN_ID` for the `smart-handling-flow` slice
- `--scope=dev-default|campaign-smoke|ooo-mixed-inbox|smart-handling-flow|all`

Reset is intentionally conservative:

- if `--scope` is omitted, it only resets scopes that can be inferred from `SEED_CAMPAIGN_ID` / `SEED_OOO_CAMPAIGN_ID`
- if `--scope=campaign-smoke` is provided, it targets that dedicated campaign id (env or built-in default)
- if `--scope=ooo-mixed-inbox` is provided, it targets that dedicated OOO campaign id
- if `--scope=smart-handling-flow` is provided, it targets the dedicated Smart Handling manual + AI campaign ids
- if `--scope=dev-default` is provided, it resets the 5 built-in production-like seed campaigns and their shared seed mailboxes
- if `--scope=all` is provided, it resets all known built-in scenario slices

Delete order is FK-aware:

1. `email_messages`
2. `email_threads`
3. `message_jobs`
4. `enrollments`
5. `leads`
6. `campaign_mailboxes`
7. soft-delete scenario-owned `mailboxes`
8. delete the dedicated `campaign`

The reset command is scoped to deterministic seed-owned data for the built-in scenarios only; it does **not** wipe the whole dev database.

## Scenarios and modules

- A **scenario** is a named list of **module** ids in [`registry.ts`](./registry.ts). Dependencies (`deps` on each `SeedModule`) are pulled in automatically and executed in **topological order** (dependencies first). Cycles are a hard error.
- **`campaign-smoke`** registers a single leaf module; the registry expands the full dependency chain (env → campaign → mailboxes → … → `batch_assign_jobs_to_interval`).
- **`ooo-mixed-inbox`** registers a single leaf module; the registry expands env → base graph → threads → messages → OOO state application.
- **`smart-handling-flow`** registers a single leaf module; the registry expands env → base graph → deterministic threads → optional inline live replies.
- Add a new module: implement `SeedModule` in e.g. `scenarios/foo.ts`, register it in `allModules`, then reference it from `scenarioModuleIds`.

## Idempotency and wipe

- **Idempotent seeds:** prefer stable natural keys, `upsert`, or “delete demo slice then insert” for a full snapshot.
- **`--wipe`:** today this is a **stub** (logs only, no deletes). Implement FK-safe deletes for rows tagged as seed/demo data in a follow-up.

## Workers and side effects

Background workers (send, scheduler, inbox-checker, etc.) call Supabase RPCs such as `claim_message_jobs_ready`, `claim_enrollments_ready`, `claim_mailboxes_to_check`. If they use the **same** project you seed, new claimable rows may be processed. Prefer a dedicated dev project or documented test mailboxes / flags.

For **`ooo-mixed-inbox`**, the due-resume threads are intentionally left with `ooo_resume_requested = true` and a past `ooo_resume_at`, so scheduler-driven OOO processing can pick them up. That is expected on a dev project.

## Running tests

The campaign test foundation now has explicit commands:

```bash
npm run test:campaign:unit         # campaign-adjacent unit tests and seed-shape checks
npm run test:campaign:fixtures     # compatibility alias for test:campaign:unit
npm run test:campaign:integration  # DB-backed campaign outcome tests (shared dev DB; needs seed env)
npm run test:campaign:worker       # scheduler worker tests, including wait-time outcome checks
npm run test:campaign              # all of the above
npm run test:flux                  # colocated Flux unit tests
npm run test:utilities             # email, slack, and account utility tests
npm run test:workers               # send-worker + inbox-checker worker tests
npm run test:seed:smoke            # dev-default dry run + seed shape smoke checks
```

Notes:

- `test:campaign:integration` uses a non-prod Supabase database with **strict namespacing** and scoped cleanup. Prefer the dedicated `CAMPAIGN_TEST_*` env vars so the harness does not inherit the app's runtime `.env.local` target by accident.
- OOO and scheduler coverage is intentionally **outcome-first**: the DB-backed tests assert final enrollment/thread/job state, not only helper return values.

## Related code

- Migrations: `supabase/migrations/`
- Example service-role script: [`scripts/migrate-cognito-users-to-supabase-auth.ts`](../migrate-cognito-users-to-supabase-auth.ts)

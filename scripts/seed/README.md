# Database seed CLI

TypeScript runner under `scripts/seed/` for inserting **dev/staging** fixture data into Supabase. Real scenarios and FK-safe wipe logic are added incrementally; the scaffold validates env, safety switches, and module order.

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

### `campaign-smoke` scenario

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `SEED_ACCOUNT_ID` | Yes | Account UUID (`accounts.id`) for the seed campaign and rows |
| `SEED_OWNER_USER_ID` | Yes | `users.id` (same as Supabase Auth user id) for `campaigns.owner_id` and `mailboxes.user_id` |
| `SEED_CAMPAIGN_ID` | No | Fixed campaign UUID for idempotent re-runs; defaults to the constant in [`constants/campaignSmoke.ts`](./constants/campaignSmoke.ts) |

Creates a **running** campaign with Fallout-inspired fictional copy (see [`theme/falloutCopy.ts`](./theme/falloutCopy.ts)), two `@furnace.test` mailboxes, two leads/enrollments, a deterministic `campaign_intervals` row, then calls **`batch_assign_jobs_to_interval`** (same RPC as the scheduler). Modeled on [`lib/test/email-variants-harness/index.ts`](../lib/test/email-variants-harness/index.ts).

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

Creates a mixed inbox fixture set with Fallout-themed fictional threads/messages:

- one normal reply thread,
- one OOO thread hidden by default unless **Include out of office** is enabled,
- one future resume case created via `mark_email_thread_out_of_office`,
- one due resume case left pending for scheduler testing,
- parseable return-date text in inbound auto-replies for modal prefill.

The scenario seeds a real campaign/mailbox/lead/enrollment/message-job graph first, then inserts `email_threads` and `email_messages`, then applies OOO flags. It is designed for UI testing and OOO scheduler verification on a dev database.

```bash
npx tsx scripts/seed/index.ts --scenario=ooo-mixed-inbox --dry-run
```

Re-runs clean and replace only the seed-owned slice for that dedicated campaign id (`email_messages`, `email_threads`, linked `message_jobs`, `enrollments`, `leads`, and `campaign_mailboxes`).

The CLI loads [`dotenv`](https://github.com/motdotla/dotenv) from the repo root in this order:

1. `.env`
2. `.env.local` with `override: true`

This means local machine values in `.env.local` win over `.env`, which is usually what you want for seed runs.

## npm scripts

```bash
npm run seed              # default scenario (minimal)
npm run seed:wipe         # same with --wipe (still needs SEED_WIPE_CONFIRM=1)
npm run seed:help         # print flags and env
```

Direct:

```bash
npx tsx scripts/seed/index.ts --scenario=minimal --dry-run
```

## Flags

| Flag | Description |
| ---- | ----------- |
| `--scenario=<id>` / `--scenario <id>` | Which scenario to run (default: `minimal`) |
| `--wipe` | Run wipe step before modules; requires `SEED_WIPE_CONFIRM=1` |
| `--dry-run` | Modules should skip writes (scaffold logs only) |
| `--help`, `-h` | Usage (no DB connection) |

## Scenarios and modules

- A **scenario** is a named list of **module** ids in [`registry.ts`](./registry.ts). Dependencies (`deps` on each `SeedModule`) are pulled in automatically and executed in **topological order** (dependencies first). Cycles are a hard error.
- **`campaign-smoke`** registers a single leaf module; the registry expands the full dependency chain (env → campaign → mailboxes → … → `batch_assign_jobs_to_interval`).
- **`ooo-mixed-inbox`** registers a single leaf module; the registry expands env → base graph → threads → messages → OOO state application.
- Add a new module: implement `SeedModule` in e.g. `scenarios/foo.ts`, register it in `allModules`, then reference it from `scenarioModuleIds`.

## Idempotency and wipe

- **Idempotent seeds:** prefer stable natural keys, `upsert`, or “delete demo slice then insert” for a full snapshot.
- **`--wipe`:** today this is a **stub** (logs only, no deletes). Implement FK-safe deletes for rows tagged as seed/demo data in a follow-up.

## Workers and side effects

Background workers (send, scheduler, inbox-checker, etc.) call Supabase RPCs such as `claim_message_jobs_ready`, `claim_enrollments_ready`, `claim_mailboxes_to_check`. If they use the **same** project you seed, new claimable rows may be processed. Prefer a dedicated dev project or documented test mailboxes / flags.

For **`ooo-mixed-inbox`**, the due-resume thread is intentionally left with `ooo_resume_requested = true` and a past `ooo_resume_at`, so scheduler-driven OOO processing can pick it up. That is expected on a dev project.

## Related code

- Migrations: `supabase/migrations/`
- Example service-role script: [`scripts/migrate-cognito-users-to-supabase-auth.ts`](../migrate-cognito-users-to-supabase-auth.ts)

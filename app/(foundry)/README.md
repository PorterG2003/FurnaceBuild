# Foundry routes (`/foundry/*`)

## Reserved URL segment

All routes under **`/foundry`** and **`/foundry/*`** belong to the Foundry (internal registry / admin) area.

Do **not** add screens under `(main)/foundry` or any path that would claim the same URLs.

## Access control

Foundry is gated by the general **`user_access_flags`** table:

- A row with `user_id` = the authenticated user’s `users.id` and **`flag_key = 'foundry'`** allows `/foundry/*`.
- **Clients** can only **SELECT** their own rows (RLS). They **cannot** insert or update this table.
- Grant or revoke with the **service role** in the Supabase SQL editor, e.g.  
  `INSERT INTO user_access_flags (user_id, flag_key) VALUES ('<uuid>', 'foundry');`  
  or `DELETE FROM user_access_flags WHERE user_id = '<uuid>' AND flag_key = 'foundry';`

Other product areas can use additional `flag_key` values over time without new tables.

## Unauthorized behavior

Users without the flag (or signed out) see a **generic “Page not found”** screen when visiting any `/foundry/*` URL. This is intentional and avoids advertising an admin surface.

## Routes (nav)

| Path | Screen |
|------|--------|
| `/foundry` | Dashboard (stats, shortcuts, recent jobs) |
| `/foundry/imports` | Import runs list; wizard under `imports/new/*` |
| `/foundry/imports/[runId]/results` | Run summary + **pipeline** (normalize, state matching, queue) |
| `/foundry/imports/[runId]/records` | Per-run source records |
| `/foundry/queue` | `review_tasks` queue (filters) |
| `/foundry/runs` | `foundry_jobs` list (async Step Functions work) |
| `/foundry/runs/[jobId]` | Job detail |
| `/foundry/export` | Export placeholder |
| `/foundry/companies/[id]`, `/foundry/source-records/[id]` | Detail |

**Redirects:** `/foundry/review` → `/foundry/queue`; `/foundry/jobs` → `/foundry/runs`; `/foundry/state-matching` → `/foundry/imports`; `/foundry/upload` → `/foundry/imports`.

## Related files

- Routes: `app/(foundry)/foundry/`
- Gate + UI shell: `components/foundry/`
- Client check: `hooks/useFoundryAccess.ts`, `lib/supabase/services/user-access-flags.ts` (`ACCESS_FLAG_FOUNDRY`)
- Migration: `supabase/migrations/20260323120000_user_access_flags.sql`

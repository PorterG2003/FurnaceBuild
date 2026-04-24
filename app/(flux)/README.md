# Flux routes (`/flux/*`)

## Reserved URL segment

All routes under **`/flux`** and **`/flux/*`** belong to the Flux (personalized prospect landing pages) area.

Do **not** add screens under `(main)/flux` or any path that would claim the same URLs.

## Access control

Flux is gated by the general **`user_access_flags`** table:

- A row with `user_id` = the authenticated user's `users.id` and **`flag_key = 'flux'`** allows `/flux/*`.
- **Clients** can only **SELECT** their own rows (RLS). They **cannot** insert or update this table.
- Grant or revoke with the **service role** in the Supabase SQL editor, e.g.  
  `INSERT INTO user_access_flags (user_id, flag_key) VALUES ('<uuid>', 'flux');`  
  or `DELETE FROM user_access_flags WHERE user_id = '<uuid>' AND flag_key = 'flux';`

## Unauthorized behavior

Users without the flag (or signed out) see a **generic "Page not found"** screen when visiting any `/flux/*` URL.

## Routes (nav)

| Path | Screen |
|------|--------|
| `/flux` | Dashboard (campaign list, recent prospect pages) |
| `/flux/campaigns` | All campaigns |
| `/flux/campaigns/[id]` | Campaign detail + template builder |
| `/flux/prospects` | All prospects (account) |
| `/flux/prospects/new` | Prospect creation + generation form |
| `/flux/prospects/[id]` | Prospect detail + page preview + URL |

## Public route

| Path | Screen |
|------|--------|
| `/p/[slug]` | Public prospect page (no auth required) |

## Related files

- Routes: `app/(flux)/flux/`
- Gate + UI shell: `components/flux/`
- Client check: `hooks/useFluxAccess.ts`, `lib/supabase/services/user-access-flags.ts` (`ACCESS_FLAG_FLUX`)
- Types: `lib/flux/types.ts`, `lib/flux/schemas.ts`
- Supabase CRUD: `lib/supabase/services/flux.ts`

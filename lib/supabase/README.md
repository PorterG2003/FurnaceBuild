# Supabase Runtime Layer

This directory contains the application-facing Supabase code used by the app and workers.

It is not the source of truth for database migrations.

## Canonical Split

- `lib/supabase/` contains runtime code: client setup, TypeScript types, and service helpers.
- `supabase/` at the repository root contains the Supabase CLI project, SQL migrations, and other database-project assets.

When in doubt:

- Import runtime code from `@/lib/supabase/*`
- Put SQL migrations in `supabase/migrations/`
- Run Supabase CLI commands from the repository root

## Service boundary rules

- **Database and RPC access** (`supabase.from(...)`, `supabase.rpc(...)`) from the app must live in `lib/supabase/services/`. Screens and components should not call these directly; they go through service functions.
- **HTTP/backend wrappers** (e.g. `fetch()` to Lambda URLs or other APIs) live in `lib/services/`, even when they use a Supabase JWT for auth.
- **Auth UI** (sign-in, sign-up, sign-out, password reset) may call `supabase.auth.*` directly in auth components. Other code that only needs an access token should use the shared helper from `lib/services/auth-token`.

## Structure

- `client.ts` - Supabase client initialization and auth/session helpers
- `types/` - TypeScript database types used by the app and workers
- `services/` - Data access layer for database and RPC; all app-side `supabase.from` / `supabase.rpc` usage belongs here

## Environment Variables

The app expects:

```env
EXPO_PUBLIC_SUPABASE_URL=your-supabase-project-url
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-api-key
```

Get these from Supabase Dashboard -> Settings -> API.

Never use the secret API key in client-side code.

## Database Changes

If you need to change the database schema:

1. Add a new SQL migration under `supabase/migrations/`
2. Apply it with the repo's documented Supabase CLI workflow
3. Regenerate or update `lib/supabase/types/database.ts`
4. Update or add service helpers in `lib/supabase/services/` as needed

## Type Generation

To regenerate types from the remote schema:

```bash
npx supabase gen types typescript --project-id <your-project-id> > lib/supabase/types/database.ts
```

## Usage

```typescript
import { getCampaigns, createCampaign } from '@/lib/supabase/services';
import { useAccount } from '@/contexts/AccountContext';

const { user } = useAccount();
const campaigns = await getCampaigns({ ownerId: user.id });
```

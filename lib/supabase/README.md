# Supabase Integration

This directory contains all Supabase-related code for database operations.

## Structure

- `client.ts` - Supabase client initialization and configuration
- `types/` - TypeScript type definitions for database tables
- `services/` - Data access layer for each table/entity
- `migrations/` - SQL migration files (create this when needed)

## Environment Variables

You need to set the following environment variables:

```env
EXPO_PUBLIC_SUPABASE_URL=your-supabase-project-url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-publishable-api-key
```

**Getting your keys:**
1. Go to Supabase Dashboard → Settings → API
2. Click the **"API Keys"** tab (use the new keys, not legacy)
3. Copy the **"Publishable API Key"** (safe for client-side)
4. Copy your **Project URL**

⚠️ Never use the "Secret API Key" in client-side code!

These can be set in a `.env` file or in `app.json` under `expo.extra`.

## Database Schema

See `migrations/` directory for SQL migrations. The current schema includes:

- `campaigns` - Campaign table with name, owner_id, and organization_id

## Running Migrations

You have two options for running database migrations:

### Option 1: Manual (Current Setup - Simple)
1. Create SQL migration file in `migrations/` (e.g., `002_add_users.sql`)
2. Copy the SQL code
3. Go to Supabase Dashboard → SQL Editor
4. Paste and run the query
5. ✅ Done!

**Pros:** Simple, no extra setup  
**Cons:** Manual step each time

### Option 2: Supabase CLI (Automated - Recommended for teams)
1. Install Supabase CLI: `npm install -g supabase`
2. Login: `supabase login`
3. Link project: `supabase link --project-ref your-project-id`
4. Push migrations: `supabase db push`

**Pros:** Automated, version controlled, can apply to multiple environments  
**Cons:** Requires CLI setup

For now, **Option 1 is fine** - just copy/paste migrations into SQL Editor when you create new tables.

## Adding New Tables

1. Create SQL migration in `migrations/` with a numbered filename (e.g., `002_add_users.sql`)
2. Run the migration (see "Running Migrations" above)
3. Add types to `types/database.ts`
4. Create service file in `services/[table-name].ts`
5. Export from `services/index.ts`

## Type Generation

To auto-generate types from your Supabase schema:

```bash
npx supabase gen types typescript --project-id <your-project-id> > lib/supabase/types/database.ts
```

## Usage

```typescript
import { getCampaigns, createCampaign } from '@/lib/supabase/services';
import { useAuthenticator } from '@aws-amplify/ui-react-native';

// In a component
const { user } = useAuthenticator();
const campaigns = await getCampaigns({ ownerId: user.userId });
```



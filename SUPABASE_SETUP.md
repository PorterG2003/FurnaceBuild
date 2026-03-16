# Supabase Setup Instructions

This guide walks you through setting up Supabase for your FurnaceBuild app.

## Directory Roles

This repo intentionally splits Supabase into two places:

- `supabase/` at the repo root is the database project. It contains the Supabase CLI config and SQL migrations.
- `lib/supabase/` is the runtime integration layer used by the app and workers.

Use `supabase/migrations/` for schema changes. Use `@/lib/supabase/*` for application imports.

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in/create account
2. Create a new project
3. Go to Settings > API to get your credentials

## 2. Get Your API Credentials

In Settings > API:

1. **Project URL**: Find this at the top of the API page (looks like `https://xxxxx.supabase.co`)
2. **Publishable API Key**:
   - Click the **"API Keys"** tab (NOT "Legacy API Keys")
   - Copy the **"Publishable API Key"** - this is safe for client-side use
   - ⚠️ Do NOT use the "Secret API Key" - that's for server-side only

## 3. Set Environment Variables

You have two options for setting environment variables:

### Option A: Using `.env` file (Recommended for development)

Create a `.env` file in the root of your project:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-api-key-here
```

**Important:** Add `.env` to your `.gitignore` file to keep credentials secure!

### Option B: Using `app.json` (Alternative)

You can also add them to `app.json` under `expo.extra`:

```json
{
  "expo": {
    "extra": {
      "supabaseUrl": "https://your-project-id.supabase.co",
      "supabasePublishableKey": "your-publishable-api-key-here"
    }
  }
}
```

## 4. Run the Database Migration

The canonical migration history lives in `supabase/migrations/`.

### Option A: Supabase CLI

From the repository root:

```bash
supabase db push
```

### Option B: Manual SQL Editor

1. Open your Supabase project dashboard
2. Go to SQL Editor
3. Open the relevant file from `supabase/migrations/`
4. Copy and paste the SQL into the editor
5. Run the query

## 5. Verify Setup

The Supabase client is automatically initialized when your app starts. You can now use it in your components:

```typescript
import { getCampaigns, createCampaign } from '@/lib/supabase/services';
import { useSupabase } from '@/hooks/useSupabase';
import { useAuthenticator } from '@aws-amplify/ui-react-native';

// In your component
const { userId } = useAuthenticator();
const { isAuthenticated } = useSupabase();

// Fetch user's campaigns
const campaigns = await getCampaigns({ ownerId: userId });
```

## Project Structure

```text
supabase/
├── config.toml             # Supabase CLI project config
└── migrations/             # SQL migrations

lib/supabase/
├── client.ts              # Supabase client initialization
├── types/
│   ├── database.ts        # Database type definitions
│   └── index.ts           # Type exports
├── services/
│   ├── campaigns.ts       # Campaign CRUD operations
│   └── index.ts           # Service exports
```

## Next Steps

- The campaigns table is ready to use
- All CRUD operations are available via the service layer
- Types are set up and ready to use
- Add more tables by creating new migrations in `supabase/migrations/`

## Security Notes

- The **Publishable API Key** is safe to use in client-side code
- Never use the **Secret API Key** in client-side code - it's for server-side only
- We're using app-level authorization (filtering by owner_id)
- For production, consider implementing Row Level Security (RLS) policies
- Never commit your `.env` file or secret keys to git

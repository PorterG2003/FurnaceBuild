# Environment Variables Setup

## One-Time Setup

1. **Create `.env.local` file:**
   ```bash
   cd infra/workers
   cp .env.example .env.local
   ```

2. **Edit `.env.local` with your values:**
   - Open `.env.local` in your editor
   - Replace the placeholder URLs with your actual Supabase branch URLs:
     - Get dev URL: Supabase Dashboard → Switch to `dev` branch → Settings → API
     - Get prod URL: Supabase Dashboard → Switch to `main` branch → Settings → API

3. **That's it!** All npm scripts automatically load these variables.

## How It Works

- All npm scripts (`npm run deploy:dev`, etc.) automatically source `.env.local`
- The `load-env.sh` script validates required variables are set
- `.env.local` is git-ignored (won't be committed)

## Manual Setup (Alternative)

If you prefer to export manually each session:

```bash
export CDK_DEFAULT_ACCOUNT=686255981838
export CDK_DEFAULT_REGION=us-west-2
export DEV_SUPABASE_URL=https://your-dev-url.supabase.co
export PROD_SUPABASE_URL=https://your-prod-url.supabase.co
```

But using `.env.local` is much easier! 🎉



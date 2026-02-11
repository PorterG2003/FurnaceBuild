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

3. **Store the Supabase Secret Key in AWS Parameter Store** (required for send-worker and other ECS workers):
   ```bash
   cd infra/workers
   npm run set-secret:dev    # for dev (prompts for Secret Key)
   npm run set-secret:prod   # for prod when ready
   ```
   - Use the **Secret Key** from Supabase Dashboard → Settings → API (not the Publishable Key).
   - Dev path: `/amplify/furnacebuild/dev/SUPABASE_SECRET_KEY`
   - Prod path: `/amplify/shared/d1jtp0rz0l9mcn/SUPABASE_SECRET_KEY`

4. **That's it!** All npm scripts automatically load these variables.

## How ECS Tasks Get Their Env Vars

The **send-worker** (and scheduler / inbox-checker workers) need:

| Env var | Set by | Description |
|--------|--------|-------------|
| `SUPABASE_URL` | CDK deploy | Supabase project URL (from `DEV_SUPABASE_URL` / `PROD_SUPABASE_URL` in `.env.local`) |
| `SUPABASE_SECRET_KEY_PARAM_PATH` | CDK deploy | SSM Parameter Store path where the Secret Key is stored (defaults in code; override with `DEV_SUPABASE_SECRET_KEY_PARAM_PATH` / `PROD_SUPABASE_SECRET_KEY_PARAM_PATH` in `.env.local`) |
| `AWS_REGION` | CDK deploy | e.g. `us-west-2` |

These are **baked into the ECS task definition** when you run:

```bash
cd infra/workers
npm run deploy:dev   # or deploy:prod
```

So if you see **"Missing SUPABASE_SECRET_KEY"** in send-worker logs:

1. **Redeploy the stack** so the task definition includes the env vars:
   ```bash
   cd infra/workers
   npm run deploy:dev
   ```
2. **Ensure the secret exists** in Parameter Store (step 3 above).
3. **Force the service to use the new task definition:**
   ```bash
   cd infra/workers
   npm run restart:dev   # or restart:prod
   ```
   This runs `--force-new-deployment` for send-worker, scheduler, and inbox-checker.

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



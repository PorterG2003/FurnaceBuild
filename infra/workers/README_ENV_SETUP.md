# Environment Variables Setup

Canonical reference for **SSM vs Amplify**: [../../docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md](../../docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md).

## One-Time Setup

1. **Create `.env.local` file:**
   ```bash
   cd infra/workers
   cp .env.example .env.local
   ```

2. **Edit `.env.local` with your values:**
   - Open `infra/workers/.env.local` in your editor
   - Replace placeholder Supabase branch URLs:
     - Get dev URL: Supabase Dashboard → Switch to `dev` branch → Settings → API
     - Get prod URL: Supabase Dashboard → Switch to `main` branch → Settings → API
   - Set **`DEV_SECRET_SSM_PREFIX`** and **`PROD_SECRET_SSM_PREFIX`** to the **parent folder** in Parameter Store (no `/SUPABASE_SECRET_KEY` on the end). CDK appends `/SUPABASE_SECRET_KEY` and `/LEADS_SUPABASE_SECRET_KEY` automatically. See the doc linked above.

3. **Store the Supabase Secret Key in AWS Parameter Store** (if not already present from Amplify):
   ```bash
   cd infra/workers
   npm run set-secret:dev    # writes {DEV_SECRET_SSM_PREFIX}/SUPABASE_SECRET_KEY
   npm run set-secret:prod   # writes {PROD_SECRET_SSM_PREFIX}/SUPABASE_SECRET_KEY when ready
   ```
   - Use the **Secret Key** from Supabase Dashboard → Settings → API (not the Publishable Key).
   - Override path: `bash scripts/set-supabase-secret.sh --param /full/ssm/name dev`

4. **That's it!** All npm scripts automatically load these variables.

## How ECS Tasks Get Their Env Vars

The **send-worker** (and scheduler / inbox-checker workers) need:

| Env var | Set by | Description |
|--------|--------|-------------|
| `SUPABASE_URL` | CDK deploy | Supabase project URL (from `DEV_SUPABASE_URL` / `PROD_SUPABASE_URL` in `.env.local`) |
| `SUPABASE_SECRET_KEY_PARAM_PATH` | CDK deploy | Full SSM name `{prefix}/SUPABASE_SECRET_KEY` baked in at synth from **`DEV_SECRET_SSM_PREFIX`** / **`PROD_SECRET_SSM_PREFIX`** |
| `AWS_REGION` | CDK deploy | e.g. `us-west-2` |
| `DEV_SLACK_ERROR_WEBHOOK_URL` / `PROD_SLACK_ERROR_WEBHOOK_URL` | CDK deploy (optional) | When set in `.env.local`, errors from workers are posted to Slack. Use **both** for different channels: dev workers (`deploy:dev`) use `DEV_`, prod workers (`deploy:prod`) use `PROD_`. Fallback: `SLACK_ERROR_WEBHOOK_URL` is used for both if the env-specific one is not set. |

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
2. **Ensure the secret exists** at **`{prefix}/SUPABASE_SECRET_KEY`** for that stack’s prefix.
3. **Force the service to use the new task definition:**
   ```bash
   cd infra/workers
   npm run restart:dev   # or restart:prod
   ```
   This runs `--force-new-deployment` for send-worker, scheduler, and inbox-checker.

## How It Works

- All npm scripts (`npm run deploy:dev`, etc.) automatically source `.env.local` via `load-env.sh`
- `.env.local` is git-ignored (won't be committed)

## Manual Setup (Alternative)

If you prefer to export manually each session:

```bash
export CDK_DEFAULT_ACCOUNT=686255981838
export CDK_DEFAULT_REGION=us-west-2
export DEV_SUPABASE_URL=https://your-dev-url.supabase.co
export PROD_SUPABASE_URL=https://your-prod-url.supabase.co
export DEV_SECRET_SSM_PREFIX=/amplify/furnacebuild/your-sandbox-id
export PROD_SECRET_SSM_PREFIX=/amplify/shared/your-prod-id
```

Using `.env.local` is easier.

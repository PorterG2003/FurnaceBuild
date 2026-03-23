# Security and access

## Server-side auth only (registry data)

The **Expo client** must not receive the leads/registry **service role** key or use the leads Supabase URL as `EXPO_PUBLIC_*` for general access. Registry reads and writes go through **trusted backends** (Lambda, workers, scripts) that hold secrets.

See [SUPABASE_LEADS.md](../../infrastructure/SUPABASE_LEADS.md) for env vars: `LEADS_SUPABASE_URL`, `LEADS_SUPABASE_SECRET_KEY`.

## No Supabase Auth dependency in the registry project

The registry database does not authenticate end users directly. **`user_access_flags`** for Foundry lives in the **main** app database and is checked before the Lambda touches the registry ([`amplify/functions/foundryRegistryApi/handler.ts`](../../../amplify/functions/foundryRegistryApi/handler.ts)).

## Service role usage

Backend code creates a Supabase client with the **secret / service role** key for `supabase-leads`. That role **bypasses RLS**, so treat it like root access to company intel: only in server environments, never in bundles sent to devices.

## Why the client does not query core tables directly

Even with RLS, exposing PostgREST to anonymous or broad JWT roles increases attack surface. Migrations **revoke** privileges from `anon` and `authenticated` on registry tables and use **`security_invoker`** views so accidental grants do not bypass RLS ([`20260324100000_registry_views_checks_grants.sql`](../../../supabase-leads/supabase/migrations/20260324100000_registry_views_checks_grants.sql)).

## RLS as secondary layer

RLS is **enabled** on registry tables with **no policies** for standard roles—default deny for anon/authenticated via PostgREST. Defense in depth: if someone misconfigures grants, RLS still blocks unless service role is used.

## Foundry UI gate (main database)

Routes under `/foundry/*` check **`user_access_flags`** (`flag_key = 'foundry'`) using the normal app Supabase client (main project). Unauthorized users see a generic not-found screen ([`app/(foundry)/README.md`](../../../app/(foundry)/README.md)).

## Lambda pattern today

1. Client calls **Function URL** with `Authorization: Bearer <main_supabase_access_token>`.
2. Lambda verifies JWT via **main** `SUPABASE_URL` + **`SUPABASE_SECRET_KEY`** (service) `auth.getUser`.
3. Lambda queries **`user_access_flags`** on the **main** project for `foundry`.
4. Lambda uses **`LEADS_SUPABASE_SECRET_KEY`** to read registry data (e.g. `GET /companies`).

## Secret handling expectations

- Store keys in Amplify **secrets** / CI env, not in git.
- Rotate if leaked; audit logs for Lambda invocations in CloudWatch.

## Related

- [../architecture/system-architecture.md](../architecture/system-architecture.md)

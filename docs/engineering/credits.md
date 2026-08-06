# Account credits

Canonical reference for the generic, account-scoped credit system in Furnace: a reusable
metering primitive for any feature that needs a monthly per-account allowance (Apollo
enrichment is the first meter).

See also: [test-convention.md](./test-convention.md).

## Scope

This standard applies to:

- `supabase/migrations/*_credits_system.sql` (and any future meter migrations)
- `lib/credits/`
- `amplify/functions/apolloEnrich/` (first consumer)
- `lib/test/credits/`

Use this system instead of building a bespoke counter/limiter for any new metered feature.

## Why a ledger (not a counter)

Balances are derived from an append-only, signed-delta ledger rather than a stored
`used`/`remaining` counter. This gives:

- A full audit trail (who consumed what, when, why, for which reference).
- Correct refunds and bonus grants as ordinary positive rows.
- No cron and no reset job — the period boundary is a query predicate.
- Easy extension to new meters with no new tables.

## Data model

### `credit_ledger` (append-only)

One row per credit event.

| column        | meaning                                                            |
| ------------- | ----------------------------------------------------------------- |
| `account_id`  | owning account                                                    |
| `meter`       | meter key, e.g. `apollo_enrichment`                              |
| `delta`       | `< 0` consume, `> 0` grant/refund, `0` audit-only (no charge)     |
| `reason`      | short machine reason, e.g. `apollo_person_match`, `apollo_no_match` |
| `ref_type` / `ref_id` | what the event refers to, e.g. `global_lead` / the global lead id |
| `created_by`  | acting user (nullable; null for system)                           |
| `metadata`    | freeform JSON (e.g. accepted field keys)                          |
| `created_at`  | event time (drives the period window)                            |

### `credit_entitlements` (allowance)

Defines the monthly grant per meter.

- `account_id IS NULL` → global default for the meter.
- `account_id = <uuid>` → per-account override.
- Resolution: per-account override **else** global default **else** `0`.
- Partial unique indexes enforce one global row per meter and one override per `(meter, account)`.

## Balance math

For the current period:

```
limit     = resolve_entitlement(account, meter)        -- override else global default
net       = SUM(delta) WHERE created_at in [period_start, period_end)
remaining = limit + net                                 -- net is negative when consumed
used      = limit - remaining
```

The entitlement is the implicit grant; consumption (`−`) and refunds (`+`) are summed on top.

## Period & reset semantics

- The period is the **MST (America/Denver) calendar month**, matching platform billing.
- `period_start = date_trunc('month', now() AT TIME ZONE 'America/Denver')` converted back to an
  instant; `period_end = period_start + interval '1 month'`.
- Summation uses an explicit half-open range `created_at >= period_start AND created_at < period_end`
  (not `date_trunc` equality) to avoid month-boundary leaks.
- Reset is **hard**: deltas from prior periods are simply outside the window.
- **Rollover** (if ever needed) is additive without migration: write explicit positive grant rows per
  period and sum all-time instead of windowing. The ledger shape already supports it.

## RPCs (all `SECURITY DEFINER`)

- `get_credit_balance(p_account_id, p_meter) → { used, remaining, credit_limit }`
  - Authenticated callers must belong to the account; service role (no JWT) bypasses the check.
  - Granted to `authenticated` and `service_role`.
- `consume_credit(p_account_id, p_meter, p_amount = 1, p_reason, p_ref_type, p_ref_id, p_created_by, p_metadata) → balance`
  - Takes a transaction advisory lock on `hashtext(account_id || ':' || meter)` so concurrent
    consumes can't exceed the limit.
  - Raises `INSUFFICIENT_CREDITS` (errcode `P0001`) when `remaining < p_amount`.
  - `p_amount = 0` writes an **audit-only** row (e.g. an Apollo no-match) that never affects the balance.
  - **Service role only.**
- `grant_credit(p_account_id, p_meter, p_amount, ...) → balance`
  - Positive-delta row for refunds / manual bonuses. **Service role only.**

## Security model

- RLS: clients get **SELECT only** on `credit_ledger` (own accounts) and `credit_entitlements`
  (own accounts + global defaults). There are no client INSERT/UPDATE/DELETE policies.
- All mutations go through the `SECURITY DEFINER` RPCs (service role) — never direct client writes.
- `consume_credit` / `grant_credit` are not granted to `authenticated`; only the server (Lambda /
  service role) may charge or grant.

## How to add a new meter

1. Add a stable key to `CREDIT_METERS` in `lib/credits/meters.ts` (and a `DEFAULT_MONTHLY_GRANTS` entry).
2. Seed a global default in a migration:

```sql
INSERT INTO credit_entitlements (meter, account_id, monthly_grant)
SELECT 'my_new_meter', NULL, 50
WHERE NOT EXISTS (
  SELECT 1 FROM credit_entitlements WHERE meter = 'my_new_meter' AND account_id IS NULL
);
```

3. On the server (a Lambda or service-role path), call `consume_credit(account, 'my_new_meter', 1, ...)`
   when the metered action succeeds, and catch `INSUFFICIENT_CREDITS`. Use `p_amount = 0` to audit
   non-charging outcomes.
4. In the UI, read the balance with `getCreditBalance(accountId, CREDIT_METERS.myNewMeter)`.
5. Add RPC outcome coverage under `lib/test/credits/`.

No new tables are required.

## Worked example: Lead enrichment (Apollo + Prospeo waterfall)

- Meter: `apollo_enrichment`, global default **100/month** (name retained; meters both providers).
- The `apolloEnrich` Lambda (single Function URL, two routes) verifies JWT + account membership on `POST /`, loads the lead's email/LinkedIn (plus name/company when present) by `(account_id, global_lead_id)`, pre-checks `get_credit_balance`, then runs the enrichment waterfall (`lib/apollo/enrichmentWaterfall.ts`).
- **Apollo profile primary:** calls Apollo `/people/match` without phone reveal first.
- **Prospeo-first phone:** on Apollo person match, calls Prospeo `POST /enrich-person` with `enrich_mobile` + `only_verified_mobile`. If Prospeo returns a verified mobile, the session completes with `phone_source=prospeo` (no Apollo phone spend).
- **Apollo phone fallback:** if Prospeo has no verified mobile, a second Apollo call requests `reveal_phone_number=true` with a per-session webhook at `POST /sessions/{sessionId}`.
- **Prospeo full fallback:** on Apollo upstream error / credit failure or Apollo `no_match`, calls Prospeo full enrich (`enrich_mobile`, not `only_verified_mobile`) for profile + phone.
- **Session state** lives in `apollo_enrichment_sessions` (separate from the credit ledger), with optional `profile_source` / `phone_source` (`apollo` | `prospeo`).
- **Credits (at most one billed unit per enrich click):**
  - Apollo person match → `consume_credit(..., 1, reason='apollo_person_match')`.
  - Prospeo full match after Apollo miss/error → `1` with `reason='prospeo_person_match'`.
  - Prospeo phone fill after Apollo already charged → `0` audit with `reason='prospeo_phone'`.
  - Prospeo phone miss before Apollo reveal → `0` audit with `reason='prospeo_phone_miss'`.
  - Apollo webhook empty / reveal failure → `0` audit with `reason='apollo_phone_miss'`.
  - Terminal no-match / provider errors → `0` audit rows.
- **Async phones:** only when Prospeo miss; Apollo mobiles arrive via webhook. Session statuses: `pending_phone | complete | no_phone | no_match | failed | expired`.
- **Re-enrich guard:** a partial unique index on `(account_id, global_lead_id) WHERE status = 'pending_phone'` blocks concurrent enrichments. Before insert, stale rows are actively expired (`status = 'expired' WHERE expires_at <= now()`) so the index cannot wedge. Resume re-opens the stored `sync_suggestion` without a second provider call or credit.
- The UI (`components/leads/detail/EnrichLeadScreen.tsx`) shows a per-field accept/override comparison; desktop uses an inbox-style side panel (`EnrichLeadPanel`).
- Secrets: `APOLLO_API_KEY`, `PROSPEO_API_KEY` (Amplify sandbox / pipeline).
## Tests

- `lib/test/credits/creditRpcOutcomes.test.ts`: default allowance, consume, audit-only, refund,
  per-account override, `INSUFFICIENT_CREDITS`, MST period boundary, and concurrent-consume safety.
- `lib/apollo/enrichmentWaterfall.test.ts`: Apollo profile + Prospeo-first phone decision matrix
  (status, sources, `phonePending`, credit amount/reason) with mocked providers.
- `lib/prospeo/*.test.ts`: Prospeo client + profile mapping.
- Run with the standard outcome-test env (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` /
  `SUPABASE_SECRET_KEY`); the migration must be applied to the target database first.

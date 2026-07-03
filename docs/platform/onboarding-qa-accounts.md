# Onboarding QA accounts

Dev-only accounts for manually testing onboarding flows across segments and roles.

## Create / refresh accounts

```bash
npx tsx scripts/onboarding/create-qa-accounts.ts --reset-onboarding
```

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

## Credentials

| Persona | Email | Role |
|---|---|---|
| Self-serve owner | `onboarding-qa-self-serve-owner@furnace.test` | owner |
| Self-serve member | `onboarding-qa-self-serve-member@furnace.test` | member |
| DFY owner | `onboarding-qa-dfy-owner@furnace.test` | owner |
| DFY member | `onboarding-qa-dfy-member@furnace.test` | member |

**Account IDs (dev):**

| Persona | `account_id` |
|---|---|
| Self-serve | `830bf1ed-ac3a-44cb-be83-248bb6d3398c` |
| DFY | `4c6edc48-82e6-41f7-ba42-82283ab5df0f` |

**DFY owner user id:** `f14f4211-5c72-48e4-903c-c70af95d52c1` (for `SEED_OWNER_USER_ID`)

**Password (all):** `OnboardingQA!2026Aa`

**App URL:** http://localhost:8081

## Test matrix

For each persona, verify:

1. **Welcome** auto-starts on first login (empty `user_onboarding_state`)
2. **Feature tours** fire on first visit to each route
3. **Replay** via Help → "Replay product tours"
4. **Desktop + mobile** viewport (NavBar vs BottomNavBar for welcome)

| Flow | Route | Segments |
|---|---|---|
| welcome | autoStart | self-serve, DFY |
| inbox | `/inbox` | self-serve, DFY |
| metrics | `/metrics` | self-serve, DFY |
| leads | `/leads` | self-serve, DFY |
| account | `/account` | self-serve, DFY |
| notifications | `/notifications` | self-serve, DFY |
| senders | `/senders` | self-serve, DFY |
| campaigns | `/campaigns` | self-serve (action copy), DFY (single "Furnace builds these" step) |
| campaigns-detail | `/campaigns` (campaign exists) | self-serve only |
| builder | `/builder?campaignId=<id>` | self-serve only |
| mission-control | `/campaigns/<id>/mission-control` | self-serve only |
| mission-control-running | `/campaigns/<id>/mission-control` (running) | self-serve only |

**DFY should NOT see any tour** on `campaigns-detail`, `builder`, or `mission-control` — Furnace's team manages campaigns for DFY clients, so those flows have no `dfy` entry in the registry and never fire for that segment, regardless of how many campaigns exist. Verifying this absence on the DFY account is as important as verifying presence on self-serve.

## Reset onboarding state

**All flows for current user:** Help → Replay product tours

**SQL (single user):**

```sql
DELETE FROM user_onboarding_state WHERE user_id = '<users.id>';
```

**Script (all QA users):**

```bash
npx tsx scripts/onboarding/create-qa-accounts.ts --reset-onboarding
```

## Seed data for campaigns-detail / mission-control / builder

Run demo-hub seed on the **self-serve** account to get a real campaign row for the `campaigns-detail`, `mission-control`, and `builder` tours (all self-serve only):

```bash
# Use account_id + owner user_id printed by create-qa-accounts.ts
SEED_ACCOUNT_ID=<self-serve-account-id> \
SEED_OWNER_USER_ID=<self-serve-owner-user-id> \
npm run seed:demo
```

Then open `/campaigns` and pick any campaign for `campaigns-detail`, mission-control, and builder tours.

Also seed the **DFY** account the same way and confirm the *opposite*: with a real, even a running, campaign present, `campaigns-detail`, `mission-control`, and `mission-control-running` still never fire — only the single `campaigns` list spotlight does.

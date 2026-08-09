# Test Convention

This repo uses a **domain-first, outcome-first** testing convention designed to be easy for humans and AI agents to follow.

## Three test layers

### 1. Unit tests

Use unit tests for deterministic logic:

- parsers
- predicates
- transforms
- merge logic
- scheduling math

Rules:

- no database
- no network
- keep them fast
- colocate them near the implementation when they are narrow and module-local

Examples:

- `lib/inbox/outOfOfficeSchedule.test.ts`
- `lib/inbox/outOfOfficeResumeRules.test.ts`
- many files under `lib/flux/`

### 2. Domain integration tests

Use domain integration tests to prove real business outcomes across:

- DB rows
- RPC behavior
- worker decisions
- multi-table state transitions

Rules:

- use a domain harness
- assert final state and eligibility semantics
- namespace every DB-backed run
- clean up by exact created ids first, namespace lookup second
- group these tests by domain, not package implementation detail

Current campaign integration home:

- `lib/test/campaign/`

### 3. Scenario / QA seeds

Use scenario seeds for:

- manual QA
- demos
- edge-case reproduction
- production-like slices

Rules:

- keep them under `scripts/seed/`
- broad enough for humans
- not the default dependency for automated tests

## Naming rules

### Test file names

- Colocated unit tests stay as `<module>.test.ts`
- Domain integration tests use explicit outcome-oriented names:
  - `oooOutcomes.test.ts`
  - `waitTimeOutcomes.test.ts`
  - `schedulerOutcomes.test.ts`

Avoid:

- `misc.test.ts`
- `helpers.test.ts`
- `campaignEverything.test.ts`

### Helper and harness names

Prefer explicit names:

- `CampaignDbHarness`
- `createCampaignGraph()`
- `cleanupCampaignGraphManifest()`
- `buildProductionLikeSeedSpecs()`

Avoid generic names:

- `setupStuff()`
- `makeData()`
- `seedThing()`

### Test names

Name tests after the behavior or business outcome they protect.

Good:

- `OOO due processing resumes only due threads and leaves future rows untouched`
- `wait-time handling updates a real enrollment row to the expected next_run_at outcome`

Bad:

- `calls helper correctly`
- `returns true for branch A`

## Location rules

### Keep colocated unit tests

Leave narrow implementation-local tests next to the code:

- `lib/inbox/*.test.ts`
- `lib/flux/*.test.ts`
- `workers/scheduler-worker/src/*.test.ts` when the test is about worker-local logic

### Put reusable domain support under `lib/test/<domain>/`

This is the canonical home for shared test support and outcome-level integration tests.

Current campaign structure:

- `lib/test/campaign/harness.ts`
- `lib/test/campaign/fixtures.ts`
- `lib/test/campaign/productionLikeSeed.ts`
- `lib/test/campaign/productionLikeSeed.test.ts`
- `lib/test/campaign/oooOutcomes.test.ts`
- `lib/test/campaign/waitTimeOutcomes.test.ts`
- `lib/test/campaign/schedulerOutcomes.test.ts`

Only create additional `lib/test/<domain>/` folders when a domain truly needs shared support or DB-backed integration tests.

### Put internal manual harnesses under `lib/devtools/`

Use `lib/devtools/` for code that powers internal `/test/*` pages, manual harnesses, or operator-facing validation flows that are not part of the canonical automated test layout.

Current examples:

- `lib/devtools/campaign-flow/`
- `lib/devtools/email-variants-harness/`

### Keep seed scenarios under `scripts/seed/`

- `lib/test/` = automated test support
- `lib/devtools/` = internal manual harnesses and `/test/*` page support
- `scripts/seed/` = manual QA and demo state generation

## Root command convention

Use repo-root commands first.

Current root command surface:

- `npm run test:campaign:unit`
- `npm run test:campaign:fixtures` (compatibility alias)
- `npm run test:campaign:integration`
- `npm run test:campaign:worker`
- `npm run test:campaign`
- `npm run test:threading` (unit + workers + DB integration + browser/composer; required PR gate)
- `npm run test:threading:unit`
- `npm run test:threading:integration`
- `npm run test:threading:browser`
- `npm run test:threading:workers`
- `npm run test:categorizer:live` (explicit OpenRouter spend; not in default unit gates)
- `npm run test:flux`
- `npm run test:foundry`
- `npm run test:utilities`
- `npm run test:send-worker`
- `npm run test:inbox-checker`
- `npm run test:workers`
- `npm run test:scrapers`
- `npm run test:core`
- `npm run test:seed:smoke`

Guideline:

- add root commands by domain
- prefer domain commands over package-only discovery
- `test:core` should cover business-critical domains first, not necessarily every test in the repo
- email threading contract: `docs/engineering/email-threading-test-contract.md`
- new `*Threading*.test.ts` / `*ThreadSubject*.test.ts` files must be registered in `test:threading*` (enforced by `test:threading:registration`)

## Repo inventory and final disposition

The current repo is standardized with these explicit dispositions:

| Area | Disposition | Canonical expectation | Root command |
| --- | --- | --- | --- |
| `lib/test/campaign/` | `keep` | shared campaign harnesses and outcome-first DB-backed integration tests live here | `npm run test:campaign:integration` |
| `workers/scheduler-worker/src/` | `split` | worker-local mock/unit tests stay here; campaign outcomes belong in `lib/test/campaign/` | `npm run test:campaign:worker` |
| `lib/inbox/` | `split` | pure inbox predicates/parsers stay colocated; cross-row campaign outcomes belong in `lib/test/campaign/` | `npm run test:campaign:unit` |
| `lib/flux/` | `keep` | colocated unit tests remain next to implementation | `npm run test:flux` |
| `lib/foundry/` and `lib/foundry/registry-server/` | `keep` | colocated unit tests remain in place | `npm run test:foundry` |
| `lib/email/`, `lib/slack/`, `lib/account/` | `keep` | small utility suites remain colocated and are grouped by a root utility command | `npm run test:utilities` |
| `workers/send-worker/src/` | `keep` | worker-local tests stay with the worker package | `npm run test:send-worker` |
| `workers/inbox-checker-worker/src/` | `keep` | worker-local tests stay with the worker package | `npm run test:inbox-checker` |
| `workers/state-scrapers/` | `keep` | scraper tests stay colocated within each scraper package | `npm run test:scrapers` |
| `scripts/seed/` | `keep` | scenario smoke checks and seed-contract tests stay with the seed system | `npm run test:seed:smoke` |
| `lib/devtools/` | `rename` | internal manual harnesses and `/test/*` page support live here, not under `lib/test/` | no canonical automated command |

Move/split rule for future domains:

- if a file is pure logic, parser, formatting, predicate, or worker-local behavior, keep it colocated
- if a file asserts DB rows, RPC effects, worker-driven state transitions, or multi-table outcomes, move it into `lib/test/<domain>/`
- if a domain gains shared setup, namespaced DB ownership, or cross-worker state assertions, create `lib/test/<domain>/` instead of inventing another ad hoc home

## Non-negotiable rules

### Outcome-first

Primary integration tests must prove final row state or business outcome.

For OOO and scheduler behavior, tests should assert:

- final enrollment state
- `next_run_at`
- thread OOO markers
- whether future campaign work was rescheduled or left untouched

### DB namespacing

Every DB-backed test run must:

- get a unique namespace
- create recoverable ownership markers
- clean up using exact created ids first
- avoid account-wide deletes

### One obvious home per domain

New tests should be placeable by domain alone without broad repo exploration.

Bulk/async features (workbench, Client API jobs, sync shortcuts) must follow [bulk-operations-standards.md](./bulk-operations-standards.md): RPC outcome tests first, then Client API HTTP outcomes for auth/limits/contract gaps, plus worker tests for async completion webhooks.

## Cursor guidance

This convention is also surfaced in:

- `.cursor/rules/test-convention.mdc`
- `.cursor/skills/test-convention-migration/SKILL.md`

Use the rule for always-on standards.
Use the skill when actively migrating tests into the new structure.

---
name: test-convention-migration
description: Migrate or add tests using the repo-wide test convention. Use when reorganizing tests, deciding where a test belongs, splitting unit and DB-backed outcome tests, or updating root test commands.
disable-model-invocation: true
---

# Test Convention Migration

## Quick start

When migrating or adding tests:

1. Classify the test as one of:
   - colocated **unit**
   - domain **integration**
   - **scenario seed**
2. Put the test in the canonical location:
   - narrow logic stays near implementation
   - reusable harnesses and DB-backed outcome tests go under `lib/test/<domain>/`
   - internal `/test/*` page support and manual harnesses go under `lib/devtools/`
   - manual QA/demo scenarios stay in `scripts/seed/`
3. Name files and tests by behavior or outcome, not by helper internals.
4. If the test touches a shared DB, require:
   - a unique namespace
   - recoverable ownership markers
   - exact-id cleanup first
5. Update root commands when a domain’s test surface changes.

## Migration rules

### Standard repo dispositions

- `lib/test/campaign/`: campaign outcome integration and shared harness support
- `workers/scheduler-worker/src/`: worker-local unit tests only; move campaign outcomes to `lib/test/campaign/`
- `lib/inbox/`: keep pure logic colocated; move DB/RPC campaign outcomes to `lib/test/campaign/`
- `lib/flux/`: keep colocated unit tests
- `lib/foundry/` and `lib/foundry/registry-server/`: keep colocated unit tests
- `workers/state-scrapers/`: keep scraper tests colocated in each scraper package
- `workers/send-worker/src/` and `workers/inbox-checker-worker/src/`: keep worker-local tests colocated
- `lib/email/`, `lib/slack/`, `lib/account/`: keep colocated utility tests
- `lib/devtools/`: manual harness and `/test/*` page support only
- `scripts/seed/`: scenario smoke checks and seed-contract tests

## File naming

- Colocated unit tests: `<module>.test.ts`
- Domain integration tests: explicit names like:
  - `oooOutcomes.test.ts`
  - `waitTimeOutcomes.test.ts`
  - `schedulerOutcomes.test.ts`

Avoid generic names like `misc.test.ts`, `helpers.test.ts`, or `campaignEverything.test.ts`.

## Root commands

Prefer repo-root commands:

- `npm run test:campaign:unit`
- `npm run test:campaign`
- `npm run test:flux`
- `npm run test:foundry`
- `npm run test:utilities`
- `npm run test:workers`
- `npm run test:scrapers`
- `npm run test:core`
- `npm run test:seed:smoke`

## Reference

For the full repo convention, naming rules, location rules, and migration boundaries, read:

- `docs/engineering/test-convention.md`

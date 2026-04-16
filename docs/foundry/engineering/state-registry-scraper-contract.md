# State registry scraper contract

Shared rules for **new state scrapers** so parsers and persistence stay correct as we add more portals. Site HTML will differ; this document is the **production behavioral contract** (registry-server + reconciliation paths). **CSV / JSONL compare scripts** in worker packages are **local testing and baseline accuracy only**—they are not shipped as product logic and must never be treated as the source of truth for who becomes an `entity_owner`.

## Layers (do not blur them)

| Layer | Responsibility | Where it lives |
|--------|----------------|----------------|
| **Search** | Query → list of hits; pick best hit or mark ambiguous | `{state}/` parsers + pick helpers |
| **Detail parse** | HTML → structured **facts** from the SOS page (every row/field we can reliably read) | `{state}/parse*.ts`, `{state}/types.ts` |
| **`raw_parsed` on `state_entities`** | Store the **full** detail object (or a stable subset): principals, officers, RA name, addresses, status, etc. No “policy” filtering here—downstream jobs and humans need the truth of record. | `persist{State}RegistryPull` → `upsertStateEntityCurrent` |
| **`ownerRowsFor{State}Detail`** | Map parsed detail → **`PersistEntityOwnerInput[]`** for `replaceCurrentEntityOwners`. **All business rules** for who counts as an “owner row” live here (officers vs RA, law-firm drops, dedupe). | `state-persistence/persist{State}Registry.ts` (exported helper next to persist) |
| **Snapshot** | Immutable HTML sample + metadata for audits | `registry_source_snapshots` |

If two states share the same RA-vs-officer policy, extract **one shared helper** under `registry-server/scrapers/` or `{state}/` and call it from each `ownerRowsFor*`—do not copy-paste diverging heuristics.

## Constants and versioning

- **`{STATE}_SOURCE_TYPE`**: stable string stored on snapshots (e.g. `iowa_sos_business_entities`).
- **`{STATE}_PARSER_VERSION`**: bump when **parsed shape** or **semantic mapping** changes in a way that affects `raw_parsed` or owners, so reconciliation and replays can branch on version.

## `entity_owners` rows (`PersistEntityOwnerInput`)

- **`ownerName`**: string as shown on the registry (trimmed); use a single display convention per state file.
- **`titleRole`**: use the **site’s label** when the portal exposes one. When the portal leaves the role blank, use a **clear default** such as **`Officer`**, **`Authorized person`**, or **`Registered Agent`** (never an empty string).
- **Order**: preserve a **deterministic** order (usually table order) for rows written to the database.

## Registered agent vs principals (default policy)

Sites mix **governance contacts** (RA, filing service) with **economic control** (members, managers, officers). **Product default:**

1. **Principals first:** officers / members / managers / authorized persons (whatever the portal exposes) become `entity_owners` with **`titleRole`** from the site, or a **default label** (`Officer`, `Authorized person`, etc.) when the site leaves the title blank.
2. **RA on the record:** always persist the registered agent string on **`raw_parsed`** (`registered_agent_name` or equivalent) whenever the parse captures it.
3. **RA as `entity_owner` (fallback only):** add at most **one** RA row **only when there are no primary principal rows** from the portal’s officer/member/manager lists. The RA name must pass **`eligibleIndividualRegisteredAgentName`** in `scrapers/registeredAgentPerson.ts` (person-like; rejects obvious companies, statutory filing shops, and law-firm style names). **`titleRole`** for that row is **`Registered Agent`**.
4. **Utah nuance:** there is often no separate RA field; a “Registered Agent” row may appear in the principals table. If the entity has any member/manager/authorized-person row, **drop** registered-agent principal rows (RA is not mixed in alongside real principals). If only RA-style rows remain, keep a row only when **`eligibleIndividualRegisteredAgentName`** passes.

### RA policy — implemented states (source of truth: JSDoc on each `ownerRowsFor*`)

| State | `raw_parsed` RA | RA as `entity_owner`? |
|-------|-----------------|------------------------|
| **FL** | `registered_agent_name` + full `people[]` | **Fallback only** when `people` has no officers/authorized persons; person check via `eligibleIndividualRegisteredAgentName`. See `florida/floridaOwnerRows.ts`. |
| **IA** | `registered_agent_name` | **Fallback only** when the officer grid is empty; same person check. See `iowa/ownerRowsForIowaDetail.ts`. |
| **UT** | Principals only (no separate RA field) | RA-titled principal rows follow rule (4) above. See `persistUtahRegistry.ts` `ownerRowsForUtahDetail`. |

When adding a state, extend this table and duplicate the detail in a short JSDoc on `ownerRowsFor{State}Detail` so drift between “contract prose” and code is obvious in review.

## Law firms and filing shops

When the portal marks a party as RA or “agent” and the name is clearly a **law firm or statutory filing company**, **exclude** them from owner rows used for contact enrichment, unless the state provides **no** principals and product explicitly wants RA fallback (then one shared rule applies).

## Snapshots and payload size

- Truncate stored HTML with the same **character cap** pattern as existing `persist*Registry` files.
- **`response_payload`** on the snapshot: lightweight metadata (entity id, counts, sample flags)—not a second copy of the full parse (the parse belongs in `state_entities.raw_parsed` via the upsert path you already use).

## Tests and fixtures

- Capture **HTML fixtures** under `lib/foundry/registry-server/fixtures/` (see [`fixtures/README.md`](../../../lib/foundry/registry-server/fixtures/README.md)).
- **Unit-test parsers** on fixtures: search results, detail, and any sub-pages.
- **Unit-test `ownerRowsFor*`** with constructed `*EntityDetailParsed` objects so RA / law-firm / dedupe rules do not regress.

## Offline compare (CSV / JSONL) — **testing only**

Scripts under `workers/state-scrapers/{state}-scraper/` (e.g. `run-csv-compare.ts`) exist to **estimate parser accuracy** against a labeled CSV (e.g. Apify “people”). They are **not production**, are **not** invoked by the Foundry API or reconciliation Lambdas, and **must not** drive `entity_owners` policy.

- **OK to differ from `ownerRowsFor*`**: a compare script may include extra names (e.g. always append registered agent) to see whether Apify contacts line up with **any** registry role. That is a **baseline / recall** choice, not a persistence contract.
- **Document the metric**: each compare script’s header comment or README should state **exactly** which names are fed into `compareToExpectedPerson` / `compareToTesterRow` so results stay interpretable across runs.
- **Production stays in registry-server**: `ownerRowsFor{State}Detail`, `persist{State}RegistryPull`, and unit tests on fixtures define what we **store**; compare output is optional telemetry for humans and CI experiments.

## Operational concerns (scraper worker)

- **Rate limits / captcha**: dedicated module (detection + backoff + retries); do not overload parser tests with live network assumptions.
- **Headed vs headless**: document per state in that worker’s `README.md`; keep Playwright version aligned with Docker base image (see [State scraper ECS playbook](./state-scraper-ecs-playbook.md)).

## Checklist before merging a new state

- [ ] `{state}/types.ts` detail type covers all fields we need for `raw_parsed`.
- [ ] `ownerRowsFor{State}Detail` documented if it differs from default RA policy.
- [ ] `SOURCE_TYPE` + `PARSER_VERSION` defined; snapshot insert uses them.
- [ ] Fixture-backed parser tests + at least one `ownerRowsFor*` test.
- [ ] If the state has a CSV compare script: document what name list it uses (may differ from `ownerRowsFor*` on purpose); do not wire compare into API or persistence.

# eXp Realty Agents

Scrape public eXp agent directory listings for **US** and **CA** via the agents-search UI GraphQL API (`agentdir-api.expproptech.com`), using a local headful Chrome session for reCAPTCHA Enterprise tokens.

## Algorithm

1. Search each US state and Canadian province with the site's `location` argument.
2. Page each slice 100 agents at a time using deterministic `lastName` sorting.
3. Dedupe agents by `id`, checkpoint every page, and refuse poison/honeypot payloads.
4. On a timeout or suspicious payload, wait 5, 15, then 45 minutes, recycle Chrome, and require a known-good health probe before resuming.

This avoids the old prefix/name pipeline's roughly 70,000 captcha-gated calls. All
known state/province slices fit below Elasticsearch's 10,000-result window.

## Setup

```bash
cd scripts/lead-sourcing/exp-agents
npm install
npx playwright install chrome
```

## Quick start

```bash
# State-enumeration sample
npm run scrape -- \
  --country ca \
  --max-agents 30 \
  --run-dir output/runs/enumeration-sample

# Resume the default CA-then-US enumeration
npm run scrape -- --resume --country both --run-dir output/runs/us-ca-enumeration

# Start a terminal-independent supervised run
RATE_MS=15000 ./scripts/run-unattended.sh output/runs/us-ca-enumeration

# Verify a completed run
npm run verify -- output/runs/us-ca-enumeration

# Analyze a browser-captured localized roster for manager signals
npm run probe:managers -- \
  /absolute/path/to/cdp-roster-capture.json \
  output/runs/us-ca-enumeration \
  IL \
  https://il.exprealty.com

# Legacy prefix/name flow (diagnostics only)
npm run scrape -- --legacy-prefixes --country us --prefixes aa,ab \
  --max-suggestions 20 --max-agents 30 --run-dir output/runs/legacy-sample
```

## Flags

| Flag | Purpose |
|------|---------|
| `--country us\|ca\|both` | Country pass(es). Default `both` |
| `--run-dir` | Output directory |
| `--resume` | Resume checkpoints in `--run-dir` |
| `--legacy-prefixes` | Use the old prefix-then-full-name search flow |
| `--prefixes aa,ab` | Seed prefixes (default: all `aa`–`zz`) |
| `--max-suggestions N` | Cap harvested suggestion names |
| `--max-agents N` | Cap agents written to CSV |
| `--rate-ms` | Delay between calls (default 600) |
| `--headed` / `--headless` | Browser mode (default headed) |
| `--suggest-only` | Stop after suggestion harvest |

## Output

```text
output/runs/<run-id>/
  agents.csv
  enumeration_checkpoint.json
  enumeration_counts.json
  run_meta.json
  run_summary.json
  verification_report.json
  manager_probe_<state>_roster.json
  manager_probe_<state>_report.json
  manager_probe_<state>_candidates.csv
  console.log
  scraper.pid
```

### CSV columns

`id`, `first_name`, `last_name`, `email`, `phone`, `city`, `state`, `country`, `photo_url`, `bio`, `source_name_query`, `scraped_at`

## Agent-manager discovery

Localized eXp roster sites expose a public `/ajax/agent-roster.php` response with
`title`, `position_types`, full profile descriptions, profile ids, and contact
fields. These are stronger manager signals than the main directory bio, but each
localized roster covers only part of a state.

### Five-state pilot (CA, TX, FL, IL, WA)

```bash
# Seed hosts, capture rosters via headed Chrome, merge, classify, emit coverage
npm run managers -- \
  --phase pilot \
  --run-dir output/runs/us-ca-enumeration \
  --resume \
  --rate-ms 2000

# Resume capture only
npm run managers -- --phase pilot --resume --collect-only

# Re-merge existing captures (no browser)
npm run managers -- --phase pilot --merge-only

# After stratified manual review, record precision and re-evaluate the gate
npm run managers -- --phase pilot --merge-only --precision-pct 92
```

### National scale (blocked until quality gate passes)

```bash
npm run managers -- \
  --phase national \
  --run-dir output/runs/us-ca-enumeration \
  --resume \
  --precision-pct 92
```

Quality gates before national scale:

- High-confidence precision ≥ 90% (from stratified review of high-confidence rows)
- Matched master-list coverage ≥ 70% in every pilot jurisdiction

**Pilot result (us-ca-enumeration):** precision passed (100% on 212 pilot high-confidence
rows after classifier tightening), but coverage failed in all five pilot states
(CA 21.9%, TX 39.6%, FL 44.4%, IL 44.9%, WA 50.8%). Host discovery plateaued — match
quality is fine; discoverable PHP rosters simply do not contain ≥70% of master agents.
National scale is therefore **stopped**; see `manager_national_gate_stop.json`.

Classifier rules:

- High: designated managing broker / broker of record / broker-in-charge, explicit team
  owner/leader (structured title preferred), quantified agent-organization leadership
- Medium: unqualified managing/principal broker title
- Excluded alone: generic broker, bare “state broker” license labels, Realtor,
  mentor/coach, historical award language

### Manager outputs

```text
output/runs/<run-id>/
  roster_host_manifest.json
  roster_captures/<host>.json
  roster_capture_checkpoint.json
  agent_managers_high_confidence.csv
  agent_managers_review.csv
  agent_managers_review_sample.csv
  agent_managers_precision_review.json
  agent_manager_unmatched.csv
  manager_coverage_report.json
  manager_run_summary.json
  manager_national_gate_stop.json
```

`probe:managers` remains available for one-off analysis of a single browser-captured
roster JSON file.

## Broker expansion (lead-yield mode)

The census 70% gate blocked national *manager census* scale. Broker expansion is a
**separate** pipeline that optimizes for outreach volume: managers + brokers, with
tiers. It writes to a new run dir and does not overwrite the five-state pilot artifacts.

Tiers:

- **A** — explicit manager / team leader / designated broker
- **B** — possible manager (unqualified managing/principal broker)
- **C** — any other structured broker title
- **D** — bio-derived broker/manager candidate (weaker)

### Baseline from existing captures (offline)

```bash
npm run brokers:baseline -- \
  --run-dir output/runs/us-ca-broker-expansion \
  --source-run-dir output/runs/us-ca-enumeration
```

**Latest us-ca-broker-expansion result:** 4,424 unique leads
(A 850 / B 94 / C 2,785 / D 695) from 71 roster captures + bio pass +
CA/TX/FL licensing. Tiny alias hosts (`abor`/`ntreis`) are flagged in
`capture_integrity_report.json` and not trusted as regional coverage.
Licensing beyond CA/TX/FL is held pending name-match review
(`license_pilot_gate.json`).

### Discover / collect more first-party hosts

```bash
npm run brokers:discover -- --run-dir output/runs/us-ca-broker-expansion --resume
npm run brokers:collect -- --run-dir output/runs/us-ca-broker-expansion --resume --rate-ms 1500
npm run brokers -- --run-dir output/runs/us-ca-broker-expansion --merge-only --bio --resume
```

### CA/TX/FL licensing pilot

Download official bulk files locally, then:

```bash
npm run brokers -- \
  --run-dir output/runs/us-ca-broker-expansion \
  --merge-only --bio --licenses --resume \
  --ca-file /path/to/ca_dre.csv \
  --tx-file /path/to/tx_trec.csv \
  --fl-file /path/to/fl_dbpr.csv
```

Fixture dry-run:

```bash
npm run brokers -- \
  --run-dir output/runs/fixture-broker-licenses \
  --merge-only --no-bio --licenses \
  --master-csv output/runs/us-ca-enumeration/agents.csv \
  --capture-dir output/runs/us-ca-enumeration/roster_captures \
  --ca-file fixtures/licenses/ca_sample.csv \
  --tx-file fixtures/licenses/tx_sample.csv \
  --fl-file fixtures/licenses/fl_sample.csv
```

### Broker expansion outputs

```text
output/runs/us-ca-broker-expansion/
  exp_broker_manager_leads.csv
  exp_broker_manager_tier_a.csv
  exp_broker_manager_tier_b.csv
  exp_broker_manager_tier_c.csv
  exp_broker_manager_tier_d.csv
  exp_broker_manager_review.csv
  exp_broker_manager_unmatched.csv
  broker_expansion_summary.json
  broker_expansion_sources.json
  capture_integrity_report.json
  roster_discovery_report.json
  license_match_report.json
  license_match_ambiguous.csv
  license_pilot_gate.json
  license_identity_review_sample.json
```

## Tests

```bash
npm test
# from repo root:
npm run test:exp-agents
```

# Webinar outreach enrichment (pass 1)

One-off package: enrich [`webinar-outreach.csv`](../meta-webinar-ads/output/exports/webinar-outreach.csv)
into company + contact rows for cold email.

| Cohort | Provider | Notes |
|--------|----------|-------|
| LinkedIn | Prospeo | Named enrich, else company search → enrich. Email only (no mobile). |
| Meta | Apollo | Domain-gated org enrich + 1 ICP contact. Name-only / generic domains deferred. |

## Commands

```bash
cd scripts/lead-sourcing/webinar-outreach-enrich
npm install

# Split cohorts + print credit estimates (no spend)
npm run prep -- --run-id pass1

# Dry-run LinkedIn / Meta (no spend)
npm run enrich:linkedin -- --run-dir output/runs/pass1 --dry-run
npm run enrich:meta -- --run-dir output/runs/pass1 --dry-run

# Live only after explicit spend OK (script-spend gate)
npm run enrich:linkedin -- --run-dir output/runs/pass1 --live --max-rows 10 --max-prospeo-credits 120
npm run enrich:linkedin -- --run-dir output/runs/pass1 --live --max-prospeo-credits 120

npm run enrich:meta -- --run-dir output/runs/pass1 --live --max-rows 20 --max-apollo-org-calls 130 --max-enrichment-credits 120
npm run enrich:meta -- --run-dir output/runs/pass1 --live --max-apollo-org-calls 130 --max-enrichment-credits 120

npm run merge -- --run-dir output/runs/pass1
```

Outputs under `output/runs/<id>/`:

- `linkedin_enriched.csv` / `meta_enriched.csv`
- `enriched_leads.csv`
- `spend_tally.json`

Hard caps default: `--max-prospeo-credits 120`, `--max-apollo-org-calls 130`, `--max-enrichment-credits 120`.

## Pass 2 (waterfall on misses)

```bash
# Build miss manifests from pass1 outputs
npm run prep:pass2 -- --pass1-dir output/runs/pass1

# Dry-run each stage (no spend)
npm run pass2 -- --pass1-dir output/runs/pass1 --stage 2a --dry-run
npm run pass2 -- --pass1-dir output/runs/pass1 --stage 2b --dry-run
npm run pass2 -- --pass1-dir output/runs/pass1 --stage 2c --dry-run
npm run pass2 -- --pass1-dir output/runs/pass1 --stage 2d --dry-run

# Live only after spend OK
npm run pass2 -- --pass1-dir output/runs/pass1 --stage 2a --live --max-rows 15 --max-prospeo-credits 200
# … then 2b / 2c / 2d sample→full

npm run merge:pass2 -- --pass1-dir output/runs/pass1
```

Stages: **2A** named Prospeo → **2B** LinkedIn→Apollo → **2C** Meta gated→Prospeo → **2D** name-only Prospeo.
Caps: `--max-prospeo-credits 200`, `--max-apollo-org-calls 80`, `--max-enrichment-credits 80`.

## Pass 5 (manual LinkedIn URLs)

```bash
# Build dark worklist + interactive HTML
npm run pass5 -- --pass1-dir output/runs/pass1 --stage prep
open output/runs/pass1/pass5/manual_linkedin_worklist.html

# After exporting manual_linkedin_submissions.json into pass5/
npm run pass5 -- --pass1-dir output/runs/pass1 --stage enrich --dry-run
npm run pass5 -- --pass1-dir output/runs/pass1 --stage enrich --live --max-prospeo-credits 40
npm run pass5 -- --pass1-dir output/runs/pass1 --stage merge
```

Waterfall: Apollo `people/match` by LinkedIn URL → Prospeo enrich on miss.

## Pass 6 (ad-copy → domain → enrich)

```bash
npm run pass6 -- --pass1-dir output/runs/pass1 --stage prep
npm run pass6 -- --pass1-dir output/runs/pass1 --stage serper --dry-run
# Live after spend OK
npm run pass6 -- --pass1-dir output/runs/pass1 --stage serper --live
npm run pass6 -- --pass1-dir output/runs/pass1 --stage confirm --live
npm run pass6 -- --pass1-dir output/runs/pass1 --stage enrich --live --max-prospeo-credits 40
npm run pass6 -- --pass1-dir output/runs/pass1 --stage merge
```

Buckets: confirmed_no_email (manual LI), copy_domain, serper_retry, skip_generic.

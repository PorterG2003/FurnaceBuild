# Email from LinkedIn (Apollo)

Enrich a LinkedIn reactor scrape CSV with emails via Apollo.io. Reuses the webinar-hosts Apollo client (`people/match` + `bulk_match` email reveal), with a **name + headline** fallback because many scrapes only have LinkedIn member-ID URLs (`/in/ACo…`).

## Input

CSV columns:

| Column | Required |
|--------|----------|
| `reactor_profile_url` | yes |
| `reactor_name` | yes (for name fallback) |
| `reactor_headline` | optional (org/title hints) |
| `source`, `post_url`, `k12_role`, `reaction_type` | passthrough |

## Quick start

```bash
cd scripts/lead-sourcing/email-from-linkedin
cp .env.example .env   # set APOLLO_API_KEY, or rely on SSM
npm install

# Live run
npm run enrich -- --input src/ThinkingMaps-linkedinscrape-admin-principal.csv

# Resume after interrupt
npm run enrich -- --resume output/runs/<dir>

# Smoke (cap Apollo calls)
npm run enrich -- --input src/...csv --max-apollo-calls 50

# Zero-cost fixtures
USE_FIXTURES=1 npm run enrich -- --input fixtures/sample-reactors.csv --fixtures

# Retry matched_no_email rows (domain → rematch → waterfall → pattern+MV)
npm run retry-no-email -- \
  --input output/runs/<prior>/enriched_unique.csv
```

## Outputs

Under `output/runs/<timestamp>/`:

| File | Contents |
|------|----------|
| `enriched_unique.csv` | One row per unique LinkedIn URL + Apollo fields |
| `enriched_full.csv` | Original scrape rows with emails joined |
| `with_email.csv` | Unique rows that have a usable email (campaign-ready) |
| `checkpoint.json` | Resume state |
| `enrichment_log.jsonl` | Per-profile audit (enrich) |
| `retry_log.jsonl` | Per-profile audit (retry-no-email) |

## Retry passes

`npm run retry-no-email` only reprocesses `matched_no_email` / `not_found` rows (domain-first):

1. Seed org/domain (and email if present) from the existing Apollo person id
2. Resolve school domain from headline via regex parse, then **LLM (OpenRouter)** when the org is missing; Apollo org enrich + quality filter; Serper fallback when Apollo misses or returns junk
3. Name rematch with domain (sync email reveal)
4. Apollo **waterfall email** via `run_waterfall_email=true` + a temporary [webhook.site](https://webhook.site) inbox (with domain when known). Disable with `--no-waterfall`.
5. Pattern-guess emails + MillionVerifier (`ok`, or `catch_all` for `first.last` / `flast`)

Existing `email_found` rows are copied through unchanged.

## Flags

| Flag | Purpose |
|------|---------|
| `--input` | Path to reactor CSV (enrich) or enriched_unique.csv (retry) |
| `--run-dir` | Explicit output directory |
| `--resume` | Resume an existing run dir |
| `--max-apollo-calls` | Stop after N Apollo people calls |
| `--max-rows` | Cap unique profiles processed |
| `--fixtures` | Force fixture mode (`USE_FIXTURES=1`) |
| `--no-waterfall` | Skip Apollo waterfall email pass |
| `--waterfall-only` | Only run waterfall (skip domain/MV) |
| `--no-llm` | Skip OpenRouter headline→org extraction |

## Confidence filter

After enrichment, filter campaign emails to mid/high confidence:

```bash
npm run filter-confidence -- \
  --input output/runs/<run>/with_email.csv \
  --run-dir output/runs/<run> \
  --min=mid
```

Writes `with_email_mid_high.csv` and `with_email_low_confidence.csv`. Drops free mail, directories, research-university misfires, and non-school vendor domains.

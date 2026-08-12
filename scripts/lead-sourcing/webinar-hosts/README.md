# Webinar Host Lead Pipeline

Four-stage TypeScript pipeline that discovers LinkedIn webinar posts via **Serper (Google SERP API)**, extracts poster/company data with **Playwright**, enriches firmographics (Apollo.io), filters to ICP, and outputs a campaign-import-ready CSV for cold email outreach.

## Quick start

```bash
cd scripts/lead-sourcing/webinar-hosts
cp .env.example .env   # SERPER_API_KEY + APOLLO_API_KEY + LINKEDIN_LI_AT
npm install
npx playwright install chrome   # Stage 2 LinkedIn extraction only
npm test                        # Tier 1: unit tests, $0
npm run test:pipeline           # Tier 2: fixture E2E, $0
npm run all:fixtures            # full pipeline on fixtures, $0
npm run stage1                    # live Stage 1 (requires SERPER_API_KEY)
```

**Do not run `npm run all` at full scale until Tiers 1–3 pass.**

## Stages

| Stage | Command | Output | Cost |
|-------|---------|--------|------|
| 1 — Google SERP | `npm run stage1` | `stage1_linkedin_webinar_posts.csv` | Serper ~$0.001/search |
| 2 — LinkedIn | `npm run stage2 -- --input ...` | `stage2_linkedin_webinar_posts_extracted.csv` | Free (Playwright) |
| 3 — Enrich | `npm run stage3 -- --input ...` | `stage3_webinar_host_entities.csv` | Apollo credits |
| 4 — Contacts | `npm run stage4 -- --input ...` | `stage4_webinar_host_leads.csv` | Apollo credits |
| All | `npm run all -- --confirm-scale` | Full run dir under `output/runs/` | |

## Stage 1 — Serper (Google SERP)

Stage 1 uses [Serper.dev](https://serper.dev) — the real Google index with `tbs=qdr:m` (past month). No browser, no captchas.

Each Serper page request costs **1 credit**. Stage 1 paginates until either Serper is exhausted or a page adds **no new LinkedIn URLs** (yield-based stop).

```bash
# New run (auto timestamp dir under output/runs/)
npm run stage1

# Named run directory
npm run stage1 -- --run-dir output/runs/my-run

# Resume after interrupt (Ctrl+C, crash, etc.)
npm run stage1 -- --resume output/runs/my-run

# Full pipeline resume (Stage 1 only)
npm run all -- --resume output/runs/my-run --confirm-scale
```

### Run directory files

| File | Purpose |
|------|---------|
| `stage1_linkedin_webinar_posts.csv` | Deduped LinkedIn post URLs (updated after each page) |
| `stage1_checkpoint.json` | Resume pointer, seen URLs, query stats |
| `stage1_page_log.jsonl` | Per-page audit log (new URLs, credits, action) |

### Yield-based pagination

Configured in `config/queries.yaml`:

```yaml
yield_stop:
  zero_new_pages: 1      # stop query after 1 page with 0 new LinkedIn URLs
  low_yield_threshold: 1 # 0 = disable low-yield stop
  low_yield_streak: 2    # stop after N consecutive pages with ≤ threshold new URLs
```

This avoids burning credits on deep SERP pages that only repeat URLs already found by earlier pages or queries.

### Env

| Env | Default | Purpose |
|-----|---------|---------|
| `SERPER_API_KEY` | — | **Required** for live Stage 1 |
| `SERPER_RATE_MS` | `500` | Delay between Serper page requests |

Time filter and query phrases come from `config/queries.yaml`.

## Stage 2 — LinkedIn (Playwright)

Stage 2 visits LinkedIn post URLs in a browser. Set `LINKEDIN_LI_AT` for best results.

Checkpoint/resume mirrors Stage 1: each row is persisted immediately so an interrupt loses at most one URL.

```bash
# New run (checkpoint auto-created in input directory)
npm run stage2 -- --input output/runs/my-run/stage1_linkedin_webinar_posts.csv

# Named run directory
npm run stage2 -- --run-dir output/runs/my-run --input output/runs/my-run/stage1_linkedin_webinar_posts.csv

# Resume after interrupt (Ctrl+C, crash, etc.)
npm run stage2 -- --resume output/runs/my-run \
  --input output/runs/my-run/stage1_linkedin_webinar_posts.csv

# Full pipeline resume (Stage 2 portion)
npm run all -- --resume output/runs/my-run --from-stage 2 --confirm-scale
```

### Run directory files

| File | Purpose |
|------|---------|
| `stage2_linkedin_webinar_posts_extracted.csv` | Extracted rows (rewritten after each URL) |
| `stage2_checkpoint.json` | Resume pointer, stats, extracted rows |
| `stage2_extraction_log.jsonl` | Per-row audit log |

Resume fails fast if the input CSV or `--max-rows` changed since the checkpoint was created.

## Stage 4 — Pipeline filter + contacts (Apollo)

Stage 4 filters entities by **webinar pipeline intent** (using Stage 2 post text), then finds contacts via Apollo.

**Pipeline filter (inclusive):** default include. Only rejects webinars with clearly zero growth/pipeline purpose (internal all-hands, recruiting-only, civic admin, etc.). Configured in `config/icp.yaml` under `pipeline_filter`.

**ICP gates:** rejects gov/nonprofit/military industries (`industry_blocklist`) and high-signal mission org names (`entity_blocklist`, e.g. armed forces, attorney general). Rejection reasons appear in dry-run `rejection_breakdown`.

**Contact search (tier-based):**
- One broad org Apollo search per company (`per_page: 15`, no title filter).
- Pick up to 2 contacts using tier slot filling:
  1. **webinar_fill** — marketing, events, demand gen, webinar, field marketing, CMO (not bare PR/comms titles)
  2. **pipeline** — sales/BD/revenue/GTM/commercial **leadership only** (VP/Director/Head/Chief; not AEs/SDRs)
  3. **executive** — company owners (founder, CEO, chief executive officer, executive director, president, owner)
- **Poster-first:** for person-posted webinars, try the LinkedIn poster before org search. Posters with excluded titles (HR, customer success, etc.) are skipped.
- Output includes `contact_tier` and `contact_pick_reason` for auditability.

Tier keywords are configured in `config/icp.yaml` under `contact_search.contact_tiers`.

```bash
# Dry-run estimate (free)
npm run stage4 -- --dry-run \
  --input output/runs/my-run/stage3_webinar_host_entities.csv

# Live run (auto-detects sibling stage2 CSV in same directory)
npm run stage4 -- \
  --input output/runs/my-run/stage3_webinar_host_entities.csv

# Explicit Stage 2 path for pipeline filter post text
npm run stage4 -- \
  --input output/runs/my-run/stage3_webinar_host_entities.csv \
  --stage2-input output/runs/my-run/stage2_linkedin_webinar_posts_extracted.csv

# Resume after Ctrl+C (checkpoint must match stage3 + stage2 inputs)
npm run stage4 -- \
  --resume output/runs/my-run \
  --input output/runs/my-run/stage3_webinar_host_entities.csv \
  --stage2-input output/runs/my-run/stage2_linkedin_webinar_posts_extracted.csv

# Monitor progress (stderr banners + throttled lines; stdout JSON per entity)
npm run stage4 -- --input ... --stage2-input ... 2>&1 | tee output/runs/my-run/stage4_run.log
```

### Progress output

| Channel | When | Example |
|---------|------|---------|
| stderr banner | start / end / interrupt | `[stage4] ── starting ──` |
| stderr progress | entity 1, last, every 25th | `[stage4] 25/2040 \| leads 31 \| zero 9 \| poster 4 \| apollo 52 \| last: Cognite` |
| stdout JSON | every entity | `{"stage4_entity":{"entity_index":41,"company_name":"Cognite",...}}` |
| jsonl file | every entity | `stage4_contact_log.jsonl` in run dir |

Leads CSV and checkpoint are rewritten after each entity — safe to interrupt and resume.

### Output files

| File | Purpose |
|------|---------|
| `stage4_webinar_host_leads.csv` | Contacts with emails, `contact_tier`, and `contact_pick_reason` (incremental) |
| `stage4_rejected_entities.csv` | Rejected entities with `rejection_reason` |
| `stage4_checkpoint.json` | Resume pointer, stats, leads, seen emails |
| `stage4_contact_log.jsonl` | Per-entity audit log |

Rejection reasons include `pipeline_not_plausible`, `industry_blocked`, `entity_blocked`, `no_apollo_org_id`, `enrichment_not_found`.

## Cost-safe testing

| Tier | Command | Cost |
|------|---------|------|
| 1 | `npm test` | $0 |
| 2 | `npm run test:pipeline` | $0 |
| 3 | `ALLOW_PAID_SMOKE=1 npm run test:smoke` | Serper + Apollo (~$0.05–0.20) |

Use `npm run all:fixtures` or `USE_FIXTURES=1` for zero-cost dev runs. Scale runs require `--confirm-scale` when estimated calls exceed `config/smoke.yaml` limits.

## Known limitations

- Stage 1 requires a Serper API key for live runs (fixtures mode is free)
- Interrupted Stage 1 runs resume via `--resume`; checkpoint must match current `queries.yaml` fingerprint
- Interrupted Stage 2 runs resume via `--resume`; checkpoint must match input CSV and `--max-rows`
- Interrupted Stage 3 runs resume via `--resume`; checkpoint must match input CSV fingerprint
- Interrupted Stage 4 runs resume via `--resume`; checkpoint must match stage3 + stage2 input fingerprints
- LinkedIn extraction works best with `LINKEDIN_LI_AT` session cookie
- Apollo credits apply per org/people lookup (stages 3–4)
- Blocked LinkedIn posts fall back to SERP metadata for enrichment

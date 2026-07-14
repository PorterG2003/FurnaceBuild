# Meta Ad Library verification worker (Phase 1 — local spike)

Playwright lookup against [Meta Ad Library](https://www.facebook.com/ads/library/) to answer whether a company runs Meta (Facebook/Instagram) ads. Mirrors the Google Ads verification worker’s local CLI pattern.

## Prerequisites

From this directory:

```bash
npm install
npx playwright install chrome
```

## Local CLI

From repo root:

```bash
npm run verify:meta-ads -- --domain acmeplumbing.com --company-name "Acme Plumbing LLC"
```

Or from this package:

```bash
npm run local -- --domain acmeplumbing.com --company-name "Acme Plumbing LLC"
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--domain` | (required) | Website domain or URL to normalize and search |
| `--company-name` | — | Fallback search term when domain lookup is inconclusive |
| `--country` | `US` | ISO country code for Ad Library |
| `--headless` | off | Run Chrome headless (headed is default; better for bot detection) |
| `--timeout-ms` | `20000` | Playwright default timeout |
| `--slow-mo-ms` | `150` | Slow motion between actions |
| `--output-dir` | — | Save full-page PNG screenshots per search attempt |
| `--scan-webinars` | off | Scroll results, filter last N days, classify webinar ads (slower) |
| `--webinar-days` | `30` | Rolling window when `--scan-webinars` is enabled |

## Search strategy

1. **Domain first** — search Ad Library with normalized domain (`keyword_unordered`)
2. **Company name fallback** — if domain pass is inconclusive (`unknown` or ambiguous `yes`), retry with `--company-name` using `keyword_exact_phrase` for multi-word names
3. **Match rules** — `yes` only when a result card ties via landing URL hostname matching the domain, or page name fuzzy-matching the company name (conservative; ambiguous → `unknown`)

## Output contract

JSON with `result` (`yes` | `no` | `unknown`), `signals.search_attempts[]`, `lookup_stats`, and optional match fields (`matched_page_name`, `page_url`, etc.).

When ads are found and matched, `signals` also includes structured list-page content (no “See ad details” drill-down):

```json
{
  "signals": {
    "matched_ads": [
      {
        "library_id": "957258190692204",
        "page_name": "Xtalks Webinars",
        "primary_text": "Developing bispecific antibodies comes with unique challenges.",
        "headline": null,
        "landing_url": "https://xtalks.com/webinars/predict-bsab-liabilities-earlier-to-reduce-development-risk/",
        "cta": "Sign Up",
        "started_running": "Jul 6, 2026"
      }
    ],
    "top_ad": { "...": "same shape as matched_ads[0]" },
    "matched_ad_count": 2
  }
}
```

| Field | Description |
|-------|-------------|
| `matched_ads` | Up to 5 domain-matching ads first, then page-name matches |
| `top_ad` | Convenience alias for `matched_ads[0]` |
| `matched_ad_count` | Length of `matched_ads` |
| `primary_text` | Ad copy after “Sponsored” |
| `headline` | Optional title line after landing URL |
| `landing_url` | First URL matching search domain when possible |
| `cta` | Button label (e.g. Sign Up, Shop Now) |

When `result` is `no`, `matched_ads` is `[]`.

### Optional webinar scan (`--scan-webinars`)

Off by default. When enabled, the lookup scrolls through more Ad Library result cards (up to 100), filters domain-matched ads to the last `--webinar-days` (default 30) using parsed `started_running` dates, and classifies webinar-related ads into `signals.webinar_scan`.

```bash
npm run verify:meta-ads -- --domain xtalks.com --company-name Xtalks --headless --scan-webinars --webinar-days 30
```

```json
{
  "signals": {
    "webinar_scan": {
      "enabled": true,
      "days": 30,
      "scanned_card_count": 38,
      "recent_ad_count": 31,
      "webinar_ad_count": 0,
      "webinar_ads": [],
      "pagination": {
        "initial_card_count": 30,
        "scanned_card_count": 38,
        "scroll_attempts": 6,
        "cards_added_by_scroll": 8,
        "scroll_helped": true,
        "stopped_reason": "stale_scrolls"
      }
    }
  }
}
```

Validate live pagination (hits Meta; expects `nike.com` to grow by at least 5 cards):

```bash
npm run validate-pagination
```

### Batch checkpoint / resume

The webinar batch runner writes a checkpoint after each company and can resume after interruption.

**8-company validation sample** (default):

```bash
node --import tsx src/batchWebinarSample.ts --scan-webinars
```

**Full stage 3 CSV** (~2,500 entities with `enrichment_status=ok`):

```bash
node --import tsx src/batchWebinarSample.ts --all --scan-webinars
```

Output goes to `tmp/meta-ads-webinar-batch-full/` (separate from the 8-company sample in `tmp/meta-ads-webinar-batch/`).

| Flag | Description |
|------|-------------|
| `--all` | Process every eligible row in the CSV (not just the 8-name sample) |
| `--pilot` | Pilot mode: seed validation domains first, default 150 rows, anti-bot defaults |
| `--max-rows N` | Cap rows processed (useful for smoke tests) |
| `--delay-min-ms` / `--delay-max-ms` | Random pause between companies (default 8–18s) |
| `--retry-no-results` | Retry empty Meta `no_results` responses with backoff |
| `--max-no-result-retries` | Retries per company when `--retry-no-results` (default `2`) |
| `--retry-min-ms` / `--retry-max-ms` | Backoff between retries (default 20–45s) |
| `--rotate-session-every` | New browser context every ~N lookups (default `20`, jittered) |
| `--headless` | Run Chrome headless — **use this for long batches** so windows don't pop up |
| `--scan-webinars` | Enable 30-day webinar scroll scan |
| `--resume` | Continue from checkpoint |
| `--fresh` | Ignore existing checkpoint and start over |
| `--out-dir` | Override output directory |
| `--checkpoint` | Override checkpoint file path |

**Pilot batch** (150 companies, validation domains first, anti-bot pacing):

```bash
node --import tsx src/batchWebinarSample.ts --all --pilot --max-rows 150 --scan-webinars --headless --fresh \
  --retry-no-results --out-dir ../../../../tmp/meta-ads-webinar-batch-pilot-150
```

```bash
# Resume full batch
node --import tsx src/batchWebinarSample.ts --all --scan-webinars --resume

# Custom checkpoint path
node --import tsx src/batchWebinarSample.ts --all --scan-webinars --checkpoint /tmp/my-checkpoint.json --resume
```

Checkpoint stores completed domains, per-company results, and errors. Resume validates CSV path, batch mode, and scan flags match the original run.

Default verify output (`matched_ads`, `result`) is unchanged when `--scan-webinars` is omitted. Webinar scan uses a separate expanded snapshot; classification still uses the initial viewport parse.

**Limitations:** date filtering is client-side on list-page `started_running` text; very large libraries may hit scroll/card caps before all recent ads load.

### Apify pilot (150-company sample)

Alternative to Playwright when Meta blocks local browser sessions. Uses [`leadsbrary/meta-ads-library-scraper`](https://apify.com/leadsbrary/meta-ads-library-scraper) on Apify with a two-pass workflow: cheap count check first, full ad pull only when count > 0.

**Prerequisite:** export your Apify token:

```bash
export APIFY_TOKEN=apify_api_...
```

**Sanity check** (8 known companies, Leadsbrary + official actor):

```bash
node --import tsx src/apifyMetaAdsSanity.ts
```

Gate: nike.com and supermetrics.com must return count > 0 on Leadsbrary before running the full pilot.

**150-company pilot:**

```bash
node --import tsx src/batchApifyPilot.ts --max-rows 150 --fresh \
  --out-dir ../../../../tmp/meta-ads-webinar-batch-pilot-150-apify
```

| Flag | Description |
|------|-------------|
| `--actor leadsbrary\|official` | Enrich actor for full ad pull (default `leadsbrary`) |
| `--screen-actor official` | Optional hybrid: screen with this actor first (cap 1); only enrich when ads exist. Keeps empties off leadsbrary so Meta `#613` page-ID enrichment never fires. Not stored in checkpoint args — safe with `--resume` on an existing leadsbrary run. |
| `--max-rows N` | Pilot row cap (default `150`) |
| `--webinar-days` | Webinar classification window (default `90`) |
| `--resume` / `--fresh` | Checkpoint control |
| `--out-dir` | Output directory |

**Hybrid resume (full batch after #613 jam):**

```bash
node --import tsx src/batchApifyPilot.ts --all --resume \
  --screen-actor official \
  --delay-ms 4000 \
  --rate-limit-backoff-ms 360000 \
  --rate-limit-max-retries 2
```

Or via the recovery loop (passes `--screen-actor official` by default now):

```bash
./run-recovery-loop.sh
```

**Compare Apify vs Playwright pilot:**

```bash
node --import tsx src/compareApifyPlaywright.ts
```

Estimated cost: under ~$5 for the 150-company pilot (count passes are cheap; full pulls only when ads exist).

Batch sample with webinar scan:

```bash
node --import tsx src/batchWebinarSample.ts --scan-webinars
```

Full batch:

```bash
node --import tsx src/batchWebinarSample.ts --all --scan-webinars
```

## Tests

```bash
npm test
```

Parser/unit tests use committed HTML fixtures under `src/fixtures/meta-ad-library/` (no network).

Optional live integration (hits Meta):

```bash
META_ADS_INTEGRATION=1 npm test
```

## Manual validation notes

Validated locally (headless Chrome, `country=US`, `active_status=active`):

| Domain | Expected | Actual | Notes |
|--------|----------|--------|-------|
| `nike.com` (+ `--company-name Nike`) | `yes` | `yes` | 26 ad cards parsed; matched via `nike.com` destination (`NIKE.COM`) |
| `this-domain-definitely-has-no-ads-xyz123.com` | `no` | `no` | 0 ad cards; domain search uses `keyword_exact_phrase` to avoid Meta keyword noise |

Domain searches use **`keyword_exact_phrase`** when the term contains a dot; company-name fallback uses exact phrase for multi-word names and unordered keywords for single tokens.

## Common blockers

| Blocker | Behavior |
|---------|----------|
| Cookie consent modal | Best-effort dismiss; does not fail hard if absent |
| Login wall | `result: unknown`, `signals.blocker: login_wall` |
| Rate limiting / empty SPA | `unknown` with error in `lookup_stats` |
| Keyword noise (unrelated ads) | `unknown` unless domain URL or strong page-name match |

## Deferred (later phases)

- ECS Docker image / Fargate task (`Dockerfile`, `index.ts`)
- Supabase `company_meta_ads_verifications` table
- Foundry API, Step Functions, UI panel, CSV Builder tool

Reference: [`google-ads-verification-worker`](../google-ads-verification-worker/)

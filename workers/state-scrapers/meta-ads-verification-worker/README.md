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

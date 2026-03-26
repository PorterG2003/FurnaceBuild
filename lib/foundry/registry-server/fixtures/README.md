# Utah Division of Corporations — captured HTML

## Production approach

Automated scraping uses **Playwright** (Path B), not curl-only replay. See [Utah registry scraper](../../../../docs/foundry/engineering/utah-registry-scraper.md).

## Source

- Live URL: [Utah Business Registration — Business Entity Search](https://businessregistration.utah.gov/EntitySearch/OnlineEntitySearch)

## Browser flow (important)

The site does **not** drop you straight into the entity search form.

1. **Redirect** — First navigation may land on the **portal / splash**.
2. **Click through** — **“Search Business Entity Records”** (Additional Options) or **Search → Business Entity**. The **business search form** (`#frm_BusinessSearch`, POST to `/EntitySearch/OnlineBusinessAndMarkSearchResult`) loads after interaction.

Automation: **`page.goto` → click entity-search link → `#BusinessSearch_Index_txtEntityName` → Search → results grid → detail**.

## Fixture files (checked in)

| File | Description |
|------|-------------|
| `utah-entity-search-index.html` | Initial SSR for `/EntitySearch/OnlineEntitySearch` (portal shell only; curl snapshot). |
| `utah-entity-search-after-click.html` | Full page after Playwright click-through; includes **Business Search** form. |
| `utah-entity-search-results.html` | Results table `#grid_businessList` after search (e.g. “365 HEATING”). |
| `utah-entity-detail-sample.html` | Entity detail with **PRINCIPAL INFORMATION** / `#grid_principalList` (365 HEATING & AIR LLC sample). |

Regenerate with:

```bash
cd workers/state-scrapers/utah-scraper && npm run capture-fixtures
```

## curl-only baseline (legacy)

```bash
curl -sS -L -A "Mozilla/5.0 ..." \
  "https://businessregistration.utah.gov/EntitySearch/OnlineEntitySearch" \
  -o utah-entity-search-index.html
```

That file has **no** search form in SSR; use the **after-click** fixture for form field names.

## Network notes

Direct `/bundles/js` requests may **302** without a full browser session (Cloudflare). Prefer **Playwright** or saved HTML for parser tests.

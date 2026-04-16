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

# Iowa Secretary of State — Business Entities Search (fixtures)

## Production approach

Live HTML is best captured with **Playwright** in a full browser session (Akamai often blocks `curl` on `search.aspx`). Entry: [Iowa Business Entities Search](https://sos.iowa.gov/search/business/).

## Page flow

1. **Search** — By business name or business number; results grid columns **Business No.**, **Name**, **Status**, **Type** (see [search help](https://sos.iowa.gov/businesses/business-entities-search-help)).
2. **Summary** — `summary.aspx` — overview (legal name, status, type/chapter, agent, principal office).
3. **Officers** — `officers.aspx` — grid **Name**, **Address1**, **Address2**, **City**, **State**, **Zip**, **Type**, **Director**.

## Fixture files (checked in)

| File | Description |
|------|-------------|
| `iowa-business-search-results.html` | Search results `GridView`-style table with two sample rows (LLC + DBA). |
| `iowa-entity-summary-sample.html` | Summary regions: overview, names, registered agent, principal office. |
| `iowa-entity-officers-sample.html` | Officers grid with two officer rows (Member / Manager). |

Sanitized fictional entity **PRAIRIE HOME SERVICES LLC** / business no. **714000** — structure matches public page regions; replace with Playwright captures when maintaining scrapers.

## curl-only baseline (legacy)

```bash
curl -sS -L -A "Mozilla/5.0 ..." \
  "https://businessregistration.utah.gov/EntitySearch/OnlineEntitySearch" \
  -o utah-entity-search-index.html
```

That file has **no** search form in SSR; use the **after-click** fixture for form field names.

## Network notes

Direct `/bundles/js` requests may **302** without a full browser session (Cloudflare). Prefer **Playwright** or saved HTML for parser tests.

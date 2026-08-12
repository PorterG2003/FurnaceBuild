# Handoff: LinkedIn Webinar Post Scraper (Stage 1 — Raw Sourcing)

## Goal

Build a script that pulls LinkedIn post URLs where someone is promoting a webinar registration, by running Google SERP queries scoped to `site:linkedin.com/posts`. Output is a deduplicated CSV of raw URLs + snippets. This is the **first stage only** — enrichment, filtering, and contact discovery happen downstream.

## Scope

**In scope**
- Run a defined set of search query variants against a Google SERP provider
- Paginate to grab more than the first page where possible
- Parse, normalize, and deduplicate results
- Output to CSV with a defined schema
- Basic logging of queries run, results returned, errors

**Out of scope (for this stage)**
- Visiting the LinkedIn URLs to scrape post content
- Identifying which company posted
- Headcount / ICP filtering
- Contact-level data

## Input: Search Query List

Build the query list by combining each phrase below with `site:linkedin.com/posts`. Recommended approach: store as a config file (`queries.yaml` or `queries.json`) so it's easy to add/remove.

Phrases to include (v1):
- `"register for our webinar"`
- `"register for the webinar"`
- `"join us for a webinar"`
- `"join us for our webinar"`
- `"join me for a webinar"`
- `"hosting a webinar"`
- `"we're hosting a webinar"`
- `"upcoming webinar" "register"`
- `"save your seat" "webinar"`
- `"RSVP" "webinar"`
- `"free webinar" "register"`
- `"live webinar" "register"`
- `"join us live" "webinar"`
- `"online workshop" "register"`
- `"masterclass" "register" "live"`

**Date scoping:** Use Google's `tbs=qdr:m` (past month) or `qdr:w` (past week) parameter. We want recent activity, not stale 2022 posts. Make the time window a config variable.

## SERP Provider

Pick one — they all work. Listed in rough order of price-to-reliability:

- **Serper.dev** — cheap, fast, simple JSON API. Good default.
- **SerpAPI** — more mature, more expensive.
- **ScraperAPI** or **Bright Data SERP** — heavier, use only if hitting scale.

API key goes in `.env`, never committed.

## Process

```
For each query in query_list:
    For each page in range(1, max_pages + 1):
        results = serp_api.search(query, page=page, time_filter=last_month)
        for r in results:
            if r.url contains "linkedin.com/posts/":
                add to results buffer
        sleep(rate_limit_delay)

Deduplicate buffer by result_url
Write CSV
```

**Notes**
- Most queries will return 10-100 results across pages. Cap at `max_pages = 5` to start.
- Filter URLs to only those matching the pattern `linkedin.com/posts/` — Google often returns non-post LinkedIn URLs and unrelated blog posts that mention the phrase.
- Rate-limit: 1-2 second delay between calls, more if you hit 429s.
- Wrap each API call in retry-with-backoff (3 retries, exponential).

## Output: CSV Schema

File: `output/linkedin_webinar_posts_YYYY-MM-DD.csv`

| Column | Type | Description |
|---|---|---|
| `result_url` | string | Full LinkedIn post URL (the unique key) |
| `result_title` | string | SERP-returned title of the post |
| `result_snippet` | string | SERP-returned snippet (often blank for LinkedIn — expected) |
| `search_query` | string | Which query variant returned this result |
| `serp_position` | int | Rank in the SERP (1-indexed) |
| `serp_page` | int | Which page of results it was on |
| `collected_at` | ISO-8601 timestamp | When the row was scraped |
| `slug_hint` | string | Parsed text between `/posts/` and `-activity-` in the URL (often contains keywords from the post — useful for downstream topic inference) |

Dedup on `result_url`. If the same URL is found via multiple queries, keep the first one and add the other query names to a `also_matched_queries` column (pipe-delimited).

## Known Issues

- **LinkedIn snippets are usually blocked.** Google will often return "We cannot provide a description for this page right now" — this is expected. The `slug_hint` field is a partial workaround; richer post content would require visiting the URL (downstream stage).
- **Some queries are noisy.** Generic phrases like `"register"` alone pull thousands of irrelevant pages. Always require at least one webinar-specific term in the query.
- **Individuals vs companies.** The URL pattern `linkedin.com/posts/{slug}` doesn't distinguish — `compelson` is a company page, `tobias-roesch-5b48a19b` is a person. Don't try to filter at this stage; flag downstream.

## Acceptance Criteria

- [ ] Script runs end-to-end with one command (`python scrape.py` or `npm run scrape`)
- [ ] Reads queries from a config file
- [ ] Outputs a single dated CSV per run
- [ ] Deduplicates by `result_url`
- [ ] Logs total queries run, total raw results, total after filter, total after dedup
- [ ] Handles API errors without crashing the run
- [ ] `.env.example` documents required env vars
- [ ] README has a one-paragraph run instruction

## Suggested File Layout

```
project/
├── .env.example
├── README.md
├── config/
│   └── queries.yaml
├── src/
│   ├── scrape.py          # entry point
│   ├── serp_client.py     # SERP API wrapper
│   ├── parser.py          # URL filtering, slug extraction
│   └── writer.py          # CSV output + dedup
└── output/
    └── .gitkeep
```

## Future Stages (context only — not for this PR)

Stage 2 will visit each URL and extract post content + identify the posting entity (company vs individual). Stage 3 will enrich entities with company metadata. Stage 4 will filter to ICP and identify contacts. Keep this scraper modular so its output is the clean input for Stage 2.

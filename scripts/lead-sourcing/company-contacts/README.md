# Company Contacts (Founder/CEO + RevOps)

Company-first Apollo enrichment: resolve orgs by domain, then pick **Founder/CEO first**, then top-level RevOps (VP/Head/Chief/CRO). Ignores person LinkedIn URLs.

Sibling to `email-from-linkedin` / `webinar-hosts`. Does **not** change webinar Stage 4 ICP.

## Quick start

```bash
cd scripts/lead-sourcing/company-contacts
npm install

# Live (Apollo key from Amplify SSM via ensureEnv; optional local APOLLO_API_KEY)
npm run prep-companies -- \
  --input /path/to/list-a.csv \
  --input /path/to/list-b.csv \
  --run-dir output/runs/2026-07-17-zoho-builtwith

npm run resolve-orgs -- --run-dir output/runs/2026-07-17-zoho-builtwith
npm run find-contacts -- --run-dir output/runs/2026-07-17-zoho-builtwith

# Verify titles + MillionVerifier (optional LinkedIn title refresh via Apollo)
npm run verify-leads -- --run-dir output/runs/2026-07-17-zoho-builtwith --refresh-linkedin-titles

# Zero-cost fixtures
USE_FIXTURES=1 npm run resolve-orgs -- --run-dir output/runs/fixture-smoke --fixtures
```

Optional: copy `.env.example` → `.env` for local overrides (`APOLLO_SECRET_TARGET_ENV=dev`).

## Pipeline

| Step | Command | Output |
|------|---------|--------|
| 1 — Prep | `npm run prep-companies` | `companies.csv`, `sources/` |
| 2 — Orgs | `npm run resolve-orgs` | `companies_resolved.csv` |
| 3 — Contacts | `npm run find-contacts` | `leads.csv`, `rejected_companies.csv` |
| 4 — Verify | `npm run verify-leads` | `leads_verified.csv`, `leads_rejected.csv`, `leads_linkedin_review.csv` |

## Persona order

Configured in `config/icp.yaml`:

1. **executive** — founder, co-founder, CEO, president, owner
2. **sales_marketing** — CMO/CRO/CSO or Sales/Marketing/Growth/GTM with VP, Head, Director, or Chief

Up to `max_contacts_per_company` (default 2). RevOps titles are classified but not filled (Furnace sells to sales/marketing decision makers).

## Run directory

```text
output/runs/<run-id>/
  sources/                 # copied input CSVs
  companies.csv
  companies_resolved.csv
  leads.csv
  rejected_companies.csv
  resolve_checkpoint.json
  contacts_checkpoint.json
  contact_log.jsonl
```

## Flags

| Flag | Purpose |
|------|---------|
| `--input` | Source CSV (repeatable on prep) or leads.csv override on verify |
| `--run-dir` | Explicit output directory |
| `--resume` | Resume an existing run dir |
| `--max-rows` | Cap companies/leads processed |
| `--max-apollo-calls` | Cap Apollo org/people calls |
| `--fixtures` | Force fixture mode |
| `--dry-run` | Estimate only (resolve/find/verify) |
| `--refresh-linkedin-titles` | On verify: re-match Apollo by LinkedIn URL and flag title mismatches |

## Verify step

`verify-leads` keeps rows that pass:

1. **Title accuracy** — Founder/CEO/company President/Owner or top-level RevOps (drops “President of BD”, board members, franchise owners, etc.)
2. **MillionVerifier** — `ok` or `catch_all` (key from SSM)

Also writes `leads_linkedin_review.csv` for companies with **two executives** (use LinkedIn URLs to confirm dual CEOs). With `--refresh-linkedin-titles`, Apollo rematch adds `linkedin_title` / `linkedin_title_match`.

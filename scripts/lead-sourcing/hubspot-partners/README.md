# HubSpot CRM Implementation Partners

Scrape HubSpot Solutions Partners with the **CRM Implementation** accreditation (`43003`) from the [public marketplace directory](https://ecosystem.hubspot.com/marketplace/explore/solutions-partners?eco_PROFILE_ACCREDITATIONS=43003).

Uses HubSpot’s public Chirp RPCs (search + listing details). No Apollo/Hunter spend. Person emails are not on marketplace profiles; `website` is the handoff into `company-contacts` if you want people enrichment later.

## Quick start

```bash
cd scripts/lead-sourcing/hubspot-partners
npm install

# Zero-cost fixtures
npm run scrape -- --fixtures --run-dir output/runs/fixture-smoke

# Live sample (5 partners)
npm run scrape -- --max-rows 5 --run-dir output/runs/sample

# Full CRM Implementation list
npm run scrape -- --run-dir output/runs/crm-implementation-full

# Resume after interrupt
npm run scrape -- --resume --run-dir output/runs/crm-implementation-full
```

## Output

```text
output/runs/<run-id>/
  partners.csv              # search cards
  partners_enriched.csv     # + detail firmographics
  search_checkpoint.json
  detail_checkpoint.json
  detail_errors.jsonl       # per-slug detail failures
  label_maps.json
  run_meta.json
  run_summary.json
```

### Enriched columns

Search: `listing_id`, `slug`, `listing_name`, `company_name`, `provider_name`, `description`, `logo_url`, `profile_url`, `partner_tier`, `partner_type`, `overall_rating`, `adjusted_rating`, `review_count`, `accreditation_id`, `accreditation_name`, `scraped_at`

Detail: `website`, `languages`, `services`, `service_names`, `industries`, `budget`, `regions`, `office_location`, `locations`, `company_size_specialty`, `source_id`, `listing_version_id`, `detail_status`, `detail_error`

## Flags

| Flag | Purpose |
|------|---------|
| `--run-dir` | Output directory |
| `--resume` | Resume checkpoints in `--run-dir` |
| `--max-rows` | Cap partners processed |
| `--fixtures` | Use recorded fixtures (no network) |
| `--dry-run` | Preview search total only |
| `--accreditation-id` | Default `43003` (CRM Implementation) |
| `--page-size` | Search page size (default 50) |
| `--rate-ms` | Delay between calls (default 400) |

## Success checklist

1. `npm test` passes
2. Fixture smoke exits 0 and writes CSVs
3. Live sample (`--max-rows 5`): 5 rows each CSV; required fields present; ≥4/5 have `website`
4. Full run: unique `listing_id` count matches live API `total`; detail success ≥98%
5. Second `--resume` on a completed run adds ~0 new HubSpot calls for already-done slugs

## People contacts (optional next step)

Feed `company_name` + `website` from `partners_enriched.csv` into `../company-contacts` for Apollo enrichment.

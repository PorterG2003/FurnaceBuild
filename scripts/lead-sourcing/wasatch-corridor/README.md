# Wasatch Corridor Prospect List

Company-only universe for the North Salt Lake–Payson corridor, enriched once, then scored through **cold email** and **webinar** doors. Contact discovery is a separate pipeline.

```bash
cd scripts/lead-sourcing/wasatch-corridor
npm install
npm test
npm run all:fixtures
npm run dry-run
```

Live Apollo / OpenRouter requires `--live` **and** an explicit spend OK. FSQ OS Places and EPA FRS are $0.

## Pilot

Three cities (Lehi, Midvale, Payson) × bands `11,20` and `21,50` = 6 Apollo shards, cap 12 credits. Skips FSQ/EPA.

```bash
npm run dry-run -- --pilot --run-dir output/runs/pilot-1
# after spend OK:
npm run acquire -- --live --pilot --run-dir output/runs/pilot-1
npm run admit -- --run-dir output/runs/pilot-1
```


## Stages

| Stage | Command | Vendors |
|---|---|---|
| acquire | `npm run acquire -- --live --run-dir output/runs/wasatch-v1` | Apollo search; FSQ extract; EPA FRS |
| admit | `npm run admit -- --run-dir …` | Census geocoder (free) |
| enrich | `npm run enrich -- --live --run-dir …` | Crawl (free), OpenRouter, Apollo people |
| doors | `npm run doors -- --run-dir …` | none |

Doors re-read `enrichment/companies.jsonl` and do not hit APIs.

## FSQ OS Places

Pass a corridor extract or drop it at `output/runs/<id>/cache/raw/fsq-os/corridor.jsonl`:

```bash
npm run acquire -- --fixtures
npm run acquire -- --live --fsq-extract path/to/corridor.jsonl
```

Filter the Apache 2.0 dump to bbox `lat 39.99–40.90`, `lng -112.15–-111.55`, B2B/industrial categories.

## Output

`output/runs/<id>/output/prospects.csv`, `exclusions.csv`, `review.csv`, `coverage.json`.

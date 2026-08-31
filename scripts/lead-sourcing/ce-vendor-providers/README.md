# Approved CE vendor-providers

Find companies that run **credit-bearing CE** so licensed attendees become **customers or partners**. Listed as a vendor or manufacturer sponsor is enough to email. Not a census of CME funders.

The sale is filling the room: they own (or influence) who shows up, and attendance is a number they are judged on.

## What a good row looks like

**Candidate** (tier 1 or 2): product company or trade/manufacturer association, not explicitly paid. Own-domain signup is tier 1; third-party or unknown signup is tier 2. Blank CE format is allowed — directory listing is enough. Professional membership societies, schools, and CE shops stay out.

**Rank** (not a cut): self-provided first, then live online, then activity count. Proven-free and grant-program flags stay on the row for copy/review. Live-online evidence from CE platform URLs (BNP, GreenCE, etc.) is ignored for ranking so template boilerplate does not float those rows.

## Contact enrichment (gated, after ranking)

Known-domain vs platform-only split, then Serper → Apollo → Prospeo → Hunter. Each vendor is a spend gate. Commands live in [`../company-contacts/README.md`](../company-contacts/README.md) under **CE vendor enrichment**.

```bash
cd ../company-contacts
npm run prep-from-prospects -- --run-dir output/runs/ce-vendors-pilot-1
npm run discover-ce-domains -- --run-dir output/runs/ce-vendors-pilot-1 --dry-run
# do not --live without spend OK; first wave is --max-rows 40
```

## Commands

```bash
cd scripts/lead-sourcing/ce-vendor-providers
npm install
npm test                          # fixtures only, $0
npm run all:fixtures              # full pipeline on fixtures, $0

# Live directory + homepage fetch (unmetered, rate-limited)
npm run directories -- --max-pages 2 --max-rows 40
npm run classify -- --run-dir output/runs/<id> --max-rows 40
npm run fit -- --run-dir output/runs/<id> --max-rows 40
npm run aggregate -- --run-dir output/runs/<id>
```

**Serper is paid.** Dry-run prints the query list and credit ceiling. `--live` is required; do not run live search without spend OK.

```bash
npm run harvest:host -- --dry-run --wave 1
npm run harvest:grant -- --dry-run --wave 1
# after spend OK:
npm run harvest:host -- --live --max-queries 20 --max-pages 2 --run-dir output/runs/<id>
```

## Stages

| Stage | Command | Network | Cost |
|---|---|---|---|
| Directories | `directories` | fetch public lists | $0 |
| Classify | `classify` | homepage fetch | $0 |
| Fit fields | `fit` | CE/registration page fetch | $0 |
| Host search | `harvest:host` | Serper | ~$0.001/search |
| Grant search | `harvest:grant` | Serper | ~$0.001/search (deprioritize hits) |
| Rank | `aggregate` | none | $0 |

## Outputs (per run dir)

- `prospects.csv` — fit tier 1–2 candidates first, then `self_provided`, `has_live_online`, `activity_count`
- `evidence.csv` — source page / snippet / registration URL
- `unmatched.csv` — host/grant phrase pages that failed extract
- `coverage_report.json` — **population composition**, not census recall

`easy_audience_access_review` is left blank. The scraper cannot tell if a dominant association already owns that audience.

## CE hosts list (`ce-hosts-1`)

Training hosts: CE shops that run live online classes, professional firms with a public webinar, and the six AIA **platform companies** (not their manufacturer sponsor indexes).

```bash
cd scripts/lead-sourcing/ce-vendor-providers
npm run directories -- --run-dir output/runs/ce-hosts-1
npm run classify -- --run-dir output/runs/ce-hosts-1
npm run fit -- --run-dir output/runs/ce-hosts-1
npm run harvest:host -- --dry-run --wave 1 --run-dir output/runs/ce-hosts-1
npm run aggregate -- --run-dir output/runs/ce-hosts-1
# host_prospects.csv = directory hosts + webinar-hosts CE slice, merged on domain
```

`prospects.csv` still uses `assignFitTier` (sponsor campaign). Do not launch from this run.

## Wave 1 ingest (pilot)

Live ingest is **ARCAT, NASBA, ASWB, GreenCE, Ron Blank, AEC Daily, CE Strong, BNP CE Center**. Parked sources (NBCC, insurance, ACCME, AIA catalog, APA, AOTA, Hanley Wood, Bluevolt, other boards) are in [`config/source-backlog.yaml`](config/source-backlog.yaml).

```bash
npm run directories -- --run-dir output/runs/pilot-ingest
# writes directory_entries.csv and directory_coverage.json

# Parse/classify ARCAT first (vendor-heavy). Homepage fetch is unmetered.
npm run classify -- --run-dir output/runs/pilot-ingest --directory arcat
npm run fit -- --run-dir output/runs/pilot-ingest --directory arcat
```

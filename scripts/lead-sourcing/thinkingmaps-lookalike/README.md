# Thinking Maps lookalike districts

Roll closed-won CRM accounts up to districts, match them to NCES LEAIDs, and rank every US public/charter district by win-rate lift.

Phase 1 is free (Urban Institute CCD/SAIPE). Phase 2 (Serper domains + Apollo contacts) is spend-gated and not run from this package.

## Commands

```bash
npm test
npm run all:fixtures
npm run all -- --input "$HOME/Downloads/Accounts_Closed-Won_after_1_1_2023.csv" --avoid "$HOME/Downloads/Avoid_List_for_Cold_Outreach.csv"
```

Stages: `prep` → `fetch` → `match` → `profile` → `score` → `validate`.

Outputs in `output/runs/<id>/`:

- `won_districts.csv` — rolled-up customers
- `match_review.csv` — NCES matches, revenue-sorted
- `profile.json` — per-bin win-rate lift
- `lookalike_districts.csv` — ranked prospects with reason strings
- `lookalike_by_state.csv`
- `validation.json` — 80/20 holdout

CCD cache lives in `data/ccd-universe-2024.json` after the first fetch. The 2024 directory leaves ELL and special-ed counts empty, so the fetch joins those fields from the 2021 directory by `leaid`.

## Phase 2

`npm run phase2` prints the gate and exits. Do not pass `--live` unless the ranked list is approved and spend is explicitly OK'd.

## Won-district school contacts

List every NCES school in matched closed-won districts, exclude the exact closed-won schools, then fill up to three contacts per remaining school: curriculum/instruction, assistant principal, principal.

```bash
npm run schools -- --run-dir output/runs/school-contacts-1
npm run schools:resolve-sites -- --run-dir output/runs/school-contacts-1 --dry-run
npm run schools:resolve-sites -- --run-dir output/runs/school-contacts-1 --live
npm run schools:directories -- --run-dir output/runs/school-contacts-1 --max-rows 20
```

Staff directories are harvested from resolved district websites via Playwright (Finalsite keyword search, Apptegy school slugs, generic school-site crawl). Serper website resolution is spend-gated (`--live`). MoltSets/Apollo stay gated for leftover slots.

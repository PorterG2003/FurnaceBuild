# Best Email Picker

Scores up to three email candidates per contact, verifies business-domain addresses with Million Verifier, and writes the winning address to a new `best_email` column.

## Quick start

```bash
cd scripts/lead-sourcing/email-scoring
npm install
npm test                    # unit tests, $0 (mocked MV)
npm run pick -- --fixtures  # full input CSV, no API calls
npm run pick                # live run — key from Amplify SSM
```

Requires `DEV_SECRET_SSM_PREFIX` / `PROD_SECRET_SSM_PREFIX` in repo-root `.env.local` or `infra/workers/.env.local` (same as other scripts). Million Verifier key lives at `{prefix}/MILLION_VERIFIER_API_KEY` — set with `npx ampx sandbox secret set MILLION_VERIFIER_API_KEY`.

Default input: `inputs/Furnace 4_21_2026 - [Need to Call] [Florida] [Utah] [Home Builders].csv`

Output lands in `output/runs/<timestamp>/` with `_best_email` appended to the input basename.

## CLI

| Flag | Purpose |
|------|---------|
| `--input <path>` | Input CSV (default: Furnace home builders file in `inputs/`) |
| `--output <path>` | Output CSV path |
| `--dry-run` | Print plan without processing |
| `--max-rows <n>` | Limit rows for smoke tests |
| `--fixtures` | Skip Million Verifier; treat business domains as valid |

## Scoring

See `best_email_picker_spec.md` for full rules: dead-domain filter, consumer vs business classification, Million Verifier check on business domains, role-based and name-match bonuses, column-order tiebreaker.

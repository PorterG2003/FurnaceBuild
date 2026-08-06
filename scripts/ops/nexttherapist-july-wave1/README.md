# NextTherapist July Training — Wave 1 reminder send

Account `8fe822e5-fccc-4799-ba5f-08232765fb73` · Campaign `7548f6de-f2a1-4e30-b005-f3dc71186829`

## Safety

- **Never** call send-now. This script only `POST /v1/threads/{id}/reply`.
- Dry-run first. Live Group A requires `--suppress-csv` (fresh registrant export).
- Wave 2 hold CSV is not used by this script.

## Usage

```bash
cd scripts/ops/nexttherapist-july-wave1
python3 test_tidy.py

# Group B (already queued 2026-08-05 — see sendlog_B.csv)
python3 send_wave1.py --group B --dry-run --names-cache names_cache_B.json

# Group A — requires fresh registrant export first
python3 rediff_group_a.py --registrants /path/to/fresh_registrants.csv
python3 send_wave1.py --group A --dry-run \
  --csv wave1_A_after_rediff.csv \
  --suppress-csv /path/to/fresh_registrants.csv
export FURNACE_API_KEY=...   # or queue via Furnace MCP createReplyJob
python3 send_wave1.py --group A --live \
  --csv wave1_A_after_rediff.csv \
  --suppress-csv /path/to/fresh_registrants.csv
```

See `STATUS.md` for live queue results.
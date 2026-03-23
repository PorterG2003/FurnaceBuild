# Workflow: Ingest source data

## Goal

Bring external business listings into **`ingestion_runs`** and **`source_business_records`** with traceable batch metadata and minimal loss of source fidelity.

## Trigger / starting point

Operator uploads a file, an API webhook fires, or a scheduled job starts—application code creates an **`ingestion_runs`** row.

## Steps

1. **Start ingestion run** — Insert `ingestion_runs` with `source_name`, `source_type`, `status = 'running'`, optional `config` / `ingest_version` / `parser_version`.
2. **Write raw records** — For each parsed row, insert `source_business_records` with `ingestion_run_id`, `name_raw`, `raw_payload`, and best-effort address/phone/website fields.
3. **Validate / normalize** — In application code: reject malformed rows, coerce types, optionally geocode. Update per-row or batch `stats` on the run.
4. **Finalize run** — Set `status` to `completed` or `failed`, `completed_at`, `error_summary` / `stats` as appropriate. `cancelled` if aborted by user.

## Tables touched

- **`ingestion_runs`** (insert, update)
- **`source_business_records`** (insert, occasional update)

Triggers: `trg_ingestion_runs_updated_at`, `trg_source_business_records_updated_at`.

## Success outcome

Run is `completed`; all accepted rows exist as `source_business_records` ready for [resolve-raw-to-company.md](resolve-raw-to-company.md).

## Failure cases

- Parser throws: mark run `failed`, capture `error_summary`; partial rows may exist (operator decides whether to delete run or resume).
- DB constraint violations on insert: surface row index / id in logs.

## Review path

Bad data patterns may spawn **`review_tasks`** (`parse_failure` or custom) if you add that hook in the ingest service.

## Audit trail

`ingestion_runs` row + `source_business_records.raw_payload` preserve source evidence; run `stats` summarize counts.

## Related

- [../schema/tables/raw-ingestion.md](../schema/tables/raw-ingestion.md)

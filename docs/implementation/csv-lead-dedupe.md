# CSV Lead Upload Dedupe

Builder CSV import for campaign lead buckets supports interactive dedupe before import, scalable async uploads, and upsert-based persistence.

## User-facing behavior

Wizard steps: **Upload CSV → Map Fields → Dedupe → Review → Import**.

### Dedupe defaults

| Filter | Default | Behavior |
|--------|---------|----------|
| Duplicate emails in file | Always on | Keeps first row per normalized email |
| Already in campaigns | **Off** | Opt-in; user chooses campaigns via searchable modal (“Choose campaigns…”) |
| Block list | On | Uses account block list (email + domain entries) |

The Dedupe step uses a **two-column layout** on desktop (filters left, import preview right). On mobile, preview appears first. The preview panel shows a hero count and a workbench-style metric breakdown (rows in file, removals by category, ready to import).

If campaign dedupe is enabled, the user must select at least one campaign before continuing.

### Import paths

| Rows after dedupe | Path |
|-------------------|------|
| ≤ 500 | Sync chunked `import_api_leads_to_campaign` |
| > 500 | Staged async: upload rows to `csv_import_staging`, finalize job, worker processes via cursor |

No row cap — large files upload once with progress.

### Close-window behavior

| Phase | Safe to close tab? |
|-------|-------------------|
| Dedupe / Review | Yes |
| Sync import | **No** — partial import possible |
| Async upload phase | **No** — upload stops |
| Async import phase (post-finalize) | **Yes** — worker continues server-side |

UI uses yellow/green callouts, `useConfirmClose` on the wizard, and `beforeunload` during risky phases.

## Architecture

```
LeadSourceNodeModal
  ├── CsvImportDedupeStep.tsx          (dedupe step UI)
  ├── lib/leads/csv-dedupe.ts          (pure dedupe + row mapping)
  ├── csv-import-preview.ts            (preview_emails_in_campaigns RPC)
  └── csv-import-jobs.ts               (sync import + staged async)

Postgres
  ├── preview_emails_in_campaigns      (inverted email lookup)
  ├── csv_import_staging               (unbounded row storage)
  ├── create/append/finalize CSV job RPCs
  └── import_api_leads_to_campaign     (upsert by email in campaign)

Worker
  └── clientApiBulkImport              (csv_lead_import_staged operation)
```

## Related dedupe elsewhere

- **Client API** bulk import: `import_api_leads_to_campaign` (email upsert per campaign)
- **Leads workbench** add-to-campaign: `add_global_leads_to_campaign` (global_lead_id upsert)
- **Block list enforcement at send time**: send-worker `isEmailBlocked`

## Tests

- Unit: `lib/leads/csv-dedupe.test.ts`
- Integration: `lib/test/campaign/csvDedupeOutcomes.test.ts`

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

### Map Fields step

Standard lead fields (`email`, `name`, company, URLs, etc.) are mapped via dropdowns; only `email` is required. Below the standard fields, the **Personalization fields** section lists the campaign's existing custom (personalization) keys — see below — each with its own column dropdown, auto-mapped where a CSV header matches. The **Custom Lead Fields** pill selector underneath is reserved for genuinely *new* custom columns (columns not already consumed by a standard or existing-key mapping).

## Custom (personalization) fields

Custom fields are the `{{custom.<key>}}` tokens a campaign personalizes on. The set of "required" keys for a campaign is derived from the Lead Source node's accumulated `customFieldKeys` (`flow_data`), read back at write time by `private_campaign_custom_field_keys`. Keys are matched after `btrim()`, so the mapping UI canonicalizes via `normalizeCustomFieldKey` (trim) and rejects template-breaking keys via `isValidCustomFieldKey` (non-empty, no `{`/`}`).

### Blanks are allowed (not silent)

Rows missing one or more required custom fields are **no longer skipped**. They are imported/added with the field left blank and counted as `incomplete` in the RPC result. This count is threaded through stats, the worker job `result`, the post-import UI alert ("Imported N leads (M with missing personalization fields)"), and the external `/v1` responses, so a partial mapping never silently produces zero leads. `skipped` now only covers rows with no usable email.

### Re-import merges, never wipes

When a lead already exists in the campaign, `import_api_leads_to_campaign` (and `add_global_leads_to_campaign`) **merge** `custom_lead_data` — provided keys overlay, previously-populated keys are preserved. Re-importing a partial mapping does not clear unmapped personalization fields. (Tradeoff: a blank value cannot clear an existing field via import; destructive clears must be explicit.)

### Mapping-screen split

| Section | Contents |
|---------|----------|
| Standard fields | Built-in lead columns; `email` required |
| Personalization fields | Existing campaign custom keys, one dropdown each, auto-mapped on matching header |
| Custom Lead Fields (pills) | Brand-new custom columns only (excludes columns already mapped above, compared via normalized key) |

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
  ├── private_campaign_custom_field_keys (required custom keys from flow_data)
  └── import_api_leads_to_campaign     (upsert by email; merges custom_lead_data; returns `incomplete`)

Worker
  └── clientApiBulkImport              (csv_lead_import_staged operation)
```

## Related dedupe elsewhere

- **Client API** bulk import: `import_api_leads_to_campaign` (email upsert per campaign)
- **Leads workbench** add-to-campaign: `add_global_leads_to_campaign` (global_lead_id upsert)
- **Block list enforcement at send time**: send-worker `isEmailBlocked`

## Tests

- Unit: `lib/leads/csv-dedupe.test.ts` (includes `normalizeCustomFieldKey`, `isValidCustomFieldKey`, `customFieldMappings` payload + collision-merge, `autoMapExistingCustomKeys`)
- Integration: `lib/test/campaign/csvDedupeOutcomes.test.ts` (incomplete counting, merge-on-reimport, staged async), `lib/test/campaign/addLeadsToCampaignOutcomes.test.ts`, `lib/test/client-api/clientApiBulkImportOutcomes.test.ts`

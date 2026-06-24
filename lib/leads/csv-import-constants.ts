/** Sync import when deduped row count is at or below this. */
export const CSV_IMPORT_SYNC_THRESHOLD = 500;

/** Client → staging RPC batch size for async CSV imports. */
export const CSV_IMPORT_STAGING_UPLOAD_CHUNK = 500;

/** Preview RPC email batch size (inverted campaign lookup). */
export const CSV_IMPORT_PREVIEW_EMAIL_CHUNK = 100;

/** Sync `import_api_leads_to_campaign` RPC batch size. */
export const CSV_IMPORT_SYNC_RPC_CHUNK = 100;

/** Worker chunk size when processing staged CSV rows (matches bulk import worker). */
export const CSV_IMPORT_WORKER_CHUNK = 500;

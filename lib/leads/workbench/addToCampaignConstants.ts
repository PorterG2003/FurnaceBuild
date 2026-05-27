/** Use server review RPC instead of full workbench dataset when selection exceeds this. */
export const ADD_TO_CAMPAIGN_REVIEW_LIGHT_THRESHOLD = 250;

/** Sync RPC path up to this many unique global_lead_ids; above uses async job. */
export const ADD_TO_CAMPAIGN_SYNC_THRESHOLD = 500;

/** Multi-row insert/upsert chunk size (legacy client path / worker hints). */
export const ADD_TO_CAMPAIGN_WRITE_CHUNK_SIZE = 100;

/** Show a heads-up in the modal when selection is at least this large. */
export const ADD_TO_CAMPAIGN_LARGE_SELECTION_THRESHOLD = 1000;

/** Worker chunk size for import job processing. */
export const ADD_TO_CAMPAIGN_IMPORT_CHUNK_SIZE = 500;

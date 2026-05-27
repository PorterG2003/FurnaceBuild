/** Sync RPC path up to this many unique global_lead_ids; above uses async job. */
export const REMOVE_SYNC_THRESHOLD = 500;

/** Worker chunk size for remove membership import jobs. */
export const REMOVE_IMPORT_CHUNK_SIZE = 500;

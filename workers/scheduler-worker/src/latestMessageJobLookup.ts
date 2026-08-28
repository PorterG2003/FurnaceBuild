export const GET_LATEST_MESSAGE_JOBS_FOR_PAIRS_RPC = 'get_latest_message_jobs_for_pairs';

/**
 * Must match the pair cap inside get_latest_message_jobs_for_pairs. The RPC
 * truncates past this; chunking here keeps a larger claim batch from silently
 * losing pairs (a missing pair reads as "no attempt yet" and re-arms the send).
 */
export const LATEST_MESSAGE_JOB_PAIR_CHUNK_SIZE = 200;

export function chunkMessageJobPairs<T>(pairs: T[], size = LATEST_MESSAGE_JOB_PAIR_CHUNK_SIZE): T[][] {
  if (pairs.length <= size) {
    return [pairs];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < pairs.length; index += size) {
    chunks.push(pairs.slice(index, index + size));
  }
  return chunks;
}

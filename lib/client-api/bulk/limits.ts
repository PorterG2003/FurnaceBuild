import {
  BULK_ASYNC_LIMIT,
  BULK_SYNC_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_ASYNC_JOBS_PER_ACCOUNT,
  MAX_PAGE_SIZE,
  MAX_QUEUED_ASYNC_JOBS_PER_ACCOUNT,
  STAGED_IMPORT_APPEND_LIMIT,
  BULK_EXPLICIT_EXCLUSION_LIMIT,
} from '../openapi/constants.js';
import { API_BULK_SCOPE_KINDS } from './scope.js';
import { IMPORT_JOB_OPERATIONS } from '../openapi/constants.js';

export type ClientApiLimitsGuide = {
  default_page_size: number;
  max_page_size: number;
  bulk_sync_limit: number;
  bulk_async_limit: number;
  /** Max jobs in `running` status per account (worker claim slots). */
  max_async_jobs_per_account: number;
  /** Max jobs in `queued` status per account (pending work). */
  max_queued_async_jobs_per_account: number;
  staged_import_append_limit: number;
  bulk_explicit_exclusion_limit: number;
  supported_scope_kinds: readonly string[];
  supported_job_operations: readonly string[];
  file_ingress: {
    staged_json_batches: boolean;
    presigned_object_upload: boolean;
    local_path_not_supported: true;
  };
};

export function buildClientApiLimitsGuide(): ClientApiLimitsGuide {
  return {
    default_page_size: DEFAULT_PAGE_SIZE,
    max_page_size: MAX_PAGE_SIZE,
    bulk_sync_limit: BULK_SYNC_LIMIT,
    bulk_async_limit: BULK_ASYNC_LIMIT,
    max_async_jobs_per_account: MAX_ASYNC_JOBS_PER_ACCOUNT,
    max_queued_async_jobs_per_account: MAX_QUEUED_ASYNC_JOBS_PER_ACCOUNT,
    staged_import_append_limit: STAGED_IMPORT_APPEND_LIMIT,
    bulk_explicit_exclusion_limit: BULK_EXPLICIT_EXCLUSION_LIMIT,
    supported_scope_kinds: [...API_BULK_SCOPE_KINDS],
    supported_job_operations: [...IMPORT_JOB_OPERATIONS],
    file_ingress: {
      staged_json_batches: true,
      presigned_object_upload: true,
      local_path_not_supported: true,
    },
  };
}

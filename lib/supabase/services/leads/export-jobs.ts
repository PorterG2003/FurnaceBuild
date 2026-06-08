import { supabase } from '../../client';
import type { Json } from '../../types/database';
import {
  enqueueAccountImportJob,
  getAccountImportJob,
  type AccountImportJobSnapshot,
} from './add-to-campaign-jobs';
import type { LeadsColumnDef } from '@/lib/leads/columns';
import type { AccountLeadExplorerQuery } from './account-leads';
import type { SavedLeadListPeopleQuery } from './saved-lists';

export type LeadsExportSource = 'explorer' | 'saved_list';

export type StartLeadsExportJobParams = {
  source: LeadsExportSource;
  globalLeadIds?: string[];
  listId?: string | null;
  query: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'> | Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'>;
  columns: LeadsColumnDef[];
  totalCount: number;
  filenameBase?: string | null;
};

export async function startLeadsExportJob(
  accountId: string,
  params: StartLeadsExportJobParams,
): Promise<string> {
  const { data, error } = await supabase.rpc('start_leads_export_job', {
    p_account_id: accountId,
    p_source: params.source,
    p_global_lead_ids: params.globalLeadIds?.length ? [...new Set(params.globalLeadIds.filter(Boolean))] : [],
    p_list_id: params.listId ?? null,
    p_query: params.query as unknown as Json,
    p_column_layout: params.columns as unknown as Json,
    p_total_count: params.totalCount,
    p_filename_base: params.filenameBase ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error('Failed to create export job.');
  }
  return String(data);
}

export { enqueueAccountImportJob, getAccountImportJob };

export function mapImportJobToLeadsExportResult(job: AccountImportJobSnapshot): {
  rowsExported: number;
  downloadUrl: string | null;
  filename: string | null;
  currentStep: string | null;
  totalRows: number;
  rowsProcessed: number;
} {
  const result = (job.result && typeof job.result === 'object' ? job.result : {}) as Record<string, unknown>;
  return {
    rowsExported: typeof result.rows_exported === 'number' ? result.rows_exported : 0,
    downloadUrl: typeof result.download_url === 'string' ? result.download_url : null,
    filename: typeof result.filename === 'string' ? result.filename : null,
    currentStep: typeof result.current_step === 'string' ? result.current_step : null,
    totalRows: typeof result.total_rows === 'number' ? result.total_rows : 0,
    rowsProcessed: typeof result.rows_processed === 'number' ? result.rows_processed : 0,
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CsvBuilderColumnRow,
  CsvBuilderColumnJobRow,
  CsvBuilderToolType,
  PostCreateCsvBuilderColumnBody,
  PostRerunCsvBuilderColumnBody,
} from '../../registry-types.js';
import { queueCsvBuilderColumnJob } from './csvBuilderToolJobs.js';

export function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function assertSupportedToolType(value: unknown): CsvBuilderToolType {
  const toolType = trimText(value) as CsvBuilderToolType;
  if (
    toolType !== 'website_verification' &&
    toolType !== 'google_ads_verification' &&
    toolType !== 'state_matching' &&
    toolType !== 'contact_enrichment'
  ) {
    throw new Error('tool_type is required and must be a supported CSV Builder tool');
  }
  return toolType;
}

export async function nextColumnPositionAndKey(
  leadsClient: SupabaseClient,
  runId: string,
): Promise<{ position: number; key: string }> {
  const { data, error } = await leadsClient
    .from('csv_builder_columns')
    .select('position, key')
    .eq('run_id', runId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const nextPosition = typeof data?.position === 'number' ? data.position + 1 : 0;
  return {
    position: nextPosition,
    key: `c${String(nextPosition + 1).padStart(3, '0')}`,
  };
}

export async function listCsvBuilderColumns(
  leadsClient: SupabaseClient,
  runId: string,
): Promise<CsvBuilderColumnRow[]> {
  const { data, error } = await leadsClient
    .from('csv_builder_columns')
    .select('*')
    .eq('run_id', runId)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CsvBuilderColumnRow[];
}

export async function getCsvBuilderColumn(
  leadsClient: SupabaseClient,
  columnId: string,
): Promise<CsvBuilderColumnRow | null> {
  const { data, error } = await leadsClient.from('csv_builder_columns').select('*').eq('id', columnId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as CsvBuilderColumnRow | null;
}

export async function createCsvBuilderColumn(
  leadsClient: SupabaseClient,
  runId: string,
  body: PostCreateCsvBuilderColumnBody,
): Promise<{ column: CsvBuilderColumnRow; column_job: CsvBuilderColumnJobRow }> {
  const label = trimText(body.label);
  if (!label) throw new Error('label is required');
  const toolType = assertSupportedToolType(body.tool_type);
  const inputColumnIds = Array.isArray(body.input_column_ids)
    ? body.input_column_ids.map((value) => trimText(value)).filter(Boolean)
    : [];
  if (inputColumnIds.length === 0) throw new Error('input_column_ids must include at least one column');
  const next = await nextColumnPositionAndKey(leadsClient, runId);
  const { data, error } = await leadsClient
    .from('csv_builder_columns')
    .insert({
      run_id: runId,
      key: next.key,
      label,
      kind: 'tool_output',
      data_type: 'text',
      position: next.position,
      visible: true,
      tool_type: toolType,
      tool_config: body.tool_config ?? {},
      input_column_ids: inputColumnIds,
      status: 'ready',
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to create CSV Builder column');
  const job = await queueCsvBuilderColumnJob(leadsClient, {
    runId,
    columnId: data.id as string,
    toolType,
    mode: 'create_column',
    config: body.tool_config ?? {},
    inputColumnIds,
  });

  await leadsClient
    .from('csv_builder_runs')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', runId);

  return { column: data as CsvBuilderColumnRow, column_job: job as CsvBuilderColumnJobRow };
}

export async function rerunCsvBuilderColumn(
  leadsClient: SupabaseClient,
  columnId: string,
  body?: PostRerunCsvBuilderColumnBody,
): Promise<{ column: CsvBuilderColumnRow; column_job: CsvBuilderColumnJobRow }> {
  const column = await getCsvBuilderColumn(leadsClient, columnId);
  if (!column) throw new Error('CSV Builder column not found');
  const patch: Record<string, unknown> = {
    status: 'ready',
    updated_at: new Date().toISOString(),
    last_run_at: new Date().toISOString(),
  };
  if (body?.tool_config && typeof body.tool_config === 'object') {
    patch.tool_config = body.tool_config;
  }
  const { data, error } = await leadsClient
    .from('csv_builder_columns')
    .update(patch)
    .eq('id', columnId)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to update CSV Builder column');
  const job = await queueCsvBuilderColumnJob(leadsClient, {
    runId: column.run_id,
    columnId: column.id,
    toolType: column.tool_type as CsvBuilderToolType,
    mode: 'rerun_column',
    config: (body?.tool_config && typeof body.tool_config === 'object' ? body.tool_config : column.tool_config) ?? {},
    inputColumnIds: column.input_column_ids ?? [],
  });

  await leadsClient
    .from('csv_builder_runs')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', column.run_id);

  return { column: data as CsvBuilderColumnRow, column_job: job as CsvBuilderColumnJobRow };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CsvBuilderColumnJobMode,
  CsvBuilderColumnJobRow,
  CsvBuilderColumnRow,
  CsvBuilderToolJobConfig,
  CsvBuilderToolJobRow,
  CsvBuilderToolManifestOutput,
  CsvBuilderToolType,
  PostCreateCsvBuilderToolJobBody,
  PostRerunCsvBuilderToolJobBody,
} from '../../registry-types.js';
import { getCsvBuilderSelectedOutputs } from './toolOutputSchema.js';
import { getCsvBuilderToolManifest } from './toolManifest.js';
import { nextColumnPositionAndKey, trimText } from './csvBuilderColumns.js';

export const CSV_BUILDER_TOOL_EXECUTION_FAMILIES: Record<CsvBuilderToolType, 'ecs' | 'lambda'> = {
  website_verification: 'ecs',
  google_ads_verification: 'ecs',
  state_matching: 'ecs',
  contact_enrichment: 'lambda',
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function normalizeToolConfig(toolType: CsvBuilderToolType, raw: unknown): CsvBuilderToolJobConfig {
  const config = asObject(raw);
  const inputMapping = asObject(config.input_mapping);
  const normalized: CsvBuilderToolJobConfig = {
    tool_type: toolType,
    input_mapping: Object.fromEntries(
      Object.entries(inputMapping)
        .map(([key, value]) => [key, trimText(value)])
        .filter(([, value]) => Boolean(value)),
    ),
    selected_outputs: asStringArray(config.selected_outputs),
    include_raw_json: config.include_raw_json === true,
    depends_on_job_id: trimText(config.depends_on_job_id) || null,
    result_parser_version: trimText(config.result_parser_version) || 'v1',
  };
  return normalized;
}

function validateToolConfig(toolType: CsvBuilderToolType, config: CsvBuilderToolJobConfig): CsvBuilderToolManifestOutput[] {
  const manifest = getCsvBuilderToolManifest(toolType);
  if (!manifest.supported) throw new Error(`${manifest.label} is not yet supported in CSV Builder`);
  const hasWebsiteFallback =
    toolType === 'google_ads_verification' &&
    (trimText(config.input_mapping.website) || trimText(config.input_mapping.website_verification_final_url));
  for (const input of manifest.inputs) {
    if (toolType === 'google_ads_verification' && input.key === 'website' && hasWebsiteFallback) continue;
    if (input.required && !trimText(config.input_mapping[input.key])) {
      throw new Error(`${input.label} is required`);
    }
  }
  const selectedOutputs = getCsvBuilderSelectedOutputs(toolType, config.selected_outputs, config.include_raw_json === true);
  if (selectedOutputs.length === 0) {
    throw new Error('Select at least one output column or enable raw JSON output');
  }
  const allowedOutputKeys = new Set(manifest.outputs.map((output) => output.key));
  for (const outputKey of config.selected_outputs) {
    if (!allowedOutputKeys.has(outputKey)) throw new Error(`Unsupported output selected: ${outputKey}`);
  }
  return selectedOutputs;
}

async function insertOutputColumns(
  leadsClient: SupabaseClient,
  args: {
    runId: string;
    label?: string;
    toolType: CsvBuilderToolType;
    config: CsvBuilderToolJobConfig;
    outputDefinitions: CsvBuilderToolManifestOutput[];
  },
): Promise<CsvBuilderColumnRow[]> {
  const inputColumnIds = [...new Set(Object.values(args.config.input_mapping).map((value) => trimText(value)).filter(Boolean))];
  let cursor = await nextColumnPositionAndKey(leadsClient, args.runId);
  const baseLabel = trimText(args.label) || getCsvBuilderToolManifest(args.toolType).label;
  const rowsToInsert = args.outputDefinitions.map((output, index) => {
    const position = cursor.position + index;
    const key = `c${String(position + 1).padStart(3, '0')}`;
    const label =
      args.outputDefinitions.length === 1 && !output.is_raw_json ? baseLabel : `${baseLabel}: ${output.label}`;
    return {
      run_id: args.runId,
      key,
      label,
      kind: 'tool_output',
      data_type: output.data_type,
      position,
      visible: true,
      tool_type: args.toolType,
      tool_job_id: null,
      tool_output_key: output.key,
      tool_output_label: output.label,
      tool_config: args.config,
      input_column_ids: inputColumnIds,
      status: 'queued',
    };
  });
  const { data, error } = await leadsClient.from('csv_builder_columns').insert(rowsToInsert).select('*');
  if (error || !data) throw new Error(error?.message ?? 'Failed to create CSV Builder output columns');
  return data as CsvBuilderColumnRow[];
}

export async function listCsvBuilderToolJobs(
  leadsClient: SupabaseClient,
  runId: string,
): Promise<CsvBuilderToolJobRow[]> {
  const { data, error } = await leadsClient
    .from('csv_builder_column_jobs')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CsvBuilderToolJobRow[];
}

export async function getCsvBuilderToolJob(
  leadsClient: SupabaseClient,
  jobId: string,
): Promise<CsvBuilderToolJobRow | null> {
  const { data, error } = await leadsClient.from('csv_builder_column_jobs').select('*').eq('id', jobId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as CsvBuilderToolJobRow | null;
}

export async function queueCsvBuilderColumnJob(
  leadsClient: SupabaseClient,
  args: {
    runId: string;
    columnId: string;
    toolType: CsvBuilderToolType;
    mode: CsvBuilderColumnJobMode;
    config?: Record<string, unknown>;
    inputColumnIds?: string[];
    outputColumnIds?: string[];
    selectedOutputKeys?: string[];
    resultParserVersion?: string | null;
  },
): Promise<CsvBuilderColumnJobRow> {
  const { data, error } = await leadsClient
    .from('csv_builder_column_jobs')
    .insert({
      run_id: args.runId,
      column_id: args.columnId,
      tool_type: args.toolType,
      mode: args.mode,
      config: args.config ?? {},
      input_column_ids: args.inputColumnIds ?? [],
      output_column_ids: args.outputColumnIds ?? [],
      selected_output_keys: args.selectedOutputKeys ?? [],
      result_parser_version: args.resultParserVersion ?? 'v1',
      status: 'queued',
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to create CSV Builder column job');
  return data as CsvBuilderColumnJobRow;
}

export async function createCsvBuilderToolJob(
  leadsClient: SupabaseClient,
  runId: string,
  body: PostCreateCsvBuilderToolJobBody,
): Promise<{ job: CsvBuilderToolJobRow; columns: CsvBuilderColumnRow[] }> {
  const config = normalizeToolConfig(body.tool_type, body.config);
  const outputs = validateToolConfig(body.tool_type, config);
  const columns = await insertOutputColumns(leadsClient, {
    runId,
    label: body.label,
    toolType: body.tool_type,
    config,
    outputDefinitions: outputs,
  });
  const inputColumnIds = [...new Set(Object.values(config.input_mapping).filter(Boolean))];
  const job = await queueCsvBuilderColumnJob(leadsClient, {
    runId,
    columnId: columns[0].id,
    toolType: body.tool_type,
    mode: 'create_column',
    config: config as unknown as Record<string, unknown>,
    inputColumnIds,
    outputColumnIds: columns.map((column) => column.id),
    selectedOutputKeys: outputs.map((output) => output.key),
    resultParserVersion: config.result_parser_version ?? 'v1',
  });
  const { data: updatedColumns, error: updateErr } = await leadsClient
    .from('csv_builder_columns')
    .update({ tool_job_id: job.id })
    .in('id', columns.map((column) => column.id))
    .select('*');
  if (updateErr) throw new Error(updateErr.message);
  await leadsClient
    .from('csv_builder_runs')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', runId);
  return {
    job,
    columns: ((updatedColumns ?? columns) as CsvBuilderColumnRow[]).sort((a, b) => a.position - b.position),
  };
}

export async function rerunCsvBuilderToolJob(
  leadsClient: SupabaseClient,
  jobId: string,
  body?: PostRerunCsvBuilderToolJobBody,
): Promise<{ job: CsvBuilderToolJobRow; columns: CsvBuilderColumnRow[] }> {
  const existing = await getCsvBuilderToolJob(leadsClient, jobId);
  if (!existing) throw new Error('CSV Builder tool job not found');
  const existingConfig = normalizeToolConfig(existing.tool_type as CsvBuilderToolType, existing.config);
  const nextConfig = body?.config ? normalizeToolConfig(existing.tool_type as CsvBuilderToolType, body.config) : existingConfig;
  const outputs = validateToolConfig(existing.tool_type as CsvBuilderToolType, nextConfig);
  const { data: existingColumnsData, error: existingColumnsErr } = await leadsClient
    .from('csv_builder_columns')
    .select('*')
    .in('id', existing.output_column_ids ?? []);
  if (existingColumnsErr) throw new Error(existingColumnsErr.message);
  let columns = (existingColumnsData ?? []) as CsvBuilderColumnRow[];
  const existingOutputKeys = new Set(columns.map((column) => column.tool_output_key).filter(Boolean));
  const missingOutputs = outputs.filter((output) => !existingOutputKeys.has(output.key));
  if (missingOutputs.length > 0) {
    const inserted = await insertOutputColumns(leadsClient, {
      runId: existing.run_id,
      label: columns[0]?.label?.split(':')[0]?.trim() || undefined,
      toolType: existing.tool_type as CsvBuilderToolType,
      config: nextConfig,
      outputDefinitions: missingOutputs,
    });
    columns = [...columns, ...inserted];
  }
  const outputColumnIds = columns
    .filter((column) => outputs.some((output) => output.key === column.tool_output_key))
    .map((column) => column.id);
  const { data, error } = await leadsClient
    .from('csv_builder_column_jobs')
    .update({
      mode: 'rerun_column',
      config: nextConfig as unknown as Record<string, unknown>,
      input_column_ids: [...new Set(Object.values(nextConfig.input_mapping).filter(Boolean))],
      output_column_ids: outputColumnIds,
      selected_output_keys: outputs.map((output) => output.key),
      result_parser_version: nextConfig.result_parser_version ?? 'v1',
      status: 'queued',
      rows_total: null,
      rows_completed: null,
      rows_failed: null,
      error_summary: null,
      started_at: null,
      completed_at: null,
    })
    .eq('id', jobId)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to update CSV Builder tool job');
  const { data: refreshedColumns, error: refreshColumnsErr } = await leadsClient
    .from('csv_builder_columns')
    .update({
      tool_job_id: jobId,
      tool_type: existing.tool_type,
      tool_config: nextConfig,
      input_column_ids: [...new Set(Object.values(nextConfig.input_mapping).filter(Boolean))],
      status: 'queued',
      last_run_at: new Date().toISOString(),
    })
    .in('id', outputColumnIds)
    .select('*');
  if (refreshColumnsErr) throw new Error(refreshColumnsErr.message);
  await leadsClient
    .from('csv_builder_runs')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', existing.run_id);
  return {
    job: data as CsvBuilderToolJobRow,
    columns: ((refreshedColumns ?? []) as CsvBuilderColumnRow[]).sort((a, b) => a.position - b.position),
  };
}

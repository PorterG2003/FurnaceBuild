import type { CsvBuilderToolManifestOutput, CsvBuilderToolType } from '../../registry-types.js';
import { getCsvBuilderToolManifest } from './toolManifest.js';

export function getCsvBuilderSelectedOutputs(
  toolType: CsvBuilderToolType,
  selectedOutputs: string[],
  includeRawJson = false,
): CsvBuilderToolManifestOutput[] {
  const manifest = getCsvBuilderToolManifest(toolType);
  const selected = new Set(selectedOutputs.filter(Boolean));
  return manifest.outputs.filter((output) => {
    if (output.is_raw_json) return includeRawJson;
    return selected.has(output.key);
  });
}

export function getCsvBuilderDefaultSelectedOutputKeys(toolType: CsvBuilderToolType): string[] {
  return getCsvBuilderToolManifest(toolType)
    .outputs.filter((output) => output.default_selected && !output.is_raw_json)
    .map((output) => output.key);
}

export function extractCsvBuilderToolOutputValue(
  toolType: CsvBuilderToolType,
  outputKey: string,
  rowResult: Record<string, unknown> | null | undefined,
): unknown {
  const result = rowResult ?? {};
  if (toolType === 'website_verification') {
    if (outputKey === 'band') return result.band ?? null;
    if (outputKey === 'score') return result.score ?? null;
    if (outputKey === 'input_url') return result.input_url ?? null;
    if (outputKey === 'final_url') return result.final_url ?? null;
    if (outputKey === 'reason_summary') return result.reason_summary ?? null;
    if (outputKey === 'raw_json') return result;
    return null;
  }
  if (toolType === 'google_ads_verification') {
    if (outputKey === 'result') return result.result ?? null;
    if (outputKey === 'search_domain') return result.search_domain ?? null;
    if (outputKey === 'advertiser_name') return result.advertiser_name ?? null;
    if (outputKey === 'advertiser_url') return result.advertiser_url ?? null;
    if (outputKey === 'raw_json') return result;
    return null;
  }
  return null;
}

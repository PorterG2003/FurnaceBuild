export {
  CSV_BUILDER_MAX_BYTES,
  CSV_BUILDER_MAX_COLUMNS,
  CSV_BUILDER_MAX_INLINE_REQUEST_BYTES,
  CSV_BUILDER_MAX_ROWS,
  parseCsvBuilderText,
  type ParsedCsvBuilderResult,
} from '../registry-server/csv-builder/parseCsv';
import {
  CSV_BUILDER_MAX_BYTES,
  parseCsvBuilderText,
  type ParsedCsvBuilderResult,
} from '../registry-server/csv-builder/parseCsv';

export async function parseCsvBuilderFile(file: File): Promise<ParsedCsvBuilderResult> {
  if (file.size > CSV_BUILDER_MAX_BYTES) {
    throw new Error(`CSV Builder supports uploads up to ${Math.round(CSV_BUILDER_MAX_BYTES / (1024 * 1024))} MB in v1.`);
  }
  const text = await file.text();
  return parseCsvBuilderText(text);
}

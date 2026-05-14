import { useCallback, useState } from 'react';
import { Alert, Platform, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import {
  createCsvBuilderRun,
  createCsvBuilderUploadUrl,
  estimateCsvBuilderCreateRunPayloadBytes,
} from '@/lib/foundry/registry-client';
import {
  parseCsvBuilderFile,
  CSV_BUILDER_MAX_BYTES,
  CSV_BUILDER_MAX_INLINE_REQUEST_BYTES,
} from '@/lib/foundry/csv-builder';

export function CsvBuilderUploadCard({
  accountId,
  defaultName = '',
}: {
  accountId: string;
  defaultName?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!accountId) {
        Alert.alert('Account required', 'No active account is selected for CSV Builder.');
        return;
      }
      if (file.size > CSV_BUILDER_MAX_BYTES) {
        Alert.alert('File too large', 'This file exceeds the CSV Builder upload limit for v1.');
        return;
      }
      setBusy(true);
      setWarnings([]);
      setFileName(file.name);
      try {
        const parsed = await parseCsvBuilderFile(file);
        if (parsed.rowCount === 0) {
          Alert.alert('No data', 'The CSV must include a header row and at least one data row.');
          return;
        }
        setWarnings(parsed.warnings.slice(0, 5));
        const createBody = {
          account_id: accountId,
          name: defaultName || file.name.replace(/\.[^.]+$/, ''),
          source_file_name: file.name,
          source_file_size_bytes: file.size,
          source_file_mime_type: file.type || null,
          headers: parsed.headers,
          rows: parsed.rows,
        } as const;
        const payloadBytes = estimateCsvBuilderCreateRunPayloadBytes(createBody);
        const result =
          payloadBytes <= CSV_BUILDER_MAX_INLINE_REQUEST_BYTES
            ? await createCsvBuilderRun(createBody)
            : await (async () => {
                const upload = await createCsvBuilderUploadUrl({
                  account_id: accountId,
                  source_file_name: file.name,
                  source_file_size_bytes: file.size,
                  source_file_mime_type: file.type || null,
                });
                const uploadResponse = await fetch(upload.upload_url, {
                  method: upload.upload_method,
                  headers: upload.upload_headers,
                  body: file,
                });
                if (!uploadResponse.ok) {
                  throw new Error(`File upload failed (${uploadResponse.status})`);
                }
                return createCsvBuilderRun({
                  account_id: accountId,
                  name: createBody.name,
                  source_file_name: file.name,
                  source_file_size_bytes: file.size,
                  source_file_mime_type: file.type || null,
                  source_s3_key: upload.object_key,
                });
              })();
        router.push(`/foundry/csv-builder/${result.run.id}`);
      } catch (error) {
        Alert.alert('CSV Builder upload failed', error instanceof Error ? error.message : 'Could not parse the CSV.');
      } finally {
        setBusy(false);
      }
    },
    [accountId, defaultName, router],
  );

  const chooseFile = useCallback(() => {
    if (Platform.OS !== 'web') {
      Alert.alert('Web only', 'CSV Builder upload is available on web for now.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv,text/tab-separated-values';
    input.value = '';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) await handleFile(file);
    };
    input.click();
  }, [handleFile]);

  return (
    <Card variant="card">
      <Text className="text-white font-instrument-semibold text-base mb-2">Upload CSV</Text>
      <Text className="text-gray-400 font-instrument text-sm leading-5 mb-4">
        CSV Builder supports UTF-8 CSV files up to roughly 50k rows or 25 MB. Parsing happens in the browser, then the
        sheet is persisted as a shared Foundry workspace.
      </Text>
      <Button onPress={chooseFile} disabled={busy} className="self-start">
        {busy ? 'Uploading…' : 'Choose CSV file'}
      </Button>
      {fileName ? <Text className="text-gray-400 font-instrument text-xs mt-3">Selected: {fileName}</Text> : null}
      {warnings.map((warning, index) => (
        <Text key={`${warning}-${index}`} className="text-amber-300 font-instrument text-xs mt-2 leading-5">
          {warning}
        </Text>
      ))}
    </Card>
  );
}

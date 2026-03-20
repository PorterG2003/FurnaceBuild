import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Text, TouchableOpacity, View } from 'react-native';
import Papa from 'papaparse';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/DataTable';
import { MultiSegmentDial } from '@/components/ui/multi-segment-dial';
import { createMailbox } from '@/lib/supabase/services';
import { testMailboxConnection } from '@/lib/services/email';
import type { MailboxInsert } from '@/lib/supabase/types';

type ConnectionTestResult =
  | { success: boolean; smtp: { success: boolean; error?: string }; imap: { success: boolean; error?: string }; message: string }
  | 'testing';

const UTF8_BOM = '\ufeff';

/** Required columns in the expected header format (from_email, user_name, etc.). */
const REQUIRED_COLUMNS = [
  'from_email',
  'password',
  'smtp_host',
  'smtp_port',
  'imap_host',
  'imap_port',
  'user_name',
] as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TEMPLATE_HEADERS =
  'from_name,from_email,user_name,password,smtp_host,smtp_port,imap_host,imap_port,max_email_per_day,custom_tracking_url,warmup_enabled,total_warmup_per_day,daily_rampup,reply_rate_percentage,bcc,signature,different_reply_to_address,imap_user_name,imap_password';
const TEMPLATE_ROW =
  'Your Name,you@example.com,you@example.com,yourpassword,smtp.example.com,587,imap.example.com,993,50,,,,,,,you@example.com,yourpassword';

function parseCSV(csvText: string): Record<string, string>[] {
  const trimmed = csvText.trim();
  if (!trimmed.length) return [];
  const withoutBOM = trimmed.startsWith(UTF8_BOM) ? trimmed.slice(UTF8_BOM.length) : trimmed;
  const firstLine = withoutBOM.split(/\r?\n/)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const result = Papa.parse<Record<string, string>>(withoutBOM, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    delimiter,
  });
  if (result.errors.length > 0) {
    const first = result.errors[0];
    throw new Error(first?.message ? `Invalid CSV: ${first.message}` : 'Invalid CSV: check header row and quoted fields.');
  }
  const fields = result.meta.fields ?? (result.data[0] ? Object.keys(result.data[0]) : []);
  return result.data.map((row) => {
    const out: Record<string, string> = {};
    fields.forEach((header) => {
      const val = row[header];
      out[header] = val != null ? String(val).trim() : '';
    });
    return out;
  });
}

function getCell(row: Record<string, string>, key: string): string {
  const lower = key.toLowerCase();
  const found = Object.keys(row).find((k) => k.toLowerCase() === lower);
  return found != null ? (row[found] ?? '').trim() : '';
}

export interface ValidationError {
  rowIndex: number;
  message: string;
}

function validateRow(row: Record<string, string>, rowIndex1Based: number): ValidationError | null {
  for (const col of REQUIRED_COLUMNS) {
    const val = getCell(row, col);
    if (!val) return { rowIndex: rowIndex1Based, message: `missing ${col}` };
  }
  const smtpPort = getCell(row, 'smtp_port');
  const imapPort = getCell(row, 'imap_port');
  if (smtpPort && (Number.isNaN(Number(smtpPort)) || Number(smtpPort) < 1 || Number(smtpPort) > 65535))
    return { rowIndex: rowIndex1Based, message: 'invalid smtp_port' };
  if (imapPort && (Number.isNaN(Number(imapPort)) || Number(imapPort) < 1 || Number(imapPort) > 65535))
    return { rowIndex: rowIndex1Based, message: 'invalid imap_port' };
  const email = getCell(row, 'from_email');
  if (email && !EMAIL_REGEX.test(email))
    return { rowIndex: rowIndex1Based, message: 'invalid from_email format' };
  return null;
}

function rowToTestParams(row: Record<string, string>) {
  const password = getCell(row, 'password');
  const imapPassword = getCell(row, 'imap_password');
  const userName = getCell(row, 'user_name');
  const imapUserName = getCell(row, 'imap_user_name');
  return {
    smtp_host: getCell(row, 'smtp_host'),
    smtp_port: parseInt(getCell(row, 'smtp_port'), 10) || 587,
    smtp_username: userName,
    smtp_password: password,
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: getCell(row, 'imap_host'),
    imap_port: parseInt(getCell(row, 'imap_port'), 10) || 993,
    imap_username: imapUserName || userName,
    imap_password: imapPassword || password,
    imap_use_ssl: true,
  };
}

function rowToMailboxInsert(
  row: Record<string, string>,
  accountId: string,
  userId: string
): MailboxInsert {
  const password = getCell(row, 'password');
  const imapPassword = getCell(row, 'imap_password');
  const userName = getCell(row, 'user_name');
  const imapUserName = getCell(row, 'imap_user_name');
  const maxPerDay = getCell(row, 'max_email_per_day');
  return {
    account_id: accountId,
    user_id: userId,
    email_address: getCell(row, 'from_email'),
    display_name: getCell(row, 'from_name') || null,
    signature: getCell(row, 'signature') || null,
    provider: 'custom',
    smtp_host: getCell(row, 'smtp_host'),
    smtp_port: parseInt(getCell(row, 'smtp_port'), 10) || 587,
    smtp_username: userName,
    smtp_password: password,
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: getCell(row, 'imap_host'),
    imap_port: parseInt(getCell(row, 'imap_port'), 10) || 993,
    imap_username: imapUserName || userName,
    imap_password: imapPassword || password,
    imap_use_ssl: true,
    status: 'connected',
    min_gap_seconds: null,
    daily_limit: maxPerDay ? parseInt(maxPerDay, 10) : null,
    hourly_limit: null,
  };
}

function downloadTemplate() {
  const csv = [TEMPLATE_HEADERS, TEMPLATE_ROW].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mailboxes_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export interface UploadMailboxesCSVModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (created: number, failed: number) => void;
  accountId: string;
  userId: string;
}

export function UploadMailboxesCSVModal({
  visible,
  onClose,
  onSuccess,
  accountId,
  userId,
}: UploadMailboxesCSVModalProps) {
  const [step, setStep] = useState<0 | 1>(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [connectionResults, setConnectionResults] = useState<Record<number, ConnectionTestResult>>({});
  const [testingConnections, setTestingConnections] = useState(false);

  const validRows = rows.filter((_, i) => !errors.some((e) => e.rowIndex === i + 1));
  const validCount = validRows.length;

  /** Table items: valid rows with their 1-based row index and connection result. */
  const previewTableItems = rows
    .map((row, i) => ({ row, rowIndex1Based: i + 1 }))
    .filter((item) => !errors.some((e) => e.rowIndex === item.rowIndex1Based))
    .map((item) => ({
      ...item,
      connectionResult: connectionResults[item.rowIndex1Based],
    }));

  /** Connection pass counts for the multi-segment dial: both, SMTP only, IMAP only, both fail, testing. */
  const connectionDialCounts = (() => {
    let bothPass = 0;
    let smtpOnly = 0;
    let imapOnly = 0;
    let bothFail = 0;
    let testing = 0;
    previewTableItems.forEach((item) => {
      const r = item.connectionResult;
      if (r === undefined || r === 'testing') {
        testing++;
        return;
      }
      const smtpOk = r.smtp?.success ?? false;
      const imapOk = r.imap?.success ?? false;
      if (smtpOk && imapOk) bothPass++;
      else if (smtpOk) smtpOnly++;
      else if (imapOk) imapOnly++;
      else bothFail++;
    });
    return { bothPass, smtpOnly, imapOnly, bothFail, testing };
  })();
  const connectionDialSegments = [
    { value: connectionDialCounts.bothPass, color: '#10b981' },
    { value: connectionDialCounts.smtpOnly, color: '#f59e0b' },
    { value: connectionDialCounts.imapOnly, color: '#3b82f6' },
    { value: connectionDialCounts.bothFail, color: '#ef4444' },
    { value: connectionDialCounts.testing, color: '#6b7280' },
  ].filter((s) => s.value > 0);

  const hasAutoTestedRef = useRef(false);
  const testsAbortedRef = useRef(false);

  const CONNECTION_TEST_BATCH_SIZE = 5;

  const runConnectionTests = async () => {
    testsAbortedRef.current = false;
    setTestingConnections(true);
    const validIndices: { index1Based: number; row: Record<string, string> }[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (errors.some((e) => e.rowIndex === i + 1)) continue;
      validIndices.push({ index1Based: i + 1, row: rows[i] });
    }
    const testingState: Record<number, ConnectionTestResult> = Object.fromEntries(
      validIndices.map(({ index1Based }) => [index1Based, 'testing'])
    );
    setConnectionResults((prev) => ({ ...prev, ...testingState }));

    if (testsAbortedRef.current) { setTestingConnections(false); return; }

    for (let b = 0; b < validIndices.length; b += CONNECTION_TEST_BATCH_SIZE) {
      if (testsAbortedRef.current) { setTestingConnections(false); return; }
      const batch = validIndices.slice(b, b + CONNECTION_TEST_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async ({ index1Based, row }) => {
          try {
            return await testMailboxConnection(rowToTestParams(row));
          } catch (err) {
            return {
              success: false,
              smtp: { success: false, error: err instanceof Error ? err.message : 'Failed' },
              imap: { success: false, error: err instanceof Error ? err.message : 'Failed' },
              message: err instanceof Error ? err.message : 'Connection test failed',
            };
          }
        })
      );
      if (testsAbortedRef.current) { setTestingConnections(false); return; }
      const batchUpdate: Record<number, ConnectionTestResult> = {};
      batch.forEach(({ index1Based }, j) => {
        batchUpdate[index1Based] = results[j];
      });
      setConnectionResults((prev) => ({ ...prev, ...batchUpdate }));
    }
    setTestingConnections(false);
  };

  useEffect(() => {
    if (step === 1 && validCount > 0 && !hasAutoTestedRef.current) {
      hasAutoTestedRef.current = true;
      runConnectionTests();
    }
    if (step === 0) hasAutoTestedRef.current = false;
  }, [step, validCount]);

  const handleFileSelect = () => {
    if (Platform.OS !== 'web') {
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.value = '';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        let text = await file.text();
        const data = parseCSV(text);
        if (!data.length) {
          setRows([]);
          setErrors([{ rowIndex: 0, message: 'No data rows found' }]);
          setFileName(file.name);
          return;
        }
        setFileName(file.name);
        setRows(data);
        const errs: ValidationError[] = [];
        data.forEach((row, i) => {
          const e = validateRow(row, i + 1);
          if (e) errs.push(e);
        });
        const emailToRows = new Map<string, number[]>();
        data.forEach((row, i) => {
          const email = getCell(row, 'from_email').toLowerCase();
          if (!email) return;
          const existing = emailToRows.get(email);
          if (existing) existing.push(i + 1);
          else emailToRows.set(email, [i + 1]);
        });
        emailToRows.forEach((rowIndices) => {
          if (rowIndices.length <= 1) return;
          for (const idx of rowIndices) {
            if (errs.some((e) => e.rowIndex === idx)) continue;
            const others = rowIndices.filter((r) => r !== idx).join(', ');
            errs.push({ rowIndex: idx, message: `duplicate from_email (also in row ${others})` });
          }
        });
        setErrors(errs);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to parse CSV';
        setErrors([{ rowIndex: 0, message }]);
        setRows([]);
        setFileName(file.name);
      }
    };
    input.click();
  };

  const handleCreate = async () => {
    if (!accountId || !userId || validCount === 0) return;
    setCreating(true);
    setCreatedCount(0);
    setFailedCount(0);
    let created = 0;
    let failed = 0;
    for (const row of validRows) {
      try {
        await createMailbox(rowToMailboxInsert(row, accountId, userId));
        created++;
        setCreatedCount(created);
      } catch {
        failed++;
        setFailedCount(failed);
      }
    }
    setCreating(false);
    onSuccess(created, failed);
    if (created > 0) onClose();
  };

  const handleClose = () => {
    testsAbortedRef.current = true;
    setStep(0);
    setFileName(null);
    setRows([]);
    setErrors([]);
    setCreatedCount(0);
    setFailedCount(0);
    setConnectionResults({});
    onClose();
  };

  if (Platform.OS !== 'web') {
    return (
      <BaseModal
        visible={visible}
        onClose={handleClose}
        title="Upload CSV"
        description="Upload CSV is available on web."
        maxWidth="md"
        footer={
          <ModalFooter>
            <Button onPress={handleClose} variant="secondary">
              Close
            </Button>
          </ModalFooter>
        }
      >
        <Text className="text-gray-400">Open this page in a browser to upload a CSV and create multiple mailboxes.</Text>
      </BaseModal>
    );
  }

  const description =
    step === 0
      ? 'Add multiple mailboxes from a CSV file'
      : 'Preview and validate';

  const footer =
    step === 0 ? (
      <ModalFooter>
        <Button onPress={handleClose} variant="secondary">
          Cancel
        </Button>
        <Button onPress={() => setStep(1)} disabled={rows.length === 0}>
          Next: Preview
        </Button>
      </ModalFooter>
    ) : (
      <ModalFooter>
        <Button
          onPress={() => {
            testsAbortedRef.current = true;
            setStep(0);
            setConnectionResults({});
          }}
          variant="secondary"
          disabled={creating}
        >
          Back
        </Button>
        <Button
          onPress={handleCreate}
          disabled={creating || validCount === 0 || testingConnections}
        >
          {creating ? `Creating... ${createdCount}/${validCount}` : `Create ${validCount} mailbox${validCount !== 1 ? 'es' : ''}`}
        </Button>
      </ModalFooter>
    );

  const footerMobile =
    step === 0 ? (
      <ModalFooter>
        <Button onPress={() => setStep(1)} disabled={rows.length === 0}>
          Next: Preview
        </Button>
      </ModalFooter>
    ) : (
      <ModalFooter>
        <Button
          onPress={handleCreate}
          disabled={creating || validCount === 0 || testingConnections}
        >
          {creating ? `Creating... ${createdCount}/${validCount}` : `Create ${validCount} mailbox${validCount !== 1 ? 'es' : ''}`}
        </Button>
      </ModalFooter>
    );

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Upload CSV"
      description={description}
      maxWidth="4xl"
      maxHeight={720}
      footer={footer}
      footerMobile={footerMobile}
    >
      {step === 0 && (
        <View className="gap-4">
          <Text className="text-gray-400 text-sm">
            Required: from_email, user_name, password, smtp_host, smtp_port, imap_host, imap_port. Optional: from_name,
            signature, max_email_per_day, imap_user_name, imap_password (defaults to password). Comma- or tab-separated.
            Extra columns are ignored.
          </Text>
          <TouchableOpacity
            onPress={handleFileSelect}
            className="border border-dashed border-white/30 rounded-xl p-6 items-center"
          >
            <Text className="text-white font-instrument-medium">
              {fileName ? fileName : 'Choose CSV File'}
            </Text>
            {fileName && rows.length > 0 && (
              <Text className="text-gray-500 text-sm mt-1">{rows.length} rows</Text>
            )}
          </TouchableOpacity>
          <Button variant="link" size="sm" onPress={downloadTemplate} className="self-start">
            Download template CSV
          </Button>
        </View>
      )}

      {step === 1 && (
        <View className="gap-4">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-white font-instrument-medium">
              {validCount} valid row{validCount !== 1 ? 's' : ''}
              {errors.length > 0 && ` · ${errors.length} error${errors.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
          {validCount > 0 && (
            <View className="flex-row flex-wrap items-center gap-6">
              <MultiSegmentDial
                segments={connectionDialSegments}
                total={validCount}
                size={120}
                strokeWidth={8}
                centerValue={connectionDialCounts.bothPass}
                centerTotal={validCount}
                centerTopLabel="Passed"
                centerBottomLabel="Total"
              />
              <View style={{ width: 300 }}>
                <View className="flex-row items-center gap-2 mb-1">
                  <View className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                  <Text className="text-gray-300 font-instrument text-sm">SMTP ✓ IMAP ✓</Text>
                  <Text className="text-white font-instrument text-sm ml-auto">{connectionDialCounts.bothPass}</Text>
                </View>
                <View className="flex-row items-center gap-2 mb-1">
                  <View className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#f59e0b' }} />
                  <Text className="text-gray-300 font-instrument text-sm">SMTP ✓ only</Text>
                  <Text className="text-white font-instrument text-sm ml-auto">{connectionDialCounts.smtpOnly}</Text>
                </View>
                <View className="flex-row items-center gap-2 mb-1">
                  <View className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
                  <Text className="text-gray-300 font-instrument text-sm">IMAP ✓ only</Text>
                  <Text className="text-white font-instrument text-sm ml-auto">{connectionDialCounts.imapOnly}</Text>
                </View>
                <View className="flex-row items-center gap-2 mb-1">
                  <View className="w-2.5 h-2.5 rounded-sm bg-red-500" />
                  <Text className="text-gray-300 font-instrument text-sm">Both failed</Text>
                  <Text className="text-white font-instrument text-sm ml-auto">{connectionDialCounts.bothFail}</Text>
                </View>
                {(connectionDialCounts.testing > 0) && (
                  <View className="flex-row items-center gap-2">
                    <View className="w-2.5 h-2.5 rounded-sm bg-gray-500" />
                    <Text className="text-gray-300 font-instrument text-sm">Testing…</Text>
                    <Text className="text-white font-instrument text-sm ml-auto">{connectionDialCounts.testing}</Text>
                  </View>
                )}
              </View>
            </View>
          )}
          {errors.length > 0 && (
            <View className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              {errors.slice(0, 10).map((e, i) => (
                <Text key={i} className="text-red-400 text-sm">
                  Row {e.rowIndex}: {e.message}
                </Text>
              ))}
              {errors.length > 10 && (
                <Text className="text-red-400/80 text-sm">... and {errors.length - 10} more</Text>
              )}
            </View>
          )}
          {validCount > 0 && (
            <View className="border border-white/20 rounded-lg overflow-hidden min-h-[120px]" style={{ borderImage: 'none' }}>
              <DataTable
                items={previewTableItems}
                columns={[
                  {
                    key: 'email',
                    label: 'Email',
                    flex: 1,
                    render: (item) => (
                      <Text className="text-white text-sm" numberOfLines={1}>
                        {getCell(item.row, 'from_email') || '—'}
                      </Text>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    flex: 1,
                    render: (item) => {
                      const r = item.connectionResult;
                      if (r === undefined) return <Text className="text-gray-500 text-sm">—</Text>;
                      if (r === 'testing') {
                        return (
                          <View className="flex-row items-center gap-1">
                            <ActivityIndicator size="small" color="#9ca3af" />
                            <Text className="text-gray-400 text-sm">Testing…</Text>
                          </View>
                        );
                      }
                      const smtpOk = r.smtp?.success ?? false;
                      const imapOk = r.imap?.success ?? false;
                      if (smtpOk && imapOk) {
                        return <Text className="text-emerald-400 text-sm">SMTP ✓ IMAP ✓</Text>;
                      }
                      const parts: string[] = [];
                      if (!smtpOk) parts.push(`SMTP ✗${r.smtp?.error ? ` ${r.smtp.error}` : ''}`);
                      if (!imapOk) parts.push(`IMAP ✗${r.imap?.error ? ` ${r.imap.error}` : ''}`);
                      return (
                        <Text className="text-red-400 text-sm" numberOfLines={2}>
                          {parts.join(' · ')}
                        </Text>
                      );
                    },
                  },
                ]}
                getItemKey={(item) => String(item.rowIndex1Based)}
                pagination={false}
                emptyMessage="No valid rows"
                equalColumnWidths
              />
            </View>
          )}
        </View>
      )}
    </BaseModal>
  );
}

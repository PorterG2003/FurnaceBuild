import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/DataTable';
import { MultiSegmentDial } from '@/components/ui/multi-segment-dial';
import {
  buildMailboxConnectionHealthUpdate,
  mailboxToTestMailboxConnectionParams,
  type TestConnectionResult,
} from '@/lib/mailbox/connectionHealth';
import {
  buildConnectionTestFailure,
  runBulkMailboxConnectionTests,
  type BulkMailboxConnectionTestItem,
} from '@/lib/mailbox/bulkConnectionTest';
import { testMailboxConnection } from '@/lib/services/email';
import { updateMailboxConnectionHealth, type MailboxOverview } from '@/lib/supabase/services/mailboxes';

type ConnectionResultState = TestConnectionResult | 'testing' | undefined;

export interface RetestMailboxesModalSummary {
  connected: number;
  failing: number;
  total: number;
}

export interface RetestMailboxesModalProps {
  visible: boolean;
  mailboxes: MailboxOverview[];
  onClose: () => void;
  onComplete?: (summary: RetestMailboxesModalSummary) => void | Promise<void>;
}

export function RetestMailboxesModal({
  visible,
  mailboxes,
  onClose,
  onComplete,
}: RetestMailboxesModalProps) {
  const [connectionResults, setConnectionResults] = useState<Record<string, ConnectionResultState>>({});
  const [completedCount, setCompletedCount] = useState(0);
  const [testingConnections, setTestingConnections] = useState(false);
  const hasStartedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const connectionItems = useMemo(
    () =>
      mailboxes.map((mailbox) => ({
        key: mailbox.id,
        input: mailbox,
        params: mailboxToTestMailboxConnectionParams(mailbox),
      })) satisfies BulkMailboxConnectionTestItem<MailboxOverview>[],
    [mailboxes],
  );

  const dialCounts = useMemo(() => {
    let bothPass = 0;
    let smtpOnly = 0;
    let imapOnly = 0;
    let bothFail = 0;
    let testing = 0;
    let notStarted = 0;

    for (const mailbox of mailboxes) {
      const result = connectionResults[mailbox.id];
      if (result === undefined) {
        notStarted += 1;
        continue;
      }
      if (result === 'testing') {
        testing += 1;
        continue;
      }

      const smtpOk = result.smtp?.success ?? false;
      const imapOk = result.imap?.success ?? false;
      if (smtpOk && imapOk) bothPass += 1;
      else if (smtpOk) smtpOnly += 1;
      else if (imapOk) imapOnly += 1;
      else bothFail += 1;
    }

    return { bothPass, smtpOnly, imapOnly, bothFail, testing, notStarted };
  }, [connectionResults, mailboxes]);

  const dialSegments = [
    { value: dialCounts.bothPass, color: '#10b981' },
    { value: dialCounts.smtpOnly, color: '#f59e0b' },
    { value: dialCounts.imapOnly, color: '#3b82f6' },
    { value: dialCounts.bothFail, color: '#ef4444' },
    { value: dialCounts.testing, color: '#6b7280' },
    { value: dialCounts.notStarted, color: '#374151' },
  ].filter((segment) => segment.value > 0);

  const summary = useMemo(
    () => ({
      connected: dialCounts.bothPass,
      failing: mailboxes.length - dialCounts.bothPass,
      total: mailboxes.length,
    }),
    [dialCounts.bothPass, mailboxes.length],
  );

  useEffect(() => {
    if (!visible || hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;
    abortControllerRef.current = new AbortController();
    setConnectionResults({});
    setCompletedCount(0);
    setTestingConnections(true);

    void runBulkMailboxConnectionTests({
      items: connectionItems,
      testFn: async (item) => {
        let result: TestConnectionResult;
        try {
          result = await testMailboxConnection(item.params);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed';
          result = buildConnectionTestFailure(message);
        }

        await updateMailboxConnectionHealth(
          item.input.id,
          buildMailboxConnectionHealthUpdate(result),
        );
        return result;
      },
      signal: abortControllerRef.current.signal,
      onProgress: ({ item, status, result, index }) => {
        if (status === 'testing') {
          setConnectionResults((prev) => ({ ...prev, [item.key]: 'testing' }));
          return;
        }

        if (result) {
          setConnectionResults((prev) => ({ ...prev, [item.key]: result }));
        }
        setCompletedCount(index + 1);
      },
    })
      .then(async (outcomes) => {
        if (abortControllerRef.current?.signal.aborted) {
          return;
        }
        const finalConnected = outcomes.filter((outcome) => outcome.result.success).length;
        await onComplete?.({
          connected: finalConnected,
          failing: outcomes.length - finalConnected,
          total: outcomes.length,
        });
      })
      .finally(() => {
        setTestingConnections(false);
      });
  }, [connectionItems, onComplete, visible]);

  const handleClose = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    hasStartedRef.current = false;
    setTestingConnections(false);
    setCompletedCount(0);
    setConnectionResults({});
    onClose();
  };

  const footer = (
    <ModalFooter>
      <Button onPress={handleClose} variant="secondary">
        {testingConnections ? 'Stop testing' : 'Close'}
      </Button>
    </ModalFooter>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Re-test connections"
      description={`Sequentially re-test ${mailboxes.length} mailbox connection${mailboxes.length === 1 ? '' : 's'} and refresh their stored health.`}
      maxWidth="4xl"
      maxHeight={720}
      footer={footer}
      footerMobile={footer}
    >
      {mailboxes.length === 0 ? (
        <Text className="text-gray-400">No mailboxes selected for retest.</Text>
      ) : (
        <View className="gap-4">
          <View className="flex-row flex-wrap items-center gap-6">
            <MultiSegmentDial
              segments={dialSegments}
              total={mailboxes.length}
              size={120}
              strokeWidth={8}
              centerValue={summary.connected}
              centerTotal={summary.total}
              centerTopLabel="Connected"
              centerBottomLabel="Total"
            />
            <View style={{ width: 320 }}>
              <View className="flex-row items-center gap-2 mb-1">
                <View className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                <Text className="text-gray-300 font-instrument text-sm">SMTP ✓ IMAP ✓</Text>
                <Text className="text-white font-instrument text-sm ml-auto">{dialCounts.bothPass}</Text>
              </View>
              <View className="flex-row items-center gap-2 mb-1">
                <View className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#f59e0b' }} />
                <Text className="text-gray-300 font-instrument text-sm">SMTP ✓ only</Text>
                <Text className="text-white font-instrument text-sm ml-auto">{dialCounts.smtpOnly}</Text>
              </View>
              <View className="flex-row items-center gap-2 mb-1">
                <View className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
                <Text className="text-gray-300 font-instrument text-sm">IMAP ✓ only</Text>
                <Text className="text-white font-instrument text-sm ml-auto">{dialCounts.imapOnly}</Text>
              </View>
              <View className="flex-row items-center gap-2 mb-1">
                <View className="w-2.5 h-2.5 rounded-sm bg-red-500" />
                <Text className="text-gray-300 font-instrument text-sm">Both failed</Text>
                <Text className="text-white font-instrument text-sm ml-auto">{dialCounts.bothFail}</Text>
              </View>
              {dialCounts.testing > 0 ? (
                <View className="flex-row items-center gap-2 mb-1">
                  <View className="w-2.5 h-2.5 rounded-sm bg-gray-500" />
                  <Text className="text-gray-300 font-instrument text-sm">Testing…</Text>
                  <Text className="text-white font-instrument text-sm ml-auto">{dialCounts.testing}</Text>
                </View>
              ) : null}
              {dialCounts.notStarted > 0 ? (
                <View className="flex-row items-center gap-2">
                  <View className="w-2.5 h-2.5 rounded-sm bg-gray-700" />
                  <Text className="text-gray-300 font-instrument text-sm">Not started</Text>
                  <Text className="text-white font-instrument text-sm ml-auto">{dialCounts.notStarted}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-white font-instrument-medium">
              {completedCount}/{mailboxes.length} completed
            </Text>
            {testingConnections ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator size="small" color="#9ca3af" />
                <Text className="text-gray-400 text-sm">Testing sequentially…</Text>
              </View>
            ) : (
              <Text className="text-gray-400 text-sm">Finished</Text>
            )}
          </View>

          <DataTable
            items={mailboxes}
            columns={[
              {
                key: 'email',
                label: 'Email',
                flex: 1,
                render: (mailbox) => (
                  <Text className="text-white text-sm" numberOfLines={1}>
                    {mailbox.email_address}
                  </Text>
                ),
              },
              {
                key: 'status',
                label: 'Status',
                flex: 1.5,
                render: (mailbox) => {
                  const result = connectionResults[mailbox.id];
                  if (result === undefined) {
                    return <Text className="text-gray-500 text-sm">Not started</Text>;
                  }
                  if (result === 'testing') {
                    return (
                      <View className="flex-row items-center gap-1">
                        <ActivityIndicator size="small" color="#9ca3af" />
                        <Text className="text-gray-400 text-sm">Testing…</Text>
                      </View>
                    );
                  }

                  const smtpOk = result.smtp?.success ?? false;
                  const imapOk = result.imap?.success ?? false;
                  if (smtpOk && imapOk) {
                    return <Text className="text-emerald-400 text-sm">SMTP ✓ IMAP ✓</Text>;
                  }

                  const parts: string[] = [];
                  if (!smtpOk) parts.push(`SMTP ✗${result.smtp?.error ? ` ${result.smtp.error}` : ''}`);
                  if (!imapOk) parts.push(`IMAP ✗${result.imap?.error ? ` ${result.imap.error}` : ''}`);
                  return (
                    <Text className="text-red-400 text-sm" numberOfLines={2}>
                      {parts.join(' · ')}
                    </Text>
                  );
                },
              },
            ]}
            getItemKey={(mailbox) => mailbox.id}
            pagination={false}
            emptyMessage="No mailboxes selected"
            equalColumnWidths
          />
        </View>
      )}
    </BaseModal>
  );
}

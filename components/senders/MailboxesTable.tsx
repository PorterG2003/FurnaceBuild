import { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/feedback';
import { MailboxOverviewCard, buildMailboxOverviewColumns } from '@/components/mailboxes';
import { MailboxActionsSheet } from './MailboxActionsSheet';
import { SendersCardListSkeleton } from '@/components/skeletons';
import type { TestConnectionResult } from './types';
import type { Mailbox } from '@/lib/supabase/types';
import type { MailboxOverview } from '@/lib/supabase/services/mailboxes';

export interface MailboxesTableProps {
  isLoading: boolean;
  showSkeleton: boolean;
  isMobile: boolean;
  allowAddMailboxes: boolean;
  mailboxes: MailboxOverview[];
  selectedMailboxes: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onTestMailbox: (mailbox: Mailbox, options?: { fromActionsSheet?: boolean }) => void;
  onEditMailbox: (mailbox: Mailbox) => void;
  onDeleteClick: (mailbox: Mailbox) => void;
  testingMailboxId: string | null;
  onBulkDelete: (ids: string[]) => Promise<void>;
  onBulkEdit: () => void;
  onClearSelection: () => void;
  onConnectMailbox: () => void;
  onUploadCSV?: () => void;
  /** Mobile actions sheet: sync open mailbox for test-result presentation (see senders page). */
  onActionsSheetMailboxChange?: (mailbox: Mailbox | null) => void;
  testResult: TestConnectionResult | null;
  testResultMailboxEmail: string | null;
}

export function MailboxesTable({
  isLoading,
  showSkeleton,
  isMobile,
  allowAddMailboxes,
  mailboxes,
  selectedMailboxes,
  onSelectionChange,
  onTestMailbox,
  onEditMailbox,
  onDeleteClick,
  testingMailboxId,
  onBulkDelete,
  onBulkEdit,
  onClearSelection,
  onConnectMailbox,
  onUploadCSV,
  onActionsSheetMailboxChange,
  testResult,
  testResultMailboxEmail,
}: MailboxesTableProps) {
  const [menuMailbox, setMenuMailbox] = useState<MailboxOverview | null>(null);
  const desktopColumns = useMemo(
    () =>
      buildMailboxOverviewColumns({
        includeActions: true,
        testingMailboxId,
        onTestMailbox: (mailbox) => onTestMailbox(mailbox),
        onEditMailbox: (mailbox) => onEditMailbox(mailbox),
        onDeleteMailbox: (mailbox) => onDeleteClick(mailbox),
      }),
    [onDeleteClick, onEditMailbox, onTestMailbox, testingMailboxId]
  );

  useEffect(() => {
    if (!isMobile && menuMailbox) {
      setMenuMailbox(null);
      onActionsSheetMailboxChange?.(null);
    }
  }, [isMobile, menuMailbox, onActionsSheetMailboxChange]);

  /** After silent list refresh, keep the open sheet bound to the latest row (same id). Do not call onActionsSheetMailboxChange here — it clears parent test state. */
  useEffect(() => {
    if (menuMailbox == null) return;
    const fresh = mailboxes.find((m) => m.id === menuMailbox.id);
    if (fresh == null) {
      setMenuMailbox(null);
      onActionsSheetMailboxChange?.(null);
    } else if (fresh !== menuMailbox) {
      setMenuMailbox(fresh);
    }
  }, [mailboxes, menuMailbox, onActionsSheetMailboxChange]);

  if (isLoading || showSkeleton) {
    if (isMobile) return <SendersCardListSkeleton />;
    return (
      <DataTable
        items={[]}
        columns={desktopColumns}
        getItemKey={(mailbox) => mailbox.id}
        loading
        selectable
        selectedKeys={selectedMailboxes}
        onSelectionChange={onSelectionChange}
        pagination={false}
        widthMode="weighted-fill"
      />
    );
  }

  if (mailboxes.length === 0) {
    if (allowAddMailboxes) {
      return (
        <EmptyState
          title="No mailboxes"
          description="Create a mailbox or upload a CSV to add mailboxes."
          action={
            <View className="gap-3 w-full items-center">
              <Button onPress={onConnectMailbox} className="w-full max-w-xs">
                Create mailbox
              </Button>
              {onUploadCSV && (
                <Button variant="secondary" onPress={onUploadCSV} className="w-full max-w-xs">
                  Upload CSV
                </Button>
              )}
            </View>
          }
        />
      );
    }
    return (
      <EmptyState
        title="No mailboxes"
        description="Mailboxes added on desktop will appear here."
      />
    );
  }

  if (isMobile) {
    return (
      <>
        <View className="gap-3">
          {mailboxes.map((mailbox) => (
            <MailboxOverviewCard
              key={mailbox.id}
              mailbox={mailbox}
              onPressMenu={() => {
                setMenuMailbox(mailbox);
                onActionsSheetMailboxChange?.(mailbox);
              }}
            />
          ))}
        </View>
        <MailboxActionsSheet
          visible={menuMailbox != null}
          mailbox={menuMailbox}
          onClose={() => {
            setMenuMailbox(null);
            onActionsSheetMailboxChange?.(null);
          }}
          testingMailboxId={testingMailboxId}
          testResult={testResult}
          testResultMailboxEmail={testResultMailboxEmail}
          onTest={(m) => onTestMailbox(m, { fromActionsSheet: true })}
          onEdit={onEditMailbox}
          onDelete={onDeleteClick}
          onDismissTestResult={() => {
            setMenuMailbox(null);
            onActionsSheetMailboxChange?.(null);
          }}
        />
      </>
    );
  }

  return (
    <>
      {selectedMailboxes.size > 0 && (
        <View className="mb-4 p-4 bg-[#1F1F1F] border border-[#2A2A2A] rounded-xl flex-row items-center justify-between">
          <Text className="text-white font-instrument-medium">
            {selectedMailboxes.size} {selectedMailboxes.size === 1 ? 'mailbox' : 'mailboxes'} selected
          </Text>
          <View className="flex-row gap-2">
            {selectedMailboxes.size >= 2 && (
              <TouchableOpacity
                onPress={onBulkEdit}
                className="px-4 py-2 bg-[#FF4D00]/20 border border-[#FF4D00]/40 rounded-lg"
              >
                <Text className="text-[#FF4D00] font-instrument-medium text-sm">Update all</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={async () => {
                const ids = Array.from(selectedMailboxes);
                await onBulkDelete(ids);
              }}
              className="px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-lg"
            >
              <Text className="text-red-400 font-instrument-medium text-sm">Delete Selected</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClearSelection} className="px-4 py-2 bg-white/5 border border-white/20 rounded-lg">
              <Text className="text-white font-instrument-medium text-sm">Clear Selection</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <DataTable
        items={mailboxes}
        columns={desktopColumns}
        getItemKey={(mailbox) => mailbox.id}
        selectable
        selectedKeys={selectedMailboxes}
        onSelectionChange={onSelectionChange}
        pagination={false}
        widthMode="weighted-fill"
      />
    </>
  );
}

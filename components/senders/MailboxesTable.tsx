import { Text, TouchableOpacity, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/feedback';
import { SendersTableSkeleton } from '@/components/skeletons';
import { PencilIcon, PlayIcon, TrashIcon } from 'react-native-heroicons/outline';
import type { Mailbox } from '@/lib/supabase/types';

function getStatusColor(status: string): string {
  switch (status) {
    case 'connected':
      return '#10B981';
    case 'disconnected':
      return '#6B7280';
    case 'error':
      return '#EF4444';
    default:
      return '#6B7280';
  }
}

export interface MailboxesTableProps {
  isLoading: boolean;
  showSkeleton: boolean;
  mailboxes: Mailbox[];
  selectedMailboxes: Set<string>;
  toggleMailboxSelection: (mailboxId: string) => void;
  toggleSelectAll: () => void;
  isAllSelected: boolean;
  isIndeterminate: boolean;
  onTestMailbox: (mailbox: Mailbox) => void;
  onEditMailbox: (mailbox: Mailbox) => void;
  onDeleteClick: (mailbox: Mailbox) => void;
  testingMailboxId: string | null;
  onBulkDelete: (ids: string[]) => Promise<void>;
  onBulkEdit: () => void;
  onClearSelection: () => void;
  onConnectMailbox: () => void;
  onUploadCSV?: () => void;
}

export function MailboxesTable({
  isLoading,
  showSkeleton,
  mailboxes,
  selectedMailboxes,
  toggleMailboxSelection,
  toggleSelectAll,
  isAllSelected,
  isIndeterminate,
  onTestMailbox,
  onEditMailbox,
  onDeleteClick,
  testingMailboxId,
  onBulkDelete,
  onBulkEdit,
  onClearSelection,
  onConnectMailbox,
  onUploadCSV,
}: MailboxesTableProps) {
  if (isLoading || showSkeleton) {
    return <SendersTableSkeleton />;
  }

  if (mailboxes.length === 0) {
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

      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl overflow-hidden">
        <View className="flex-row border-b border-[#2A2A2A] bg-[#1F1F1F]">
          <View className="px-2 py-2 justify-center items-center">
            <Checkbox checked={isAllSelected} indeterminate={isIndeterminate} onPress={toggleSelectAll} />
          </View>
          <View className="flex-[2] px-2 py-2 justify-center">
            <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">Display Name</Text>
          </View>
          <View className="flex-[2] px-2 py-2 justify-center">
            <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">Email Address</Text>
          </View>
          <View className="flex-[1] px-2 py-2 justify-center">
            <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">Status</Text>
          </View>
          <View className="flex-[1] px-2 py-2 justify-center">
            <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">Actions</Text>
          </View>
        </View>

        {mailboxes.map((mailbox, index) => {
          const isSelected = selectedMailboxes.has(mailbox.id);
          return (
            <View
              key={mailbox.id}
              className={`flex-row border-b border-[#2A2A2A] ${
                index === mailboxes.length - 1 ? 'border-b-0' : ''
              } ${isSelected ? 'bg-[#1F1F1F]' : ''}`}
            >
              <View className="px-2 py-2 justify-center items-center">
                <Checkbox checked={isSelected} onPress={() => toggleMailboxSelection(mailbox.id)} />
              </View>
              <View className="flex-[2] px-2 py-2 justify-center">
                <Text className="text-white font-instrument-medium text-sm">
                  {mailbox.display_name || mailbox.email_address}
                </Text>
              </View>
              <View className="flex-[2] px-2 py-2 justify-center">
                <Text className="text-gray-400 font-instrument text-sm">{mailbox.email_address}</Text>
              </View>
              <View className="flex-[1] px-2 py-2 justify-center">
                <View
                  className="px-2 py-1 rounded self-start"
                  style={{ backgroundColor: getStatusColor(mailbox.status) + '20' }}
                >
                  <Text
                    className="text-xs font-instrument-medium capitalize"
                    style={{ color: getStatusColor(mailbox.status) }}
                  >
                    {mailbox.status}
                  </Text>
                </View>
              </View>
              <View className="flex-[1] px-2 py-2 justify-center">
                <View className="flex-row gap-1.5">
                  <IconButton
                    variant="secondary"
                    size="sm"
                    icon={PlayIcon}
                    label={testingMailboxId === mailbox.id ? 'Testing...' : 'Test'}
                    onPress={() => onTestMailbox(mailbox)}
                    disabled={testingMailboxId === mailbox.id}
                  />
                  <IconButton variant="secondary" size="sm" icon={PencilIcon} onPress={() => onEditMailbox(mailbox)} />
                  <IconButton variant="destructive" size="sm" icon={TrashIcon} onPress={() => onDeleteClick(mailbox)} />
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

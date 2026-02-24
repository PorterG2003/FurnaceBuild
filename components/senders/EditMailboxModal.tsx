import { Text, TextInput, View } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { ComposerRichEditor } from '@/components/inbox';
import type { EditorBridge } from '@10play/tentap-editor';
import type { Mailbox } from '@/lib/supabase/types';
import type { MailboxFormData } from './types';

const EDIT_MODAL_TABS: Tab[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'smtp_imap', label: 'SMTP & IMAP' },
];

const inputStyle = {
  borderColor: '#FFFFFF4D',
  backgroundColor: '#FFFFFF0D',
  color: '#FFFFFF',
  borderWidth: 1,
};

export interface EditMailboxModalProps {
  visible: boolean;
  onClose: () => void;
  /** Set for single-mailbox edit; null for bulk edit. */
  editMailbox: Mailbox | null;
  /** IDs when editing multiple mailboxes (bulk). */
  editMailboxIds?: string[];
  editFormData: MailboxFormData;
  setEditFormData: React.Dispatch<React.SetStateAction<MailboxFormData | null>>;
  activeTab: string;
  onTabChange: (tabId: string) => void;
  saving: boolean;
  onSave: () => void;
  editSignatureEditorRef: React.RefObject<EditorBridge | null>;
}

export function EditMailboxModal({
  visible,
  onClose,
  editMailbox,
  editMailboxIds = [],
  editFormData,
  setEditFormData,
  activeTab,
  onTabChange,
  saving,
  onSave,
  editSignatureEditorRef,
}: EditMailboxModalProps) {
  const isBulk = editMailboxIds.length > 0;
  const title = isBulk ? 'Update mailboxes' : 'Edit Mailbox';
  const description = isBulk
    ? `${editMailboxIds.length} mailboxes selected`
    : (editMailbox?.email_address ?? '');

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      description={description}
      maxWidth="4xl"
      maxHeight={720}
      footer={
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button onPress={onClose} variant="secondary">
              Cancel
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button onPress={onSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </View>
        </View>
      }
    >
      <View className="gap-4">
        {!isBulk && (
          <Tabs
            tabs={EDIT_MODAL_TABS}
            activeTab={activeTab}
            onTabChange={onTabChange}
            layout="equal"
          />
        )}

        {(isBulk || activeTab === 'profile') && (
          <View className="gap-4">
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Display Name (Optional)</Text>
              <TextInput
                value={editFormData.display_name}
                onChangeText={(text) => setEditFormData((prev) => (prev ? { ...prev, display_name: text } : null))}
                placeholder="John Doe"
                placeholderTextColor="#666"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
            </View>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Email Signature (Optional)</Text>
              <ComposerRichEditor
                key={`edit-signature-${editMailbox?.id ?? 'bulk'}`}
                initialContent={editFormData.signature || '<p></p>'}
                placeholder="Best regards, Your Name"
                editorRef={editSignatureEditorRef}
                minHeight={140}
              />
            </View>

            <Text className="text-lg font-instrument-semibold text-white mt-4 mb-1">Sending limits</Text>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Minimum seconds between sends</Text>
              <TextInput
                value={editFormData.min_gap_seconds != null ? String(editFormData.min_gap_seconds) : ''}
                onChangeText={(text) => {
                  const n = text.trim() === '' ? null : parseInt(text, 10);
                  setEditFormData((prev) =>
                    prev ? { ...prev, min_gap_seconds: n !== null && !Number.isNaN(n) ? n : prev.min_gap_seconds ?? 180 } : null
                  );
                }}
                placeholder="180"
                placeholderTextColor="#666"
                keyboardType="numeric"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
              <Text className="text-xs text-gray-500 font-instrument mt-2">Minimum gap between sends from this mailbox (default: 180).</Text>
            </View>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Max sends per day</Text>
              <TextInput
                value={editFormData.daily_limit != null ? String(editFormData.daily_limit) : ''}
                onChangeText={(text) => {
                  const n = text.trim() === '' ? null : parseInt(text, 10);
                  setEditFormData((prev) =>
                    prev ? { ...prev, daily_limit: n !== null && !Number.isNaN(n) ? n : prev.daily_limit ?? 50 } : null
                  );
                }}
                placeholder="50"
                placeholderTextColor="#666"
                keyboardType="numeric"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
              <Text className="text-xs text-gray-500 font-instrument mt-2">Daily email limit for this mailbox (default: 50).</Text>
            </View>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Max sends per hour</Text>
              <TextInput
                value={editFormData.hourly_limit != null ? String(editFormData.hourly_limit) : ''}
                onChangeText={(text) => {
                  const n = text.trim() === '' ? null : parseInt(text, 10);
                  setEditFormData((prev) =>
                    prev ? { ...prev, hourly_limit: n !== null && !Number.isNaN(n) ? n : prev.hourly_limit ?? 10 } : null
                  );
                }}
                placeholder="10"
                placeholderTextColor="#666"
                keyboardType="numeric"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
              <Text className="text-xs text-gray-500 font-instrument mt-2">Hourly email limit for this mailbox (default: 10).</Text>
            </View>
          </View>
        )}

        {activeTab === 'smtp_imap' && (
          <View className="gap-4">
            <Text className="text-lg font-instrument-semibold text-white mb-1">SMTP (Sending)</Text>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">SMTP Host</Text>
              <TextInput
                value={editFormData.smtp_host}
                onChangeText={(text) => setEditFormData((prev) => (prev ? { ...prev, smtp_host: text } : null))}
                placeholder="smtp.gmail.com"
                placeholderTextColor="#666"
                autoCapitalize="none"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
            </View>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">SMTP Port</Text>
              <TextInput
                value={editFormData.smtp_port}
                onChangeText={(text) => setEditFormData((prev) => (prev ? { ...prev, smtp_port: text } : null))}
                placeholder="587"
                placeholderTextColor="#666"
                keyboardType="numeric"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
            </View>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">SMTP Username</Text>
              <TextInput
                value={editFormData.smtp_username}
                onChangeText={(text) => setEditFormData((prev) => (prev ? { ...prev, smtp_username: text } : null))}
                placeholder="your@email.com"
                placeholderTextColor="#666"
                autoCapitalize="none"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
            </View>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">SMTP Password</Text>
              <TextInput
                value={editFormData.smtp_password}
                onChangeText={(text) => setEditFormData((prev) => (prev ? { ...prev, smtp_password: text } : null))}
                placeholder="Enter SMTP password or app password"
                placeholderTextColor="#666"
                secureTextEntry
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
              <Text className="text-xs text-gray-500 font-instrument mt-2">For Gmail, use an App Password.</Text>
            </View>

            <Text className="text-lg font-instrument-semibold text-white mt-4 mb-1">IMAP (Receiving)</Text>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">IMAP Host</Text>
              <TextInput
                value={editFormData.imap_host}
                onChangeText={(text) => setEditFormData((prev) => (prev ? { ...prev, imap_host: text } : null))}
                placeholder="imap.gmail.com"
                placeholderTextColor="#666"
                autoCapitalize="none"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
            </View>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">IMAP Port</Text>
              <TextInput
                value={editFormData.imap_port}
                onChangeText={(text) => setEditFormData((prev) => (prev ? { ...prev, imap_port: text } : null))}
                placeholder="993"
                placeholderTextColor="#666"
                keyboardType="numeric"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
            </View>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">IMAP Username</Text>
              <TextInput
                value={editFormData.imap_username}
                onChangeText={(text) => setEditFormData((prev) => (prev ? { ...prev, imap_username: text } : null))}
                placeholder="your@email.com"
                placeholderTextColor="#666"
                autoCapitalize="none"
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
            </View>
            <View>
              <Text className="text-sm font-instrument-medium mb-2 text-gray-300">IMAP Password</Text>
              <TextInput
                value={editFormData.imap_password}
                onChangeText={(text) => setEditFormData((prev) => (prev ? { ...prev, imap_password: text } : null))}
                placeholder="Enter IMAP password or app password"
                placeholderTextColor="#666"
                secureTextEntry
                className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                style={inputStyle}
                selectionColor="#FF4D00"
              />
              <Text className="text-xs text-gray-500 font-instrument mt-2">For Gmail, use an App Password.</Text>
            </View>
          </View>
        )}
      </View>
    </BaseModal>
  );
}

import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { ComposerRichEditor } from '@/components/inbox';
import type { EditorBridge } from '@10play/tentap-editor';
import type { MailboxFormData } from './types';

const inputStyle = {
  borderColor: '#FFFFFF4D',
  backgroundColor: '#FFFFFF0D',
  color: '#FFFFFF',
  borderWidth: 1,
};

export interface ConnectMailboxModalProps {
  visible: boolean;
  onClose: () => void;
  formData: MailboxFormData;
  setFormData: React.Dispatch<React.SetStateAction<MailboxFormData>>;
  connecting: boolean;
  testResult: { success: boolean; message: string; smtp?: { success: boolean; error?: string }; imap?: { success: boolean; error?: string } } | null;
  testing: boolean;
  onConnect: () => void;
  onTestConnection: () => void;
  connectSignatureEditorRef: React.RefObject<EditorBridge | null>;
}

export function ConnectMailboxModal({
  visible,
  onClose,
  formData,
  setFormData,
  connecting,
  testResult,
  testing,
  onConnect,
  onTestConnection,
  connectSignatureEditorRef,
}: ConnectMailboxModalProps) {
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Create Mailbox"
      description="Add an SMTP/IMAP mailbox"
      maxWidth="2xl"
      maxHeight={680}
      footer={
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button onPress={onClose} variant="secondary">
              Cancel
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              onPress={onConnect}
              disabled={connecting || (testResult !== null && !testResult.success)}
            >
              {connecting ? 'Creating...' : 'Create'}
            </Button>
          </View>
        </View>
      }
    >
      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Email Address</Text>
        <TextInput
          value={formData.email_address}
          onChangeText={(text) => {
            setFormData((prev) => ({
              ...prev,
              email_address: text,
              smtp_username: prev.smtp_username || text,
              imap_username: prev.imap_username || text,
            }));
          }}
          placeholder="your@email.com"
          placeholderTextColor="#666"
          keyboardType="email-address"
          autoCapitalize="none"
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={inputStyle}
          selectionColor="#FF4D00"
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Display Name (Optional)</Text>
        <TextInput
          value={formData.display_name}
          onChangeText={(text) => setFormData((prev) => ({ ...prev, display_name: text }))}
          placeholder="John Doe"
          placeholderTextColor="#666"
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={inputStyle}
          selectionColor="#FF4D00"
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Email Signature (Optional)</Text>
        <ComposerRichEditor
          key="connect-signature"
          initialContent={formData.signature || '<p></p>'}
          placeholder="Best regards, John Doe"
          editorRef={connectSignatureEditorRef}
          minHeight={100}
        />
        <Text className="text-xs text-gray-500 font-instrument mt-2">
          This signature will be appended to emails sent from this mailbox.
        </Text>
      </View>

      <Text className="text-lg font-instrument-semibold text-white mt-6 mb-4">Sending limits</Text>
      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Minimum seconds between sends</Text>
        <TextInput
          value={formData.min_gap_seconds != null ? String(formData.min_gap_seconds) : ''}
          onChangeText={(text) => {
            const n = text.trim() === '' ? null : parseInt(text, 10);
            setFormData((prev) => ({
              ...prev,
              min_gap_seconds: n !== null && !Number.isNaN(n) ? n : prev.min_gap_seconds ?? 180,
            }));
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
      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Max sends per day</Text>
        <TextInput
          value={formData.daily_limit != null ? String(formData.daily_limit) : ''}
          onChangeText={(text) => {
            const n = text.trim() === '' ? null : parseInt(text, 10);
            setFormData((prev) => ({
              ...prev,
              daily_limit: n !== null && !Number.isNaN(n) ? n : prev.daily_limit ?? 50,
            }));
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
      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Max sends per hour</Text>
        <TextInput
          value={formData.hourly_limit != null ? String(formData.hourly_limit) : ''}
          onChangeText={(text) => {
            const n = text.trim() === '' ? null : parseInt(text, 10);
            setFormData((prev) => ({
              ...prev,
              hourly_limit: n !== null && !Number.isNaN(n) ? n : prev.hourly_limit ?? 10,
            }));
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

      <Text className="text-lg font-instrument-semibold mb-4 text-white mt-6">SMTP Settings (Sending)</Text>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">SMTP Host</Text>
        <TextInput
          value={formData.smtp_host}
          onChangeText={(text) => setFormData((prev) => ({ ...prev, smtp_host: text }))}
          placeholder="SMTP host"
          placeholderTextColor="#666"
          autoCapitalize="none"
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={inputStyle}
          selectionColor="#FF4D00"
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">SMTP Port</Text>
        <TextInput
          value={formData.smtp_port}
          onChangeText={(text) => setFormData((prev) => ({ ...prev, smtp_port: text }))}
          placeholder="e.g. 587"
          placeholderTextColor="#666"
          keyboardType="numeric"
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={inputStyle}
          selectionColor="#FF4D00"
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">SMTP Username</Text>
        <TextInput
          value={formData.smtp_username}
          onChangeText={(text) => setFormData((prev) => ({ ...prev, smtp_username: text }))}
          placeholder="your@email.com"
          placeholderTextColor="#666"
          autoCapitalize="none"
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={inputStyle}
          selectionColor="#FF4D00"
        />
      </View>

      <View className="mb-6">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">SMTP Password</Text>
        <TextInput
          value={formData.smtp_password}
          onChangeText={(text) => setFormData((prev) => ({ ...prev, smtp_password: text }))}
          placeholder="SMTP password"
          placeholderTextColor="#666"
          secureTextEntry
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={inputStyle}
          selectionColor="#FF4D00"
        />
      </View>

      <Text className="text-lg font-instrument-semibold mb-4 text-white mt-6">IMAP Settings (Receiving)</Text>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">IMAP Host</Text>
        <TextInput
          value={formData.imap_host}
          onChangeText={(text) => setFormData((prev) => ({ ...prev, imap_host: text }))}
          placeholder="IMAP host"
          placeholderTextColor="#666"
          autoCapitalize="none"
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={inputStyle}
          selectionColor="#FF4D00"
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">IMAP Port</Text>
        <TextInput
          value={formData.imap_port}
          onChangeText={(text) => setFormData((prev) => ({ ...prev, imap_port: text }))}
          placeholder="e.g. 993"
          placeholderTextColor="#666"
          keyboardType="numeric"
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={inputStyle}
          selectionColor="#FF4D00"
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">IMAP Username</Text>
        <TextInput
          value={formData.imap_username}
          onChangeText={(text) => setFormData((prev) => ({ ...prev, imap_username: text }))}
          placeholder="your@email.com"
          placeholderTextColor="#666"
          autoCapitalize="none"
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={inputStyle}
          selectionColor="#FF4D00"
        />
      </View>

      <View className="mb-6">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">IMAP Password</Text>
        <TextInput
          value={formData.imap_password}
          onChangeText={(text) => setFormData((prev) => ({ ...prev, imap_password: text }))}
          placeholder="IMAP password"
          placeholderTextColor="#666"
          secureTextEntry
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={inputStyle}
          selectionColor="#FF4D00"
        />
      </View>

      <View className="mb-4 mt-6">
        <TouchableOpacity
          onPress={onTestConnection}
          disabled={testing}
          className="px-4 py-3 bg-blue-500/20 border border-blue-500/30 rounded-xl"
          style={{ opacity: testing ? 0.5 : 1 }}
        >
          {testing ? (
            <View className="flex-row items-center justify-center gap-2">
              <ActivityIndicator color="#60A5FA" size="small" />
              <Text className="text-blue-400 font-instrument-medium">Testing Connection...</Text>
            </View>
          ) : (
            <Text className="text-center text-blue-400 font-instrument-medium">Test Connection</Text>
          )}
        </TouchableOpacity>
      </View>

      {testResult && (
        <View
          className={`mb-4 p-4 rounded-xl border ${
            testResult.success ? 'bg-green-500/20 border-green-500/30' : 'bg-red-500/20 border-red-500/30'
          }`}
        >
          <Text
            className={`text-center font-instrument-semibold mb-2 ${
              testResult.success ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {testResult.success ? '✓ Connection Test Passed' : '✗ Connection Test Failed'}
          </Text>
          <Text
            className={`text-center font-instrument text-sm ${
              testResult.success ? 'text-green-300' : 'text-red-300'
            }`}
          >
            {testResult.message}
          </Text>
          {testResult.smtp && (
            <View className="mt-2">
              <Text className="text-xs text-gray-400 font-instrument">
                SMTP: {testResult.smtp.success ? '✓ Connected' : `✗ ${testResult.smtp.error}`}
              </Text>
            </View>
          )}
          {testResult.imap && (
            <View className="mt-1">
              <Text className="text-xs text-gray-400 font-instrument">
                IMAP: {testResult.imap.success ? '✓ Connected' : `✗ ${testResult.imap.error}`}
              </Text>
            </View>
          )}
        </View>
      )}
    </BaseModal>
  );
}

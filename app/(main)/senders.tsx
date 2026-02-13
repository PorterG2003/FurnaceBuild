import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAccount } from '@/contexts/AccountContext';
import { PageLayout } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Alert, LoadingState, EmptyState } from '@/components/ui/feedback';
import { ConfirmDeleteModal } from '@/components/ui/modals';
import { PlayIcon, TrashIcon } from 'react-native-heroicons/outline';
import { Platform } from 'react-native';
import {
  createMailbox,
  deleteMailbox,
  getMailboxesByAccount,
  updateMailbox,
  updateMailboxStatus,
} from '@/lib/supabase/services';
import { testMailboxConnection } from '@/lib/services/email';
import type { Mailbox } from '@/lib/supabase/types';

type Provider = 'gmail' | 'outlook' | 'custom';

interface MailboxFormData {
  provider: Provider;
  email_address: string;
  display_name: string;
  // SMTP
  smtp_host: string;
  smtp_port: string;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  smtp_use_ssl: boolean;
  // IMAP
  imap_host: string;
  imap_port: string;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
}

const PROVIDER_PRESETS: Record<Provider, Partial<MailboxFormData>> = {
  gmail: {
    smtp_host: 'smtp.gmail.com',
    smtp_port: '587',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'imap.gmail.com',
    imap_port: '993',
    imap_use_ssl: true,
  },
  outlook: {
    smtp_host: 'smtp-mail.outlook.com',
    smtp_port: '587',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'outlook.office365.com',
    imap_port: '993',
    imap_use_ssl: true,
  },
  custom: {},
};

interface ActionButtonProps {
  onPress: () => void;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  variant: 'blue' | 'red';
  disabled?: boolean;
  isLoading?: boolean;
}

function ActionButton({
  onPress,
  icon: Icon,
  label,
  variant,
  disabled = false,
  isLoading = false,
}: ActionButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const colors = {
    blue: {
      bg: 'bg-blue-500/20',
      bgHover: 'bg-blue-500/30',
      border: 'border-blue-500/30',
      borderHover: 'border-blue-500/40',
      text: 'text-blue-400',
      iconColor: '#60A5FA',
    },
    red: {
      bg: 'bg-red-500/20',
      bgHover: 'bg-red-500/30',
      border: 'border-red-500/30',
      borderHover: 'border-red-500/40',
      text: 'text-red-400',
      iconColor: '#F87171',
    },
  };

  const colorScheme = colors[variant];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || isLoading}
      activeOpacity={0.7}
      onPressIn={() => setIsHovered(true)}
      onPressOut={() => setIsHovered(false)}
      className={`px-2.5 py-1.5 rounded-lg border flex-row items-center gap-1.5 ${
        isHovered && !disabled && !isLoading
          ? colorScheme.bgHover + ' ' + colorScheme.borderHover
          : colorScheme.bg + ' ' + colorScheme.border
      }`}
      style={{
        opacity: disabled || isLoading ? 0.5 : 1,
      }}
      // @ts-ignore - web-only prop
      onMouseEnter={() => Platform.OS === 'web' && !disabled && !isLoading && setIsHovered(true)}
      onMouseLeave={() => Platform.OS === 'web' && setIsHovered(false)}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={colorScheme.iconColor} />
      ) : (
        <>
          <Icon size={14} color={colorScheme.iconColor} />
          <Text className={`${colorScheme.text} font-instrument-medium text-xs`}>
            {label}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export default function SendersPage() {
  const { account, user: profile } = useAccount();
  const accountId = account?.id ?? null;

  const [isLoading, setIsLoading] = useState(true);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [selectedMailboxes, setSelectedMailboxes] = useState<Set<string>>(new Set());
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [mailboxToDelete, setMailboxToDelete] = useState<Mailbox | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingMailboxId, setTestingMailboxId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    smtp?: { success: boolean; error?: string };
    imap?: { success: boolean; error?: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState<MailboxFormData>({
    provider: 'gmail',
    email_address: '',
    display_name: '',
    smtp_host: 'smtp.gmail.com',
    smtp_port: '587',
    smtp_username: '',
    smtp_password: '',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'imap.gmail.com',
    imap_port: '993',
    imap_username: '',
    imap_password: '',
    imap_use_ssl: true,
  });

  const loadMailboxes = useCallback(async () => {
    if (!accountId) return;

    try {
      setIsLoading(true);
      const mailboxesList = await getMailboxesByAccount(accountId);
      setMailboxes(mailboxesList);
    } catch (err) {
      console.error('Failed to load mailboxes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (accountId) {
      loadMailboxes();
    }
  }, [accountId, loadMailboxes]);

  const handleProviderChange = (provider: Provider) => {
    const preset = PROVIDER_PRESETS[provider];
    setFormData((prev) => ({
      ...prev,
      provider,
      smtp_host: preset.smtp_host || prev.smtp_host,
      smtp_port: preset.smtp_port || prev.smtp_port,
      smtp_use_tls: preset.smtp_use_tls ?? prev.smtp_use_tls,
      smtp_use_ssl: preset.smtp_use_ssl ?? prev.smtp_use_ssl,
      imap_host: preset.imap_host || prev.imap_host,
      imap_port: preset.imap_port || prev.imap_port,
      imap_use_ssl: preset.imap_use_ssl ?? prev.imap_use_ssl,
      // Keep user-entered values for username/password
      smtp_username: prev.smtp_username || prev.email_address,
      imap_username: prev.imap_username || prev.email_address,
    }));
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    // Validation
    if (!formData.email_address.trim()) {
      setError('Email address is required');
      return;
    }
    if (!formData.smtp_host.trim() || !formData.imap_host.trim()) {
      setError('SMTP and IMAP hosts are required');
      return;
    }
    if (!formData.smtp_username.trim() || !formData.imap_username.trim()) {
      setError('SMTP and IMAP usernames are required');
      return;
    }
    if (!formData.smtp_password.trim() || !formData.imap_password.trim()) {
      setError('SMTP and IMAP passwords are required');
      return;
    }

    setTesting(true);
    setError(null);
    setTestResult(null);

    try {
      const result = await testMailboxConnection({
        smtp_host: formData.smtp_host.trim(),
        smtp_port: parseInt(formData.smtp_port, 10),
        smtp_username: formData.smtp_username.trim(),
        smtp_password: formData.smtp_password,
        smtp_use_tls: formData.smtp_use_tls,
        smtp_use_ssl: formData.smtp_use_ssl,
        imap_host: formData.imap_host.trim(),
        imap_port: parseInt(formData.imap_port, 10),
        imap_username: formData.imap_username.trim(),
        imap_password: formData.imap_password,
        imap_use_ssl: formData.imap_use_ssl,
      });

      setTestResult(result);
      if (result.success) {
        setSuccess('Connection test successful!');
        setTimeout(() => setSuccess(null), 5000);
      } else {
        setError(result.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to test connection';
      setError(message);
      setTestResult({
        success: false,
        message,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = async () => {
    if (!accountId || !profile) {
      setError('Account not found');
      return;
    }

    // Validation
    if (!formData.email_address.trim()) {
      setError('Email address is required');
      return;
    }
    if (!formData.smtp_host.trim() || !formData.imap_host.trim()) {
      setError('SMTP and IMAP hosts are required');
      return;
    }
    if (!formData.smtp_username.trim() || !formData.imap_username.trim()) {
      setError('SMTP and IMAP usernames are required');
      return;
    }
    if (!formData.smtp_password.trim() || !formData.imap_password.trim()) {
      setError('SMTP and IMAP passwords are required');
      return;
    }

    setConnecting(true);
    setError(null);
    setSuccess(null);

    try {
      // ⚠️ SECURITY: Passwords should be encrypted before storing
      // TODO: Implement encryption using Supabase Vault or AWS KMS
      // For now, storing as plain text (NOT PRODUCTION READY)
      await createMailbox({
        account_id: accountId,
        user_id: profile.id,
        email_address: formData.email_address.trim(),
        display_name: formData.display_name.trim() || null,
        provider: formData.provider,
        smtp_host: formData.smtp_host.trim(),
        smtp_port: parseInt(formData.smtp_port, 10),
        smtp_username: formData.smtp_username.trim(),
        smtp_password: formData.smtp_password, // Should be encrypted
        smtp_use_tls: formData.smtp_use_tls,
        smtp_use_ssl: formData.smtp_use_ssl,
        imap_host: formData.imap_host.trim(),
        imap_port: parseInt(formData.imap_port, 10),
        imap_username: formData.imap_username.trim(),
        imap_password: formData.imap_password, // Should be encrypted
        imap_use_ssl: formData.imap_use_ssl,
        status: 'connected',
        sync_enabled: true,
      });

      setSuccess('Mailbox connected successfully!');
      setShowConnectModal(false);
      
      // Reset form
      setFormData({
        provider: 'gmail',
        email_address: '',
        display_name: '',
        smtp_host: 'smtp.gmail.com',
        smtp_port: '587',
        smtp_username: '',
        smtp_password: '',
        smtp_use_tls: true,
        smtp_use_ssl: false,
        imap_host: 'imap.gmail.com',
        imap_port: '993',
        imap_username: '',
        imap_password: '',
        imap_use_ssl: true,
      });

      await loadMailboxes();
      
      // Auto-dismiss success message
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect mailbox';
      setError(message);
    } finally {
      setConnecting(false);
    }
  };

  const handleTestMailbox = async (mailbox: Mailbox) => {
    setTestingMailboxId(mailbox.id);
    setError(null);
    setSuccess(null);

    try {
      const result = await testMailboxConnection({
        smtp_host: mailbox.smtp_host,
        smtp_port: mailbox.smtp_port,
        smtp_username: mailbox.smtp_username,
        smtp_password: mailbox.smtp_password,
        smtp_use_tls: mailbox.smtp_use_tls,
        smtp_use_ssl: mailbox.smtp_use_ssl,
        imap_host: mailbox.imap_host,
        imap_port: mailbox.imap_port,
        imap_username: mailbox.imap_username,
        imap_password: mailbox.imap_password,
        imap_use_ssl: mailbox.imap_use_ssl,
      });

      // Update mailbox status based on test result
      const newStatus = result.success ? 'connected' : 'error';
      await updateMailboxStatus(
        mailbox.id,
        newStatus,
        result.success ? null : result.message
      );

      if (result.success) {
        setSuccess(`Mailbox "${mailbox.display_name || mailbox.email_address}" connection test passed!`);
        setTimeout(() => setSuccess(null), 5000);
      } else {
        setError(`Connection test failed: ${result.message}`);
      }

      // Reload mailboxes to show updated status
      await loadMailboxes();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to test mailbox connection';
      setError(message);
      // Update status to error
      await updateMailboxStatus(mailbox.id, 'error', message);
      await loadMailboxes();
    } finally {
      setTestingMailboxId(null);
    }
  };

  const handleDeleteClick = (mailbox: Mailbox) => {
    setMailboxToDelete(mailbox);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!mailboxToDelete) return;

    setDeleting(true);
    setError(null);
    setSuccess(null);

    try {
      await deleteMailbox(mailboxToDelete.id);
      await loadMailboxes();
      setSuccess('Mailbox deleted successfully');
      setTimeout(() => setSuccess(null), 5000);
      setShowDeleteModal(false);
      setMailboxToDelete(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete mailbox';
      setError(message);
    } finally {
      setDeleting(false);
    }
  };

  const toggleMailboxSelection = (mailboxId: string) => {
    setSelectedMailboxes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(mailboxId)) {
        newSet.delete(mailboxId);
      } else {
        newSet.add(mailboxId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedMailboxes.size === mailboxes.length) {
      setSelectedMailboxes(new Set());
    } else {
      setSelectedMailboxes(new Set(mailboxes.map((m) => m.id)));
    }
  };

  const isAllSelected = mailboxes.length > 0 && selectedMailboxes.size === mailboxes.length;
  const isIndeterminate = selectedMailboxes.size > 0 && selectedMailboxes.size < mailboxes.length;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return '#10B981'; // green
      case 'disconnected':
        return '#6B7280'; // gray
      case 'error':
        return '#EF4444'; // red
      default:
        return '#6B7280';
    }
  };

  return (
    <PageLayout>
          {/* Header */}
          <View className="mb-6 flex-row items-center justify-between">
            <View>
            <Text className="text-3xl font-instrument-semibold text-white mb-2">
              Senders
            </Text>
            <Text className="text-gray-400 font-instrument">
                Manage your email mailbox connections
            </Text>
            </View>
            <Button onPress={() => setShowConnectModal(true)}>
              Connect Mailbox
            </Button>
          </View>

          {/* Messages */}
          {error && <Alert variant="error" message={error} />}
          {success && <Alert variant="success" message={success} />}

          {/* Bulk Actions Bar - Shows when items are selected */}
          {selectedMailboxes.size > 0 && (
            <View className="mb-4 p-4 bg-[#1F1F1F] border border-[#2A2A2A] rounded-xl flex-row items-center justify-between">
              <Text className="text-white font-instrument-medium">
                {selectedMailboxes.size} {selectedMailboxes.size === 1 ? 'mailbox' : 'mailboxes'} selected
              </Text>
              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={async () => {
                    const ids = Array.from(selectedMailboxes);
                    try {
                      await Promise.all(ids.map((id) => deleteMailbox(id)));
                      setSelectedMailboxes(new Set());
                      await loadMailboxes();
                      setSuccess(`${ids.length} ${ids.length === 1 ? 'mailbox' : 'mailboxes'} deleted successfully`);
                      setTimeout(() => setSuccess(null), 5000);
                    } catch (err) {
                      const message = err instanceof Error ? err.message : 'Failed to delete mailboxes';
                      setError(message);
                    }
                  }}
                  className="px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-lg"
                >
                  <Text className="text-red-400 font-instrument-medium text-sm">
                    Delete Selected
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setSelectedMailboxes(new Set())}
                  className="px-4 py-2 bg-white/5 border border-white/20 rounded-lg"
                >
                  <Text className="text-white font-instrument-medium text-sm">
                    Clear Selection
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Loading State */}
          {isLoading ? (
            <LoadingState message="Loading mailboxes..." />
          ) : mailboxes.length === 0 ? (
            /* Empty State */
            <EmptyState
              title="No Mailboxes Connected"
              description="Connect your first mailbox to start sending and receiving emails"
              actionText="Connect Your First Mailbox"
              onAction={() => setShowConnectModal(true)}
            />
          ) : (
            /* Mailboxes Table */
            <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl overflow-hidden">
              {/* Table Header */}
              <View className="flex-row border-b border-[#2A2A2A] bg-[#1F1F1F]">
                {/* Checkbox Column */}
                <View className="px-2 py-2 justify-center items-center">
                  <Checkbox
                    checked={isAllSelected}
                    indeterminate={isIndeterminate}
                    onPress={toggleSelectAll}
                  />
                </View>
                <View className="flex-[2] px-2 py-2 justify-center">
                  <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">
                    Display Name
                  </Text>
                </View>
                <View className="flex-[2] px-2 py-2 justify-center">
                  <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">
                    Email Address
                  </Text>
                </View>
                <View className="flex-[1] px-2 py-2 justify-center">
                  <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">
                    Provider
                  </Text>
                </View>
                <View className="flex-[1] px-2 py-2 justify-center">
                  <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">
                    Status
                  </Text>
                </View>
                <View className="flex-[1] px-2 py-2 justify-center">
                  <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">
                    Sync
                  </Text>
                </View>
                <View className="flex-[1] px-2 py-2 justify-center">
                  <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">
                    Actions
                  </Text>
                </View>
              </View>

              {/* Table Rows */}
              {mailboxes.map((mailbox, index) => {
                const isSelected = selectedMailboxes.has(mailbox.id);
                return (
                  <View
                    key={mailbox.id}
                    className={`flex-row border-b border-[#2A2A2A] ${
                      index === mailboxes.length - 1 ? 'border-b-0' : ''
                    } ${isSelected ? 'bg-[#1F1F1F]' : ''}`}
                  >
                    {/* Checkbox Column */}
                    <View className="px-2 py-2 justify-center items-center">
                      <Checkbox
                        checked={isSelected}
                        onPress={() => toggleMailboxSelection(mailbox.id)}
                      />
                    </View>
                    <View className="flex-[2] px-2 py-2 justify-center">
                      <Text className="text-white font-instrument-medium text-sm">
                        {mailbox.display_name || mailbox.email_address}
                      </Text>
                    </View>
                    <View className="flex-[2] px-2 py-2 justify-center">
                      <Text className="text-gray-400 font-instrument text-sm">
                        {mailbox.email_address}
                      </Text>
                    </View>
                    <View className="flex-[1] px-2 py-2 justify-center">
                      <Text className="text-gray-400 font-instrument text-sm capitalize">
                        {mailbox.provider}
                      </Text>
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
                      <Text className="text-gray-400 font-instrument text-sm">
                        {mailbox.sync_enabled ? 'Enabled' : 'Disabled'}
                      </Text>
                    </View>
                    <View className="flex-[1] px-2 py-2 justify-center">
                      <View className="flex-row gap-1.5">
                        <ActionButton
                          onPress={() => handleTestMailbox(mailbox)}
                          disabled={testingMailboxId === mailbox.id}
                          isLoading={testingMailboxId === mailbox.id}
                          icon={PlayIcon}
                          label="Test"
                          variant="blue"
                        />
                        <ActionButton
                          onPress={() => handleDeleteClick(mailbox)}
                          icon={TrashIcon}
                          label="Delete"
                          variant="red"
                        />
                      </View>
                    </View>
                </View>
                );
              })}
            </View>
          )}

      {/* Connect Mailbox Modal - Same as inbox.tsx */}
      <Modal
        visible={showConnectModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowConnectModal(false);
          setError(null);
          setSuccess(null);
          setTestResult(null);
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 20,
          }}
        >
          <Pressable
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            onPress={() => {
              setShowConnectModal(false);
              setError(null);
              setSuccess(null);
              setTestResult(null);
            }}
          />
          <View
            style={{
              backgroundColor: '#1A1A1A',
              borderRadius: 16,
              borderWidth: 1,
              borderColor: '#2A2A2A',
              padding: 24,
              width: '100%',
              maxWidth: 600,
              maxHeight: '90%',
            }}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-2xl font-instrument-semibold mb-2 text-white">
                Connect Mailbox
              </Text>
              <Text className="text-gray-400 font-instrument text-sm mb-6">
                Connect your email account to send and receive emails
              </Text>

              {/* Provider Selection */}
              <View className="mb-6">
                <Text className="text-sm font-instrument-medium mb-3 text-gray-300">
                  Email Provider
                </Text>
                <View className="flex-row gap-3">
                  {(['gmail', 'outlook', 'custom'] as Provider[]).map((provider) => (
                    <TouchableOpacity
                      key={provider}
                      onPress={() => handleProviderChange(provider)}
                      className={`flex-1 px-4 py-3 rounded-xl border ${
                        formData.provider === provider
                          ? 'bg-brand-orange/20 border-brand-orange'
                          : 'bg-white/5 border-white/20'
                      }`}
                    >
                      <Text
                        className={`text-center font-instrument-medium capitalize ${
                          formData.provider === provider ? 'text-white' : 'text-gray-400'
                        }`}
                      >
                        {provider}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Email Address */}
              <View className="mb-4">
                <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
                  Email Address
                </Text>
                <TextInput
                  value={formData.email_address}
                  onChangeText={(text) => {
                    setFormData((prev) => ({
                      ...prev,
                      email_address: text,
                      smtp_username: prev.smtp_username || text,
                      imap_username: prev.imap_username || text,
                    }));
                    setError(null);
                  }}
                  placeholder="your@email.com"
                  placeholderTextColor="#666"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  selectionColor="#FF4D00"
                />
              </View>

              {/* Display Name (Optional) */}
              <View className="mb-4">
                <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
                  Display Name (Optional)
                </Text>
                <TextInput
                  value={formData.display_name}
                  onChangeText={(text) => {
                    setFormData((prev) => ({ ...prev, display_name: text }));
                    setError(null);
                  }}
                  placeholder="John Doe"
                  placeholderTextColor="#666"
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  selectionColor="#FF4D00"
                />
              </View>

              {/* SMTP Section */}
              <Text className="text-lg font-instrument-semibold mb-4 text-white mt-6">
                SMTP Settings (Sending)
              </Text>

              <View className="mb-4">
                <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
                  SMTP Host
                </Text>
                <TextInput
                  value={formData.smtp_host}
                  onChangeText={(text) => {
                    setFormData((prev) => ({ ...prev, smtp_host: text }));
                    setError(null);
                  }}
                  placeholder="smtp.gmail.com"
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  selectionColor="#FF4D00"
                />
              </View>

              <View className="mb-4">
                <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
                  SMTP Port
                </Text>
                <TextInput
                  value={formData.smtp_port}
                  onChangeText={(text) => {
                    setFormData((prev) => ({ ...prev, smtp_port: text }));
                    setError(null);
                  }}
                  placeholder="587"
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  selectionColor="#FF4D00"
                />
              </View>

              <View className="mb-4">
                <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
                  SMTP Username
                </Text>
                <TextInput
                  value={formData.smtp_username}
                  onChangeText={(text) => {
                    setFormData((prev) => ({ ...prev, smtp_username: text }));
                    setError(null);
                  }}
                  placeholder="your@email.com"
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  selectionColor="#FF4D00"
                />
              </View>

              <View className="mb-6">
                <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
                  SMTP Password
                </Text>
                <TextInput
                  value={formData.smtp_password}
                  onChangeText={(text) => {
                    setFormData((prev) => ({ ...prev, smtp_password: text }));
                    setError(null);
                  }}
                  placeholder="Enter SMTP password or app password"
                  placeholderTextColor="#666"
                  secureTextEntry
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  selectionColor="#FF4D00"
                />
                <Text className="text-xs text-gray-500 font-instrument mt-2">
                  For Gmail, use an App Password instead of your regular password
                </Text>
              </View>

              {/* IMAP Section */}
              <Text className="text-lg font-instrument-semibold mb-4 text-white mt-6">
                IMAP Settings (Receiving)
              </Text>

              <View className="mb-4">
                <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
                  IMAP Host
                </Text>
                <TextInput
                  value={formData.imap_host}
                  onChangeText={(text) => {
                    setFormData((prev) => ({ ...prev, imap_host: text }));
                    setError(null);
                  }}
                  placeholder="imap.gmail.com"
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  selectionColor="#FF4D00"
                />
              </View>

              <View className="mb-4">
                <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
                  IMAP Port
                </Text>
                <TextInput
                  value={formData.imap_port}
                  onChangeText={(text) => {
                    setFormData((prev) => ({ ...prev, imap_port: text }));
                    setError(null);
                  }}
                  placeholder="993"
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  selectionColor="#FF4D00"
                />
              </View>

              <View className="mb-4">
                <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
                  IMAP Username
                </Text>
                <TextInput
                  value={formData.imap_username}
                  onChangeText={(text) => {
                    setFormData((prev) => ({ ...prev, imap_username: text }));
                    setError(null);
                  }}
                  placeholder="your@email.com"
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  selectionColor="#FF4D00"
                />
              </View>

              <View className="mb-6">
                <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
                  IMAP Password
                </Text>
                <TextInput
                  value={formData.imap_password}
                  onChangeText={(text) => {
                    setFormData((prev) => ({ ...prev, imap_password: text }));
                    setError(null);
                  }}
                  placeholder="Enter IMAP password or app password"
                  placeholderTextColor="#666"
                  secureTextEntry
                  className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                  style={{
                    borderColor: '#FFFFFF4D',
                    backgroundColor: '#FFFFFF0D',
                    color: '#FFFFFF',
                    borderWidth: 1,
                  }}
                  selectionColor="#FF4D00"
                />
                <Text className="text-xs text-gray-500 font-instrument mt-2">
                  For Gmail, use an App Password instead of your regular password
                </Text>
              </View>

              {/* Test Connection Button */}
              <View className="mb-4 mt-6">
                <TouchableOpacity
                  onPress={handleTestConnection}
                  disabled={testing}
                  className="px-4 py-3 bg-blue-500/20 border border-blue-500/30 rounded-xl"
                  style={{ opacity: testing ? 0.5 : 1 }}
                >
                  {testing ? (
                    <View className="flex-row items-center justify-center gap-2">
                      <ActivityIndicator color="#60A5FA" size="small" />
                      <Text className="text-blue-400 font-instrument-medium">
                        Testing Connection...
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-center text-blue-400 font-instrument-medium">
                      Test Connection
                    </Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* Test Result */}
              {testResult && (
                <View
                  className={`mb-4 p-4 rounded-xl border ${
                    testResult.success
                      ? 'bg-green-500/20 border-green-500/30'
                      : 'bg-red-500/20 border-red-500/30'
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

              {error && (
                <View className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
                  <Text className="text-red-400 text-center font-instrument-medium text-sm">
                    {error}
                  </Text>
                </View>
              )}

              {/* Actions */}
              <View className="flex-row gap-3 mt-4">
                <TouchableOpacity
                  onPress={() => {
                    setShowConnectModal(false);
                    setError(null);
                    setSuccess(null);
                    setTestResult(null);
                  }}
                  className="flex-1 px-4 py-3 bg-white/5 border border-white/20 rounded-xl"
                >
                  <Text className="text-center text-white font-instrument-medium">
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleConnect}
                  disabled={connecting || (testResult !== null && !testResult.success)}
                  className="flex-1 px-4 py-3 bg-brand-orange rounded-xl"
                  style={{ opacity: connecting || (testResult !== null && !testResult.success) ? 0.5 : 1 }}
                >
                  {connecting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text className="text-center text-white font-instrument-medium">
                      Connect
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmDeleteModal
        visible={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setMailboxToDelete(null);
        }}
        onConfirm={handleDeleteConfirm}
        title="Delete Mailbox"
        itemName={mailboxToDelete?.display_name || mailboxToDelete?.email_address}
        isLoading={deleting}
      />
    </PageLayout>
  );
}

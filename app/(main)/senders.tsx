import { useCallback, useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useAccount } from '@/contexts/AccountContext';
import { PageLayout, PageHeader, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Alert, useSmoothLoading, useToast } from '@/components/ui/feedback';
import { ConfirmDeleteModal } from '@/components/ui/modals';
import {
  ConnectMailboxModal,
  CREATE_MAILBOX_FORM_DATA,
  EditMailboxModal,
  MailboxesTable,
  TestResultModal,
  UploadMailboxesCSVModal,
  type MailboxFormData,
  type Provider,
  type TestConnectionResult,
} from '@/components/senders';
import { BLANK_MAILBOX_FORM_DATA } from '@/components/senders/types';
import {
  createMailbox,
  deleteMailbox,
  getMailboxOverviewsByAccount,
  updateMailbox,
  updateMailboxStatus,
} from '@/lib/supabase/services';
import type { MailboxOverview } from '@/lib/supabase/services/mailboxes';
import { testMailboxConnection } from '@/lib/services/email';
import type { Mailbox, MailboxUpdate } from '@/lib/supabase/types';
import type { EditorBridge } from '@10play/tentap-editor';

/** Build partial update payload for bulk edit: only profile + throttle (no SMTP/IMAP). */
function buildBulkUpdatePayload(
  formData: MailboxFormData,
  signatureHtml: string | undefined
): MailboxUpdate {
  const payload: MailboxUpdate = {};
  if (formData.display_name.trim()) payload.display_name = formData.display_name.trim() || null;
  if (signatureHtml && signatureHtml !== '<p></p>') payload.signature = signatureHtml;
  if (formData.min_gap_seconds != null) payload.min_gap_seconds = formData.min_gap_seconds;
  if (formData.daily_limit != null) payload.daily_limit = formData.daily_limit;
  if (formData.hourly_limit != null) payload.hourly_limit = formData.hourly_limit;
  return payload;
}

export default function SendersPage() {
  const { account, user: profile } = useAccount();
  const { toast } = useToast();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const wasMobileRef = useRef(isMobile);
  const accountId = account?.id ?? null;

  const [isLoading, setIsLoading] = useState(true);
  const [mailboxes, setMailboxes] = useState<MailboxOverview[]>([]);
  const [selectedMailboxes, setSelectedMailboxes] = useState<Set<string>>(new Set());
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showUploadCSVModal, setShowUploadCSVModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTestResultModal, setShowTestResultModal] = useState(false);
  const [testResultMailboxEmail, setTestResultMailboxEmail] = useState<string | null>(null);
  const [mailboxToDelete, setMailboxToDelete] = useState<Mailbox | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingMailboxId, setTestingMailboxId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const actionsSheetMailboxRef = useRef<Mailbox | null>(null);
  const showSkeleton = useSmoothLoading(isLoading);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editMailbox, setEditMailbox] = useState<Mailbox | null>(null);
  const [editMailboxIds, setEditMailboxIds] = useState<string[]>([]);
  const [editFormData, setEditFormData] = useState<MailboxFormData | null>(null);
  const [editModalActiveTab, setEditModalActiveTab] = useState<string>('profile');
  const [saving, setSaving] = useState(false);
  const editSignatureEditorRef = useRef<EditorBridge | null>(null);
  const connectSignatureEditorRef = useRef<EditorBridge | null>(null);

  const [formData, setFormData] = useState<MailboxFormData>(CREATE_MAILBOX_FORM_DATA);

  const loadMailboxes = useCallback(async (options?: { silent?: boolean }) => {
    if (!accountId) return;

    const silent = options?.silent === true;
    try {
      if (!silent) setIsLoading(true);
      const mailboxesList = await getMailboxOverviewsByAccount(accountId);
      setMailboxes(mailboxesList);
    } catch (err) {
      console.error('Failed to load mailboxes:', err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (accountId) {
      loadMailboxes();
    }
  }, [accountId, loadMailboxes]);

  useEffect(() => {
    if (isMobile && !wasMobileRef.current) {
      setSelectedMailboxes(new Set());
      setShowConnectModal(false);
      setShowUploadCSVModal(false);
      setTestResult(null);
    }
    wasMobileRef.current = isMobile;
  }, [isMobile]);

  const handleTestConnection = async () => {
    // Validation
    if (!formData.email_address.trim()) {
      toast.error('Email address is required');
      return;
    }
    if (!formData.smtp_host.trim() || !formData.imap_host.trim()) {
      toast.error('SMTP and IMAP hosts are required');
      return;
    }
    if (!formData.smtp_username.trim() || !formData.imap_username.trim()) {
      toast.error('SMTP and IMAP usernames are required');
      return;
    }
    if (!formData.smtp_password.trim() || !formData.imap_password.trim()) {
      toast.error('SMTP and IMAP passwords are required');
      return;
    }

    setTesting(true);
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
        toast.success('Connection test successful!');
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to test connection';
      toast.error(message);
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
      toast.error('Account not found');
      return;
    }

    // Validation
    if (!formData.email_address.trim()) {
      toast.error('Email address is required');
      return;
    }
    if (!formData.smtp_host.trim() || !formData.imap_host.trim()) {
      toast.error('SMTP and IMAP hosts are required');
      return;
    }
    if (!formData.smtp_username.trim() || !formData.imap_username.trim()) {
      toast.error('SMTP and IMAP usernames are required');
      return;
    }
    if (!formData.smtp_password.trim() || !formData.imap_password.trim()) {
      toast.error('SMTP and IMAP passwords are required');
      return;
    }

    setConnecting(true);

    try {
      const signatureHtml = (await connectSignatureEditorRef.current?.getHTML())?.trim();
      const signature = signatureHtml && signatureHtml !== '<p></p>' ? signatureHtml : null;

      // ⚠️ SECURITY: Passwords should be encrypted before storing
      // TODO: Implement encryption using Supabase Vault or AWS KMS
      // For now, storing as plain text (NOT PRODUCTION READY)
      await createMailbox({
        account_id: accountId,
        user_id: profile.id,
        email_address: formData.email_address.trim(),
        display_name: formData.display_name.trim() || null,
        signature,
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
        min_gap_seconds: formData.min_gap_seconds ?? null,
        daily_limit: formData.daily_limit ?? null,
        hourly_limit: formData.hourly_limit ?? null,
      });

      toast.success('Mailbox created successfully');
      setShowConnectModal(false);
      setFormData(CREATE_MAILBOX_FORM_DATA);
      await loadMailboxes();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect mailbox';
      toast.error(message);
    } finally {
      setConnecting(false);
    }
  };

  const handleActionsSheetMailboxChange = useCallback((m: Mailbox | null) => {
    actionsSheetMailboxRef.current = m;
    setTestResult(null);
    setTestResultMailboxEmail(null);
    setShowTestResultModal(false);
  }, []);

  const handleTestMailbox = useCallback(async (
    mailbox: Mailbox,
    options?: { fromActionsSheet?: boolean }
  ) => {
    const fromSheet = options?.fromActionsSheet === true;
    setTestingMailboxId(mailbox.id);

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

      const newStatus = result.success ? 'connected' : 'error';
      await updateMailboxStatus(
        mailbox.id,
        newStatus,
        result.success ? null : result.message
      );

      setTestResult(result);
      setTestResultMailboxEmail(mailbox.email_address);

      const showInSheet =
        fromSheet && actionsSheetMailboxRef.current?.id === mailbox.id;
      if (!showInSheet) {
        setShowTestResultModal(true);
      }

      await loadMailboxes({ silent: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to test mailbox connection';
      const failure: TestConnectionResult = {
        success: false,
        message,
      };

      await updateMailboxStatus(mailbox.id, 'error', message);

      setTestResult(failure);
      setTestResultMailboxEmail(mailbox.email_address);

      const showInSheet =
        fromSheet && actionsSheetMailboxRef.current?.id === mailbox.id;
      if (!showInSheet) {
        toast.error(message);
        setShowTestResultModal(true);
      }

      await loadMailboxes({ silent: true });
    } finally {
      setTestingMailboxId(null);
    }
  }, [loadMailboxes, toast]);

  const handleEditMailbox = useCallback((mailbox: Mailbox) => {
    setEditMailbox(mailbox);
    setEditMailboxIds([]);
    setEditFormData({
      provider: (mailbox.provider as Provider) || 'custom',
      email_address: mailbox.email_address,
      display_name: mailbox.display_name ?? '',
      signature: mailbox.signature ?? '',
      smtp_host: mailbox.smtp_host,
      smtp_port: String(mailbox.smtp_port),
      smtp_username: mailbox.smtp_username,
      smtp_password: mailbox.smtp_password,
      smtp_use_tls: mailbox.smtp_use_tls,
      smtp_use_ssl: mailbox.smtp_use_ssl,
      imap_host: mailbox.imap_host,
      imap_port: String(mailbox.imap_port),
      imap_username: mailbox.imap_username,
      imap_password: mailbox.imap_password,
      imap_use_ssl: mailbox.imap_use_ssl,
      min_gap_seconds: mailbox.min_gap_seconds ?? null,
      daily_limit: mailbox.daily_limit ?? null,
      hourly_limit: mailbox.hourly_limit ?? null,
    });
    setEditModalActiveTab('profile');
    setShowEditModal(true);
  }, []);

  const handleBulkEdit = () => {
    const ids = Array.from(selectedMailboxes);
    if (ids.length < 2) return;
    setEditMailbox(null);
    setEditMailboxIds(ids);
    setEditFormData({ ...BLANK_MAILBOX_FORM_DATA });
    setEditModalActiveTab('profile');
    setShowEditModal(true);
  };

  const handleSaveMailbox = async () => {
    if (!editFormData) return;
    const isBulk = editMailboxIds.length > 0;
    if (!isBulk && !editMailbox) return;

    const signatureHtml = (await editSignatureEditorRef.current?.getHTML())?.trim() ?? editFormData.signature;
    setSaving(true);
    try {
      if (isBulk) {
        const payload = buildBulkUpdatePayload(editFormData, signatureHtml);
        if (Object.keys(payload).length === 0) {
          toast.error('Fill in at least one field to update');
          setSaving(false);
          return;
        }
        await Promise.all(editMailboxIds.map((id) => updateMailbox(id, payload)));
        toast.success(`${editMailboxIds.length} mailboxes updated`);
        setShowEditModal(false);
        setEditMailboxIds([]);
        setEditFormData(null);
        setSelectedMailboxes(new Set());
      } else {
        await updateMailbox(editMailbox!.id, {
          display_name: editFormData.display_name.trim() || null,
          signature: signatureHtml && signatureHtml !== '<p></p>' ? signatureHtml : null,
          smtp_host: editFormData.smtp_host.trim(),
          smtp_port: parseInt(editFormData.smtp_port, 10),
          smtp_username: editFormData.smtp_username.trim(),
          smtp_password: editFormData.smtp_password,
          smtp_use_tls: editFormData.smtp_use_tls,
          smtp_use_ssl: editFormData.smtp_use_ssl,
          imap_host: editFormData.imap_host.trim(),
          imap_port: parseInt(editFormData.imap_port, 10),
          imap_username: editFormData.imap_username.trim(),
          imap_password: editFormData.imap_password,
          imap_use_ssl: editFormData.imap_use_ssl,
          min_gap_seconds: editFormData.min_gap_seconds ?? null,
          daily_limit: editFormData.daily_limit ?? null,
          hourly_limit: editFormData.hourly_limit ?? null,
        });
        toast.success('Mailbox updated');
        setShowEditModal(false);
        setEditMailbox(null);
        setEditFormData(null);
      }
      await loadMailboxes();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update mailbox';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = useCallback((mailbox: Mailbox) => {
    setMailboxToDelete(mailbox);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (!mailboxToDelete) return;

    setDeleting(true);

    try {
      await deleteMailbox(mailboxToDelete.id);
      await loadMailboxes();
      toast.success('Mailbox deleted successfully');
      setShowDeleteModal(false);
      setMailboxToDelete(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete mailbox';
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const openConnectModal = () => {
    if (isMobile) return;
    setTestResult(null);
    setShowTestResultModal(false);
    setShowConnectModal(true);
  };

  const openUploadCSVModal = () => {
    if (isMobile) return;
    setShowUploadCSVModal(true);
  };

  const handleBulkDelete = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => deleteMailbox(id)));
      setSelectedMailboxes(new Set());
      await loadMailboxes();
      toast.success(`${ids.length} ${ids.length === 1 ? 'mailbox' : 'mailboxes'} deleted successfully`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete mailboxes';
      toast.error(message);
    }
  };

  const desktopHeaderActions = (
    <View className="flex-row gap-2">
      <Button variant="secondary" onPress={openUploadCSVModal}>
        Upload CSV
      </Button>
      <Button onPress={openConnectModal}>Create mailbox</Button>
    </View>
  );

  return (
    <PageLayout mobileLayout="scrollable">
      <PageHeader
        title="Senders"
        subtitle={isMobile ? 'Connected mailboxes' : 'Manage your email mailbox connections'}
        primaryAction={isMobile ? undefined : desktopHeaderActions}
      />
      {isMobile ? (
        <Alert
          variant="info"
          message="To connect new mailboxes or upload a CSV, use Furnace on a desktop browser."
        />
      ) : null}

      <MailboxesTable
        isLoading={isLoading}
        showSkeleton={showSkeleton}
        isMobile={isMobile}
        allowAddMailboxes={!isMobile}
        mailboxes={mailboxes}
        selectedMailboxes={selectedMailboxes}
        onSelectionChange={setSelectedMailboxes}
        onTestMailbox={handleTestMailbox}
        onEditMailbox={handleEditMailbox}
        onDeleteClick={handleDeleteClick}
        testingMailboxId={testingMailboxId}
        onBulkDelete={handleBulkDelete}
        onBulkEdit={handleBulkEdit}
        onClearSelection={() => setSelectedMailboxes(new Set())}
        onConnectMailbox={openConnectModal}
        onUploadCSV={openUploadCSVModal}
        onActionsSheetMailboxChange={handleActionsSheetMailboxChange}
        testResult={testResult}
        testResultMailboxEmail={testResultMailboxEmail}
      />

      <ConnectMailboxModal
        visible={showConnectModal}
        onClose={() => {
          setShowConnectModal(false);
          setTestResult(null);
        }}
        formData={formData}
        setFormData={setFormData}
        connecting={connecting}
        testResult={testResult}
        testing={testing}
        onConnect={handleConnect}
        onTestConnection={handleTestConnection}
        connectSignatureEditorRef={connectSignatureEditorRef}
      />

      <UploadMailboxesCSVModal
        visible={showUploadCSVModal}
        onClose={() => setShowUploadCSVModal(false)}
        onSuccess={async (created, failed) => {
          await loadMailboxes();
          if (created > 0) {
            if (failed > 0) toast.success(`${created} mailboxes created; ${failed} failed`);
            else toast.success(`${created} mailbox${created !== 1 ? 'es' : ''} created`);
          } else if (failed > 0) toast.error('Failed to create mailboxes');
        }}
        accountId={accountId ?? ''}
        userId={profile?.id ?? ''}
      />

      <TestResultModal
        visible={showTestResultModal}
        testResult={testResult}
        testResultMailboxEmail={testResultMailboxEmail}
        onClose={() => {
          setShowTestResultModal(false);
          setTestResult(null);
          setTestResultMailboxEmail(null);
        }}
      />

      {(editMailbox || editMailboxIds.length > 0) && editFormData && (
        <EditMailboxModal
          visible={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setEditMailbox(null);
            setEditMailboxIds([]);
            setEditFormData(null);
          }}
          editMailbox={editMailbox}
          editMailboxIds={editMailboxIds}
          editFormData={editFormData}
          setEditFormData={setEditFormData}
          activeTab={editModalActiveTab}
          onTabChange={setEditModalActiveTab}
          saving={saving}
          onSave={handleSaveMailbox}
          editSignatureEditorRef={editSignatureEditorRef}
        />
      )}

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

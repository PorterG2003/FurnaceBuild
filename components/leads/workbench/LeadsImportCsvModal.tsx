import { useCallback, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { CsvUploadDropzone } from '@/components/foundry/imports/CsvUploadDropzone';
import { useAccount } from '@/contexts/AccountContext';
import {
  createSavedLeadListFromCsvEmails,
  resolveLeadListCsvEmails,
} from '@/lib/supabase/services/leads/saved-lists';

const UTF8_BOM = '\ufeff';

function parseCsvEmails(text: string): string[] {
  const normalized = text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const headerCells = lines[0]!.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '').toLowerCase());
  const emailIndex = headerCells.findIndex((cell) =>
    ['email', 'email address', 'work email', 'business email'].includes(cell),
  );

  const emails: string[] = [];
  const startIndex = emailIndex >= 0 ? 1 : 0;
  const columnIndex = emailIndex >= 0 ? emailIndex : 0;

  for (let i = startIndex; i < lines.length; i += 1) {
    const cells = lines[i]!.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
    const candidate = cells[columnIndex]?.trim();
    if (candidate && candidate.includes('@')) {
      emails.push(candidate);
    }
  }

  return [...new Set(emails.map((email) => email.toLowerCase()))];
}

export function LeadsImportCsvModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (listId: string) => void;
}) {
  const { account } = useAccount();
  const [fileName, setFileName] = useState<string | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [listName, setListName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [matchedCount, setMatchedCount] = useState(0);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [creating, setCreating] = useState(false);

  const reset = useCallback(() => {
    setFileName(null);
    setEmails([]);
    setListName('');
    setError(null);
    setMatchedCount(0);
    setUnmatchedCount(0);
    setResolving(false);
    setCreating(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleParsed = useCallback(async (parsedFileName: string, text: string) => {
    if (!account?.id) {
      setError('No active account found.');
      return;
    }
    setError(null);
    const parsedEmails = parseCsvEmails(text);
    if (parsedEmails.length === 0) {
      setError('No email addresses found in this CSV. Include an email column or put emails in the first column.');
      setFileName(parsedFileName);
      setEmails([]);
      setListName(parsedFileName.replace(/\.csv$/i, ''));
      return;
    }
    setFileName(parsedFileName);
    setEmails(parsedEmails);
    setListName(parsedFileName.replace(/\.csv$/i, ''));
    try {
      setResolving(true);
      const resolved = await resolveLeadListCsvEmails(account.id, parsedEmails);
      setMatchedCount(resolved.matchedEmailCount);
      setUnmatchedCount(resolved.unmatchedEmails.length);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to inspect CSV emails.');
      setMatchedCount(0);
      setUnmatchedCount(0);
    } finally {
      setResolving(false);
    }
  }, [account?.id]);

  const handleCreate = useCallback(async () => {
    if (!account?.id) {
      setError('No active account found.');
      return;
    }
    if (emails.length === 0) {
      setError('Upload a CSV with at least one email address.');
      return;
    }
    try {
      setCreating(true);
      const nextList = await createSavedLeadListFromCsvEmails(account.id, {
        name: listName.trim() || (fileName?.replace(/\.csv$/i, '') || 'Imported list'),
        emails,
      });
      handleClose();
      onCreated(nextList.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create list from CSV.');
    } finally {
      setCreating(false);
    }
  }, [account?.id, emails, fileName, handleClose, listName, onCreated]);

  if (Platform.OS !== 'web') {
    return (
      <BaseModal
        visible={visible}
        onClose={handleClose}
        title="Import CSV"
        description="CSV import is available on a desktop browser."
        maxWidth="md"
        footer={(
          <ModalFooter>
            <Button variant="secondary" onPress={handleClose}>
              Close
            </Button>
          </ModalFooter>
        )}
      >
        <Text className="text-gray-400 font-instrument text-sm">
          Open Furnace on a desktop browser to import a CSV and create a leads list.
        </Text>
      </BaseModal>
    );
  }

  const footer = (
    <ModalFooter>
      <Button variant="secondary" onPress={handleClose} disabled={creating}>
        Cancel
      </Button>
      <Button onPress={() => void handleCreate()} disabled={emails.length === 0 || resolving || creating}>
        Create list
      </Button>
    </ModalFooter>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Import CSV"
      description="Upload a CSV to create a new leads list from email addresses."
      maxWidth="2xl"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-4">
        {resolving ? <LoadingState message="Matching CSV emails to leads..." className="py-8" /> : null}
        {creating ? <LoadingState message="Creating saved list..." className="py-8" /> : null}
        {error ? <Alert variant="error" message={error} /> : null}
        <CsvUploadDropzone onParsed={handleParsed} />
        {emails.length > 0 ? (
          <View className="gap-3">
            <View>
              <Text className="text-gray-500 font-instrument text-xs uppercase mb-2">List name</Text>
              <TextInput
                value={listName}
                onChangeText={setListName}
                placeholder="Imported list"
                placeholderTextColor="#6B7280"
                className="border border-[#2A2A2A] rounded-xl px-4 py-3 bg-[#121212] text-white font-instrument min-h-[44px]"
                editable={!creating}
              />
            </View>
            <Text className="text-gray-400 font-instrument text-sm">
              Found {emails.length} email{emails.length === 1 ? '' : 's'} in {fileName ?? 'CSV'}.{' '}
              {matchedCount} match this account&apos;s leads
              {unmatchedCount > 0 ? `, ${unmatchedCount} do not` : ''}.
            </Text>
          </View>
        ) : null}
      </View>
    </BaseModal>
  );
}

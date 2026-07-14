import { View, Text, Pressable, Platform } from 'react-native';
import { PaperClipIcon, XMarkIcon } from 'react-native-heroicons/outline';
import { formatBytes } from '@/lib/inbox';
import type { SendAttachment } from '@/lib/supabase/services/inbox';

export interface ComposerAttachmentItem extends SendAttachment {
  /** Local-only upload progress flag */
  uploading?: boolean;
}

export const COMPOSER_FILE_INPUT_ID = 'composer-file-input';
const MAX_FILES_DEFAULT = 10;
const MAX_TOTAL_BYTES_DEFAULT = 5 * 1024 * 1024;
const MAX_FILE_BYTES_DEFAULT = 2 * 1024 * 1024;

export interface ComposerAttachmentsProps {
  attachments: ComposerAttachmentItem[];
  onAttachmentsChange: (attachments: ComposerAttachmentItem[]) => void;
  /** Called when user picks files (parent uploads to Storage). */
  onFilesSelected?: (files: FileList) => void | Promise<void>;
  /** Called when user removes an attachment (parent deletes pending Storage object). */
  onRemoveAttachment?: (attachment: ComposerAttachmentItem, index: number) => void | Promise<void>;
  maxFiles?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
  /** Optional error message to show (e.g. total size exceeded) */
  error?: string | null;
  /** Message when some files were skipped (e.g. "1 file skipped (over 2 MB)") */
  skipMessage?: string | null;
  /** When true, only render the list (no trigger). Used when trigger is in editor toolbar (web). */
  hideTrigger?: boolean;
  /** Show "Adding…" when parent is reading files (web). */
  loading?: boolean;
}

export function ComposerAttachments({
  attachments,
  onAttachmentsChange,
  onFilesSelected,
  onRemoveAttachment,
  maxFiles = MAX_FILES_DEFAULT,
  maxTotalBytes = MAX_TOTAL_BYTES_DEFAULT,
  maxFileBytes: _maxFileBytes = MAX_FILE_BYTES_DEFAULT,
  error: externalError,
  skipMessage: externalSkipMessage = null,
  hideTrigger = false,
  loading: externalLoading = false,
}: ComposerAttachmentsProps) {
  const loading = externalLoading;

  const totalBytes = attachments.reduce((sum, a) => sum + (a.size ?? 0), 0);
  const atLimit = attachments.length >= maxFiles;
  const overTotal = totalBytes > maxTotalBytes;

  const handleWebInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (!files || files.length === 0) return;
    if (onFilesSelected) {
      await onFilesSelected(files);
      return;
    }
  };

  const handleNativeAttach = async () => {
    if (Platform.OS === 'web') return;
    // Native: parent should wire document picker via onFilesSelected equivalent;
    // keep attach button as no-op without handler for now.
  };

  const removeAt = async (index: number) => {
    const att = attachments[index];
    if (att && onRemoveAttachment) {
      await onRemoveAttachment(att, index);
    }
    const next = attachments.filter((_, i) => i !== index);
    onAttachmentsChange(next);
  };

  const triggerAttach = () => {
    if (Platform.OS !== 'web') {
      void handleNativeAttach();
    }
  };

  const errorMessage = externalError ?? (overTotal ? 'Total attachment size exceeds 5 MB.' : null);
  const showTriggerChrome =
    !hideTrigger &&
    (Platform.OS !== 'web' || loading || attachments.length > 0 || !onFilesSelected);

  // Web file input is always rendered when onFilesSelected is provided (hidden trigger uses toolbar).
  const showHiddenFileInput = Platform.OS === 'web' && !!onFilesSelected;

  return (
    <View className={hideTrigger ? '' : 'mt-2'}>
      {showHiddenFileInput && (
        // @ts-expect-error web-only input
        <input
          id={COMPOSER_FILE_INPUT_ID}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleWebInputChange}
        />
      )}

      {!hideTrigger && (
        <View className="flex-row items-center gap-2 flex-wrap">
          {Platform.OS === 'web' ? (
            <Pressable
              onPress={() => {
                if (atLimit || loading) return;
                const el = typeof document !== 'undefined' ? document.getElementById(COMPOSER_FILE_INPUT_ID) : null;
                (el as HTMLInputElement | null)?.click();
              }}
              disabled={atLimit || loading}
              className="flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5"
              style={{
                backgroundColor: 'rgba(107, 114, 128, 0.15)',
                opacity: atLimit || loading ? 0.5 : 1,
              }}
            >
              <PaperClipIcon size={16} color="#9CA3AF" />
              <Text className="text-gray-300 font-instrument text-xs">
                {loading ? 'Uploading…' : 'Attach'}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={triggerAttach}
              disabled={atLimit || loading}
              className="flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5"
              style={{
                backgroundColor: 'rgba(107, 114, 128, 0.15)',
                opacity: atLimit || loading ? 0.5 : 1,
              }}
            >
              <PaperClipIcon size={16} color="#9CA3AF" />
              <Text className="text-gray-300 font-instrument text-xs">Attach</Text>
            </Pressable>
          )}
          {!loading && attachments.length > 0 && (
            <Text className="text-gray-500 font-instrument text-[10px]">
              {attachments.length} file{attachments.length !== 1 ? 's' : ''}, {formatBytes(totalBytes)}
            </Text>
          )}
        </View>
      )}

      {Platform.OS === 'web' && hideTrigger && (loading || (!loading && attachments.length > 0)) && (
        <View className="mb-1">
          {loading && (
            <Text className="text-gray-500 font-instrument text-[10px]">Uploading…</Text>
          )}
          {!loading && attachments.length > 0 && (
            <Text className="text-gray-500 font-instrument text-[10px]">
              {attachments.length} file{attachments.length !== 1 ? 's' : ''}, {formatBytes(totalBytes)}
            </Text>
          )}
        </View>
      )}

      {attachments.length > 0 && (
        <View className="mt-2 gap-1">
          {attachments.map((att, index) => (
            <View
              key={`${att.storagePath}:${att.filename}:${index}`}
              className="flex-row items-center justify-between rounded-lg px-2.5 py-1.5"
              style={{ backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A' }}
            >
              <View className="flex-1 min-w-0 mr-2">
                <Text className="text-gray-300 font-instrument text-xs" numberOfLines={1}>
                  {att.filename}
                </Text>
                <Text className="text-gray-500 font-instrument text-[10px]">
                  {att.uploading ? 'Uploading…' : formatBytes(att.size ?? 0)}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  void removeAt(index);
                }}
                hitSlop={8}
                accessibilityLabel={`Remove ${att.filename}`}
              >
                <XMarkIcon size={16} color="#9CA3AF" />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {errorMessage ? (
        <Text className="text-red-400 font-instrument text-[10px] mt-1">{errorMessage}</Text>
      ) : null}
      {externalSkipMessage ? (
        <Text className="text-amber-400/90 font-instrument text-[10px] mt-1">{externalSkipMessage}</Text>
      ) : null}
      {showTriggerChrome ? null : null}
    </View>
  );
}

import { useRef, useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { PaperClipIcon, XMarkIcon } from 'react-native-heroicons/outline';
import { formatBytes } from '@/lib/inbox';
import type { SendAttachment } from '@/lib/supabase/services/inbox';

export interface ComposerAttachmentItem extends SendAttachment {
  size?: number;
}

export const COMPOSER_FILE_INPUT_ID = 'composer-file-input';
const MAX_FILES_DEFAULT = 10;
const MAX_TOTAL_BYTES_DEFAULT = 5 * 1024 * 1024;
const MAX_FILE_BYTES_DEFAULT = 2 * 1024 * 1024;

function parseDataUrl(dataUrl: string): { contentType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL');
  return { contentType: match[1].trim(), base64: match[2] };
}

export interface ComposerAttachmentsProps {
  attachments: ComposerAttachmentItem[];
  onAttachmentsChange: (attachments: ComposerAttachmentItem[]) => void;
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
  maxFiles = MAX_FILES_DEFAULT,
  maxTotalBytes = MAX_TOTAL_BYTES_DEFAULT,
  maxFileBytes = MAX_FILE_BYTES_DEFAULT,
  error: externalError,
  skipMessage: externalSkipMessage = null,
  hideTrigger = false,
  loading: externalLoading = false,
}: ComposerAttachmentsProps) {
  const [webLoading, setWebLoading] = useState(false);
  const loading = externalLoading || webLoading;

  const totalBytes = attachments.reduce((sum, a) => sum + (a.size ?? 0), 0);
  const atLimit = attachments.length >= maxFiles;
  const overTotal = totalBytes > maxTotalBytes;

  const handleWebInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (!files || files.length === 0) return;
    setWebLoading(true);
    const toAdd: ComposerAttachmentItem[] = [];
    let skipped = 0;
    const currentTotal = attachments.reduce((s, a) => s + (a.size ?? 0), 0);
    for (let i = 0; i < files.length && attachments.length + toAdd.length < maxFiles; i++) {
      const file = files[i];
      if (file.size > maxFileBytes) {
        skipped += 1;
        continue;
      }
      const runningTotal = currentTotal + toAdd.reduce((s, a) => s + (a.size ?? 0), 0);
      if (runningTotal + file.size > maxTotalBytes) {
        skipped += 1;
        continue;
      }
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const parsed = parseDataUrl(reader.result as string);
              resolve(parsed.base64);
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        toAdd.push({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          content: base64,
          size: file.size,
        });
      } catch {
        skipped += 1;
      }
    }
    setWebLoading(false);
    if (toAdd.length > 0) {
      onAttachmentsChange([...attachments, ...toAdd]);
    }
  };

  const handleNativeAttach = async () => {
    if (Platform.OS === 'web') return;
    try {
      const docPicker = await import('expo-document-picker').catch(() => null);
      if (!docPicker) return;
      const result = await docPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      const FileSystem = await import('expo-file-system').catch(() => null);
      if (!FileSystem) return;
      const toAdd: ComposerAttachmentItem[] = [];
      const currentTotal = attachments.reduce((s, a) => s + (a.size ?? 0), 0);
      for (const asset of result.assets) {
        if (attachments.length + toAdd.length >= maxFiles) break;
        const uri = asset.uri;
        const name = asset.name ?? 'attachment';
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: 'base64',
        });
        const size = asset.size ?? Math.floor(base64.length * 0.75);
        if (size > maxFileBytes) continue;
        if (currentTotal + toAdd.reduce((s, a) => s + (a.size ?? 0), 0) + size > maxTotalBytes) continue;
        const contentType = asset.mimeType ?? 'application/octet-stream';
        toAdd.push({ filename: name, contentType, content: base64, size });
      }
      if (toAdd.length > 0) {
        onAttachmentsChange([...attachments, ...toAdd]);
      }
    } catch (err) {
      console.error('Document picker error:', err);
    }
  };

  const removeAt = (index: number) => {
    const next = attachments.filter((_, i) => i !== index);
    onAttachmentsChange(next);
  };

  const triggerAttach = () => {
    if (Platform.OS !== 'web') {
      handleNativeAttach();
    }
  };

  const errorMessage = externalError ?? (overTotal ? 'Total attachment size exceeds 5 MB.' : null);

  const attachButtonContent = (
    <>
      <PaperClipIcon size={18} color="#9CA3AF" />
      <Text className="text-gray-400 font-instrument text-sm">
        {loading ? 'Adding…' : 'Attach file'}
      </Text>
    </>
  );

  const nativeAttachRowStyle = {
    minHeight: 44,
    backgroundColor: '#2A2A2A' as const,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
    gap: 8,
  };

  const hasTopRowContent =
    (Platform.OS === 'web' && !hideTrigger) ||
    (Platform.OS !== 'web' && !hideTrigger) ||
    (Platform.OS === 'web' && (loading || attachments.length > 0));

  return (
    <View className="mb-4" style={{ paddingHorizontal: 12, maxWidth: '100%' }}>
      {hasTopRowContent && (
      <View className="flex-row items-center gap-2 flex-wrap">
        {Platform.OS === 'web' && !hideTrigger && (
          <>
            <input
              id={COMPOSER_FILE_INPUT_ID}
              type="file"
              multiple
              accept="*/*"
              className="hidden"
              onChange={handleWebInputChange}
            />
            <label
              htmlFor={COMPOSER_FILE_INPUT_ID}
              style={{
                display: 'inline-flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: '#2A2A2A',
                backgroundColor: atLimit ? '#1A1A1A' : '#2A2A2A',
                opacity: atLimit ? 0.6 : 1,
                cursor: atLimit ? 'not-allowed' : 'pointer',
                pointerEvents: atLimit ? 'none' : 'auto',
              }}
            >
              {attachButtonContent}
            </label>
          </>
        )}
        {Platform.OS !== 'web' && !hideTrigger && (
          <View style={nativeAttachRowStyle}>
            <Pressable
              onPress={triggerAttach}
              disabled={atLimit}
              className="flex-row items-center gap-2 rounded-xl border border-[#3A3A3A] px-3 py-2"
              style={{
                borderWidth: 1,
                backgroundColor: atLimit ? '#1A1A1A' : '#1A1A1A',
                opacity: atLimit ? 0.6 : 1,
              }}
            >
              {attachButtonContent}
            </Pressable>
            {loading && (
              <Text className="text-gray-500 font-instrument text-xs">Adding…</Text>
            )}
            {!loading && attachments.length > 0 && (
              <Text className="text-gray-500 font-instrument text-xs">
                {attachments.length} file{attachments.length !== 1 ? 's' : ''}, {formatBytes(totalBytes)}
              </Text>
            )}
          </View>
        )}
        {Platform.OS === 'web' && (loading || (!loading && attachments.length > 0)) && (
          <>
            {loading && (
              <Text className="text-gray-500 font-instrument text-xs">Adding…</Text>
            )}
            {!loading && attachments.length > 0 && (
              <Text className="text-gray-500 font-instrument text-xs">
                {attachments.length} file{attachments.length !== 1 ? 's' : ''}, {formatBytes(totalBytes)}
              </Text>
            )}
          </>
        )}
      </View>
      )}
      {errorMessage && (
        <Text className="text-amber-500 font-instrument text-xs mt-1.5">{errorMessage}</Text>
      )}
      {externalSkipMessage && (
        <Text className="text-amber-500 font-instrument text-xs mt-1.5">{externalSkipMessage}</Text>
      )}
      {attachments.length > 0 && (
        <View className="mt-2 gap-1.5">
          {attachments.map((att, index) => (
            <View
              key={`${att.filename}-${index}`}
              className="flex-row items-center justify-between rounded-lg bg-[#2A2A2A] border border-[#3A3A3A] px-3 py-2"
              style={{ borderWidth: 1 }}
            >
              <Text className="text-gray-300 font-instrument text-sm flex-1" numberOfLines={1} ellipsizeMode="middle">
                {att.filename}
              </Text>
              <Text className="text-gray-500 font-instrument text-xs mr-2">
                {att.size != null ? formatBytes(att.size) : '—'}
              </Text>
              <Pressable
                onPress={() => removeAt(index)}
                hitSlop={8}
                className="p-1 rounded"
                style={{ backgroundColor: 'rgba(107, 114, 128, 0.2)' }}
              >
                <XMarkIcon size={16} color="#9CA3AF" />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

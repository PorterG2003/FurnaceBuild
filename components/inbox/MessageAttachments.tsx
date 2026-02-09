import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Image, Platform } from 'react-native';
import { ArrowDownTrayIcon, DocumentIcon, PhotoIcon } from 'react-native-heroicons/outline';
import type { EmailMessage } from '@/lib/supabase/types';
import { formatBytes } from '@/lib/inbox';

const BLOCK_SIZE = 140;

function isImageType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.startsWith('image/');
}

/** Single attachment block: square preview/icon, truncated filename; on hover: full filename + download */
function AttachmentBlock({
  att,
  message,
  index,
  onDownload,
  onFetchPreview,
}: {
  att: { filename?: string; name?: string; contentType?: string; content_type?: string; size?: number; part?: string; imapUid?: number };
  message: EmailMessage;
  index: number;
  onDownload: (emailMessageId: string, part: string, filename: string) => Promise<void>;
  onFetchPreview?: (emailMessageId: string, part: string) => Promise<Blob | null>;
}) {
  const part = att.part;
  const canDownload = !!part && (att.imapUid != null || (message as { imap_uid?: number }).imap_uid != null);
  const filename = att.filename ?? att.name ?? 'attachment';
  const contentType = att.contentType ?? att.content_type ?? '';

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [webHovered, setWebHovered] = useState(false);
  const showHoverContent = webHovered || Platform.OS !== 'web';
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isImageType(contentType) || !onFetchPreview || !part || !canDownload) return;
    let revoked = false;
    setPreviewLoading(true);
    onFetchPreview(message.id, String(part))
      .then((blob) => {
        if (!revoked && blob) {
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          setPreviewUrl(url);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!revoked) setPreviewLoading(false);
      });
    return () => {
      revoked = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setPreviewUrl(null);
    };
  }, [message.id, part, contentType, canDownload, onFetchPreview]);

  const isImage = isImageType(contentType);

  const containerProps =
    Platform.OS === 'web'
      ? {
          onMouseEnter: () => setWebHovered(true),
          onMouseLeave: () => setWebHovered(false),
        }
      : {};

  return (
    <View
      className="rounded-lg overflow-hidden"
      style={{
        width: BLOCK_SIZE,
        height: BLOCK_SIZE,
        backgroundColor: '#1A1A1A',
        borderWidth: 1,
        borderColor: '#2A2A2A',
        ...(Platform.OS === 'web' && { cursor: canDownload && !downloading ? 'pointer' : 'default' }),
      }}
      {...(containerProps as object)}
    >
      {/* Full-block loading: filename + progress bar, persists when hover ends */}
      {downloading && (
        <View
          className="absolute inset-0 p-3 justify-between"
          style={{ backgroundColor: '#1A1A1A' }}
        >
          <View className="flex-shrink-0 min-h-0">
            <Text className="text-gray-300 font-instrument text-xs" numberOfLines={3}>
              {filename}
            </Text>
            {att.size != null && (
              <Text className="text-gray-500 font-instrument text-[10px] mt-1">
                {formatBytes(att.size)}
              </Text>
            )}
          </View>
          <View className="flex-shrink-0">
            <View
              className="rounded-full overflow-hidden"
              style={{ height: 4, backgroundColor: 'rgba(107, 114, 128, 0.3)' }}
            >
              <View
                className="h-full rounded-full"
                style={{
                  width: `${downloadProgress}%`,
                  backgroundColor: '#F3440D',
                }}
              />
            </View>
            <Text className="text-gray-500 font-instrument text-[10px] mt-1.5" style={{ color: '#9CA3AF' }}>
              {downloadProgress}%
            </Text>
          </View>
        </View>
      )}
      {/* Default: preview + truncated filename; download only on hover (web) or always (native) */}
      {!downloading && !showHoverContent && (
        <>
          <View style={{ width: BLOCK_SIZE, height: 100, alignItems: 'center', justifyContent: 'center', backgroundColor: '#121212' }}>
            {previewUrl ? (
              <Image
                source={{ uri: previewUrl }}
                style={{ width: BLOCK_SIZE, height: 100 }}
                resizeMode="cover"
              />
            ) : isImage && previewLoading ? (
              <Text className="text-gray-500 font-instrument text-xs">Loading…</Text>
            ) : isImage ? (
              <PhotoIcon size={32} color="#6B7280" />
            ) : (
              <DocumentIcon size={32} color="#6B7280" />
            )}
          </View>
          <View className="px-2 justify-center" style={{ backgroundColor: '#1A1A1A', height: 40 }}>
            <Text className="text-gray-300 font-instrument text-xs" numberOfLines={1} ellipsizeMode="tail">
              {filename}
            </Text>
          </View>
        </>
      )}
      {/* Hover (web): full filename at top + size + download; native always shows this (no hover) */}
      {!downloading && showHoverContent && (
        <View
          className="absolute inset-0 p-3 justify-between"
          style={{ backgroundColor: '#1A1A1A' }}
        >
          <View className="flex-shrink-0 min-h-0">
            <Text className="text-gray-300 font-instrument text-xs" numberOfLines={4}>
              {filename}
            </Text>
            {att.size != null && (
              <Text className="text-gray-500 font-instrument text-[10px] mt-1">
                {formatBytes(att.size)}
              </Text>
            )}
          </View>
          <Pressable
            onPress={async () => {
              if (!canDownload || downloading) return;
              setDownloading(true);
              setDownloadProgress(0);
              // Fake progress: ramp 0→90% over ~4s, then jump to 100% on done
              const start = Date.now();
              const interval = setInterval(() => {
                const elapsed = (Date.now() - start) / 1000;
                const target = Math.min(90, Math.floor(elapsed * 25));
                setDownloadProgress(target);
              }, 120);
              try {
                await onDownload(message.id, String(part), filename);
                clearInterval(interval);
                setDownloadProgress(100);
                await new Promise((r) => setTimeout(r, 120)); // Brief 100% before closing
              } finally {
                clearInterval(interval);
                setDownloading(false);
                setDownloadProgress(0);
              }
            }}
            disabled={!canDownload || downloading}
            className="flex-row items-center justify-center gap-1 rounded py-1.5 flex-shrink-0"
            hitSlop={4}
            style={{
              backgroundColor: canDownload ? 'rgba(243, 68, 13, 0.15)' : 'rgba(107, 114, 128, 0.15)',
              opacity: canDownload ? 1 : 0.7,
            }}
          >
            <ArrowDownTrayIcon size={14} color={canDownload ? '#F3440D' : '#6B7280'} />
            <Text
              className="font-instrument-medium text-xs"
              style={{ color: canDownload ? '#F3440D' : '#6B7280' }}
            >
              Download
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Attachment blocks with image preview or document icon + download */
export function MessageAttachments({
  message,
  onDownload,
  onFetchPreview,
}: {
  message: EmailMessage;
  onDownload: (emailMessageId: string, part: string, filename: string) => Promise<void>;
  onFetchPreview?: (emailMessageId: string, part: string) => Promise<Blob | null>;
}) {
  const attachments = (message.attachments as Array<{ filename?: string; name?: string; contentType?: string; content_type?: string; size?: number; part?: string; imapUid?: number }> | null) ?? [];
  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  return (
    <View className="mt-3 flex-row flex-wrap gap-2">
      {attachments.map((att, i) => (
        <AttachmentBlock
          key={i}
          att={att}
          message={message}
          index={i}
          onDownload={onDownload}
          onFetchPreview={onFetchPreview}
        />
      ))}
    </View>
  );
}

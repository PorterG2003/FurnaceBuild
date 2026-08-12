import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, ActivityIndicator } from 'react-native';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ArrowPathIcon,
  ExclamationCircleIcon,
  EllipsisVerticalIcon,
  InformationCircleIcon,
} from 'react-native-heroicons/outline';
import type { EmailMessage } from '@/lib/supabase/types';
import { getDisplayBody } from '@/lib/email/index';
import { buildMessageHeaderDisplay, formatMessageDate, getInitials } from '@/lib/inbox';
import { BottomSheet, ConfirmModal } from '@/components/ui/modals';
import { MessageBody } from './MessageBody';
import { MessageAttachments } from './MessageAttachments';

function MessageAddressRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start gap-2 min-w-0">
      <Text
        className="text-gray-400 font-instrument-medium text-xs"
        style={{ width: 36 }}
      >
        {label}
      </Text>
      <Text className="text-gray-300 font-instrument text-xs flex-1 min-w-0">
        {value}
      </Text>
    </View>
  );
}

export type MessageBubbleActionsLayout = 'inline' | 'overflowSheet';

function formatPendingScheduledTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (dateOnly.getTime() === today.getTime()) {
    return `${time} today`;
  }
  if (dateOnly.getTime() === tomorrow.getTime()) {
    return `${time} tomorrow`;
  }
  if (Math.abs(dateOnly.getTime() - today.getTime()) < 7 * 24 * 60 * 60 * 1000) {
    return `${time} ${d.toLocaleDateString([], { weekday: 'short' })}`;
  }
  return `${time} ${d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })}`;
}

/** Single message bubble: centered card with avatar and Reply/Forward in header (or overflow menu on mobile) */
export function MessageBubble({
  message,
  onReply,
  onForward,
  onDownloadAttachment,
  onFetchAttachmentPreview,
  isPending,
  isFailed,
  errorMessage,
  pendingJobStatus,
  pendingScheduledAt,
  pendingSendWaitReason,
  isSendingImmediately,
  onSendImmediately,
  onCancel,
  pendingDisplayLabel,
  pendingSecondaryLabel,
  cancelLabel,
  cancelConfirmTitle,
  cancelConfirmMessage,
  onRetry,
  messageActionsLayout = 'inline',
}: {
  message: EmailMessage;
  onReply?: (message: EmailMessage) => void;
  onForward?: (message: EmailMessage) => void;
  onDownloadAttachment?: (emailMessageId: string, attachmentIndex: number, filename: string) => Promise<void>;
  onFetchAttachmentPreview?: (emailMessageId: string, attachmentIndex: number) => Promise<Blob | null>;
  isPending?: boolean;
  isFailed?: boolean;
  errorMessage?: string | null;
  pendingJobStatus?: 'queued' | 'reserved' | 'sending';
  pendingScheduledAt?: string | null;
  pendingSendWaitReason?: string | null;
  isSendingImmediately?: boolean;
  onSendImmediately?: () => void;
  onCancel?: () => void;
  pendingDisplayLabel?: string;
  pendingSecondaryLabel?: string | null;
  cancelLabel?: string;
  cancelConfirmTitle?: string;
  cancelConfirmMessage?: string;
  onRetry?: () => void;
  /** `overflowSheet`: three-dots opens a bottom sheet with Reply / Forward (mobile). */
  messageActionsLayout?: MessageBubbleActionsLayout;
}) {
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const rawBody = message.body_text ?? message.body_html ?? '';
  const body = getDisplayBody(rawBody, {
    format: message.body_text ? 'text' : 'html',
  });
  const sender = message.from_name || message.from_email;
  const subject = message.subject?.trim();
  const headerDisplay = buildMessageHeaderDisplay({
    message,
    pendingSecondaryLabel,
  });
  const [addressesExpanded, setAddressesExpanded] = useState(
    headerDisplay.defaultExpanded,
  );
  useEffect(() => {
    setAddressesExpanded(headerDisplay.defaultExpanded);
  }, [message.id, headerDisplay.defaultExpanded]);
  const isSent = message.direction === 'sent';
  const canReply = onReply != null && !isPending && !isFailed;
  const canForward = onForward != null && !isPending && !isFailed;
  const showRetry = isFailed && onRetry != null;
  const showOverflowActions =
    messageActionsLayout === 'overflowSheet' && (canReply || canForward);
  const showInlineActions = messageActionsLayout === 'inline' && (canReply || canForward);
  /** Desktop pane uses a centered 92%-width card; mobile inbox uses full width of the padded row. */
  const fullWidthCard = messageActionsLayout === 'overflowSheet';
  const scheduledAtMs = pendingScheduledAt ? new Date(pendingScheduledAt).getTime() : NaN;
  const hasFutureSchedule =
    pendingJobStatus === 'queued' &&
    Number.isFinite(scheduledAtMs) &&
    scheduledAtMs > Date.now();
  const headerStatusText = isFailed
    ? 'Failed'
    : !isPending
      ? formatMessageDate(message.received_at)
      : pendingJobStatus === 'reserved' || pendingJobStatus === 'sending'
        ? 'Sending…'
        : hasFutureSchedule
          ? 'Scheduled'
          : 'Waiting to send…';
  const pendingPrimaryText = hasFutureSchedule && pendingScheduledAt
    ? `Sends after ${formatPendingScheduledTime(pendingScheduledAt)}`
    : null;
  const showSendImmediatelyButton =
    !!(
      isPending &&
      !isFailed &&
      pendingJobStatus === 'queued' &&
      onSendImmediately &&
      (hasFutureSchedule || pendingSendWaitReason)
    );
  const showHeaderCancelButton =
    !!(onCancel && isPending && !isFailed && pendingJobStatus === 'queued');
  const showCancelButton = !!(onCancel && isFailed);
  const showPendingCallout =
    !!(
      isPending &&
      !isFailed &&
      (pendingPrimaryText || pendingSendWaitReason || showSendImmediatelyButton)
    );

  const borderPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isPending || isFailed) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(borderPulse, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: false,
        }),
        Animated.timing(borderPulse, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isPending, isFailed, borderPulse]);

  const animatedBorderColor = borderPulse.interpolate({
    inputRange: [0, 1],
    outputRange: ['#2A2A2A', 'rgba(243, 68, 13, 0.55)'],
  });

  const cardContent = (
    <View
      className={
        fullWidthCard
          ? 'rounded-xl w-full max-w-full overflow-hidden'
          : 'rounded-xl w-[92%] max-w-[92%] overflow-hidden'
      }
      style={{
        backgroundColor: isSent ? '#1E1E1E' : '#1A1A1A',
        borderWidth: isPending || isFailed ? 0 : 1,
        borderColor: isPending || isFailed ? 'transparent' : '#2A2A2A',
      }}
    >
      {isPending && !isFailed ? (
        <Animated.View
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderWidth: 2,
            borderRadius: 12,
            borderColor: animatedBorderColor,
          }}
        />
      ) : null}
      {isFailed ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderWidth: 2,
            borderRadius: 12,
            borderColor: '#EF4444',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <View className="px-5 pt-3 pb-2.5">
        <View className="flex-row items-start justify-between flex-wrap gap-2">
          <View className="flex-row items-start flex-1 min-w-0">
            <View
              className="w-10 h-10 rounded-full items-center justify-center flex-shrink-0"
              style={{ backgroundColor: '#2A2A2A' }}
            >
              <Text className="text-white font-instrument-semibold text-sm">
                {getInitials(message.from_name, message.from_email)}
              </Text>
            </View>
            <View className="ml-3 items-start flex-1 min-w-0 gap-0.5">
              <View className="flex-row items-center w-full min-w-0 gap-2">
                <View className="flex-row items-center flex-1 min-w-0 gap-2">
                  <Text
                    className="text-white font-instrument-semibold text-base min-w-0"
                    numberOfLines={1}
                    style={{ flexShrink: 1 }}
                  >
                    {pendingDisplayLabel ?? (isSent ? 'You' : sender)}
                  </Text>
                  {subject ? (
                    <Text
                      className="text-gray-500 font-instrument text-sm min-w-0"
                      numberOfLines={1}
                      style={{ flexShrink: 1, fontStyle: 'italic', paddingEnd: 3 }}
                    >
                      {subject}
                    </Text>
                  ) : null}
                </View>
                {(!fullWidthCard || isFailed || isPending) && (
                  <View className="flex-row items-center gap-2 flex-shrink-0">
                    {showHeaderCancelButton ? (
                      <Pressable
                        onPress={() => setCancelConfirmOpen(true)}
                        className="rounded-lg px-3 py-1.5"
                        hitSlop={8}
                        style={{ backgroundColor: 'rgba(239, 68, 68, 0.14)' }}
                      >
                        <Text className="font-instrument-medium text-sm" style={{ color: '#FCA5A5' }}>
                          {cancelLabel ?? 'Cancel'}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Text className="text-gray-500 font-instrument text-xs">
                      {headerStatusText}
                    </Text>
                  </View>
                )}
              </View>
              {headerDisplay.pendingSecondaryLabel ? (
                <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
                  {headerDisplay.pendingSecondaryLabel}
                </Text>
              ) : null}
              <View className="gap-0.5 min-w-0 w-full">
                <Pressable
                  onPress={() => setAddressesExpanded((open) => !open)}
                  className="flex-row items-center gap-1 min-w-0 self-start max-w-full"
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: addressesExpanded }}
                  accessibilityLabel={
                    addressesExpanded
                      ? 'Hide details'
                      : `${headerDisplay.summaryLine || 'Recipients'}. Show details`
                  }
                >
                  {addressesExpanded ? (
                    <Text className="text-gray-400 font-instrument text-xs">
                      Hide details
                    </Text>
                  ) : (
                    <>
                      <Text
                        className="text-gray-400 font-instrument text-xs"
                        numberOfLines={1}
                        style={{ flexShrink: 1 }}
                      >
                        {headerDisplay.summaryLine || 'Recipients'}
                      </Text>
                      <InformationCircleIcon
                        size={14}
                        color="#9CA3AF"
                        style={{ flexShrink: 0 }}
                      />
                    </>
                  )}
                </Pressable>
                {addressesExpanded ? (
                  <View
                    className="gap-0.5 min-w-0"
                    accessible
                    accessibilityRole="text"
                    accessibilityLabel={headerDisplay.accessibilityLabel}
                  >
                    <MessageAddressRow label="From" value={headerDisplay.fromDisplay} />
                    {headerDisplay.toDisplay ? (
                      <MessageAddressRow label="To" value={headerDisplay.toDisplay} />
                    ) : null}
                    {headerDisplay.ccDisplay ? (
                      <MessageAddressRow label="Cc" value={headerDisplay.ccDisplay} />
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          </View>
          {showRetry && (
            <Pressable
              onPress={onRetry}
              className="flex-row items-center gap-2 rounded-lg px-3 py-1.5 flex-shrink-0"
              hitSlop={8}
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)' }}
            >
              <ArrowPathIcon size={16} color="#EF4444" />
              <Text className="font-instrument-medium text-sm" style={{ color: '#EF4444' }}>
                Retry
              </Text>
            </Pressable>
          )}
          {showOverflowActions && (
            <Pressable
              onPress={() => setActionSheetOpen(true)}
              className="flex-row items-center justify-center rounded-lg p-1.5 flex-shrink-0"
              hitSlop={8}
              accessibilityLabel="Message actions"
              style={{ backgroundColor: 'rgba(107, 114, 128, 0.2)' }}
            >
              <EllipsisVerticalIcon size={20} color="#9CA3AF" />
            </Pressable>
          )}
          {showInlineActions && canReply && (
            <Pressable
              onPress={() => onReply(message)}
              className="flex-row items-center gap-2 rounded-lg px-3 py-1.5 flex-shrink-0"
              hitSlop={8}
              style={{ backgroundColor: 'rgba(243, 68, 13, 0.12)' }}
            >
              <ArrowUturnLeftIcon size={16} color="#F3440D" />
              <Text className="font-instrument-medium text-sm" style={{ color: '#F3440D' }}>
                Reply
              </Text>
            </Pressable>
          )}
          {showInlineActions && canForward && (
            <Pressable
              onPress={() => onForward(message)}
              className="flex-row items-center gap-2 rounded-lg px-3 py-1.5 flex-shrink-0"
              hitSlop={8}
              style={{ backgroundColor: 'rgba(107, 114, 128, 0.2)' }}
            >
              <ArrowUturnRightIcon size={16} color="#9CA3AF" />
              <Text className="font-instrument-medium text-sm text-gray-400">
                Forward
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      <View className="mx-5 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }} />
      <View className="px-5 py-4">
        {isFailed && errorMessage ? (
          <View className="mb-3 flex-row items-start gap-2 rounded-lg p-3" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
            <ExclamationCircleIcon size={18} color="#EF4444" style={{ marginTop: 2 }} />
            <View className="flex-1">
              <Text className="text-red-400 font-instrument-semibold text-sm mb-1">Failed to send</Text>
              <Text className="text-red-300 font-instrument text-xs">{errorMessage}</Text>
              {showCancelButton ? (
                <Pressable
                  onPress={() => setCancelConfirmOpen(true)}
                  className="mt-3 flex-row items-center justify-center self-start rounded-lg px-3 py-2"
                  style={{ backgroundColor: 'rgba(239, 68, 68, 0.16)' }}
                >
                  <Text className="font-instrument-medium text-sm" style={{ color: '#FCA5A5' }}>
                    {cancelLabel ?? 'Cancel'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
        {showPendingCallout ? (
          <View
            className="mb-3 flex-row items-center gap-3 rounded-lg p-3"
            style={{ backgroundColor: 'rgba(243, 68, 13, 0.08)', borderWidth: 1, borderColor: 'rgba(243, 68, 13, 0.16)' }}
          >
            <View className="flex-1 min-w-0">
              {pendingPrimaryText ? (
                <Text className="text-[#F97316] font-instrument-semibold text-sm">
                  {pendingPrimaryText}
                </Text>
              ) : null}
              {pendingSendWaitReason ? (
                <Text className="text-orange-200 font-instrument text-xs mt-1">
                  {pendingSendWaitReason}
                </Text>
              ) : null}
            </View>
            {showSendImmediatelyButton ? (
              <View className="flex-row items-center gap-2 flex-shrink-0">
                <Pressable
                  onPress={onSendImmediately}
                  disabled={isSendingImmediately}
                  accessibilityLabel="Send now, bypass hourly send limits and minimum gap for this message"
                  className="flex-row items-center justify-center rounded-lg px-3 py-2"
                  style={{ backgroundColor: 'rgba(243, 68, 13, 0.14)' }}
                >
                  {isSendingImmediately ? (
                    <ActivityIndicator size="small" color="#F97316" />
                  ) : (
                    <Text className="font-instrument-medium text-sm" style={{ color: '#F97316' }}>
                      Send now
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
        <MessageBody
          bodyHtml={message.body_html}
          bodyText={message.body_text}
          displayText={body}
        />
        {onDownloadAttachment && (
          <MessageAttachments
            message={message}
            onDownload={onDownloadAttachment}
            onFetchPreview={onFetchAttachmentPreview}
          />
        )}
      </View>
    </View>
  );

  return (
    <View
      className={
        fullWidthCard
          ? 'mb-4 w-full'
          : 'mb-4 flex-row w-full justify-center items-center'
      }
    >
      {cardContent}
      {showOverflowActions && (
        <BottomSheet visible={actionSheetOpen} onClose={() => setActionSheetOpen(false)}>
          {canReply && (
            <Pressable
              onPress={() => {
                setActionSheetOpen(false);
                onReply?.(message);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                borderBottomWidth: canForward ? 1 : 0,
                borderBottomColor: '#2A2A2A',
              }}
            >
              <ArrowUturnLeftIcon size={20} color="#9CA3AF" />
              <Text className="text-white font-instrument-medium text-base text-gray-400">
                Reply
              </Text>
            </Pressable>
          )}
          {canForward && (
            <Pressable
              onPress={() => {
                setActionSheetOpen(false);
                onForward?.(message);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
              }}
            >
              <ArrowUturnRightIcon size={20} color="#9CA3AF" />
              <Text className="text-white font-instrument-medium text-base text-gray-400">Forward</Text>
            </Pressable>
          )}
        </BottomSheet>
      )}
      <ConfirmModal
        visible={cancelConfirmOpen}
        onClose={() => setCancelConfirmOpen(false)}
        onConfirm={() => {
          setCancelConfirmOpen(false);
          onCancel?.();
        }}
        title={cancelConfirmTitle ?? 'Cancel pending message?'}
        message={cancelConfirmMessage ?? 'This will cancel the pending message before it sends.'}
        confirmLabel={cancelLabel ?? 'Cancel'}
        cancelLabel="Keep"
        confirmVariant="destructive"
      />
    </View>
  );
}

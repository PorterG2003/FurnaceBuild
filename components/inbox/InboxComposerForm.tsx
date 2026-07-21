import React from 'react';
import { View, Text, TextInput, ScrollView, Pressable } from 'react-native';
import { PaperAirplaneIcon } from 'react-native-heroicons/outline';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmModal } from '@/components/ui/modals';
import { ComposerAttachments } from './ComposerAttachments';
import { ComposerRichEditor } from './ComposerRichEditor';
import { MessageBody } from './MessageBody';
import { stripHtml } from '@/lib/email';
import type { EmailEditorMode } from '@/lib/email';
import type { EditorBridge } from '@10play/tentap-editor';
import type { ComposerAttachmentItem } from './ComposerAttachments';
import { MAX_ATTACHMENTS, MAX_TOTAL_BYTES, MAX_FILE_BYTES } from './inboxConstants';
import { EmailHtmlCodeEditor } from '@/components/email/EmailHtmlCodeEditor';

export interface InboxComposerFormProps {
  mode: 'reply' | 'forward';
  onCancel: () => void;
  /** Reply fields */
  replyToEmail: string;
  setReplyToEmail: (v: string) => void;
  replyCc: string;
  setReplyCc: (v: string) => void;
  replySubject: string;
  setReplySubject: (v: string) => void;
  /** Forward fields */
  forwardToEmail: string;
  setForwardToEmail: (v: string) => void;
  forwardCc: string;
  setForwardCc: (v: string) => void;
  forwardSubject: string;
  setForwardSubject: (v: string) => void;
  /** Shared */
  composerEditorRef: React.RefObject<EditorBridge | null>;
  composerAttachments: ComposerAttachmentItem[];
  setComposerAttachments: React.Dispatch<React.SetStateAction<ComposerAttachmentItem[]>>;
  onFilesSelected: (files: FileList) => void;
  onRemoveAttachment?: (attachment: ComposerAttachmentItem, index: number) => void | Promise<void>;
  composerAttachmentsLoading: boolean;
  composerAttachmentsSkipMessage: string | null;
  includeSignature: boolean;
  setIncludeSignature: React.Dispatch<React.SetStateAction<boolean>>;
  forwardQuoteHtml: string;
  replyEditorMode: EmailEditorMode;
  forwardEditorMode: EmailEditorMode;
  replyHtmlDraft: string;
  setReplyHtmlDraft: React.Dispatch<React.SetStateAction<string>>;
  forwardHtmlDraft: string;
  setForwardHtmlDraft: React.Dispatch<React.SetStateAction<string>>;
  replyRichInitialContent: string;
  forwardRichInitialContent: string;
  onSwitchReplyToHtml: () => void;
  onSwitchForwardToHtml: () => void;
  switchToRichConfirmMode: 'reply' | 'forward' | null;
  onRequestSwitchToRich: (mode: 'reply' | 'forward') => void;
  onCancelSwitchToRich: () => void;
  onConfirmSwitchToRich: () => void;
  /** Actions */
  onSendReply: () => void;
  onSendForward: () => void;
  sendingReply: boolean;
  sendingForward: boolean;
  /** Optional: hide attachment trigger on web */
  hideAttachmentTrigger?: boolean;
  /** Optional: editor key suffix for mobile vs desktop (e.g. "reply" vs "reply-sheet") */
  editorKeySuffix?: string;
}

const inputClassName = 'bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]';
const inputStyle = { borderWidth: 1 };

export function InboxComposerForm({
  mode,
  onCancel,
  replyToEmail,
  setReplyToEmail,
  replyCc,
  setReplyCc,
  replySubject,
  setReplySubject,
  forwardToEmail,
  setForwardToEmail,
  forwardCc,
  setForwardCc,
  forwardSubject,
  setForwardSubject,
  composerEditorRef,
  composerAttachments,
  setComposerAttachments,
  onFilesSelected,
  onRemoveAttachment,
  composerAttachmentsLoading,
  composerAttachmentsSkipMessage,
  includeSignature,
  setIncludeSignature,
  forwardQuoteHtml,
  replyEditorMode,
  forwardEditorMode,
  replyHtmlDraft,
  setReplyHtmlDraft,
  forwardHtmlDraft,
  setForwardHtmlDraft,
  replyRichInitialContent,
  forwardRichInitialContent,
  onSwitchReplyToHtml,
  onSwitchForwardToHtml,
  switchToRichConfirmMode,
  onRequestSwitchToRich,
  onCancelSwitchToRich,
  onConfirmSwitchToRich,
  onSendReply,
  onSendForward,
  sendingReply,
  sendingForward,
  hideAttachmentTrigger = false,
  editorKeySuffix = '',
}: InboxComposerFormProps) {
  const totalAttachmentBytes = composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0);
  const attachmentsError = totalAttachmentBytes > MAX_TOTAL_BYTES ? 'Total attachment size exceeds 5 MB.' : null;

  const attachmentsBlock = (
    <ComposerAttachments
      attachments={composerAttachments}
      onAttachmentsChange={setComposerAttachments}
      onFilesSelected={onFilesSelected}
      onRemoveAttachment={onRemoveAttachment}
      maxFiles={MAX_ATTACHMENTS}
      maxTotalBytes={MAX_TOTAL_BYTES}
      maxFileBytes={MAX_FILE_BYTES}
      hideTrigger={hideAttachmentTrigger}
      loading={composerAttachmentsLoading}
      skipMessage={composerAttachmentsSkipMessage}
      error={attachmentsError}
    />
  );

  const scrollStyle = { flex: 1, minHeight: 0 };

  return (
    <View className="flex-1 min-h-0 pb-4">
      <View className="flex-row justify-between items-center mb-5 pb-3 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
        <Text className="text-xl font-instrument-semibold text-white">
          {mode === 'reply' ? 'Reply' : 'Forward'}
        </Text>
        <Pressable onPress={onCancel} className="rounded-xl border border-[#3A3A3A] px-4 py-2">
          <Text className="text-gray-300 font-instrument-medium text-sm">Cancel</Text>
        </Pressable>
      </View>
      {mode === 'reply' ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          className="pb-4"
          style={scrollStyle}
        >
          <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">To</Text>
          <TextInput
            value={replyToEmail}
            onChangeText={setReplyToEmail}
            placeholder="recipient@example.com"
            placeholderTextColor="#6B7280"
            className={inputClassName}
            style={inputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Cc (optional)</Text>
          <Text className="text-gray-500 font-instrument text-xs mb-1">Separate multiple addresses with commas or spaces.</Text>
          <TextInput
            value={replyCc}
            onChangeText={setReplyCc}
            placeholder="cc@example.com, other@example.com"
            placeholderTextColor="#6B7280"
            className={inputClassName}
            style={inputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Subject</Text>
          <TextInput
            value={replySubject}
            onChangeText={setReplySubject}
            placeholder="Subject"
            placeholderTextColor="#6B7280"
            className={inputClassName}
            style={inputStyle}
          />
          <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Message</Text>
          <View className="flex-row items-center gap-2 mb-3">
            <Checkbox checked={includeSignature} onPress={() => setIncludeSignature((prev) => !prev)} />
            <Pressable onPress={() => setIncludeSignature((prev) => !prev)}>
              <Text className="text-gray-300 font-instrument text-sm">Include signature</Text>
            </Pressable>
          </View>
          {replyEditorMode === 'html' ? (
            <>
              <EmailHtmlCodeEditor
                value={replyHtmlDraft}
                onChangeText={setReplyHtmlDraft}
                label="Message HTML"
                placeholder="<p>Write your reply…</p>"
                minHeight={180}
                trailingElement={
                  <Pressable onPress={() => onRequestSwitchToRich('reply')} className="rounded-xl border border-[#3A3A3A] px-3 py-2">
                    <Text className="text-gray-300 font-instrument-medium text-xs">Rich text</Text>
                  </Pressable>
                }
              />
              {attachmentsBlock}
            </>
          ) : (
            <ComposerRichEditor
              key={`reply${editorKeySuffix}:${replyRichInitialContent}`}
              initialContent={replyRichInitialContent}
              placeholder="Write your reply…"
              editorRef={composerEditorRef}
              minHeight={140}
              attachmentCount={composerAttachments.length}
              onFilesSelected={onFilesSelected}
              renderBetweenToolbarAndContent={attachmentsBlock}
              onSwitchToHtml={onSwitchReplyToHtml}
            />
          )}
          <View className="mb-5" />
          <Button
            onPress={onSendReply}
            disabled={sendingReply || !replyToEmail.trim() || totalAttachmentBytes > MAX_TOTAL_BYTES}
            className="rounded-xl"
          >
            <View className="flex-row items-center gap-2">
              <Text className="font-instrument-medium text-base text-white">
                {sendingReply ? 'Sending…' : 'Send reply'}
              </Text>
              <PaperAirplaneIcon size={18} color="white" />
            </View>
          </Button>
        </ScrollView>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          className="pb-4"
          style={scrollStyle}
        >
          <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">To</Text>
          <TextInput
            value={forwardToEmail}
            onChangeText={setForwardToEmail}
            placeholder="recipient@example.com"
            placeholderTextColor="#6B7280"
            className={inputClassName}
            style={inputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Cc (optional)</Text>
          <TextInput
            value={forwardCc}
            onChangeText={setForwardCc}
            placeholder="cc@example.com, other@example.com"
            placeholderTextColor="#6B7280"
            className={inputClassName}
            style={inputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Subject</Text>
          <TextInput
            value={forwardSubject}
            onChangeText={setForwardSubject}
            placeholder="Subject"
            placeholderTextColor="#6B7280"
            className={inputClassName}
            style={inputStyle}
          />
          <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Message</Text>
          <Text className="text-gray-500 font-instrument text-xs mb-1">Add your message above the forwarded content.</Text>
          <View className="flex-row items-center gap-2 mb-3">
            <Checkbox checked={includeSignature} onPress={() => setIncludeSignature((prev) => !prev)} />
            <Pressable onPress={() => setIncludeSignature((prev) => !prev)}>
              <Text className="text-gray-300 font-instrument text-sm">Include signature</Text>
            </Pressable>
          </View>
          {forwardEditorMode === 'html' ? (
            <>
              <EmailHtmlCodeEditor
                value={forwardHtmlDraft}
                onChangeText={setForwardHtmlDraft}
                label="Message HTML"
                placeholder="<p>Write your message…</p>"
                minHeight={180}
                trailingElement={
                  <Pressable onPress={() => onRequestSwitchToRich('forward')} className="rounded-xl border border-[#3A3A3A] px-3 py-2">
                    <Text className="text-gray-300 font-instrument-medium text-xs">Rich text</Text>
                  </Pressable>
                }
              />
              {attachmentsBlock}
            </>
          ) : (
            <ComposerRichEditor
              key={`forward${editorKeySuffix}:${forwardRichInitialContent}`}
              initialContent={forwardRichInitialContent}
              placeholder="Write your message…"
              editorRef={composerEditorRef}
              minHeight={140}
              attachmentCount={composerAttachments.length}
              onFilesSelected={onFilesSelected}
              renderBetweenToolbarAndContent={attachmentsBlock}
              onSwitchToHtml={onSwitchForwardToHtml}
            />
          )}
          <View className="mt-4 mb-5 rounded-xl border border-[#2A2A2A] bg-[#202020] px-4 py-3">
            <Text className="text-gray-400 font-instrument-medium text-sm mb-2">Forwarded content</Text>
            <MessageBody
              bodyHtml={forwardQuoteHtml}
              bodyText={null}
              displayText={stripHtml(forwardQuoteHtml)}
              disableQuotedThreadCollapse
            />
          </View>
          <Button
            onPress={onSendForward}
            disabled={sendingForward || !forwardToEmail.trim() || totalAttachmentBytes > MAX_TOTAL_BYTES}
            className="rounded-xl"
          >
            <View className="flex-row items-center gap-2">
              <Text className="font-instrument-medium text-base text-white">
                {sendingForward ? 'Sending…' : 'Send forward'}
              </Text>
              <PaperAirplaneIcon size={18} color="white" />
            </View>
          </Button>
        </ScrollView>
      )}
      <ConfirmModal
        visible={switchToRichConfirmMode != null}
        onClose={onCancelSwitchToRich}
        onConfirm={onConfirmSwitchToRich}
        title="Switch back to Rich text?"
        message="Complex HTML may be simplified or replaced when it is converted back into the Rich text editor."
        confirmLabel="Switch"
      />
    </View>
  );
}

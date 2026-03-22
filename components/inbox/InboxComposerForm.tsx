import React from 'react';
import { View, Text, TextInput, ScrollView, Pressable } from 'react-native';
import { PaperAirplaneIcon } from 'react-native-heroicons/outline';
import { Button } from '@/components/ui/button';
import { ComposerAttachments } from './ComposerAttachments';
import { ComposerRichEditor } from './ComposerRichEditor';
import { buildQuotedForwardThreadHtml } from '@/lib/inbox/quote-utils';
import type { EmailMessage } from '@/lib/supabase/types';
import type { EditorBridge } from '@10play/tentap-editor';
import type { ComposerAttachmentItem } from './ComposerAttachments';
import { MAX_ATTACHMENTS, MAX_TOTAL_BYTES, MAX_FILE_BYTES } from './inboxConstants';

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
  composerAttachmentsLoading: boolean;
  composerAttachmentsSkipMessage: string | null;
  signatureHtml: string;
  /** Forward only: messages and subject for quoted HTML */
  messages: EmailMessage[];
  forwardThreadSubject: string;
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
  composerAttachmentsLoading,
  composerAttachmentsSkipMessage,
  signatureHtml,
  messages,
  forwardThreadSubject,
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
      maxFiles={MAX_ATTACHMENTS}
      maxTotalBytes={MAX_TOTAL_BYTES}
      maxFileBytes={MAX_FILE_BYTES}
      hideTrigger={hideAttachmentTrigger}
      loading={composerAttachmentsLoading}
      skipMessage={composerAttachmentsSkipMessage}
      error={attachmentsError}
    />
  );

  return (
    <View className="pb-4">
      <View className="flex-row justify-between items-center mb-5 pb-3 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
        <Text className="text-xl font-instrument-semibold text-white">
          {mode === 'reply' ? 'Reply' : 'Forward'}
        </Text>
        <Pressable onPress={onCancel} className="rounded-xl border border-[#3A3A3A] px-4 py-2">
          <Text className="text-gray-300 font-instrument-medium text-sm">Cancel</Text>
        </Pressable>
      </View>
      {mode === 'reply' ? (
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} className="pb-4">
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
          <ComposerRichEditor
            key={`reply${editorKeySuffix}`}
            initialContent={`<p></p>${signatureHtml}`}
            placeholder="Write your reply…"
            editorRef={composerEditorRef}
            minHeight={140}
            attachmentCount={composerAttachments.length}
            onFilesSelected={onFilesSelected}
            renderBetweenToolbarAndContent={attachmentsBlock}
          />
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
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} className="pb-4">
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
          <ComposerRichEditor
            key={`forward${editorKeySuffix}`}
            initialContent={`<p></p>${signatureHtml}${buildQuotedForwardThreadHtml(messages, forwardThreadSubject)}`}
            placeholder="Write your message…"
            editorRef={composerEditorRef}
            minHeight={140}
            attachmentCount={composerAttachments.length}
            onFilesSelected={onFilesSelected}
            renderBetweenToolbarAndContent={attachmentsBlock}
          />
          <View className="mb-5" />
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
    </View>
  );
}

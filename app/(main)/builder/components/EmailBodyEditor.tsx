import React from 'react';
import { View, Text, Platform } from 'react-native';
import { ComposerRichEditor } from '@/components/inbox';
import { MergeTagVariablePicker } from '@/components/builder/MergeTagVariablePicker';

/** Minimal bridge for rich editor (getHTML, getText, insertContent). Web TipTap implementation provides these. */
interface EmailEditorBridge {
  getHTML: () => string;
  getText: () => string;
  insertContent?: (text: string) => void;
}

export type LeadVariable = { token: string; description: string };

export interface EmailBodyEditorProps {
  initialContent: string;
  editorRef: React.MutableRefObject<EmailEditorBridge | null>;
  variables: LeadVariable[];
  placeholder?: string;
  minHeight?: number;
  label?: string;
  /** Called when content changes (web). Used for live preview. */
  onContentChange?: (text: string) => void;
  /** Called when editor HTML changes (web). */
  onHtmlChange?: (html: string) => void;
  /** Optional element to render in the header row to the right of the Variables button (e.g. Preview). */
  trailingElement?: React.ReactNode;
  onSwitchToHtml?: () => void;
}

/**
 * Rich text editor for email body in builder, with variable insertion.
 * Uses ComposerRichEditor (TipTap on web) and adds a variable menu.
 * Web-only: ComposerRichEditor.web provides insertContent for variable insertion.
 */
export function EmailBodyEditor({
  initialContent,
  editorRef,
  variables,
  placeholder = "Hi {{first_name}},\n\nLoved what you're building at {{company_name}}...",
  minHeight = 220,
  label = 'Email Body',
  onContentChange,
  onHtmlChange,
  trailingElement,
  onSwitchToHtml,
}: EmailBodyEditorProps) {
  const handleSelectVariable = (token: string) => {
    const bridge = editorRef.current;
    if (bridge?.insertContent) {
      bridge.insertContent(token);
    }
  };

  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text className="text-sm font-instrument-medium text-gray-300">
          {label}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {trailingElement}
        <MergeTagVariablePicker variables={variables} onSelect={handleSelectVariable} />
        </View>
      </View>
      <View>
        <ComposerRichEditor
          key="email-body"
          initialContent={initialContent}
          placeholder={placeholder}
          editorRef={editorRef as React.MutableRefObject<import('@10play/tentap-editor').EditorBridge | null>}
          minHeight={minHeight}
          onContentChange={onContentChange}
          onHtmlChange={onHtmlChange}
          onSwitchToHtml={onSwitchToHtml}
        />
      </View>
    </View>
  );
}

export default EmailBodyEditor;

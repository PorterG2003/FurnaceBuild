import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { CodeBracketIcon } from 'react-native-heroicons/outline';
import { ComposerRichEditor } from '@/components/inbox';
import { Select } from '@/components/ui/forms';

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
  /** Optional element to render in the header row to the right of the Variables button (e.g. Preview). */
  trailingElement?: React.ReactNode;
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
  trailingElement,
}: EmailBodyEditorProps) {
  const [variableSearch, setVariableSearch] = useState('');

  const filteredVariables = useMemo(() => {
    if (!variableSearch.trim()) return variables;
    const q = variableSearch.trim().toLowerCase();
    return variables.filter(
      (v) =>
        v.token.toLowerCase().includes(q) || v.description.toLowerCase().includes(q)
    );
  }, [variables, variableSearch]);

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
        <Select<LeadVariable>
          items={filteredVariables}
          getItemId={(v) => v.token}
          getItemLabel={(v) => ({ primary: v.token, secondary: v.description })}
          value={null}
          onChange={(_id, item) => {
            if (item) handleSelectVariable(item.token);
          }}
          searchable={true}
          onSearchChange={setVariableSearch}
          searchValue={variableSearch}
          placeholder="Variables"
          searchPlaceholder="Search variables…"
          emptyMessage={(hasSearch) =>
            hasSearch ? 'No matching variables.' : 'No variables.'
          }
          listMaxHeight={320}
          noMargin={true}
          size="compact"
          dropdownMinWidth={260}
          renderTrigger={({ open, onPress }) => (
            <TouchableOpacity
              onPress={onPress}
              style={{
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderWidth: 1,
                borderColor: open ? 'rgba(243,68,13,0.4)' : 'rgba(255,255,255,0.16)',
                backgroundColor: open ? 'rgba(243,68,13,0.2)' : 'rgba(255,255,255,0.08)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CodeBracketIcon size={18} color={open ? '#F3440D' : '#FFFFFF'} />
            </TouchableOpacity>
            )}
        />
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
        />
      </View>
    </View>
  );
}

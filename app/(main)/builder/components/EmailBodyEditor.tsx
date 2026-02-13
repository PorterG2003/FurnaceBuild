import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { CodeBracketIcon } from 'react-native-heroicons/outline';
import { ComposerRichEditor } from '@/components/inbox';

/** Minimal bridge for rich editor (getHTML, getText, insertContent). Web TipTap implementation provides these. */
interface EmailEditorBridge {
  getHTML: () => string;
  getText: () => string;
  insertContent?: (text: string) => void;
}

export type LeadVariable = { token: string; description: string };

interface VariableMenuProps {
  variables: LeadVariable[];
  width?: number;
  maxHeight?: number;
  anchorOffset?: number;
  onSelect: (token: string) => void;
}

const VariableMenu = ({
  variables,
  width = 240,
  maxHeight = 280,
  anchorOffset = 52,
  onSelect,
}: VariableMenuProps) => (
  <View
    style={{
      position: 'absolute',
      top: anchorOffset,
      right: 0,
      width,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.18)',
      backgroundColor: '#141414',
      paddingVertical: 6,
      paddingHorizontal: 6,
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 12 },
      elevation: 12,
      zIndex: 200,
      maxHeight,
      overflow: 'hidden',
    }}
  >
    <ScrollView
      showsVerticalScrollIndicator
      style={{ maxHeight: maxHeight - 12 }}
      contentContainerStyle={{ paddingVertical: 4 }}
    >
      {variables.map((variable, index) => (
        <TouchableOpacity
          key={variable.token}
          onPress={() => onSelect(variable.token)}
          style={{
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: '#262626',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
            marginBottom: index === variables.length - 1 ? 0 : 8,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 12, fontFamily: 'Instrument Sans, system-ui, sans-serif', fontWeight: '600' }}>
            {variable.token}
          </Text>
          <Text style={{ color: '#9CA3AF', fontSize: 11, marginTop: 3, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>
            {variable.description}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
);

export interface EmailBodyEditorProps {
  initialContent: string;
  editorRef: React.MutableRefObject<EmailEditorBridge | null>;
  variables: LeadVariable[];
  placeholder?: string;
  minHeight?: number;
  label?: string;
  /** Called when content changes (web). Used for live preview. */
  onContentChange?: (text: string) => void;
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
}: EmailBodyEditorProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSelectVariable = (token: string) => {
    const bridge = editorRef.current;
    if (bridge?.insertContent) {
      bridge.insertContent(token);
    }
    setMenuOpen(false);
  };

  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    <View
      style={{
        marginBottom: 24,
        position: 'relative',
        zIndex: menuOpen ? 30 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text className="text-sm font-instrument-medium text-gray-300">
          {label}
        </Text>
        <TouchableOpacity
          onPress={() => setMenuOpen((prev) => !prev)}
          style={{
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderWidth: 1,
            borderColor: menuOpen ? 'rgba(243,68,13,0.4)' : 'rgba(255,255,255,0.16)',
            backgroundColor: menuOpen ? 'rgba(243,68,13,0.2)' : 'rgba(255,255,255,0.08)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CodeBracketIcon
            size={18}
            color={menuOpen ? '#F3440D' : '#FFFFFF'}
          />
        </TouchableOpacity>
      </View>
      <View style={{ position: 'relative', zIndex: menuOpen ? 40 : 1 }}>
        <ComposerRichEditor
          key="email-body"
          initialContent={initialContent}
          placeholder={placeholder}
          editorRef={editorRef as React.MutableRefObject<import('@10play/tentap-editor').EditorBridge | null>}
          minHeight={minHeight}
          onContentChange={onContentChange}
        />
        {menuOpen && (
          <VariableMenu
            variables={variables}
            width={260}
            maxHeight={320}
            anchorOffset={8}
            onSelect={handleSelectVariable}
          />
        )}
      </View>
    </View>
  );
}

import React, { useEffect } from 'react';
import { View } from 'react-native';
import { RichText, Toolbar, useEditorBridge } from '@10play/tentap-editor';
import type { EditorBridge } from '@10play/tentap-editor';

const darkTheme = {
  toolbar: {
    toolbarBody: {
      borderTopColor: '#2A2A2A',
      borderBottomColor: '#2A2A2A',
      backgroundColor: '#1A1A1A',
    },
  },
  webview: {
    backgroundColor: '#2A2A2A',
  },
  webviewContainer: {},
};

export interface ComposerRichEditorProps {
  initialContent?: string;
  placeholder?: string;
  editorRef: React.MutableRefObject<EditorBridge | null>;
  minHeight?: number;
}

/**
 * Rich text editor for reply/forward composer.
 * Exposes the editor via editorRef so parent can call getHTML()/getText() on send.
 */
export function ComposerRichEditor({
  initialContent = '<p></p>',
  placeholder = 'Write your message…',
  editorRef,
  minHeight = 120,
}: ComposerRichEditorProps) {
  const editor = useEditorBridge({
    autofocus: false,
    avoidIosKeyboard: true,
    initialContent,
    theme: darkTheme,
  });

  useEffect(() => {
    editorRef.current = editor;
    if ('setPlaceholder' in editor && typeof editor.setPlaceholder === 'function') {
      editor.setPlaceholder(placeholder);
    }
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef, placeholder]);

  return (
    <View style={{ minHeight, borderRadius: 12, overflow: 'hidden', backgroundColor: '#2A2A2A', borderWidth: 1, borderColor: '#2A2A2A' }}>
      <RichText editor={editor} />
      <Toolbar editor={editor} />
    </View>
  );
}

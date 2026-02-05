import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions/placeholder';
import type { Editor } from '@tiptap/core';
import {
  LinkIcon,
  PhotoIcon,
  CodeBracketIcon,
  CodeBracketSquareIcon,
  ListBulletIcon,
  ChatBubbleBottomCenterTextIcon,
  DocumentTextIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
} from 'react-native-heroicons/outline';

export interface EditorBridge {
  getHTML: () => string;
  getText: () => string;
  setPlaceholder?: (value: string) => void;
}

export interface ComposerRichEditorProps {
  initialContent?: string;
  placeholder?: string;
  editorRef: React.MutableRefObject<EditorBridge | null>;
  minHeight?: number;
}

/**
 * Rich text editor for web using TipTap.
 * Exposes a bridge compatible with TenTap's EditorBridge so the parent can call getHTML()/getText().
 */
export function ComposerRichEditor({
  initialContent = '<p></p>',
  placeholder = 'Write your message…',
  editorRef,
  minHeight = 120,
}: ComposerRichEditorProps) {
  const placeholderRef = useRef(placeholder);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [imagePopoverOpen, setImagePopoverOpen] = useState(false);
  const [headingDropdownOpen, setHeadingDropdownOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'composer-editor',
      },
    },
  });

  useEffect(() => {
    placeholderRef.current = placeholder;
  }, [placeholder]);

  useEffect(() => {
    if (!editor) return;
    const bridge: EditorBridge = {
      getHTML: () => editor.getHTML(),
      getText: () => editor.getText(),
      setPlaceholder: (value: string) => {
        placeholderRef.current = value;
      },
    };
    editorRef.current = bridge;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  useEffect(() => {
    if (linkPopoverOpen && linkInputRef.current) {
      const href = editor?.getAttributes('link')?.href ?? '';
      setLinkUrl(href);
      linkInputRef.current.focus();
    }
  }, [linkPopoverOpen, editor]);

  const editorContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Close popovers when clicking in the editor content (user is done, wants to type)
      if (editorContentRef.current?.contains(target)) {
        setLinkPopoverOpen(false);
        setImagePopoverOpen(false);
        setHeadingDropdownOpen(false);
      }
      // Close when clicking outside the entire editor
      if (containerRef.current && !containerRef.current.contains(target)) {
        setLinkPopoverOpen(false);
        setImagePopoverOpen(false);
        setHeadingDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const handleSetLink = () => {
    if (!editor) return;
    const url = linkUrl.trim();
    if (url) {
      const hasProtocol = /^https?:\/\//i.test(url);
      editor.chain().focus().setLink({ href: hasProtocol ? url : `https://${url}` }).run();
    }
    setLinkPopoverOpen(false);
    setLinkUrl('');
  };

  const handleRemoveLink = () => {
    editor?.chain().focus().unsetLink().run();
    setLinkPopoverOpen(false);
    setLinkUrl('');
  };

  const handleAddImage = () => {
    const url = imageUrl.trim();
    if (url && editor) {
      const hasProtocol = /^https?:\/\//i.test(url);
      editor.chain().focus().setImage({ src: hasProtocol ? url : `https://${url}` }).run();
    }
    setImagePopoverOpen(false);
    setImageUrl('');
  };

  if (!editor) return null;

  const isLinkActive = editor.isActive('link');
  const currentHeading = editor.isActive('heading', { level: 1 }) ? 1
    : editor.isActive('heading', { level: 2 }) ? 2
    : editor.isActive('heading', { level: 3 }) ? 3
    : 0;

  return (
    <div
      ref={containerRef}
      style={{
        minHeight,
        borderRadius: 12,
        overflow: 'visible',
        backgroundColor: '#2A2A2A',
        border: '1px solid #2A2A2A',
      }}
    >
      {/* Toolbar */}
      <div className="composer-toolbar">
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <BoldIcon size={18} color="currentColor" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <ItalicIcon size={18} color="currentColor" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
          <UnderlineIcon size={18} color="currentColor" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
          <StrikeIcon size={18} color="currentColor" />
        </ToolbarButton>

        <div className="composer-toolbar-divider" />

        <div style={{ position: 'relative' }}>
          <ToolbarButton
            onClick={() => setLinkPopoverOpen((o) => !o)}
            active={isLinkActive}
            title="Link"
          >
            <LinkIcon size={18} color="currentColor" />
          </ToolbarButton>
          {linkPopoverOpen && (
            <LinkPopover
              linkUrl={linkUrl}
              setLinkUrl={setLinkUrl}
              onSet={handleSetLink}
              onRemove={handleRemoveLink}
              onClose={() => setLinkPopoverOpen(false)}
              inputRef={linkInputRef}
              hasLink={isLinkActive}
            />
          )}
        </div>

        <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline code">
          <CodeBracketIcon size={18} color="currentColor" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
          <CodeBracketSquareIcon size={18} color="currentColor" />
        </ToolbarButton>

        <div className="composer-toolbar-divider" />

        <div style={{ position: 'relative' }}>
          <ToolbarButton
            onClick={() => setHeadingDropdownOpen((o) => !o)}
            active={currentHeading > 0}
            title="Heading"
          >
            <DocumentTextIcon size={18} color="currentColor" />
          </ToolbarButton>
          {headingDropdownOpen && (
            <HeadingDropdown
              editor={editor}
              currentHeading={currentHeading}
              onClose={() => setHeadingDropdownOpen(false)}
            />
          )}
        </div>

        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <ListBulletIcon size={18} color="currentColor" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <OrderedListIcon size={18} color="currentColor" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
          <ChatBubbleBottomCenterTextIcon size={18} color="currentColor" />
        </ToolbarButton>

        <div className="composer-toolbar-divider" />

        <div style={{ position: 'relative' }}>
          <ToolbarButton onClick={() => setImagePopoverOpen((o) => !o)} active={false} title="Insert image">
            <PhotoIcon size={18} color="currentColor" />
          </ToolbarButton>
          {imagePopoverOpen && (
            <ImagePopover
              imageUrl={imageUrl}
              setImageUrl={setImageUrl}
              onAdd={handleAddImage}
              onClose={() => setImagePopoverOpen(false)}
            />
          )}
        </div>

        <div style={{ marginLeft: 'auto' }} />

        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} active={false} disabled={!editor.can().undo()} title="Undo">
          <ArrowUturnLeftIcon size={18} color="currentColor" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} active={false} disabled={!editor.can().redo()} title="Redo">
          <ArrowUturnRightIcon size={18} color="currentColor" />
        </ToolbarButton>
      </div>
      {/* Editor content */}
      <div ref={editorContentRef} className="composer-editor-wrapper" style={{ minHeight: minHeight - 52 }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** Minimal typography icons (Heroicons has no Bold/Italic/Underline/Strike) */
const ICON_SIZE = 18;
function BoldIcon({ size = ICON_SIZE, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h6a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
      <path d="M6 12h7a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  );
}
function ItalicIcon({ size = ICON_SIZE, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  );
}
function UnderlineIcon({ size = ICON_SIZE, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v7a6 6 0 0 0 12 0V3" />
      <line x1="4" y1="21" x2="20" y2="21" />
    </svg>
  );
}
function StrikeIcon({ size = ICON_SIZE, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4H9a3 3 0 0 0-2.83 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}

function OrderedListIcon({ size = ICON_SIZE, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.242 5.992h12m-12 6.003H20.24m-12 5.999h12M4.117 7.495v-3.75H2.99m1.125 3.75H2.99m1.125 0H5.24m-1.92 2.577a1.125 1.125 0 1 1 1.591 1.59l-1.83 1.83h2.16M2.99 15.745h1.125a1.125 1.125 0 0 1 0 2.25H3.74m0-.002h.375a1.125 1.125 0 0 1 0 2.25H2.99" />
    </svg>
  );
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`composer-toolbar-btn ${active ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

function LinkPopover({
  linkUrl,
  setLinkUrl,
  onSet,
  onRemove,
  onClose,
  inputRef,
  hasLink,
}: {
  linkUrl: string;
  setLinkUrl: (v: string) => void;
  onSet: () => void;
  onRemove: () => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  hasLink: boolean;
}) {
  return (
    <div className="composer-popover">
      <input
        ref={inputRef}
        type="url"
        value={linkUrl}
        onChange={(e) => setLinkUrl(e.target.value)}
        placeholder="https://example.com"
        className="composer-popover-input"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSet();
          if (e.key === 'Escape') onClose();
        }}
      />
      <div className="composer-popover-actions">
        <button type="button" className="composer-popover-btn" onClick={onSet}>
          Apply
        </button>
        {hasLink && (
          <button type="button" className="composer-popover-btn composer-popover-btn-danger" onClick={onRemove}>
            Remove
          </button>
        )}
        <button type="button" className="composer-popover-btn composer-popover-btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ImagePopover({
  imageUrl,
  setImageUrl,
  onAdd,
  onClose,
}: {
  imageUrl: string;
  setImageUrl: (v: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  return (
    <div className="composer-popover">
      <input
        type="url"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        placeholder="https://example.com/image.png"
        className="composer-popover-input"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onAdd();
          if (e.key === 'Escape') onClose();
        }}
      />
      <div className="composer-popover-actions">
        <button type="button" className="composer-popover-btn" onClick={onAdd}>
          Insert
        </button>
        <button type="button" className="composer-popover-btn composer-popover-btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function HeadingDropdown({
  editor,
  currentHeading,
  onClose,
}: {
  editor: Editor;
  currentHeading: number;
  onClose: () => void;
}) {
  const options = [
    { level: 0, label: 'Paragraph' },
    { level: 1, label: 'Heading 1' },
    { level: 2, label: 'Heading 2' },
    { level: 3, label: 'Heading 3' },
  ];
  return (
    <div className="composer-popover composer-popover-dropdown">
      {options.map(({ level, label }) => (
        <button
          key={level}
          type="button"
          className={`composer-popover-dropdown-item ${currentHeading === level ? 'is-active' : ''}`}
          onClick={() => {
            if (level === 0) {
              editor.chain().focus().setParagraph().run();
            } else {
              editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run();
            }
            onClose();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

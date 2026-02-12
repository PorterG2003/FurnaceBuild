import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions/placeholder';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import {
  LinkIcon,
  PaperClipIcon,
  PhotoIcon,
  CodeBracketIcon,
  CodeBracketSquareIcon,
  ListBulletIcon,
  ChatBubbleBottomCenterTextIcon,
  DocumentTextIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  TrashIcon,
} from 'react-native-heroicons/outline';
import { COMPOSER_FILE_INPUT_ID } from './ComposerAttachments';

export interface EditorBridge {
  getHTML: () => string;
  getText: () => string;
  setPlaceholder?: (value: string) => void;
  /** Insert text/HTML at cursor (used by EmailBodyEditor for variables). */
  insertContent?: (text: string) => void;
}

export interface ComposerRichEditorProps {
  initialContent?: string;
  placeholder?: string;
  editorRef: React.MutableRefObject<EditorBridge | null>;
  minHeight?: number;
  /** Attachment count for badge on attach button (web) */
  attachmentCount?: number;
  /** Called when user selects files via attach button (web). Parent should read files and update state. */
  onFilesSelected?: (files: FileList) => void;
  /** Rendered between the toolbar and the editor content (e.g. attachment chips). */
  renderBetweenToolbarAndContent?: React.ReactNode;
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
  attachmentCount = 0,
  onFilesSelected,
  renderBetweenToolbarAndContent,
}: ComposerRichEditorProps) {
  const placeholderRef = useRef(placeholder);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [imagePopoverOpen, setImagePopoverOpen] = useState(false);
  const [headingDropdownOpen, setHeadingDropdownOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkDisplayText, setLinkDisplayText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageError, setImageError] = useState<string | null>(null);
  const linkUrlInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const linkAnchorRef = useRef<HTMLDivElement>(null);
  const headingAnchorRef = useRef<HTMLDivElement>(null);
  const imageAnchorRef = useRef<HTMLDivElement>(null);

  const [imageToolbar, setImageToolbar] = useState<{ top: number; left: number; pos: number } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'composer-editor',
      },
      handleDOMEvents: {
        mouseover: (view, event) => {
          const target = event.target as HTMLElement;
          if (target.tagName === 'IMG' && view.dom.contains(target)) {
            const pos = view.posAtDOM(target, 0);
            const node = view.state.doc.nodeAt(pos);
            if (node?.type.name === 'image') {
              const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos));
              view.dispatch(tr);
            }
          }
        },
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Backspace') {
          const { selection } = view.state;
          if (selection instanceof NodeSelection && selection.node.type.name === 'image') {
            const tr = view.state.tr.deleteSelection();
            view.dispatch(tr);
            return true;
          }
        }
        return false;
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
      insertContent: (text: string) => {
        editor.chain().focus().insertContent(text).run();
      },
    };
    editorRef.current = bridge;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  useEffect(() => {
    if (!editor) return;
    const updateImageToolbar = () => {
      const { selection } = editor.state;
      if (selection instanceof NodeSelection && selection.node.type.name === 'image') {
        const { view } = editor;
        const dom = view.nodeDOM(selection.from) as HTMLElement | null;
        if (dom) {
          const rect = dom.getBoundingClientRect();
          setImageToolbar({ top: rect.top - 8, left: rect.left, pos: selection.from });
        } else {
          setImageToolbar(null);
        }
      } else {
        setImageToolbar(null);
      }
    };
    editor.on('selectionUpdate', updateImageToolbar);
    updateImageToolbar();
    return () => {
      editor.off('selectionUpdate', updateImageToolbar);
    };
  }, [editor]);

  useEffect(() => {
    if (linkPopoverOpen && editor) {
      const href = editor.getAttributes('link')?.href ?? '';
      setLinkUrl(href);
      // Get display text: extend to link range if in a link, then get selected text
      let displayText = '';
      if (editor.isActive('link')) {
        editor.chain().focus().extendMarkRange('link').run();
        const { from, to } = editor.state.selection;
        displayText = editor.state.doc.textBetween(from, to, '');
      } else {
        const { from, to } = editor.state.selection;
        displayText = editor.state.doc.textBetween(from, to, '');
      }
      setLinkDisplayText(displayText);
      setTimeout(() => linkUrlInputRef.current?.focus(), 0);
    }
  }, [linkPopoverOpen, editor]);

  const editorContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const el = target as Element;
      // Don't close when clicking inside a popover (portaled to body, so not in containerRef)
      if (el.closest?.('[data-composer-popover]')) return;
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
      const href = hasProtocol ? url : `https://${url}`;
      const displayText = linkDisplayText.trim() || href;
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      editor.chain().focus().insertContent(`<a href="${esc(href)}">${esc(displayText)}</a>`).run();
    }
    setLinkPopoverOpen(false);
    setLinkUrl('');
    setLinkDisplayText('');
  };

  const handleRemoveLink = () => {
    editor?.chain().focus().unsetLink().run();
    setLinkPopoverOpen(false);
    setLinkUrl('');
    setLinkDisplayText('');
  };

  const handleAddImageFromUrl = () => {
    const url = imageUrl.trim();
    if (url && editor) {
      const hasProtocol = /^https?:\/\//i.test(url);
      editor.chain().focus().setImage({ src: hasProtocol ? url : `https://${url}` }).run();
    }
    setImagePopoverOpen(false);
    setImageUrl('');
  };

  const handleAddImageFromFile = (file: File) => {
    if (!editor) return;
    const MAX_SIZE = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX_SIZE) {
      setImageError(`Image must be under ${MAX_SIZE / 1024 / 1024}MB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      editor.chain().focus().setImage({ src: dataUrl }).run();
      setImagePopoverOpen(false);
      setImageUrl('');
      setImageError(null);
    };
    reader.onerror = () => setImageError('Failed to read file');
    reader.readAsDataURL(file);
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

        <div ref={linkAnchorRef} style={{ position: 'relative' }}>
          <ToolbarButton
            onClick={() => setLinkPopoverOpen((o) => !o)}
            active={isLinkActive}
            title="Link"
          >
            <LinkIcon size={18} color="currentColor" />
          </ToolbarButton>
          {linkPopoverOpen && (
            <PortalPopover anchorRef={linkAnchorRef} onClose={() => setLinkPopoverOpen(false)}>
              <LinkPopover
                linkDisplayText={linkDisplayText}
                setLinkDisplayText={setLinkDisplayText}
                linkUrl={linkUrl}
                setLinkUrl={setLinkUrl}
                onSet={handleSetLink}
                onRemove={handleRemoveLink}
                onClose={() => setLinkPopoverOpen(false)}
                urlInputRef={linkUrlInputRef}
                hasLink={isLinkActive}
              />
            </PortalPopover>
          )}
        </div>

        <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline code">
          <CodeBracketIcon size={18} color="currentColor" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
          <CodeBracketSquareIcon size={18} color="currentColor" />
        </ToolbarButton>

        <div className="composer-toolbar-divider" />

        <div ref={headingAnchorRef} style={{ position: 'relative' }}>
          <ToolbarButton
            onClick={() => setHeadingDropdownOpen((o) => !o)}
            active={currentHeading > 0}
            title="Heading"
          >
            <DocumentTextIcon size={18} color="currentColor" />
          </ToolbarButton>
          {headingDropdownOpen && (
            <PortalPopover anchorRef={headingAnchorRef} onClose={() => setHeadingDropdownOpen(false)}>
              <HeadingDropdown
                editor={editor}
                currentHeading={currentHeading}
                onClose={() => setHeadingDropdownOpen(false)}
              />
            </PortalPopover>
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

        <div ref={imageAnchorRef} style={{ position: 'relative' }}>
          <ToolbarButton onClick={() => setImagePopoverOpen((o) => !o)} active={false} title="Insert image">
            <PhotoIcon size={18} color="currentColor" />
          </ToolbarButton>
          {imagePopoverOpen && (
            <PortalPopover anchorRef={imageAnchorRef} onClose={() => setImagePopoverOpen(false)}>
              <ImagePopover
                imageUrl={imageUrl}
                setImageUrl={setImageUrl}
                imageError={imageError}
                onAddFromUrl={handleAddImageFromUrl}
                onAddFromFile={handleAddImageFromFile}
                onClose={() => {
                  setImagePopoverOpen(false);
                  setImageError(null);
                }}
                fileInputRef={imageFileInputRef}
              />
            </PortalPopover>
          )}
        </div>

        {onFilesSelected && (
          <>
            <input
              id={COMPOSER_FILE_INPUT_ID}
              type="file"
              multiple
              accept="*/*"
              style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  onFilesSelected(files);
                }
                e.target.value = '';
              }}
            />
            <label
              htmlFor={COMPOSER_FILE_INPUT_ID}
              className="composer-toolbar-btn"
              title="Attach file"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
            >
              <PaperClipIcon size={18} color="currentColor" />
              {attachmentCount > 0 && (
                <span
                  className="composer-toolbar-attach-badge"
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    minWidth: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: '#F3440D',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingLeft: 2,
                    paddingRight: 2,
                  }}
                >
                  {attachmentCount > 9 ? '9+' : attachmentCount}
                </span>
              )}
            </label>
          </>
        )}

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
      {renderBetweenToolbarAndContent}
      {imageToolbar && editor && createPortal(
        <div
          data-composer-popover
          className="composer-image-toolbar"
          style={{
            position: 'fixed',
            top: imageToolbar.top - 44,
            left: imageToolbar.left,
            zIndex: 9999,
          }}
        >
          <button
            type="button"
            className="composer-image-toolbar-btn"
            onClick={() => editor.chain().focus().setNodeSelection(imageToolbar.pos).updateAttributes('image', { width: 200 }).run()}
            title="Small"
          >
            S
          </button>
          <button
            type="button"
            className="composer-image-toolbar-btn"
            onClick={() => editor.chain().focus().setNodeSelection(imageToolbar.pos).updateAttributes('image', { width: 400 }).run()}
            title="Medium"
          >
            M
          </button>
          <button
            type="button"
            className="composer-image-toolbar-btn"
            onClick={() => editor.chain().focus().setNodeSelection(imageToolbar.pos).updateAttributes('image', { width: null }).run()}
            title="Large (original)"
          >
            L
          </button>
          <button
            type="button"
            className="composer-image-toolbar-btn composer-image-toolbar-btn-danger"
            onClick={() => {
              editor.chain().focus().setNodeSelection(imageToolbar.pos).deleteSelection().run();
              setImageToolbar(null);
            }}
            title="Delete"
          >
            <TrashIcon size={14} color="currentColor" />
          </button>
        </div>,
        document.body
      )}
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

/** Renders popover content in a portal so it escapes toolbar overflow clipping. */
function PortalPopover({
  anchorRef,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  dropdown?: boolean;
  children: React.ReactNode;
}) {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = () => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({ top: rect.bottom + 6, left: rect.left });
  };

  useLayoutEffect(() => {
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [anchorRef]);

  return createPortal(
    <div
      data-composer-popover
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 9999,
      }}
    >
      {children}
    </div>,
    document.body
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
  linkDisplayText,
  setLinkDisplayText,
  linkUrl,
  setLinkUrl,
  onSet,
  onRemove,
  onClose,
  urlInputRef,
  hasLink,
}: {
  linkDisplayText: string;
  setLinkDisplayText: (v: string) => void;
  linkUrl: string;
  setLinkUrl: (v: string) => void;
  onSet: () => void;
  onRemove: () => void;
  onClose: () => void;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  hasLink: boolean;
}) {
  return (
    <div className="composer-popover">
      <div style={{ marginBottom: 12 }}>
        <label className="composer-popover-label">Display text</label>
        <input
          type="text"
          value={linkDisplayText}
          onChange={(e) => setLinkDisplayText(e.target.value)}
          placeholder="Text to display (optional)"
          className="composer-popover-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter') urlInputRef.current?.focus();
            if (e.key === 'Escape') onClose();
          }}
        />
      </div>
      <div>
        <label className="composer-popover-label">URL</label>
        <input
          ref={urlInputRef}
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
      </div>
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
  imageError,
  onAddFromUrl,
  onAddFromFile,
  onClose,
  fileInputRef,
}: {
  imageUrl: string;
  setImageUrl: (v: string) => void;
  imageError: string | null;
  onAddFromUrl: () => void;
  onAddFromFile: (file: File) => void;
  onClose: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="composer-popover">
      <div style={{ marginBottom: 12 }}>
        <label className="composer-popover-label">Image URL</label>
        <input
          type="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://example.com/image.png"
          className="composer-popover-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAddFromUrl();
            if (e.key === 'Escape') onClose();
          }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label className="composer-popover-label">Or upload from computer</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="composer-popover-input"
          style={{ padding: '10px 12px' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onAddFromFile(file);
              e.target.value = '';
            }
          }}
        />
        <div className="composer-popover-hint">Max 2MB. Images are embedded in the email.</div>
      </div>
      {imageError && (
        <div className="composer-popover-error" style={{ marginBottom: 12 }}>
          {imageError}
        </div>
      )}
      <div className="composer-popover-actions">
        <button type="button" className="composer-popover-btn" onClick={onAddFromUrl}>
          Insert URL
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

import sanitizeHtml from 'sanitize-html';
import { stripHtml } from './parse-body.js';

export type EmailEditorMode = 'richText' | 'html';
export type EmailHtmlDocumentKind = 'fragment' | 'fullDocument';

export interface CanonicalizeEmailHtmlOptions {
  preserveFullDocument?: boolean;
}

export interface CanonicalizeEmailHtmlResult {
  html: string;
  bodyFragmentHtml: string;
  bodyText: string;
  documentKind: EmailHtmlDocumentKind;
  wasModified: boolean;
}

export interface CanonicalEmailSaveInput {
  editorMode?: EmailEditorMode | null;
  bodyHtml?: string | null;
  bodyText?: string | null;
  template?: string | null;
}

export interface CanonicalEmailSaveResult {
  editorMode: EmailEditorMode;
  bodyHtml: string;
  bodyText: string;
  template: string;
  documentKind: EmailHtmlDocumentKind;
  wasModified: boolean;
}

const EMPTY_RICH_HTML = '<p></p>';
const FULL_DOC_PATTERN = /<(?:!doctype|html|head|body)\b/i;
const MERGE_TAG_PATTERN = /\{\{[\s\S]+?\}\}/g;
const RAW_HTML_PATTERN = /<[a-z][\s\S]*>/i;

const MERGE_TAG_SENTINEL_PREFIX = '__FURNACE_MERGE_TAG_';
const MERGE_TAG_SENTINEL_SUFFIX = '__';

const STYLE_BLOCK_DANGERS = [
  /@import/gi,
  /expression\s*\(/gi,
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /-moz-binding/gi,
  /behaviou?r\s*:/gi,
] as const;

const INLINE_STYLE_DANGERS = [
  /expression\s*\(/gi,
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /-moz-binding/gi,
  /behaviou?r\s*:/gi,
] as const;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function protectMergeTags(input: string): { value: string; mergeTags: string[] } {
  const mergeTags: string[] = [];
  const value = input.replace(MERGE_TAG_PATTERN, (match) => {
    const idx = mergeTags.push(match) - 1;
    return `${MERGE_TAG_SENTINEL_PREFIX}${idx}${MERGE_TAG_SENTINEL_SUFFIX}`;
  });
  return { value, mergeTags };
}

function restoreMergeTags(input: string, mergeTags: string[]): string {
  return input.replace(
    new RegExp(`${MERGE_TAG_SENTINEL_PREFIX}(\\d+)${MERGE_TAG_SENTINEL_SUFFIX}`, 'g'),
    (_match, index) => mergeTags[Number(index)] ?? ''
  );
}

function sanitizeStyleBlock(css: string): string {
  let out = css;
  for (const pattern of STYLE_BLOCK_DANGERS) {
    out = out.replace(pattern, '');
  }
  return out.trim();
}

function sanitizeInlineStyleValue(css: string): string {
  let out = css;
  for (const pattern of INLINE_STYLE_DANGERS) {
    out = out.replace(pattern, '');
  }
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*/g, '; ')
    .trim()
    .replace(/;$/, '');
}

function replaceUnsupportedElementsWithFallbacks(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b([^>]*)src=(['"])(.*?)\2[^>]*>[\s\S]*?<\/iframe>/gi, (_match, _attrs, _quote, src) => {
      const safeSrc = escapeHtml(src);
      return `<p><a href="${safeSrc}" target="_blank" rel="noopener noreferrer">Open embedded content</a></p>`;
    })
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '<p>Embedded content removed for email safety.</p>')
    .replace(/<video\b([^>]*)src=(['"])(.*?)\2[^>]*>[\s\S]*?<\/video>/gi, (_match, _attrs, _quote, src) => {
      const safeSrc = escapeHtml(src);
      return `<p><a href="${safeSrc}" target="_blank" rel="noopener noreferrer">View video</a></p>`;
    })
    .replace(/<audio\b([^>]*)src=(['"])(.*?)\2[^>]*>[\s\S]*?<\/audio>/gi, (_match, _attrs, _quote, src) => {
      const safeSrc = escapeHtml(src);
      return `<p><a href="${safeSrc}" target="_blank" rel="noopener noreferrer">Listen to audio</a></p>`;
    })
    .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, '<p>Interactive form removed for email safety.</p>')
    .replace(/<(input|button|select|option|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(input|button|select|option|textarea)\b[^>]*\/?>/gi, '')
    .replace(/<(canvas|svg|object|embed|applet)\b[^>]*>[\s\S]*?<\/\1>/gi, '<p>Unsupported embedded content removed for email safety.</p>');
}

export function isFullHtmlDocument(html: string | null | undefined): boolean {
  const value = String(html ?? '').trim();
  return FULL_DOC_PATTERN.test(value);
}

export function extractBodyFragmentFromHtml(html: string | null | undefined): string {
  const value = String(html ?? '').trim();
  if (!value) return '';
  const bodyMatch = value.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1]?.trim() ?? '';
  return value
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .replace(/<\/?(html|head|body)\b[^>]*>/gi, '')
    .trim();
}

export function seedHtmlModeFromRichText(html: string | null | undefined): string {
  const value = String(html ?? '').trim();
  return value && value !== EMPTY_RICH_HTML ? value : '';
}

export function convertHtmlToRichTextSeed(html: string | null | undefined): string {
  const fragment = extractBodyFragmentFromHtml(html);
  return fragment || EMPTY_RICH_HTML;
}

export function canonicalizeEmailHtml(
  html: string | null | undefined,
  options: CanonicalizeEmailHtmlOptions = {}
): CanonicalizeEmailHtmlResult {
  const raw = String(html ?? '').trim();
  if (!raw) {
    return {
      html: '',
      bodyFragmentHtml: '',
      bodyText: '',
      documentKind: 'fragment',
      wasModified: false,
    };
  }

  const documentKind: EmailHtmlDocumentKind = isFullHtmlDocument(raw) ? 'fullDocument' : 'fragment';
  const { value: protectedHtml, mergeTags } = protectMergeTags(replaceUnsupportedElementsWithFallbacks(raw));

  let sanitized = sanitizeHtml(protectedHtml, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'html',
      'head',
      'body',
      'meta',
      'title',
      'style',
      'img',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'td',
      'th',
      'caption',
      'colgroup',
      'col',
      'center',
      'font',
      'section',
      'article',
      'header',
      'footer',
      'main',
      'aside',
      'figure',
      'figcaption',
    ],
    allowedAttributes: {
      '*': [
        'align',
        'bgcolor',
        'border',
        'class',
        'color',
        'dir',
        'height',
        'id',
        'lang',
        'role',
        'style',
        'title',
        'valign',
        'width',
        'aria-*',
        'data-*',
      ],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'srcset', 'alt', 'width', 'height', 'border'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      table: ['cellpadding', 'cellspacing'],
      meta: ['name', 'content', 'charset', 'http-equiv'],
      style: ['type', 'media'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'srcset'],
    allowProtocolRelative: true,
    disallowedTagsMode: 'discard',
    allowVulnerableTags: true,
    parseStyleAttributes: false,
  });

  sanitized = sanitized
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_match: string, attrs: string, css: string) => {
      const safeCss = sanitizeStyleBlock(css);
      return safeCss ? `<style${attrs}>${safeCss}</style>` : '';
    })
    .replace(/\sstyle=(['"])(.*?)\1/gi, (_match: string, quote: string, css: string) => {
      const safeCss = sanitizeInlineStyleValue(css);
      return safeCss ? ` style=${quote}${safeCss}${quote}` : '';
    });

  sanitized = restoreMergeTags(sanitized, mergeTags).trim();

  const htmlOut =
    documentKind === 'fullDocument' && options.preserveFullDocument !== false
      ? sanitized
      : documentKind === 'fullDocument'
        ? extractBodyFragmentFromHtml(sanitized)
        : sanitized;

  const bodyFragmentHtml = extractBodyFragmentFromHtml(htmlOut);
  const bodyText = stripHtml(bodyFragmentHtml || htmlOut);

  return {
    html: htmlOut,
    bodyFragmentHtml,
    bodyText,
    documentKind,
    wasModified: htmlOut !== raw,
  };
}

export function canonicalizeEmailContentForSave(
  input: CanonicalEmailSaveInput
): CanonicalEmailSaveResult {
  const editorMode: EmailEditorMode = input.editorMode === 'html' ? 'html' : 'richText';
  if (editorMode === 'html') {
    const canonical = canonicalizeEmailHtml(input.bodyHtml ?? '', { preserveFullDocument: true });
    return {
      editorMode,
      bodyHtml: canonical.html,
      bodyText: canonical.bodyText,
      template: canonical.bodyText,
      documentKind: canonical.documentKind,
      wasModified: canonical.wasModified,
    };
  }

  const richHtml = String(input.bodyHtml ?? '').trim();
  const richText = String(input.bodyText ?? input.template ?? '').trim();
  const htmlSource =
    richHtml ||
    (richText
      ? richText.includes('<')
        ? richText
        : richText
            .split(/\n/)
            .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
            .join('')
      : '');
  const canonical = canonicalizeEmailHtml(htmlSource, { preserveFullDocument: false });
  const template = richText || canonical.bodyText;
  return {
    editorMode,
    bodyHtml: canonical.html,
    bodyText: template,
    template,
    documentKind: canonical.documentKind,
    wasModified: canonical.wasModified || htmlSource !== richHtml,
  };
}

export function mergeHtmlEmailWithSignature(
  html: string,
  mailboxSignatureRaw: string | null | undefined,
  includeSignature: boolean
): string {
  const bodySource = String(html ?? '').trim();
  if (!bodySource) return '';
  const normalizedSignature =
    includeSignature && mailboxSignatureRaw?.trim() ? mailboxSignatureRaw.trim() : '';
  if (!normalizedSignature) return bodySource;

  const signatureHtml = canonicalizeEmailHtml(normalizedSignature, { preserveFullDocument: false }).bodyFragmentHtml;
  if (!signatureHtml) return bodySource;

  if (isFullHtmlDocument(bodySource)) {
    if (/<\/body>/i.test(bodySource)) {
      return bodySource.replace(
        /<\/body>/i,
        `<div><br><br></div>${signatureHtml}</body>`
      );
    }
    return `${bodySource}<div><br><br></div>${signatureHtml}`;
  }

  return `${bodySource}<br><br>${signatureHtml}`;
}

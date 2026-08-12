/**
 * Build campaign email content from node config and lead.
 * Single source of truth for both send-worker (actual send) and app (preview).
 * Pipeline: first meaningful body_html → template → body → body_text,
 * then processSpintax → mergeTemplate; same for subject.
 *
 * Blank / placeholder `body_html` (e.g. `""` or `<p></p>` from API/MCP richText
 * normalize) must not block fallback to `template`.
 */

import { stripHtml } from './parse-body.js';
import { mergeTemplate, type LeadLike } from './mergeTemplate.js';
import {
  processSpintax,
  type ProcessSpintaxOptions,
  type SpintaxScope,
} from './processSpintax.js';
import { stripSignatureStyles } from './strip-signature-styles.js';
import {
  canonicalizeEmailHtml,
  isFullHtmlDocument,
  mergeHtmlEmailWithSignature,
  type EmailEditorMode,
} from './emailHtmlMode.js';

function withSpintaxScope(
  options: ProcessSpintaxOptions | undefined,
  scope: SpintaxScope
): ProcessSpintaxOptions {
  return { ...(options ?? {}), scope };
}

/**
 * Convert block-level HTML (from TipTap or signature editor) to a flat <br>-separated
 * fragment with no <p> wrappers. Email clients add margin to <p>; using only <br>
 * produces consistent line spacing everywhere.
 */
export function htmlToFragment(html: string): string {
  let out = html.replace(/<\/p>\s*<p[^>]*>/gi, '<br>');
  out = out.replace(/^<p[^>]*>/i, '');
  out = out.replace(/<\/p>\s*$/i, '');
  return out.trim();
}

/**
 * True when a body field has real copy after trimming tags/nbsp placeholders.
 * Empty string and TipTap shells like `<p></p>` are not meaningful.
 */
export function hasMeaningfulEmailBody(value: string | null | undefined): boolean {
  if (value == null) return false;
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  return stripHtml(trimmed.replace(/&nbsp;/gi, ' ')).length > 0;
}

/**
 * Prefer real HTML body, then template / legacy body / body_text.
 * Skips blank and placeholder-only HTML so API template-only variants still send.
 */
export function selectCampaignBodySource(config: {
  body_html?: string | null;
  template?: string | null;
  body?: string | null;
  body_text?: string | null;
}): string {
  const candidates = [config.body_html, config.template, config.body, config.body_text];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && hasMeaningfulEmailBody(candidate)) {
      return candidate;
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string') return candidate;
  }
  return '';
}

export interface MergeInboxComposeHtmlResult {
  bodyHtmlMerged: string;
  isHtmlBody: boolean;
}

/**
 * Keep inbox reply/forward HTML join behavior aligned with buildCampaignEmailContent.
 */
export function mergeInboxComposeHtml(
  editorBodyHtml: string,
  mailboxSignatureRaw: string | null | undefined,
  includeSignature: boolean,
  options?: ProcessSpintaxOptions
): MergeInboxComposeHtmlResult {
  const bodySource = String(editorBodyHtml ?? '');
  const normalizedSignature =
    includeSignature && mailboxSignatureRaw?.trim()
      ? stripSignatureStyles(mailboxSignatureRaw.trim())
      : '';
  const bodyPart = bodySource.replace(/\s+$/, '');
  const sigPart = normalizedSignature.replace(/^\s+/, '');
  const bodyIsHtml = /<[a-z][\s\S]*>/i.test(bodyPart);
  const sigIsHtml = /<[a-z][\s\S]*>/i.test(sigPart);
  const sigPartForHtml = sigPart.replace(/^(\s*<br\s*\/?>\s*)+/gi, '').trimStart();

  let bodyRaw: string;
  if (normalizedSignature && bodyIsHtml && sigIsHtml) {
    const bodyFragment = htmlToFragment(bodyPart);
    const sigFragment = htmlToFragment(sigPartForHtml).replace(/^(\s*<br\s*\/?>\s*)+/gi, '');
    bodyRaw = `${bodyFragment}<br><br>${sigFragment}`;
  } else if (normalizedSignature) {
    bodyRaw = `${bodyPart}\n\n${sigPart}`;
  } else if (bodyIsHtml) {
    bodyRaw = htmlToFragment(bodyPart);
  } else {
    bodyRaw = bodySource;
  }

  const bodyHtmlMerged = processSpintax(bodyRaw, withSpintaxScope(options, 'body'));
  return {
    bodyHtmlMerged,
    isHtmlBody: /<[a-z][\s\S]*>/i.test(bodyHtmlMerged),
  };
}

export interface BuildCampaignEmailContentConfig {
  subject?: string;
  body_html?: string;
  body_text?: string;
  template?: string;
  body?: string;
  editor_mode?: EmailEditorMode;
  /** Optional mailbox signature; included in body and processed with spintax/mergeTemplate. */
  signature?: string;
}

export interface BuildCampaignEmailContentResult {
  subject: string;
  bodyMerged: string;
  isHtmlBody: boolean;
  bodyText: string | null;
}

export interface BuildCampaignEmailContentOptions extends ProcessSpintaxOptions {}

/**
 * Build merged subject and body for a single lead. Used by send-worker and preview modal.
 */
export function buildCampaignEmailContent(
  config: BuildCampaignEmailContentConfig,
  lead: LeadLike,
  options?: BuildCampaignEmailContentOptions
): BuildCampaignEmailContentResult {
  const subjectRaw = String(config.subject ?? '');
  const subjectSpun = processSpintax(subjectRaw, withSpintaxScope(options, 'subject'));
  const subject = mergeTemplate(subjectSpun, lead);

  const bodySource = selectCampaignBodySource(config);
  const editorMode: EmailEditorMode =
    config.editor_mode === 'html' || isFullHtmlDocument(bodySource) ? 'html' : 'richText';
  const normalizedSignature =
    config.signature?.trim() ? stripSignatureStyles(config.signature.trim()) : '';
  const bodyPart = bodySource.replace(/\s+$/, '');
  const sigPart = normalizedSignature.replace(/^\s+/, '');
  const bodyOptions = withSpintaxScope(options, 'body');
  const bodySpun =
    editorMode === 'html'
      ? processSpintax(
          mergeHtmlEmailWithSignature(
            canonicalizeEmailHtml(bodySource, { preserveFullDocument: true }).html,
            normalizedSignature,
            Boolean(normalizedSignature)
          ),
          bodyOptions
        )
      : mergeInboxComposeHtml(
          bodySource,
          config.signature ?? null,
          Boolean(config.signature?.trim()),
          bodyOptions
        ).bodyHtmlMerged;
  const bodyMerged = mergeTemplate(bodySpun, lead);
  const isHtmlBody = /<[a-z][\s\S]*>/i.test(bodyMerged);
  const bodyText =
    typeof config.body_text === 'string' && !isHtmlBody
      ? mergeTemplate(
          processSpintax(config.body_text, withSpintaxScope(options, 'body_text')),
          lead
        )
      : isHtmlBody
        ? stripHtml(bodyMerged)
        : bodyMerged;

  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    const log = (label: string, value: unknown) =>
      console.log(`[buildCampaignEmailContent] ${label}`, typeof value === 'string' ? { length: value.length, end: value.slice(-80), start: value.slice(0, 80) } : value);
    log('config.body_html (length)', config.body_html?.length);
    log('config.signature (length)', config.signature?.length);
    log('bodySource', bodySource);
    log('normalizedSignature', normalizedSignature);
    log('bodyPart (trimmed end)', bodyPart);
    log('sigPart (trimmed start)', sigPart);
    const bodyIsHtml = /<[a-z][\s\S]*>/i.test(bodyPart);
    const sigIsHtml = /<[a-z][\s\S]*>/i.test(sigPart);
    log('bodyIsHtml / sigIsHtml', { bodyIsHtml, sigIsHtml });
    log('editor_mode', editorMode);
    log('bodyRaw (join used)', bodyIsHtml && sigIsHtml ? '<br><br>' : '\\n\\n');
    log('bodyRaw (snippet around join)', bodySpun.slice(Math.max(0, bodyPart.length - 20), bodyPart.length + 60));
    log('bodyMerged (snippet around join)', bodyMerged.slice(Math.max(0, bodyPart.length - 20), bodyPart.length + 120));
  }

  return {
    subject,
    bodyMerged,
    isHtmlBody,
    bodyText,
  };
}

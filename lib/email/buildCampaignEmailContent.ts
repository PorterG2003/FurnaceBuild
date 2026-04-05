/**
 * Build campaign email content from node config and lead.
 * Single source of truth for both send-worker (actual send) and app (preview).
 * Pipeline: body_html ?? template ?? body → processSpintax → mergeTemplate; same for subject.
 */

import { mergeTemplate, type LeadLike } from './mergeTemplate.js';
import { processSpintax, type ProcessSpintaxOptions } from './processSpintax.js';
import { stripSignatureStyles } from './strip-signature-styles.js';

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
    const sigFragment = htmlToFragment(sigPartForHtml);
    bodyRaw = `${bodyFragment}<br><br>${sigFragment}`;
  } else if (normalizedSignature) {
    bodyRaw = `${bodyPart}\n\n${sigPart}`;
  } else if (bodyIsHtml) {
    bodyRaw = htmlToFragment(bodyPart);
  } else {
    bodyRaw = bodySource;
  }

  const bodyHtmlMerged = processSpintax(bodyRaw, options);
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
  const subjectSpun = processSpintax(subjectRaw, options);
  const subject = mergeTemplate(subjectSpun, lead);

  const bodySource =
    typeof (config.body_html ?? config.template ?? config.body) === 'string'
      ? (config.body_html ?? config.template ?? config.body)!
      : '';
  const normalizedSignature =
    config.signature?.trim() ? stripSignatureStyles(config.signature.trim()) : '';
  const bodyPart = bodySource.replace(/\s+$/, '');
  const sigPart = normalizedSignature.replace(/^\s+/, '');
  const { bodyHtmlMerged: bodySpun } = mergeInboxComposeHtml(
    bodySource,
    config.signature ?? null,
    Boolean(config.signature?.trim()),
    options
  );
  const bodyMerged = mergeTemplate(bodySpun, lead);
  const bodyTextFromConfig =
    typeof config.body_text === 'string' ? config.body_text : null;
  const isHtmlBody = /<[a-z][\s\S]*>/i.test(bodyMerged);
  const bodyText = bodyTextFromConfig ?? (isHtmlBody ? null : bodyMerged);

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

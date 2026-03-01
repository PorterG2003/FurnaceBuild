/**
 * Build campaign email content from node config and lead.
 * Single source of truth for both send-worker (actual send) and app (preview).
 * Pipeline: body_html ?? template ?? body → processSpintax → mergeTemplate; same for subject.
 */

import { mergeTemplate, type LeadLike } from './mergeTemplate.js';
import { processSpintax, type ProcessSpintaxOptions } from './processSpintax.js';
import { stripSignatureStyles } from './strip-signature-styles.js';

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
  const bodyIsHtml = /<[a-z][\s\S]*>/i.test(bodyPart);
  const sigIsHtml = /<[a-z][\s\S]*>/i.test(sigPart);
  const bodyRaw = normalizedSignature
    ? bodyIsHtml && sigIsHtml
      ? `${bodyPart}<p><br></p>${sigPart}`
      : `${bodyPart}\n\n${sigPart}`
    : bodySource;
  const bodySpun = processSpintax(bodyRaw, options);
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
    log('bodyIsHtml / sigIsHtml', { bodyIsHtml, sigIsHtml });
    log('bodyRaw (join used)', bodyIsHtml && sigIsHtml ? 'HTML spacer' : '\\n\\n');
    log('bodyRaw (snippet around join)', bodyRaw.slice(Math.max(0, bodyPart.length - 20), bodyPart.length + 60));
    log('bodyMerged (snippet around join)', bodyMerged.slice(Math.max(0, bodyPart.length - 20), bodyPart.length + 120));
  }

  return {
    subject,
    bodyMerged,
    isHtmlBody,
    bodyText,
  };
}

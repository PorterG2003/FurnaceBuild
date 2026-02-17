/**
 * Build campaign email content from node config and lead.
 * Single source of truth for both send-worker (actual send) and app (preview).
 * Pipeline: body_html ?? template ?? body → processSpintax → mergeTemplate; same for subject.
 */

import { mergeTemplate, type LeadLike } from './mergeTemplate';
import { processSpintax, type ProcessSpintaxOptions } from './processSpintax';

export interface BuildCampaignEmailContentConfig {
  subject?: string;
  body_html?: string;
  body_text?: string;
  template?: string;
  body?: string;
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

  const bodyRaw =
    typeof (config.body_html ?? config.template ?? config.body) === 'string'
      ? (config.body_html ?? config.template ?? config.body)!
      : '';
  const bodySpun = processSpintax(bodyRaw, options);
  const bodyMerged = mergeTemplate(bodySpun, lead);
  const bodyTextFromConfig =
    typeof config.body_text === 'string' ? config.body_text : null;
  const isHtmlBody = /<[a-z][\s\S]*>/i.test(bodyMerged);
  const bodyText = bodyTextFromConfig ?? (isHtmlBody ? null : bodyMerged);

  return {
    subject,
    bodyMerged,
    isHtmlBody,
    bodyText,
  };
}

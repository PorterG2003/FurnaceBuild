import type { CampaignFlowData, CampaignFlowNode } from '../campaigns/flow/index.js';
import { hasMeaningfulEmailBody } from '../email/buildCampaignEmailContent.js';
import { canonicalizeEmailHtml } from '../email/emailHtmlMode.js';

/**
 * Ensure every leadSource node carries the campaign bucket id.
 */
export function withLeadSourceBucketId(
  flow: CampaignFlowData,
  bucketId: string | null | undefined,
): CampaignFlowData {
  if (!bucketId) return flow;
  return {
    ...flow,
    nodes: flow.nodes.map((node) => {
      if (node.type !== 'leadSource') return node;
      const data = (node.data ?? {}) as Record<string, unknown>;
      return {
        ...node,
        data: {
          ...data,
          bucketId,
        },
      };
    }),
  };
}

function enrichEmailNodeForReadback(node: CampaignFlowNode): CampaignFlowNode {
  if (node.type !== 'email') return node;
  const data = (node.data ?? {}) as Record<string, unknown>;
  const variants = Array.isArray(data.variants) ? data.variants : [];
  const nextVariants = variants.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const variant = raw as Record<string, unknown>;
    const editorMode = variant.editor_mode === 'html' ? 'html' : 'richText';
    if (editorMode !== 'richText') return variant;
    if (hasMeaningfulEmailBody(typeof variant.body_html === 'string' ? variant.body_html : '')) {
      return variant;
    }
    const fallback =
      (typeof variant.template === 'string' && variant.template) ||
      (typeof variant.body_text === 'string' && variant.body_text) ||
      '';
    if (!fallback.trim()) return variant;
    const html = fallback.includes('<')
      ? canonicalizeEmailHtml(fallback, { preserveFullDocument: false }).html
      : canonicalizeEmailHtml(
          fallback
            .split(/\n/)
            .map((line) => `<p>${line || '<br>'}</p>`)
            .join(''),
          { preserveFullDocument: false },
        ).html;
    return {
      ...variant,
      body_html: html,
    };
  });
  return {
    ...node,
    data: {
      ...data,
      variants: nextVariants,
    },
  };
}

/**
 * Readback enrichment for API/MCP: fill empty richText body_html from template/body_text.
 */
export function enrichFlowForApiReadback(flow: CampaignFlowData): CampaignFlowData {
  return {
    ...flow,
    nodes: flow.nodes.map(enrichEmailNodeForReadback),
  };
}

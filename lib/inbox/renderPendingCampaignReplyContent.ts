import { buildCampaignEmailContent, type LeadLike } from '@/lib/email';

export interface PendingCampaignReplyPreview {
  bodyText: string;
  bodyHtml: string | null;
  source: 'message_data.body_*' | 'rendered node_config' | 'node_config fallback' | 'empty';
}

type MessageData = {
  body_text?: unknown;
  body_html?: unknown;
  node_config?: unknown;
  lead_data?: unknown;
};

type RenderOptions = {
  messageData: MessageData | null | undefined;
  mailboxSignature: string | null;
};

export function renderPendingCampaignReplyContent({
  messageData,
  mailboxSignature,
}: RenderOptions): PendingCampaignReplyPreview {
  const md = (messageData ?? {}) as Record<string, unknown>;

  const topText = typeof md.body_text === 'string' ? md.body_text.trim() : '';
  const topHtml = typeof md.body_html === 'string' ? md.body_html.trim() : '';
  if (topText || topHtml) {
    return {
      bodyHtml: topHtml || null,
      bodyText: topText || topHtml,
      source: 'message_data.body_*',
    };
  }

  const nodeConfig = (md.node_config ?? {}) as Record<string, unknown>;
  const leadDataRaw = (md.lead_data ?? {}) as Record<string, unknown>;
  const leadData: LeadLike = {
    email: typeof leadDataRaw.email === 'string' ? leadDataRaw.email : '',
    name: typeof leadDataRaw.name === 'string' ? leadDataRaw.name : undefined,
    first_name:
      typeof leadDataRaw.first_name === 'string' ? leadDataRaw.first_name : undefined,
    last_name:
      typeof leadDataRaw.last_name === 'string' ? leadDataRaw.last_name : undefined,
    ...leadDataRaw,
  };

  try {
    const content = buildCampaignEmailContent(
      {
        subject: typeof nodeConfig.subject === 'string' ? nodeConfig.subject : undefined,
        body_html: typeof nodeConfig.body_html === 'string' ? nodeConfig.body_html : undefined,
        body_text: typeof nodeConfig.body_text === 'string' ? nodeConfig.body_text : undefined,
        template: typeof nodeConfig.template === 'string' ? nodeConfig.template : undefined,
        body: typeof nodeConfig.body === 'string' ? nodeConfig.body : undefined,
        editor_mode:
          nodeConfig.editor_mode === 'html' || nodeConfig.editor_mode === 'text'
            ? nodeConfig.editor_mode
            : undefined,
        signature: mailboxSignature ?? undefined,
      },
      leadData,
      { deterministic: true }
    );
    return {
      bodyHtml: content.isHtmlBody ? content.bodyMerged : null,
      bodyText: content.bodyText,
      source: 'rendered node_config',
    };
  } catch {
    const fallback =
      (typeof nodeConfig.body === 'string' && nodeConfig.body) ||
      (typeof nodeConfig.template === 'string' && nodeConfig.template) ||
      (typeof nodeConfig.body_html === 'string' && nodeConfig.body_html) ||
      (typeof nodeConfig.body_text === 'string' && nodeConfig.body_text) ||
      '';
    if (!fallback) {
      return {
        bodyHtml: null,
        bodyText: '',
        source: 'empty',
      };
    }
    return {
      bodyHtml: fallback.includes('<') ? fallback : null,
      bodyText: fallback,
      source: 'node_config fallback',
    };
  }
}

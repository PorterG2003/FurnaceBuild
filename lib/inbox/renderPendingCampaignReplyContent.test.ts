import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderPendingCampaignReplyContent } from './renderPendingCampaignReplyContent.js';

describe('renderPendingCampaignReplyContent', () => {
  it('prefers top-level body fields when present', () => {
    const result = renderPendingCampaignReplyContent({
      messageData: {
        body_text: 'Plain body',
        body_html: '<p>Plain body</p>',
      },
      mailboxSignature: null,
    });

    assert.deepEqual(result, {
      bodyText: 'Plain body',
      bodyHtml: '<p>Plain body</p>',
      source: 'message_data.body_*',
    });
  });

  it('renders deterministic campaign reply content from node_config and lead_data', () => {
    const result = renderPendingCampaignReplyContent({
      messageData: {
        node_config: {
          subject: '',
          template: '{Hi|Hello} {{first_name}}',
        },
        lead_data: {
          email: 'casey@example.com',
          first_name: 'Casey',
          name: 'Casey Example',
        },
      },
      mailboxSignature: 'Thanks,\nPorter',
    });

    assert.equal(result.source, 'rendered node_config');
    assert.equal(result.bodyText, 'Hi Casey\n\nThanks,\nPorter');
    assert.equal(result.bodyHtml, null);
  });
});

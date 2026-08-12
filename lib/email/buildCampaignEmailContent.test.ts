import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCampaignEmailContent,
  htmlToFragment,
  mergeInboxComposeHtml,
} from './buildCampaignEmailContent.js';
import { canonicalizeEmailContentForSave } from './emailHtmlMode.js';
import { buildSpintaxSeed } from './processSpintax.js';

const lead = {
  first_name: 'Casey',
  company_name: 'Acme',
};

describe('htmlToFragment', () => {
  it('flattens paragraph-wrapped html into a br-separated fragment', () => {
    assert.equal(htmlToFragment('<p>Hello</p><p>World</p>'), 'Hello<br>World');
  });
});

describe('mergeInboxComposeHtml', () => {
  it('joins html body and signature with br spacing after stripping signature styles', () => {
    const result = mergeInboxComposeHtml(
      '<p>Hello {{first_name}}</p>',
      '<p style="color:red"><br>Thanks,<br>Porter</p>',
      true,
      { deterministic: true }
    );

    assert.deepEqual(result, {
      bodyHtmlMerged: 'Hello {{first_name}}<br><br>Thanks,<br>Porter',
      isHtmlBody: true,
    });
  });

  it('joins plain text body and signature with blank lines', () => {
    const result = mergeInboxComposeHtml(
      'Hello {{first_name}}',
      'Thanks,\nPorter',
      true,
      { deterministic: true }
    );

    assert.deepEqual(result, {
      bodyHtmlMerged: 'Hello {{first_name}}\n\nThanks,\nPorter',
      isHtmlBody: false,
    });
  });
});

describe('buildCampaignEmailContent', () => {
  it('uses body_html before template/body and renders spintax before variable merge', () => {
    const result = buildCampaignEmailContent(
      {
        subject: '{Hi {{first_name}}|Hello {{first_name}}}',
        body_html: '<p>{Thanks|Appreciate it} {{first_name}}</p>',
        template: 'ignore me',
        body: 'ignore me too',
      },
      lead,
      { deterministic: true }
    );

    assert.equal(result.subject, 'Hi Casey');
    assert.equal(result.bodyMerged, 'Thanks Casey');
    assert.equal(result.isHtmlBody, false);
    assert.equal(result.bodyText, 'Thanks Casey');
  });

  it('derives rendered plain text from the final html body for html messages', () => {
    const result = buildCampaignEmailContent(
      {
        subject: 'Checking in',
        body_html:
          '<p>{Hey|Hello} {{first_name}},</p><p>{Thanks|Appreciate it} for your time.</p>',
        body_text:
          '{Hey|Hello} {{first_name}},\n\n{Thanks|Appreciate it} for your time.',
        signature: '<p><br>Thanks,<br>Porter</p>',
      },
      lead,
      { deterministic: true }
    );

    assert.equal(
      result.bodyMerged,
      'Hey Casey,<br>Thanks for your time.<br><br>Thanks,<br>Porter'
    );
    assert.equal(result.isHtmlBody, true);
    assert.equal(result.bodyText, 'Hey Casey, Thanks for your time. Thanks, Porter');
    assert.doesNotMatch(result.bodyText ?? '', /\{|\}|\{\{/);
  });

  it('renders explicit plain-text body_text when the final message is plain text', () => {
    const result = buildCampaignEmailContent(
      {
        subject: 'Plain text',
        template: 'Fallback {{first_name}}',
        body_text: '{Hello|Hi} {{first_name}} from {{company_name}}',
      },
      lead,
      { deterministic: true }
    );

    assert.equal(result.bodyMerged, 'Fallback Casey');
    assert.equal(result.isHtmlBody, false);
    assert.equal(result.bodyText, 'Hello Casey from Acme');
  });

  it('preserves full-document HTML mode and appends signature without flattening tables', () => {
    const saved = canonicalizeEmailContentForSave({
      editorMode: 'html',
      bodyHtml:
        '<!DOCTYPE html><html><head><style>.hero{color:#fff}</style></head><body><table><tr><td class="hero">Hello {{first_name}}</td></tr></table></body></html>',
    });
    const result = buildCampaignEmailContent(
      {
        subject: 'HTML mode',
        body_html: saved.bodyHtml,
        body_text: saved.bodyText,
        template: saved.template,
        editor_mode: 'html',
        signature: '<p>Thanks,<br>Porter</p>',
      },
      lead,
      { deterministic: true }
    );

    assert.equal(result.isHtmlBody, true);
    assert.match(result.bodyMerged, /<html>/i);
    assert.match(result.bodyMerged, /<table>/i);
    assert.match(result.bodyMerged, /Thanks,<br\s*\/?>Porter/);
    assert.equal(result.bodyText, 'Hello Casey Thanks, Porter');
  });

  it('falls back to template when body_html is an empty string (API/MCP normalize shape)', () => {
    const result = buildCampaignEmailContent(
      {
        subject: 'API template only',
        body_html: '',
        template: 'Hey {{first_name}}, figured this might help.',
        body_text: 'Hey {{first_name}}, figured this might help.',
      },
      lead,
      { deterministic: true }
    );

    assert.equal(result.bodyMerged, 'Hey Casey, figured this might help.');
    assert.equal(result.isHtmlBody, false);
    assert.equal(result.bodyText, 'Hey Casey, figured this might help.');
  });

  it('falls back to template when body_html is a TipTap empty shell', () => {
    const result = buildCampaignEmailContent(
      {
        subject: 'Placeholder html',
        body_html: '<p></p>',
        template: 'Hey {{first_name}}, quick note.',
        signature: '<p>Thanks,<br>Porter</p>',
      },
      lead,
      { deterministic: true }
    );

    assert.match(result.bodyMerged, /Hey Casey, quick note/);
    assert.match(result.bodyMerged, /Thanks,<br\s*\/?>Porter/);
    assert.equal(result.isHtmlBody, true);
    assert.match(result.bodyText ?? '', /Hey Casey, quick note/);
  });

  it('falls back to template when body_html is whitespace-only', () => {
    const result = buildCampaignEmailContent(
      {
        subject: 'Whitespace html',
        body_html: '   ',
        template: 'Hello {{first_name}}',
      },
      lead,
      { deterministic: true }
    );

    assert.equal(result.bodyMerged, 'Hello Casey');
    assert.equal(result.bodyText, 'Hello Casey');
  });

  it('renders identical preview/send payloads for the same seeded identity', () => {
    const config = {
      subject: '{Hi {{first_name}}|Hello {{first_name}}} from {Austin|Dallas}',
      body_html:
        '<p>{Hey|Hello} {{first_name}},</p><p>{outer {one|two}|fallback} and {thanks|appreciate it}.</p>',
      body_text:
        '{Hey|Hello} {{first_name}},\n\n{outer {one|two}|fallback} and {thanks|appreciate it}.',
      template: 'unused',
      signature: '<p>{Cheers|Thanks},<br>Porter</p>',
    };
    const seed = buildSpintaxSeed({
      campaignId: 'camp-parity',
      leadId: 'lead-parity',
      variantId: 'var-parity',
    });

    const previewOptions = { seed };
    const sendOptions = {
      seed: buildSpintaxSeed({
        campaignId: 'camp-parity',
        leadId: 'lead-parity',
        variantId: 'var-parity',
      }),
    };

    const preview = buildCampaignEmailContent(config, lead, previewOptions);
    const send = buildCampaignEmailContent(config, lead, sendOptions);

    assert.deepEqual(preview, send);
    assert.doesNotMatch(preview.subject, /\{[^}]*\|/);
    assert.doesNotMatch(preview.bodyMerged, /\{[^}]*\|/);
    assert.match(preview.subject, /Casey/);
    assert.match(preview.bodyMerged, /Casey/);
    assert.match(preview.bodyMerged ?? '', /Porter/);

    // Retry / re-render stability
    assert.deepEqual(buildCampaignEmailContent(config, lead, previewOptions), preview);
  });

  it('keeps subject and body scopes independent under the same seed', () => {
    const seed = buildSpintaxSeed({
      campaignId: 'camp-scope',
      leadId: 'lead-scope',
      variantId: 'var-scope',
    });
    const result = buildCampaignEmailContent(
      {
        subject: '{Alpha|Beta|Gamma}',
        body_html: '<p>{Alpha|Beta|Gamma}</p>',
      },
      lead,
      { seed }
    );
    assert.match(result.subject, /^(Alpha|Beta|Gamma)$/);
    assert.match(result.bodyMerged, /^(Alpha|Beta|Gamma)$/);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCurrentMstDate,
  renderPlatformTermsMarkdown,
  renderTermsTemplate,
} from './terms';

test('formatCurrentMstDate uses fixed MST calendar date', () => {
  assert.equal(formatCurrentMstDate(new Date('2026-05-30T23:30:00.000Z')), 'May 30, 2026');
  assert.equal(formatCurrentMstDate(new Date('2026-05-31T06:30:00.000Z')), 'May 30, 2026');
});

test('renderTermsTemplate replaces known placeholders and preserves unknown tokens', () => {
  const rendered = renderTermsTemplate('Hello {{client_name}} {{unknown_value}}', {
    client_name: 'Sisu',
  });

  assert.equal(rendered, 'Hello Sisu {{unknown_value}}');
});

test('renderPlatformTermsMarkdown fills managed-services variables from invite inputs', () => {
  const rendered = renderPlatformTermsMarkdown({
    sourceMarkdown: [
      '{{client_name}}',
      '{{monthly_fee}}',
      '{{effective_date_mst}}',
      '{{start_date_mst}}',
      '{{outreach_volume}}',
      '{{inbox_count}}',
    ].join('\n'),
    proposedAccountName: 'Sisu',
    monthlyRetainerCents: 180000,
    proposalSnapshot: {
      managed_outreach_volume: 5000,
      managed_inbox_count: 25,
    },
    now: new Date('2026-05-30T23:30:00.000Z'),
  });

  assert.equal(
    rendered,
    ['Sisu', '$1,800', 'May 30, 2026', 'May 30, 2026', '5,000', '25'].join('\n')
  );
});

test('renderPlatformTermsMarkdown falls back when managed variables are missing', () => {
  const rendered = renderPlatformTermsMarkdown({
    sourceMarkdown: '{{outreach_volume}} / {{inbox_count}}',
    proposedAccountName: null,
    monthlyRetainerCents: null,
    proposalSnapshot: {},
    now: new Date('2026-05-30T23:30:00.000Z'),
  });

  assert.equal(rendered, 'TBD / TBD');
});

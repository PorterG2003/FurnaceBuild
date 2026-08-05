import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCategorizerPrompt,
  CTA_SCENARIOS,
  resolveClassifyBody,
  CLASSIFY_BODY_RAW_PREFIX_LIMIT,
  resolveClassifyFailureAction,
  parseSqsApproximateReceiveCount,
  CLASSIFY_REPLY_MAX_ATTEMPTS,
  isCampaignFamilyMessageType,
} from './index';

const NOW = new Date('2026-06-10T15:00:00.000Z');

test('buildCategorizerPrompt documents CTA affirmative, decline precedence, and empty-body Neutral', () => {
  const prompt = buildCategorizerPrompt({
    messageDate: NOW,
    reply: { subject: 'Re: Hi', bodyText: 'Yes, please!' },
    priorOutbound: {
      subject: 'Quick question',
      bodyText: 'Want me to send the link?',
    },
  });

  assert.ok(prompt.system.includes('permission CTA') || prompt.system.includes('yes/no'));
  assert.ok(prompt.system.includes('remove-me') || prompt.system.includes('stop-contacting'));
  assert.ok(prompt.system.includes('empty') && prompt.system.includes('Neutral'));
  assert.ok(prompt.system.includes('Never infer Interested from the outbound alone'));
});

test('buildCategorizerPrompt includes outbound CTA and reply for each fixture', () => {
  for (const scenario of CTA_SCENARIOS) {
    const prompt = buildCategorizerPrompt({
      messageDate: NOW,
      reply: scenario.reply,
      priorOutbound: scenario.outbound,
    });
    assert.ok(
      prompt.user.includes(scenario.outbound.bodyText!.slice(0, 40)),
      `${scenario.id}: outbound CTA missing from user prompt`,
    );
    if (scenario.reply.bodyText?.trim()) {
      assert.ok(
        prompt.user.includes(scenario.reply.bodyText.slice(0, 20)),
        `${scenario.id}: reply text missing from user prompt`,
      );
    } else {
      assert.ok(prompt.user.includes('(empty body)'), `${scenario.id}: empty reply should show empty body`);
    }
    assert.ok(prompt.user.includes('Prior outbound:'));
    assert.ok(prompt.user.includes('Inbound reply:'));
  }
});

test('buildCategorizerPrompt shows (none) when prior outbound is omitted', () => {
  const prompt = buildCategorizerPrompt({
    messageDate: NOW,
    reply: { subject: null, bodyText: 'Hello' },
    priorOutbound: null,
  });
  assert.ok(prompt.user.includes('Prior outbound:'));
  assert.ok(prompt.user.includes('(none)'));
  assert.ok(prompt.user.includes('Hello'));
});

test('resolveClassifyBody strips quote-heavy replies to the affirmative prefix', () => {
  const body = [
    'Yes, please!',
    '',
    'On Mon, Jane wrote:',
    '> Want me to send the link?',
  ].join('\n');
  assert.equal(resolveClassifyBody({ body_text: body }), 'Yes, please!');
});

test('resolveClassifyBody falls back to raw prefix when strip empties the body', () => {
  const quotedOnly = [
    'On Mon, Jane wrote:',
    '> Want me to send the link to the July training?',
    '> Happy to share if useful.',
  ].join('\n');
  const resolved = resolveClassifyBody({ body_text: quotedOnly });
  assert.ok(resolved);
  assert.ok(resolved!.startsWith('On Mon'));
  assert.ok(resolved!.length <= CLASSIFY_BODY_RAW_PREFIX_LIMIT);
});

test('resolveClassifyBody prefers body_text over html and returns null for empty', () => {
  assert.equal(
    resolveClassifyBody({ body_text: 'Plain yes', body_html: '<p>HTML</p>' }),
    'Plain yes',
  );
  assert.equal(resolveClassifyBody({ body_text: null, body_html: null }), null);
  assert.equal(resolveClassifyBody({ body_html: '<p>From HTML</p>' }), 'From HTML');
});

test('resolveClassifyFailureAction retries below max and gives up at max', () => {
  assert.equal(resolveClassifyFailureAction(1), 'retry');
  assert.equal(resolveClassifyFailureAction(2), 'retry');
  assert.equal(resolveClassifyFailureAction(CLASSIFY_REPLY_MAX_ATTEMPTS), 'give_up');
  assert.equal(resolveClassifyFailureAction(CLASSIFY_REPLY_MAX_ATTEMPTS + 5), 'give_up');
});

test('parseSqsApproximateReceiveCount defaults to 1', () => {
  assert.equal(parseSqsApproximateReceiveCount(undefined), 1);
  assert.equal(parseSqsApproximateReceiveCount({}), 1);
  assert.equal(parseSqsApproximateReceiveCount({ ApproximateReceiveCount: '3' }), 3);
});

test('isCampaignFamilyMessageType accepts campaign family and null, rejects inbox', () => {
  assert.equal(isCampaignFamilyMessageType(null), true);
  assert.equal(isCampaignFamilyMessageType('campaign'), true);
  assert.equal(isCampaignFamilyMessageType('campaign_priority'), true);
  assert.equal(isCampaignFamilyMessageType('campaign_reply'), true);
  assert.equal(isCampaignFamilyMessageType('inbox_reply'), false);
  assert.equal(isCampaignFamilyMessageType('inbox_forward'), false);
});

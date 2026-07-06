import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDemoHubSeedSpecs,
  DEMO_HUB_CONVERSATION_COUNT,
  DEMO_HUB_OPEN_THREAD_TARGET,
  DEMO_HUB_POSITIVE_SHARE_OF_REPLIES,
  DEMO_HUB_REPLY_RATE,
  DEMO_HUB_TOTAL_LEADS,
  deriveCampaignStatsFromSent,
  getDemoHubSeedSummary,
} from './demoHubSeed';

test('demo hub summary matches documented totals', () => {
  const summary = getDemoHubSeedSummary();

  assert.equal(summary.campaignCount, 4);
  assert.equal(summary.totalLeads, DEMO_HUB_TOTAL_LEADS);
  assert.equal(summary.totalThreads, DEMO_HUB_CONVERSATION_COUNT);
  assert.equal(summary.mailboxEmails.length, 30);
  assert.equal(summary.accountName, 'Acme Example Co.');
});

test('demo hub allocates lead counts per campaign without drifting', () => {
  const specs = buildDemoHubSeedSpecs();
  const counts = specs.map((spec) => spec.leads.length);
  assert.deepEqual(counts, [1_400, 900, 400, 300]);
});

test('demo hub thread counts per campaign match plan', () => {
  const specs = buildDemoHubSeedSpecs();
  const threadCounts = specs.map(
    (spec) => spec.leads.filter((lead) => lead.thread != null).length,
  );
  assert.deepEqual(threadCounts, [28, 8, 4, 0]);
});

test('demo hub avoids QA-style subject prefixes', () => {
  const specs = buildDemoHubSeedSpecs();
  for (const spec of specs) {
    for (const lead of spec.leads) {
      const subject = lead.thread?.subject ?? '';
      assert.doesNotMatch(subject, /^\[(NORMAL|SH |RESUME|REPLACED)/);
      assert.doesNotMatch(subject, /Seed Thread/i);
    }
  }
});

test('demo hub stat targets stay within realistic reply bands', () => {
  const summary = getDemoHubSeedSummary();

  for (const target of summary.statTargets) {
    if (target.sent === 0) {
      assert.equal(target.replied, 0);
      assert.equal(target.positive, 0);
      continue;
    }

    assert.ok(target.replyRate >= 0.01, `reply rate too low for ${target.campaignId}`);
    assert.ok(target.replyRate <= 0.05, `reply rate too high for ${target.campaignId}`);
    if (target.replied > 0) {
      assert.ok(
        target.positiveShareOfReplies >= 0.1,
        `positive share too low for ${target.campaignId}`,
      );
      assert.ok(
        target.positiveShareOfReplies <= 0.5,
        `positive share too high for ${target.campaignId}`,
      );
    }
  }
});

test('deriveCampaignStatsFromSent uses default demo rates', () => {
  const stats = deriveCampaignStatsFromSent(1_800);
  assert.equal(stats.sent, 1_800);
  assert.equal(stats.replied, Math.round(1_800 * DEMO_HUB_REPLY_RATE));
  assert.equal(stats.positive, Math.round(stats.replied * DEMO_HUB_POSITIVE_SHARE_OF_REPLIES));
});

test('demo hub includes hero interested thread key on running campaign', () => {
  const primary = buildDemoHubSeedSpecs()[0];
  assert.ok(primary);
  const hero = primary.leads.find((lead) => lead.key === 'hero-interested');
  assert.ok(hero?.thread);
  assert.equal(hero.thread?.category, 'Interested');
});

test('demo hub thread mix favors interested/not interested and keeps few open', () => {
  const specs = buildDemoHubSeedSpecs();
  const threads = specs.flatMap((spec) =>
    spec.leads.flatMap((lead) => (lead.thread ? [lead.thread] : [])),
  );

  const categoryCounts = {
    interested: 0,
    notInterested: 0,
    neutral: 0,
    autoReply: 0,
    other: 0,
  };
  let openCount = 0;

  for (const thread of threads) {
    if (thread.conversationStatus === 'open') {
      openCount += 1;
    }
    switch (thread.category) {
      case 'Interested':
        categoryCounts.interested += 1;
        break;
      case 'Not Interested':
        categoryCounts.notInterested += 1;
        break;
      case 'Neutral':
        categoryCounts.neutral += 1;
        break;
      case 'Auto Reply':
        categoryCounts.autoReply += 1;
        break;
      default:
        categoryCounts.other += 1;
        break;
    }
  }

  assert.equal(openCount, DEMO_HUB_OPEN_THREAD_TARGET);
  assert.ok(
    categoryCounts.interested + categoryCounts.notInterested > categoryCounts.neutral * 2,
    'expected interested + not interested to dominate neutral',
  );
  assert.ok(categoryCounts.interested >= 10);
  assert.ok(categoryCounts.notInterested >= 10);
});

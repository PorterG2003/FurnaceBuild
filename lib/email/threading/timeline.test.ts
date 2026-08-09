import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildThreadTimeline, newestEpochEntries } from './timeline.js';
import type { ThreadTimelineInput } from './types.js';

function outbound(overrides: Partial<ThreadTimelineInput> & { wireMessageId: string; at: string }): ThreadTimelineInput {
  return { direction: 'sent', deliveredSubject: '', ...overrides };
}

function inbound(overrides: Partial<ThreadTimelineInput> & { wireMessageId: string; at: string }): ThreadTimelineInput {
  return { direction: 'received', deliveredSubject: '', ...overrides };
}

describe('buildThreadTimeline', () => {
  it('normalizes ids, drops unusable entries, and orders oldest first', () => {
    const timeline = buildThreadTimeline([
      outbound({ wireMessageId: '<B@Furnace.Build>', at: '2026-04-02T00:00:00Z' }),
      outbound({ wireMessageId: 'a@furnace.build', at: '2026-04-01T00:00:00Z' }),
      outbound({ wireMessageId: 'not-a-message-id', at: '2026-04-03T00:00:00Z' }),
      outbound({ wireMessageId: 'c@furnace.build', at: '' }),
    ]);

    assert.deepEqual(
      timeline.map((entry) => entry.wireMessageId),
      ['a@furnace.build', 'b@furnace.build'],
    );
  });

  it('merges the job view and the backfilled row view of one wire message', () => {
    const timeline = buildThreadTimeline([
      outbound({
        wireMessageId: 'a@furnace.build',
        at: '2026-04-01T00:00:00Z',
        deliveredSubject: 'Hello Casey',
        subjectTemplate: '{Hello {{first_name}}|Hi {{first_name}}}',
        startsEpoch: true,
        messageJobId: 'job-1',
      }),
      outbound({
        wireMessageId: '<a@furnace.build>',
        at: '2026-04-01T00:05:00Z',
        emailMessageId: 'row-1',
      }),
    ]);

    assert.equal(timeline.length, 1);
    const entry = timeline[0]!;
    assert.equal(entry.messageJobId, 'job-1');
    assert.equal(entry.emailMessageId, 'row-1');
    assert.equal(entry.deliveredSubject, 'Hello Casey');
    assert.equal(entry.startsEpoch, true);
    assert.equal(entry.at, '2026-04-01T00:00:00Z', 'keeps the earlier send time');
  });

  it('tags one epoch when no send carries an explicit subject', () => {
    const timeline = buildThreadTimeline([
      outbound({ wireMessageId: 'a@furnace.build', at: '2026-04-01T00:00:00Z', startsEpoch: true }),
      inbound({ wireMessageId: 'r1@mail.example.com', at: '2026-04-02T00:00:00Z' }),
      outbound({ wireMessageId: 'b@furnace.build', at: '2026-04-03T00:00:00Z' }),
    ]);

    assert.deepEqual(
      timeline.map((entry) => entry.conversationRootMessageId),
      ['a@furnace.build', 'a@furnace.build', 'a@furnace.build'],
    );
  });

  it('opens a new epoch at an explicit-subject send and inherits it afterwards', () => {
    const timeline = buildThreadTimeline([
      outbound({ wireMessageId: 'a@furnace.build', at: '2026-04-01T00:00:00Z', startsEpoch: true }),
      outbound({ wireMessageId: 'b@furnace.build', at: '2026-04-02T00:00:00Z' }),
      outbound({
        wireMessageId: 'c@furnace.build',
        at: '2026-04-03T00:00:00Z',
        startsEpoch: true,
        deliveredSubject: 'Brand new subject',
      }),
      inbound({ wireMessageId: 'r1@mail.example.com', at: '2026-04-04T00:00:00Z' }),
      outbound({ wireMessageId: 'd@furnace.build', at: '2026-04-05T00:00:00Z' }),
    ]);

    assert.deepEqual(
      timeline.map((entry) => entry.conversationRootMessageId),
      [
        'a@furnace.build',
        'a@furnace.build',
        'c@furnace.build',
        'c@furnace.build',
        'c@furnace.build',
      ],
    );
  });

  it('seeds the epoch from a persisted key when the window starts mid-conversation', () => {
    const timeline = buildThreadTimeline([
      inbound({
        wireMessageId: 'r1@mail.example.com',
        at: '2026-04-04T00:00:00Z',
        conversationRootMessageId: '<earlier@furnace.build>',
      }),
      outbound({ wireMessageId: 'd@furnace.build', at: '2026-04-05T00:00:00Z' }),
    ]);

    assert.deepEqual(
      timeline.map((entry) => entry.conversationRootMessageId),
      ['earlier@furnace.build', 'earlier@furnace.build'],
    );
  });
});

describe('newestEpochEntries', () => {
  it('returns only the newest epoch, oldest first', () => {
    const timeline = buildThreadTimeline([
      outbound({ wireMessageId: 'a@furnace.build', at: '2026-04-01T00:00:00Z', startsEpoch: true }),
      outbound({ wireMessageId: 'b@furnace.build', at: '2026-04-02T00:00:00Z' }),
      outbound({ wireMessageId: 'c@furnace.build', at: '2026-04-03T00:00:00Z', startsEpoch: true }),
      inbound({ wireMessageId: 'r1@mail.example.com', at: '2026-04-04T00:00:00Z' }),
    ]);

    assert.deepEqual(
      newestEpochEntries(timeline).map((entry) => entry.wireMessageId),
      ['c@furnace.build', 'r1@mail.example.com'],
    );
  });

  it('returns empty for an empty timeline', () => {
    assert.deepEqual(newestEpochEntries([]), []);
  });
});

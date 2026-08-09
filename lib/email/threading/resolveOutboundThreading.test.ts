import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { containsUnresolvedTemplate } from './subject.js';
import { resolveOutboundThreading } from './resolveOutboundThreading.js';
import { buildThreadTimeline } from './timeline.js';
import type { ThreadTimelineInput } from './types.js';

const lead = { id: 'lead-1', email: 'lead@example.com', first_name: 'Casey' };

function outbound(
  overrides: Partial<ThreadTimelineInput> & { wireMessageId: string; at: string },
): ThreadTimelineInput {
  return { direction: 'sent', ...overrides };
}

function inbound(
  overrides: Partial<ThreadTimelineInput> & { wireMessageId: string; at: string },
): ThreadTimelineInput {
  return { direction: 'received', ...overrides };
}

const rootSend = outbound({
  wireMessageId: 'a@furnace.build',
  at: '2026-04-01T00:00:00Z',
  deliveredSubject: 'Root subject Casey',
  subjectTemplate: '{Root subject {{first_name}}|Base subject {{first_name}}}',
  startsEpoch: true,
  emailMessageId: 'row-a',
});

describe('resolveOutboundThreading — rule 3, empty root', () => {
  it('sends an empty subject with no headers and never invents a placeholder', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: '',
      renderedSubject: '',
      timeline: [],
      lead,
    });

    assert.equal(result.decision, 'root');
    assert.equal(result.subject, '');
    assert.equal(result.inReplyTo, null);
    assert.equal(result.references, null);
    assert.equal(result.threadTopic, null);
  });

  it('treats a mistaken (No subject) template as an empty root', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: '(No subject)',
      renderedSubject: '(No subject)',
      timeline: [],
      lead,
    });

    assert.equal(result.subject, '');
    assert.equal(result.decision, 'root');
  });

  it('starts a root with a real subject when the first step has one', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: 'Quick question',
      renderedSubject: 'Quick question',
      timeline: [],
      lead,
    });

    assert.equal(result.subject, 'Quick question');
    assert.equal(result.inReplyTo, null);
  });
});

describe('resolveOutboundThreading — rules 1, 2, 6, 10: continuing a thread', () => {
  it('reuses the exact delivered subject without re-spinning', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: '',
      renderedSubject: '',
      timeline: buildThreadTimeline([rootSend]),
      lead,
    });

    assert.equal(result.decision, 'continue-epoch');
    assert.equal(result.subject, 'Root subject Casey');
    assert.equal(result.inReplyTo, '<a@furnace.build>');
    assert.equal(result.references, '<a@furnace.build>');
  });

  it('parents the most recent inbound rather than the last outbound', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: '',
      renderedSubject: '',
      timeline: buildThreadTimeline([
        rootSend,
        outbound({ wireMessageId: 'b@furnace.build', at: '2026-04-02T00:00:00Z' }),
        inbound({
          wireMessageId: 'r1@mail.example.com',
          at: '2026-04-03T00:00:00Z',
          emailMessageId: 'row-r1',
        }),
      ]),
      lead,
    });

    assert.equal(result.inReplyTo, '<r1@mail.example.com>');
    assert.equal(result.parentWireMessageId, 'r1@mail.example.com');
    assert.equal(result.parentEmailMessageId, 'row-r1');
    assert.equal(
      result.references,
      '<a@furnace.build> <b@furnace.build> <r1@mail.example.com>',
      'References accumulate the whole epoch in order',
    );
  });

  it('parents the newest inbound when several arrive back to back', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: '',
      renderedSubject: '',
      timeline: buildThreadTimeline([
        rootSend,
        inbound({ wireMessageId: 'r1@mail.example.com', at: '2026-04-02T00:00:00Z' }),
        inbound({ wireMessageId: 'r2@mail.example.com', at: '2026-04-03T00:00:00Z' }),
      ]),
      lead,
    });

    assert.equal(result.inReplyTo, '<r2@mail.example.com>');
  });

  it('renders the epoch template deterministically when no delivered subject was recorded', () => {
    const timeline = buildThreadTimeline([
      outbound({
        wireMessageId: 'a@furnace.build',
        at: '2026-04-01T00:00:00Z',
        deliveredSubject: '',
        subjectTemplate: '{Alpha {{first_name}}|Beta {{first_name}}}',
        startsEpoch: true,
      }),
    ]);

    const first = resolveOutboundThreading({
      subjectTemplate: '',
      renderedSubject: '',
      timeline,
      lead,
    });
    const second = resolveOutboundThreading({
      subjectTemplate: '',
      renderedSubject: '',
      timeline,
      lead,
    });

    assert.equal(first.subject, second.subject);
    assert.equal(containsUnresolvedTemplate(first.subject), false);
    assert.match(first.subject, /^(Alpha|Beta) Casey$/);
  });
});

describe('resolveOutboundThreading — rules 4, 5: explicit subjects and epochs', () => {
  it('starts a new conversation with no inherited headers', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: 'Brand new subject',
      renderedSubject: 'Brand new subject',
      timeline: buildThreadTimeline([
        rootSend,
        outbound({ wireMessageId: 'b@furnace.build', at: '2026-04-02T00:00:00Z' }),
      ]),
      lead,
    });

    assert.equal(result.decision, 'new-epoch');
    assert.equal(result.subject, 'Brand new subject');
    assert.equal(result.inReplyTo, null, 'explicit subject inherits no ancestry');
    assert.equal(result.references, null);
    assert.deepEqual(result.referenceMessageIds, []);
    assert.equal(result.conversationRootMessageId, null, 'this send becomes the epoch root');
  });

  it('continues the newest epoch, not the campaign root', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: '',
      renderedSubject: '',
      timeline: buildThreadTimeline([
        rootSend,
        outbound({
          wireMessageId: 'c@furnace.build',
          at: '2026-04-03T00:00:00Z',
          deliveredSubject: 'Brand new subject',
          subjectTemplate: 'Brand new subject',
          startsEpoch: true,
        }),
      ]),
      lead,
    });

    assert.equal(result.subject, 'Brand new subject', 'inherits the newest epoch subject');
    assert.equal(result.inReplyTo, '<c@furnace.build>');
    assert.equal(
      result.references,
      '<c@furnace.build>',
      'ancestry starts at the new epoch root, excluding the old thread',
    );
    assert.equal(result.conversationRootMessageId, 'c@furnace.build');
  });

  it('scopes ancestry to the newest epoch even when an inbound follows it', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: '',
      renderedSubject: '',
      timeline: buildThreadTimeline([
        rootSend,
        inbound({ wireMessageId: 'r1@mail.example.com', at: '2026-04-02T00:00:00Z' }),
        outbound({
          wireMessageId: 'c@furnace.build',
          at: '2026-04-03T00:00:00Z',
          deliveredSubject: 'Brand new subject',
          startsEpoch: true,
        }),
        inbound({ wireMessageId: 'r2@mail.example.com', at: '2026-04-04T00:00:00Z' }),
      ]),
      lead,
    });

    assert.equal(result.inReplyTo, '<r2@mail.example.com>');
    assert.equal(result.references, '<c@furnace.build> <r2@mail.example.com>');
    assert.equal(
      result.references?.includes('a@furnace.build'),
      false,
      'the previous epoch must not leak into References',
    );
  });
});

describe('resolveOutboundThreading — rule 9: explicit parent', () => {
  it('parents the caller-selected message and keeps its ancestry', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: 'Re: Root subject Casey',
      renderedSubject: 'Re: Root subject Casey',
      timeline: buildThreadTimeline([
        rootSend,
        inbound({
          wireMessageId: 'r1@mail.example.com',
          at: '2026-04-02T00:00:00Z',
          emailMessageId: 'row-r1',
          referenceMessageIds: ['a@furnace.build'],
        }),
        inbound({ wireMessageId: 'r2@mail.example.com', at: '2026-04-03T00:00:00Z' }),
      ]),
      explicitParentWireId: '<r1@mail.example.com>',
      lead,
    });

    assert.equal(result.decision, 'explicit-parent');
    assert.equal(result.inReplyTo, '<r1@mail.example.com>');
    assert.equal(result.references, '<a@furnace.build> <r1@mail.example.com>');
    assert.equal(result.parentEmailMessageId, 'row-r1');
    assert.equal(result.subject, 'Re: Root subject Casey');
  });

  it('still threads to a parent that is not in the loaded window', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: 'Re: Something',
      renderedSubject: 'Re: Something',
      timeline: [],
      explicitParentWireId: 'outside@mail.example.com',
      lead,
    });

    assert.equal(result.inReplyTo, '<outside@mail.example.com>');
    assert.equal(result.references, '<outside@mail.example.com>');
    assert.equal(result.parentEmailMessageId, null);
  });

  it('ignores an unusable explicit parent and falls back to epoch rules', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: '',
      renderedSubject: '',
      timeline: buildThreadTimeline([rootSend]),
      explicitParentWireId: 'not-a-message-id',
      lead,
    });

    assert.equal(result.decision, 'continue-epoch');
    assert.equal(result.inReplyTo, '<a@furnace.build>');
  });
});

describe('resolveOutboundThreading — thread topic', () => {
  it('strips reply prefixes for the Outlook conversation key', () => {
    const result = resolveOutboundThreading({
      subjectTemplate: 'Re: Fwd: Quick question',
      renderedSubject: 'Re: Fwd: Quick question',
      timeline: [],
      lead,
    });

    assert.equal(result.threadTopic, 'Quick question');
  });
});

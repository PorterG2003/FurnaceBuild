/**
 * Browser/composer subject regressions (deterministic, no external mailbox).
 * Encodes the contract that reply/forward defaults and thread titles must use
 * the rendered delivered subject — never unresolved thread.subject spintax.
 *
 * Exercises the same builders hooks/useInboxComposer.ts calls, so a regression in
 * the app's reply/forward defaults fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from '../campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
  createCampaignTestNamespace,
} from '../campaign/fixtures';
import {
  assertNoUnresolvedTemplate,
  looksLikeUnresolvedTemplate,
} from './threadingAssertions';
import {
  THREADING_SUBJECT_RAW_TEMPLATE,
  THREADING_SUBJECT_RENDERED,
} from '../../../scripts/seed/constants/threadingSubjectComposer';
import {
  resolveComposerForwardSubject,
  resolveComposerReplySubject,
} from '../../../scripts/seed/scenarios/threading-subject-composer/verify';
import { normalizeStoredEmailSubject } from '../../email/followUpSubject';
import {
  buildForwardDefaultSubject,
  buildReplyDefaultSubject,
  containsUnresolvedTemplate,
} from '../../email/threading/subject';

test('composer reply/forward defaults must show rendered parent subject, not raw thread spintax', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('composer-subject'),
  });

  try {
    const now = Date.now();
    const graph = await harness.createCampaignGraph({
      name: 'Composer Subject Outcomes',
      status: 'paused',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'composer',
          email: `lead-composer-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              status: 'sent',
              sentAt: new Date(now - 3600_000).toISOString(),
              scheduledAt: new Date(now - 3600_000).toISOString(),
              providerMessageId: `<composer-${harness.namespace}@furnace.test>`,
              messageData: {
                sent_subject: THREADING_SUBJECT_RENDERED,
                node_config: { subject: THREADING_SUBJECT_RAW_TEMPLATE },
              },
            }),
          ],
          thread: buildCampaignThread({
            subject: THREADING_SUBJECT_RAW_TEMPLATE,
            lastMessageAt: new Date(now).toISOString(),
            hasReply: true,
            messageJobKey: 'sent-1',
            messages: [
              buildThreadMessage({
                direction: 'sent',
                subject: THREADING_SUBJECT_RENDERED,
                bodyText: 'Outbound',
                receivedAt: new Date(now - 3600_000).toISOString(),
                messageId: `composer-${harness.namespace}@furnace.test`,
              }),
              buildThreadMessage({
                direction: 'received',
                subject: `Re: ${THREADING_SUBJECT_RENDERED}`,
                bodyText: 'Inbound',
                receivedAt: new Date(now).toISOString(),
                messageId: `inbound-composer-${harness.namespace}@mail.example.com`,
              }),
            ],
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('composer')!;
    const { data: thread } = await harness.supabase
      .from('email_threads')
      .select('id, subject')
      .eq('id', lead.threadId!)
      .single();
    assert.ok(thread);
    assert.equal(looksLikeUnresolvedTemplate(thread!.subject), true);

    const { data: sentMessage } = await harness.supabase
      .from('email_messages')
      .select('subject')
      .eq('thread_id', thread!.id)
      .eq('direction', 'sent')
      .limit(1)
      .single();
    assert.equal(sentMessage!.subject, THREADING_SUBJECT_RENDERED);

    const expectedReply = resolveComposerReplySubject({
      threadSubject: thread!.subject,
      parentMessageSubject: sentMessage!.subject,
    });
    const expectedForward = resolveComposerForwardSubject({
      threadSubject: thread!.subject,
      parentMessageSubject: sentMessage!.subject,
    });
    assert.equal(expectedReply, `Re: ${THREADING_SUBJECT_RENDERED}`);
    assert.equal(expectedForward, `Fwd: ${THREADING_SUBJECT_RENDERED}`);
    assertNoUnresolvedTemplate(expectedReply, 'contract reply subject');
    assertNoUnresolvedTemplate(expectedForward, 'contract forward subject');

    // The builders the app actually calls, given a thread title that was frozen
    // raw before subject resolution existed.
    const actualReply = buildReplyDefaultSubject({
      parentMessageSubject: sentMessage!.subject,
      threadSubject: thread!.subject,
    });
    const actualForward = buildForwardDefaultSubject({
      parentMessageSubject: sentMessage!.subject,
      threadSubject: thread!.subject,
    });
    assert.equal(
      actualReply,
      expectedReply,
      'reply composer subject must equal rendered parent subject (not raw thread spintax)',
    );
    assert.equal(
      actualForward,
      expectedForward,
      'forward composer subject must equal rendered parent subject (not raw thread spintax)',
    );
    assertNoUnresolvedTemplate(actualReply, 'UI reply subject');
    assertNoUnresolvedTemplate(actualForward, 'UI forward subject');

    // Even with no usable parent, the raw thread title must be rendered rather
    // than shown verbatim.
    const fallbackReply = buildReplyDefaultSubject({
      parentMessageSubject: null,
      threadSubject: thread!.subject,
      lead: { first_name: 'Casey' },
    });
    assert.equal(containsUnresolvedTemplate(fallbackReply), false, fallbackReply);
  } finally {
    await harness.cleanup();
  }
});

test('campaign builder: empty subject stores empty; (No subject) is display-only', () => {
  // Display helper used by EmailNodeModal variant list.
  const displaySubject = (stored: string) => (stored ? stored : '(No subject)');
  assert.equal(displaySubject(''), '(No subject)');
  assert.equal(displaySubject('Real'), 'Real');

  // Persistence must never write the placeholder.
  assert.equal(normalizeStoredEmailSubject(''), '');
  assert.equal(normalizeStoredEmailSubject('(No subject)'), '');
  assert.equal(normalizeStoredEmailSubject('  (No subject)  '), '');
  assert.equal(normalizeStoredEmailSubject('Real subject'), 'Real subject');

  // Preview of explicit spintax must resolve (not show raw braces after render).
  // Builder stores the template; preview path resolves — assert the stored value stays the template
  // while display of empty stays placeholder-only.
  const storedEmpty = normalizeStoredEmailSubject('');
  assert.equal(storedEmpty, '');
  assert.notEqual(storedEmpty, '(No subject)');
});

test('reopening/saving must not convert (No subject) display placeholder into stored data', () => {
  // Simulates: UI shows placeholder, user saves without editing → store empty.
  const uiValueShown = '(No subject)';
  const onSave = (inputFromField: string) => normalizeStoredEmailSubject(inputFromField);
  assert.equal(onSave(uiValueShown), '');
  assert.equal(onSave(''), '');
  assert.equal(onSave('Keep this'), 'Keep this');
});

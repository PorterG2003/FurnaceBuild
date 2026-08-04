import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignDbHarness } from '../campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
  createCampaignTestNamespace,
} from '../campaign/fixtures';
import { normalizeInboxSearchQuery } from '../../inbox/normalizeInboxSearchQuery';

async function ensureInboxSearchSchema(
  harness: CampaignDbHarness,
  t: test.TestContext,
): Promise<boolean> {
  const { error } = await harness.supabase.rpc('list_account_inbox_threads', {
    p_account_id: '00000000-0000-4000-8000-000000000000',
    p_limit: 1,
    p_offset: 0,
  });
  if (error && /Could not find the function|does not exist|schema cache/i.test(error.message)) {
    t.skip(`Inbox search RPC not applied in shared test DB: ${error.message}`);
    return false;
  }
  return true;
}

async function searchThreads(
  harness: CampaignDbHarness,
  accountId: string,
  q: string,
): Promise<Array<{ id: string }>> {
  const { data, error } = await harness.supabase.rpc('list_account_inbox_threads', {
    p_account_id: accountId,
    p_search: normalizeInboxSearchQuery(q),
    p_has_reply_only: true,
    p_limit: 20,
    p_offset: 0,
  });
  assert.equal(error, null, error?.message);
  return (data ?? []) as Array<{ id: string }>;
}

test('inbox search matches subject, lead, body, tag, and campaign name', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('thread-search'),
  });
  const now = Date.now();
  const unique = harness.namespace.replace(/[^a-z0-9]/gi, '').slice(-8);
  const campaignName = `SearchCamp ${unique}`;
  const leadFirst = `Aldera${unique}`;
  const subjectToken = `subj${unique}`;
  const bodyToken = `bodyphrase${unique}`;
  const tagName = `tag${unique}`;
  // Keep the local-part alphanumeric so prefix FTS does not split on hyphens.
  const participantToken = `part${unique}`;
  const participantEmail = `${participantToken}@furnace.test`;

  try {
    if (!(await ensureInboxSearchSchema(harness, t))) return;

    const graph = await harness.createCampaignGraph({
      name: campaignName,
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'search-target',
          email: `lead${unique}@furnace.test`,
          firstName: leadFirst,
          lastName: 'Solo',
          companyName: `Corp${unique}`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: `Hello ${subjectToken} world`,
            lastMessageAt: new Date(now).toISOString(),
            messages: [
              buildThreadMessage({
                direction: 'sent',
                receivedAt: new Date(now - 60_000).toISOString(),
                readAt: new Date(now - 60_000).toISOString(),
                bodyText: 'Campaign outreach',
              }),
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date(now).toISOString(),
                readAt: null,
                fromEmail: participantEmail,
                bodyText: `Please review ${bodyToken} tomorrow`,
              }),
            ],
          }),
        }),
        buildCampaignLead({
          key: 'search-noise',
          email: `noise-${unique}@furnace.test`,
          firstName: 'Noise',
          lastName: 'Lead',
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Unrelated noise thread',
            lastMessageAt: new Date(now - 120_000).toISOString(),
            messages: [
              buildThreadMessage({
                direction: 'sent',
                receivedAt: new Date(now - 180_000).toISOString(),
                readAt: new Date(now - 180_000).toISOString(),
              }),
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date(now - 120_000).toISOString(),
                readAt: null,
                bodyText: 'Completely different reply content',
              }),
            ],
          }),
        }),
      ],
    });

    const targetThreadId = graph.leadsByKey.get('search-target')!.threadId!;
    const noiseThreadId = graph.leadsByKey.get('search-noise')!.threadId!;
    const accountId = graph.accountId;

    await harness.supabase
      .from('email_threads')
      .update({ participants: [participantEmail, `lead${unique}@furnace.test`] })
      .eq('id', targetThreadId);

    const { data: tagRow, error: tagError } = await harness.supabase
      .from('thread_tags')
      .insert({ account_id: accountId, name: tagName, color: '#888888' })
      .select('id')
      .single();
    assert.equal(tagError, null, tagError?.message);
    const tagId = tagRow!.id as string;

    const { error: assignError } = await harness.supabase.from('thread_tag_assignments').insert({
      thread_id: targetThreadId,
      tag_id: tagId,
      account_id: accountId,
    });
    assert.equal(assignError, null, assignError?.message);

    await harness.supabase.rpc('refresh_email_thread_search_vector', {
      p_thread_id: targetThreadId,
    });

    const cases: Array<{ q: string; label: string; allowNoise?: boolean }> = [
      { q: subjectToken, label: 'subject' },
      { q: leadFirst, label: 'lead first name' },
      { q: bodyToken, label: 'message body' },
      { q: tagName, label: 'thread tag' },
      // Both threads share one campaign in this graph, so campaign-name hits are not exclusive.
      { q: 'SearchCamp', label: 'campaign name prefix', allowNoise: true },
      { q: participantToken, label: 'participant email prefix' },
    ];

    for (const { q, label, allowNoise } of cases) {
      const threads = await searchThreads(harness, accountId, q);
      assert.ok(
        threads.some((row) => row.id === targetThreadId),
        `expected hit for ${label} query "${q}"`,
      );
      if (!allowNoise) {
        assert.equal(
          threads.some((row) => row.id === noiseThreadId),
          false,
          `noise thread should not match ${label}`,
        );
      }
    }

    const miss = await searchThreads(harness, accountId, `zzzmiss${unique}`);
    assert.equal(miss.length, 0);

    await harness.supabase.from('thread_tag_assignments').delete().eq('tag_id', tagId);
    await harness.supabase.from('thread_tags').delete().eq('id', tagId);
  } finally {
    await harness.cleanup();
  }
});

test('inbox search matches secondary to_emails recipients', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('thread-search-to-emails'),
  });
  const now = Date.now();
  const unique = harness.namespace.replace(/[^a-z0-9]/gi, '').slice(-8);
  const secondaryToToken = `secto${unique}`;
  const secondaryToEmail = `${secondaryToToken}@furnace.test`;

  try {
    if (!(await ensureInboxSearchSchema(harness, t))) return;

    const graph = await harness.createCampaignGraph({
      name: `ToEmailsCamp ${unique}`,
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'to-emails-target',
          email: `lead-to-${unique}@furnace.test`,
          firstName: 'Target',
          lastName: 'Lead',
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: `To emails ${unique}`,
            lastMessageAt: new Date(now).toISOString(),
            messages: [
              buildThreadMessage({
                direction: 'sent',
                receivedAt: new Date(now - 60_000).toISOString(),
                readAt: new Date(now - 60_000).toISOString(),
                bodyText: 'Campaign outreach',
              }),
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date(now).toISOString(),
                readAt: null,
                bodyText: 'Prospect reply content',
              }),
            ],
          }),
        }),
        buildCampaignLead({
          key: 'to-emails-noise',
          email: `noise-to-${unique}@furnace.test`,
          firstName: 'Noise',
          lastName: 'Lead',
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Unrelated noise thread',
            lastMessageAt: new Date(now - 120_000).toISOString(),
            messages: [
              buildThreadMessage({
                direction: 'sent',
                receivedAt: new Date(now - 180_000).toISOString(),
                readAt: new Date(now - 180_000).toISOString(),
              }),
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date(now - 120_000).toISOString(),
                readAt: null,
                bodyText: 'Completely different reply content',
              }),
            ],
          }),
        }),
      ],
    });

    const targetThreadId = graph.leadsByKey.get('to-emails-target')!.threadId!;
    const noiseThreadId = graph.leadsByKey.get('to-emails-noise')!.threadId!;

    const { data: targetMessages, error: listError } = await harness.supabase
      .from('email_messages')
      .select('id, to_email')
      .eq('thread_id', targetThreadId)
      .eq('direction', 'received')
      .limit(1);
    assert.equal(listError, null, listError?.message);
    const targetMessage = targetMessages?.[0] as { id: string; to_email: string } | undefined;
    assert.ok(targetMessage?.id);

    const { error: toEmailsError } = await harness.supabase
      .from('email_messages')
      .update({
        to_emails: [targetMessage!.to_email, secondaryToEmail],
      } as any)
      .eq('id', targetMessage!.id);
    if (toEmailsError && /to_emails|schema cache|column/i.test(toEmailsError.message)) {
      t.skip(`email_messages.to_emails not applied in shared test DB: ${toEmailsError.message}`);
      return;
    }
    assert.equal(toEmailsError, null, toEmailsError?.message);

    const threads = await searchThreads(harness, graph.accountId, secondaryToToken);
    assert.ok(
      threads.some((row) => row.id === targetThreadId),
      `expected hit for secondary to_emails query "${secondaryToToken}"`,
    );
    assert.equal(
      threads.some((row) => row.id === noiseThreadId),
      false,
      'noise thread should not match secondary to_emails recipient',
    );
  } finally {
    await harness.cleanup();
  }
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ThreadTimelineLoadError, loadThreadTimeline } from './loadThreadTimeline.js';

type TableResult = { data?: unknown; error?: { code?: string; message?: string } | null };

/**
 * Minimal chainable Supabase stub. Every builder method returns the same object,
 * which resolves to the result configured for the table.
 */
function stubSupabase(results: Record<string, TableResult>) {
  return {
    from(table: string) {
      const result = results[table] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'or', 'order', 'limit', 'not', 'range']) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => result;
      chain.then = (resolve: (value: TableResult) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  } as never;
}

const sentJob = {
  id: 'job-1',
  provider_message_id: '<root@furnace.build>',
  submitted_message_id: '<root@furnace.build>',
  sent_at: '2026-08-01T00:00:00.000Z',
  message_data: { sent_subject: 'Quick check-in' },
};

describe('loadThreadTimeline error handling', () => {
  it('throws when email_messages cannot be read, rather than reporting an empty thread', async () => {
    // 42703 is what a worker deployed ahead of its migration sees.
    await assert.rejects(
      () =>
        loadThreadTimeline({
          supabase: stubSupabase({
            message_jobs: { data: [sentJob] },
            email_messages: {
              error: { code: '42703', message: 'column email_messages.x does not exist' },
            },
          }),
          campaignId: 'campaign-1',
          leadId: 'lead-1',
          threadId: 'thread-1',
        }),
      (error: unknown) => {
        assert.ok(error instanceof ThreadTimelineLoadError);
        assert.equal(error.source, 'email_messages');
        assert.match(error.message, /42703/);
        return true;
      },
    );
  });

  it('throws when message_jobs cannot be read', async () => {
    await assert.rejects(
      () =>
        loadThreadTimeline({
          supabase: stubSupabase({
            message_jobs: { error: { code: '08006', message: 'connection failure' } },
          }),
          campaignId: 'campaign-1',
          leadId: 'lead-1',
          threadId: 'thread-1',
        }),
      (error: unknown) => {
        assert.ok(error instanceof ThreadTimelineLoadError);
        assert.equal(error.source, 'message_jobs');
        return true;
      },
    );
  });

  it('throws when the thread lookup fails, instead of treating the lead as unthreaded', async () => {
    await assert.rejects(
      () =>
        loadThreadTimeline({
          supabase: stubSupabase({
            message_jobs: { data: [sentJob] },
            email_threads: { error: { code: '08006', message: 'connection failure' } },
          }),
          campaignId: 'campaign-1',
          leadId: 'lead-1',
        }),
      (error: unknown) => {
        assert.ok(error instanceof ThreadTimelineLoadError);
        assert.equal(error.source, 'email_threads');
        return true;
      },
    );
  });

  it('treats a missing thread row as a new conversation', async () => {
    const timeline = await loadThreadTimeline({
      supabase: stubSupabase({
        message_jobs: { data: [] },
        email_threads: { data: null },
        events: { data: [] },
      }),
      campaignId: 'campaign-1',
      leadId: 'lead-1',
    });

    assert.deepEqual(timeline, []);
  });

  it('builds the timeline when both sources read cleanly', async () => {
    const timeline = await loadThreadTimeline({
      supabase: stubSupabase({
        message_jobs: { data: [sentJob] },
        email_messages: { data: [] },
        events: { data: [] },
      }),
      campaignId: 'campaign-1',
      leadId: 'lead-1',
      threadId: 'thread-1',
    });

    assert.equal(timeline.length, 1);
    assert.equal(timeline[0]!.deliveredSubject, 'Quick check-in');
  });

  it('tolerates a failed sent-event lookup, which only supplies a legacy subject fallback', async () => {
    const timeline = await loadThreadTimeline({
      supabase: stubSupabase({
        message_jobs: { data: [sentJob] },
        email_messages: { data: [] },
        events: { error: { code: '42501', message: 'permission denied' } },
      }),
      campaignId: 'campaign-1',
      leadId: 'lead-1',
      threadId: 'thread-1',
    });

    assert.equal(timeline.length, 1);
  });
});

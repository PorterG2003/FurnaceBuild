/**
 * Read-only post-seed verifier for threading-subject-composer.
 * Inspects Furnace DB only — never sends through an external mailbox provider.
 *
 * Usage:
 *   npx tsx scripts/seed/scenarios/threading-subject-composer/verify.ts
 */
import assert from 'node:assert/strict';
import { createSeedContext } from '../../seedContext';
import { loadSeedEnv } from '../../env';
import {
  THREADING_SUBJECT_RAW_TEMPLATE,
  THREADING_SUBJECT_RENDERED,
  THREADING_SUBJECT_THREAD_ID,
} from '../../constants/threadingSubjectComposer';
import { looksLikeUnresolvedTemplate } from '../../../../lib/test/inbox/threadingAssertions';

/** Mirrors the intended composer default (contract), not the buggy thread.subject copy. */
export function resolveComposerReplySubject(params: {
  threadSubject: string | null | undefined;
  parentMessageSubject: string | null | undefined;
}): string {
  const parent = String(params.parentMessageSubject ?? '').trim();
  const base = parent || String(params.threadSubject ?? '').trim();
  if (!base) return 'Re: (No subject)';
  return base.startsWith('Re:') ? base : `Re: ${base}`;
}

export function resolveComposerForwardSubject(params: {
  threadSubject: string | null | undefined;
  parentMessageSubject: string | null | undefined;
}): string {
  const parent = String(params.parentMessageSubject ?? '').trim();
  const base = parent || String(params.threadSubject ?? '').trim();
  if (!base) return 'Fwd: (No subject)';
  return base.startsWith('Fwd:') ? base : `Fwd: ${base}`;
}

async function main() {
  loadSeedEnv();
  const ctx = createSeedContext({
    scenarioId: 'threading-subject-composer',
    wipe: false,
    dryRun: false,
  });

  const { data: thread, error } = await ctx.supabase
    .from('email_threads')
    .select('id, subject')
    .eq('id', THREADING_SUBJECT_THREAD_ID)
    .maybeSingle();
  if (error) throw error;
  if (!thread) {
    console.error(
      `[verify] Thread ${THREADING_SUBJECT_THREAD_ID} not found. Run: npm run seed -- --scenario=threading-subject-composer`,
    );
    process.exit(2);
  }

  const { data: messages, error: msgError } = await ctx.supabase
    .from('email_messages')
    .select('id, direction, subject')
    .eq('thread_id', THREADING_SUBJECT_THREAD_ID)
    .order('received_at', { ascending: true });
  if (msgError) throw msgError;

  const sent = (messages ?? []).find((m) => m.direction === 'sent');
  const received = (messages ?? []).find((m) => m.direction === 'received');
  assert.ok(sent, 'seeded sent message required');
  assert.ok(received, 'seeded inbound message required');

  assert.equal(sent!.subject, THREADING_SUBJECT_RENDERED);
  assert.equal(looksLikeUnresolvedTemplate(sent!.subject), false);

  // Seed intentionally leaves raw template on the thread row to reproduce the defect.
  assert.equal(thread.subject, THREADING_SUBJECT_RAW_TEMPLATE);

  const replySubject = resolveComposerReplySubject({
    threadSubject: thread.subject,
    parentMessageSubject: sent!.subject,
  });
  const forwardSubject = resolveComposerForwardSubject({
    threadSubject: thread.subject,
    parentMessageSubject: sent!.subject,
  });

  assert.equal(replySubject, `Re: ${THREADING_SUBJECT_RENDERED}`);
  assert.equal(forwardSubject, `Fwd: ${THREADING_SUBJECT_RENDERED}`);
  assert.equal(looksLikeUnresolvedTemplate(replySubject), false);
  assert.equal(looksLikeUnresolvedTemplate(forwardSubject), false);
  assert.equal(looksLikeUnresolvedTemplate(thread.subject), true);

  console.log('[verify] threading-subject-composer DB state OK');
  console.log(`[verify] contract composer reply subject: ${replySubject}`);
  console.log(`[verify] defect surface thread.subject still raw: ${thread.subject}`);
}

if (process.argv[1] && /threading-subject-composer\/verify\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error('[verify] failed', err);
    process.exit(1);
  });
}

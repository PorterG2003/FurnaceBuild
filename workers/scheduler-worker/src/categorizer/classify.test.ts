import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_REPLY_CATEGORY,
  CATEGORIZER_BODY_TRUNCATION_LIMIT,
  CATEGORIZER_CATEGORIES,
  DEFAULT_CATEGORIZER_MODEL,
  RETURN_DATE_MAX_DAYS,
  buildCategorizerPrompt,
  classifyReply,
  isBranchCategory,
  parseCategorizerResponse,
  resolveCategorizerModel,
  sanitizeReturnDate,
  truncateReplyBody,
  type CategorizerLlmTransport,
} from './classify.js';

const NOW = new Date('2026-06-10T15:00:00.000Z');

function isoDaysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// sanitizeReturnDate (OOO return-date guardrails)
// ---------------------------------------------------------------------------

test('sanitizeReturnDate accepts a near-future ISO date', () => {
  const date = isoDaysFromNow(7);
  assert.equal(sanitizeReturnDate(date, NOW), date);
});

test('sanitizeReturnDate keeps today (sender returns later today)', () => {
  const today = NOW.toISOString().slice(0, 10);
  assert.equal(sanitizeReturnDate(today, NOW), today);
});

test('sanitizeReturnDate discards dates in the past', () => {
  assert.equal(sanitizeReturnDate('2020-01-01', NOW), null);
  assert.equal(sanitizeReturnDate(isoDaysFromNow(-1), NOW), null);
});

test('sanitizeReturnDate discards dates beyond the 90-day horizon', () => {
  assert.equal(sanitizeReturnDate(isoDaysFromNow(RETURN_DATE_MAX_DAYS + 1), NOW), null);
  assert.equal(sanitizeReturnDate('2099-01-01', NOW), null);
});

test('sanitizeReturnDate keeps dates exactly at the horizon edge', () => {
  const edge = isoDaysFromNow(RETURN_DATE_MAX_DAYS);
  assert.equal(sanitizeReturnDate(edge, NOW), edge);
});

test('sanitizeReturnDate rejects non-ISO and non-string inputs', () => {
  assert.equal(sanitizeReturnDate('next Monday', NOW), null);
  assert.equal(sanitizeReturnDate('06/20/2026', NOW), null);
  assert.equal(sanitizeReturnDate('2026-6-2', NOW), null);
  assert.equal(sanitizeReturnDate(20260620, NOW), null);
  assert.equal(sanitizeReturnDate(null, NOW), null);
  assert.equal(sanitizeReturnDate(undefined, NOW), null);
  assert.equal(sanitizeReturnDate({ date: '2026-06-20' }, NOW), null);
});

test('sanitizeReturnDate rejects impossible calendar dates', () => {
  assert.equal(sanitizeReturnDate('2026-13-40', NOW), null);
});

// ---------------------------------------------------------------------------
// parseCategorizerResponse (model output hardening)
// ---------------------------------------------------------------------------

test('parseCategorizerResponse parses a clean JSON object', () => {
  const parsed = parseCategorizerResponse('{"category": "Interested", "return_date": null}', NOW);
  assert.deepEqual(parsed, { category: 'Interested', returnDate: null });
});

test('parseCategorizerResponse parses fenced and prose-wrapped JSON', () => {
  const fenced = parseCategorizerResponse(
    '```json\n{"category": "Not Interested", "return_date": null}\n```',
    NOW,
  );
  assert.deepEqual(fenced, { category: 'Not Interested', returnDate: null });

  const prose = parseCategorizerResponse(
    `Sure! Here is the classification: {"category": "Neutral", "return_date": null} Hope that helps.`,
    NOW,
  );
  assert.deepEqual(prose, { category: 'Neutral', returnDate: null });
});

test('parseCategorizerResponse rejects unknown categories and non-JSON', () => {
  assert.equal(parseCategorizerResponse('{"category": "Maybe", "return_date": null}', NOW), null);
  assert.equal(parseCategorizerResponse('The reply is interested.', NOW), null);
  assert.equal(parseCategorizerResponse('', NOW), null);
  assert.equal(parseCategorizerResponse('["Interested"]', NOW), null);
});

test('parseCategorizerResponse only honors return_date for Auto Reply', () => {
  const future = isoDaysFromNow(5);

  const autoReply = parseCategorizerResponse(
    `{"category": "Auto Reply", "return_date": "${future}"}`,
    NOW,
  );
  assert.deepEqual(autoReply, { category: AUTO_REPLY_CATEGORY, returnDate: future });

  // A hallucinated return date on a branch category is dropped.
  const interested = parseCategorizerResponse(
    `{"category": "Interested", "return_date": "${future}"}`,
    NOW,
  );
  assert.deepEqual(interested, { category: 'Interested', returnDate: null });
});

test('parseCategorizerResponse sanitizes absurd Auto Reply return dates to null', () => {
  const parsed = parseCategorizerResponse(
    '{"category": "Auto Reply", "return_date": "2020-01-01"}',
    NOW,
  );
  assert.deepEqual(parsed, { category: AUTO_REPLY_CATEGORY, returnDate: null });
});

// ---------------------------------------------------------------------------
// Prompt + body truncation
// ---------------------------------------------------------------------------

test('truncateReplyBody caps oversized bodies and marks truncation', () => {
  const oversized = 'a'.repeat(CATEGORIZER_BODY_TRUNCATION_LIMIT + 500);
  const truncated = truncateReplyBody(oversized);
  assert.ok(truncated.length <= CATEGORIZER_BODY_TRUNCATION_LIMIT + '\n[truncated]'.length);
  assert.ok(truncated.endsWith('[truncated]'));

  assert.equal(truncateReplyBody('  short  '), 'short');
  assert.equal(truncateReplyBody(null), '');
});

test('buildCategorizerPrompt anchors relative dates to the message date and lists every category', () => {
  const prompt = buildCategorizerPrompt({
    subject: 'Re: Quick check-in',
    bodyText: 'I am out until next Monday.',
    messageDate: NOW,
  });

  assert.ok(prompt.system.includes('2026-06-10'), 'system prompt anchors the message date');
  for (const category of CATEGORIZER_CATEGORIES) {
    assert.ok(prompt.system.includes(`"${category}"`), `system prompt lists ${category}`);
  }
  assert.ok(prompt.user.includes('Re: Quick check-in'));
  assert.ok(prompt.user.includes('I am out until next Monday.'));
});

test('buildCategorizerPrompt handles empty subject and body', () => {
  const prompt = buildCategorizerPrompt({ subject: null, bodyText: null, messageDate: NOW });
  assert.ok(prompt.user.includes('(no subject)'));
  assert.ok(prompt.user.includes('(empty body)'));
});

// ---------------------------------------------------------------------------
// classifyReply (transport failure mapping)
// ---------------------------------------------------------------------------

const INPUT = { subject: 'Re: Hello', bodyText: 'Sounds great!', messageDate: NOW };

test('classifyReply returns the parsed classification on success', async () => {
  const transport: CategorizerLlmTransport = async () => ({
    ok: true,
    text: '{"category": "Interested", "return_date": null}',
  });
  const result = await classifyReply(INPUT, { transport, now: NOW });
  assert.deepEqual(result, {
    ok: true,
    classification: { category: 'Interested', returnDate: null },
  });
});

test('classifyReply maps transport failures with HTTP status into the error', async () => {
  const transport: CategorizerLlmTransport = async () => ({
    ok: false,
    details: 'upstream exploded',
    httpStatus: 502,
  });
  const result = await classifyReply(INPUT, { transport, now: NOW });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.includes('HTTP 502'));
  assert.ok(!result.ok && result.error.includes('upstream exploded'));
});

test('classifyReply catches transport throws instead of propagating', async () => {
  const transport: CategorizerLlmTransport = async () => {
    throw new Error('socket hang up');
  };
  const result = await classifyReply(INPUT, { transport, now: NOW });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.includes('socket hang up'));
});

test('classifyReply treats unparseable completions as failures', async () => {
  const transport: CategorizerLlmTransport = async () => ({
    ok: true,
    text: 'I would say this person is interested!',
  });
  const result = await classifyReply(INPUT, { transport, now: NOW });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.includes('Unparseable'));
});

// ---------------------------------------------------------------------------
// Misc contract guards
// ---------------------------------------------------------------------------

test('isBranchCategory accepts exactly the three branch categories', () => {
  assert.equal(isBranchCategory('Interested'), true);
  assert.equal(isBranchCategory('Neutral'), true);
  assert.equal(isBranchCategory('Not Interested'), true);
  assert.equal(isBranchCategory(AUTO_REPLY_CATEGORY), false);
  assert.equal(isBranchCategory(null), false);
  assert.equal(isBranchCategory(undefined), false);
  assert.equal(isBranchCategory('interested'), false);
});

test('resolveCategorizerModel honors the env override and defaults to Gemini 2.5 Flash Lite', () => {
  const original = process.env.OPENROUTER_CATEGORIZER_MODEL;
  try {
    delete process.env.OPENROUTER_CATEGORIZER_MODEL;
    assert.equal(resolveCategorizerModel(), DEFAULT_CATEGORIZER_MODEL);
    process.env.OPENROUTER_CATEGORIZER_MODEL = 'openai/gpt-4o-mini';
    assert.equal(resolveCategorizerModel(), 'openai/gpt-4o-mini');
  } finally {
    if (original === undefined) {
      delete process.env.OPENROUTER_CATEGORIZER_MODEL;
    } else {
      process.env.OPENROUTER_CATEGORIZER_MODEL = original;
    }
  }
});

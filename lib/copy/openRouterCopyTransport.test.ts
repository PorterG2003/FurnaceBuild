import assert from 'node:assert/strict';
import test from 'node:test';
import {
  callOpenRouterCopyParse,
  COPY_PARSE_INLINE_LLM_ATTEMPTS,
} from './openRouterCopyTransport';

test('OpenRouter copy transport retries transient failures and returns JSON text', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls < COPY_PARSE_INLINE_LLM_ATTEMPTS) {
      return new Response(
        JSON.stringify({ error: { message: 'rate limited' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"pieces":[]}' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await callOpenRouterCopyParse({
    apiKey: 'fixture-key',
    model: 'fixture-model',
    prompt: { system: 'system', user: 'user' },
    fetchImpl,
  });
  assert.equal(result, '{"pieces":[]}');
  assert.equal(calls, COPY_PARSE_INLINE_LLM_ATTEMPTS);
});

test('OpenRouter copy transport requests a large JSON completion budget', async () => {
  let requestBody = '';
  const fetchImpl: typeof fetch = async (_url, init) => {
    requestBody = String(init?.body ?? '');
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"pieces":[]}' }, finish_reason: 'stop' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  await callOpenRouterCopyParse({
    apiKey: 'fixture-key',
    model: 'fixture-model',
    prompt: { system: 'system', user: 'user' },
    fetchImpl,
  });
  assert.match(requestBody, /"max_tokens":8192/);
});

test('OpenRouter copy transport retries truncated completions', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"pieces":[' }, finish_reason: 'length' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"pieces":[]}' }, finish_reason: 'stop' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await callOpenRouterCopyParse({
    apiKey: 'fixture-key',
    model: 'fixture-model',
    prompt: { system: 'system', user: 'user' },
    fetchImpl,
  });
  assert.equal(result, '{"pieces":[]}');
  assert.equal(calls, 2);
});

test('OpenRouter copy transport stops after the bounded attempt count', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error('offline fixture');
  };

  await assert.rejects(
    callOpenRouterCopyParse({
      apiKey: 'fixture-key',
      model: 'fixture-model',
      prompt: { system: 'system', user: 'user' },
      fetchImpl,
    }),
    /offline fixture/,
  );
  assert.equal(calls, COPY_PARSE_INLINE_LLM_ATTEMPTS);
});

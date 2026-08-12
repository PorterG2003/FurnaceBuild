import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPipelineIntentPass,
  parsePipelineIntentLlmContent,
  scorePipelineIntent,
} from './pipelineIntentLlm.js';

describe('pipelineIntentLlm', () => {
  it('parses LLM JSON and normalizes intent', () => {
    const parsed = parsePipelineIntentLlmContent(
      '```json\n{"intent":"Customer Training","confidence":0.8,"audience":"customers","reason":"for our customers"}\n```',
    );
    assert.equal(parsed.intent, 'customer_training');
    assert.equal(parsed.confidence, 0.8);
  });

  it('fixture mode drops customer training', async () => {
    const result = await scorePipelineIntent(
      'Join our webinar for our customers — customer training on the new dashboard.',
      { useFixtures: true },
    );
    assert.equal(result.intent, 'customer_training');
    assert.equal(result.pass, false);
  });

  it('fixture mode keeps demand webinar', async () => {
    const result = await scorePipelineIntent(
      'Register for our webinar on demand generation for B2B marketers. Open to prospects.',
      { useFixtures: true },
    );
    assert.equal(result.pass, true);
    assert.equal(isPipelineIntentPass(result.intent), true);
  });

  it('regex deny short-circuits before LLM', async () => {
    const result = await scorePipelineIntent('Join our all-hands town hall for employees only.', {
      useFixtures: false,
      apiKey: 'should-not-be-used',
    });
    assert.equal(result.pass, false);
    assert.equal(result.source, 'regex_deny');
  });
});

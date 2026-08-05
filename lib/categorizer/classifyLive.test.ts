/**
 * Live OpenRouter classification against CTA_SCENARIOS.
 * Part of the normal campaign unit suite. Resolves OPENROUTER_API_KEY from
 * env/.env.local or Amplify SSM (same path as scheduler workers).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSeedEnv } from '../../scripts/seed/env';
import {
  loadSelfRecoveryEnv,
  resolveOpenRouterApiKey,
} from '../../scripts/self-recovery-env';
import { CTA_SCENARIOS } from './ctaScenarios';
import {
  classifyReply,
  DEFAULT_CATEGORIZER_MODEL,
} from '../../workers/scheduler-worker/src/categorizer/classify';

loadSeedEnv();
loadSelfRecoveryEnv();

const MODEL =
  process.env.OPENROUTER_CATEGORIZER_MODEL?.trim() || DEFAULT_CATEGORIZER_MODEL;
const NOW = new Date('2026-08-05T15:00:00.000Z');

async function ensureOpenRouterKey(): Promise<string> {
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    return process.env.OPENROUTER_API_KEY.trim();
  }
  const resolved = await resolveOpenRouterApiKey({ targetEnv: 'dev' });
  process.env.OPENROUTER_API_KEY = resolved.apiKey;
  console.log(`[categorizer-live] OPENROUTER_API_KEY from ${resolved.source}`);
  return resolved.apiKey;
}

test('live OpenRouter: CTA_SCENARIOS match expectedCategory', async (t) => {
  const apiKey = await ensureOpenRouterKey();
  assert.ok(apiKey, 'OPENROUTER_API_KEY required');

  console.log(
    JSON.stringify({
      suite: 'categorizer-live',
      model: MODEL,
      scenarios: CTA_SCENARIOS.length,
      note: 'Each scenario = 1 OpenRouter chat completion',
    }),
  );

  let billableCalls = 0;
  const failures: Array<{
    id: string;
    expected: string;
    actual: string | null;
    error?: string;
  }> = [];

  for (const scenario of CTA_SCENARIOS) {
    await t.test(scenario.id, async () => {
      billableCalls += 1;
      const result = await classifyReply(
        {
          messageDate: NOW,
          reply: scenario.reply,
          priorOutbound: scenario.outbound,
        },
        { now: NOW },
      );

      if (!result.ok) {
        failures.push({
          id: scenario.id,
          expected: scenario.expectedCategory,
          actual: null,
          error: result.error,
        });
        assert.fail(`${scenario.id}: classify failed — ${result.error}`);
      }

      const actual = result.classification.category;
      if (actual !== scenario.expectedCategory) {
        failures.push({
          id: scenario.id,
          expected: scenario.expectedCategory,
          actual,
        });
      }
      assert.equal(
        actual,
        scenario.expectedCategory,
        `${scenario.id}: expected ${scenario.expectedCategory}, got ${actual}` +
          (scenario.notes ? ` (${scenario.notes})` : ''),
      );
    });
  }

  t.after(() => {
    console.log(
      JSON.stringify(
        {
          suite: 'categorizer-live',
          billableCalls,
          failures,
        },
        null,
        2,
      ),
    );
  });
});

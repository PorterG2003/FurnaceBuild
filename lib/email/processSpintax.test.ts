import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSpintaxSeed,
  fnv1a32,
  LEGACY_MISSING_VARIANT_ID,
  processSpintax,
  selectSpintaxOptionIndex,
  SPINTAX_SEED_VERSION,
} from './processSpintax.js';

describe('buildSpintaxSeed', () => {
  it('assembles a versioned campaign/lead/variant identity seed', () => {
    assert.equal(
      buildSpintaxSeed({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        variantId: 'var-1',
      }),
      `${SPINTAX_SEED_VERSION}:camp-1:lead-1:var-1`
    );
  });

  it('uses a stable legacy stand-in when variant_id is missing', () => {
    assert.equal(
      buildSpintaxSeed({ campaignId: 'camp-1', leadId: 'lead-1', variantId: null }),
      `${SPINTAX_SEED_VERSION}:camp-1:lead-1:${LEGACY_MISSING_VARIANT_ID}`
    );
    assert.equal(
      buildSpintaxSeed({ campaignId: 'camp-1', leadId: 'lead-1', variantId: '  ' }),
      `${SPINTAX_SEED_VERSION}:camp-1:lead-1:${LEGACY_MISSING_VARIANT_ID}`
    );
  });
});

describe('processSpintax', () => {
  it('returns the first option in deterministic mode and preserves variables for later merge', () => {
    const result = processSpintax(
      'Subject: {Hi {{first_name}}|Hello {{first_name}}} from {Austin|Dallas}',
      { deterministic: true }
    );

    assert.equal(result, 'Subject: Hi {{first_name}} from Austin');
  });

  it('resolves nested spintax iteratively', () => {
    const result = processSpintax('Open with {outer {one|two}|fallback}', {
      deterministic: true,
    });

    assert.equal(result, 'Open with outer one');
  });

  it('uses random selection when deterministic mode is disabled', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.99;

    try {
      const result = processSpintax('Pick {first|second|third}');
      assert.equal(result, 'Pick third');
    } finally {
      Math.random = originalRandom;
    }
  });

  it('leaves malformed single-option braces unchanged', () => {
    assert.equal(processSpintax('Keep {literal} braces', { deterministic: true }), 'Keep {literal} braces');
  });

  it('handles multiple spintax segments in one string', () => {
    const result = processSpintax('{Hi|Hello} there, {friend|team}', {
      deterministic: true,
    });

    assert.equal(result, 'Hi there, friend');
  });

  it('uses fixed seeded vectors for subject/body selection', () => {
    const seed = buildSpintaxSeed({
      campaignId: 'camp-1',
      leadId: 'lead-1',
      variantId: 'var-1',
    });

    assert.equal(fnv1a32('hello'), 1335831723);
    assert.equal(
      selectSpintaxOptionIndex(3, {
        seed,
        scope: 'subject',
        path: '0',
        optionsRaw: 'first|second|third',
      }),
      1
    );
    assert.equal(
      processSpintax('Pick {first|second|third}', { seed, scope: 'subject' }),
      'Pick second'
    );
    assert.equal(
      processSpintax('{Hi|Hello} there, {friend|team}', { seed, scope: 'body' }),
      'Hi there, team'
    );
    assert.equal(
      processSpintax('Open with {outer {one|two}|fallback}', { seed, scope: 'body' }),
      'Open with outer two'
    );
    assert.equal(
      processSpintax('{Hi {{first_name}}|Hello {{first_name}}} from {Austin|Dallas}', {
        seed,
        scope: 'subject',
      }),
      'Hi {{first_name}} from Dallas'
    );
  });

  it('is stable across repeated calls with the same seed', () => {
    const seed = buildSpintaxSeed({
      campaignId: 'camp-1',
      leadId: 'lead-1',
      variantId: 'var-1',
    });
    const input = '{Hi|Hello} {{first_name}}, {thanks|appreciate it} from {Austin|Dallas|Houston}';
    const first = processSpintax(input, { seed, scope: 'body' });
    const second = processSpintax(input, { seed, scope: 'body' });
    assert.equal(first, second);
    assert.doesNotMatch(first, /\{[^}]*\|/);
    assert.match(first, /\{\{first_name\}\}/);
  });

  it('isolates choices by scope and occurrence path', () => {
    const seed = buildSpintaxSeed({
      campaignId: 'camp-1',
      leadId: 'lead-1',
      variantId: 'var-1',
    });
    const input = '{Alpha|Beta|Gamma}';
    const subject = processSpintax(input, { seed, scope: 'subject' });
    const body = processSpintax(input, { seed, scope: 'body' });
    const bodyText = processSpintax(input, { seed, scope: 'body_text' });
    // Same seed + different scopes may or may not collide; all must be valid options.
    for (const value of [subject, body, bodyText]) {
      assert.match(value, /^(Alpha|Beta|Gamma)$/);
    }
    // Distinct paths within one string can resolve independently.
    const multi = processSpintax('{A|B}|{A|B}', { seed, scope: 'body' });
    assert.match(multi, /^[AB]\|[AB]$/);
  });

  it('changes seed dimensions without requiring a different option each time', () => {
    const base = { campaignId: 'camp-1', leadId: 'lead-1', variantId: 'var-1' };
    const input = '{A|B|C|D|E|F|G|H}';
    const results = [
      processSpintax(input, { seed: buildSpintaxSeed(base), scope: 'body' }),
      processSpintax(input, {
        seed: buildSpintaxSeed({ ...base, campaignId: 'camp-2' }),
        scope: 'body',
      }),
      processSpintax(input, {
        seed: buildSpintaxSeed({ ...base, leadId: 'lead-2' }),
        scope: 'body',
      }),
      processSpintax(input, {
        seed: buildSpintaxSeed({ ...base, variantId: 'var-2' }),
        scope: 'body',
      }),
      processSpintax(input, {
        seed: buildSpintaxSeed({ ...base, variantId: null }),
        scope: 'body',
      }),
    ];
    for (const value of results) {
      assert.match(value, /^[A-H]$/);
    }
    // Same identity is stable even when variant is explicitly null vs omitted.
    assert.equal(
      processSpintax(input, {
        seed: buildSpintaxSeed({ ...base, variantId: null }),
        scope: 'body',
      }),
      processSpintax(input, {
        seed: buildSpintaxSeed({ ...base, variantId: undefined }),
        scope: 'body',
      })
    );
  });

  it('is approximately uniform across a large deterministic sample', () => {
    const counts = new Map<string, number>();
    const options = ['A', 'B', 'C', 'D'];
    const sampleSize = 4000;
    for (let i = 0; i < sampleSize; i++) {
      const seed = buildSpintaxSeed({
        campaignId: 'camp-uniform',
        leadId: `lead-${i}`,
        variantId: 'var-1',
      });
      const value = processSpintax('{A|B|C|D}', { seed, scope: 'body' });
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    assert.equal(counts.size, options.length);
    const expected = sampleSize / options.length;
    for (const option of options) {
      const count = counts.get(option) ?? 0;
      // Loose bound: each option should land within ~20% of expected.
      assert.ok(
        Math.abs(count - expected) < expected * 0.2,
        `${option} count ${count} drifted too far from ${expected}`
      );
    }
  });

  it('prefers seed over deterministic first-option when both are provided', () => {
    const seed = buildSpintaxSeed({
      campaignId: 'camp-1',
      leadId: 'lead-1',
      variantId: 'var-1',
    });
    // Seeded vector picks "second"; first-option mode would pick "first".
    assert.equal(
      processSpintax('Pick {first|second|third}', {
        seed,
        scope: 'subject',
        deterministic: true,
      }),
      'Pick second'
    );
  });
});

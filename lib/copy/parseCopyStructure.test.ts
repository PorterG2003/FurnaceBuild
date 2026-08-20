import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCopyStructurePrompt,
  CopyStructureParseError,
  COPY_PARSE_MAX_PIECES_PER_KIND,
  parseCopyStructureResponse,
} from './parseCopyStructure';

const INPUT = {
  subject: '{Quick question|A thought} for {{first_name}}',
  body: [
    '{Noticed|Saw} {{custom.company}} is hiring.',
    'Teams like Acme cut ramp time by 42%.',
    'I can send the three-step playbook.',
    'Worth a look?',
  ].join('\n\n'),
  archetypes: [
    {
      id: 'existing-cta',
      kind: 'cta' as const,
      slug: 'permission-question',
      name: 'Permission question',
      description: 'Asks permission to share the next step.',
    },
  ],
};

test('buildCopyStructurePrompt defines the closed taxonomy and verbatim contract', () => {
  const prompt = buildCopyStructurePrompt(INPUT);
  assert.match(prompt.system, /subject.*hook.*problem.*proof.*offer.*cta/s);
  assert.match(prompt.system, /VERBATIM/);
  assert.ok(prompt.user.includes(INPUT.subject));
  assert.ok(prompt.user.includes('permission-question'));
});

test('parseCopyStructureResponse validates spans and reuses existing archetypes', () => {
  const parsed = parseCopyStructureResponse(
    JSON.stringify({
      pieces: [
        {
          kind: 'hook',
          text: '{Noticed|Saw} {{custom.company}} is hiring.',
          position: 0,
          archetype_slug: 'hiring-signal',
          archetype_name: 'Hiring signal',
        },
        {
          kind: 'proof',
          text: 'Teams like Acme cut ramp time by 42%.',
          position: 44,
          archetype_slug: 'quantified-result',
          archetype_name: 'Quantified result',
        },
        {
          kind: 'cta',
          text: 'Worth a look?',
          position: 121,
          archetype_slug: 'permission-question',
          archetype_name: 'Ignored replacement',
        },
      ],
    }),
    INPUT,
  );

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.rawText, '{Noticed|Saw} {{custom.company}} is hiring.');
  assert.equal(parsed[0]?.displayText, 'Noticed is hiring.');
  assert.equal(parsed[2]?.archetype.existingId, 'existing-cta');
  assert.equal(parsed[2]?.archetype.name, 'Permission question');
});

test('parseCopyStructureResponse drops hallucinations and out-of-vocabulary kinds', () => {
  const parsed = parseCopyStructureResponse(
    JSON.stringify({
      pieces: [
        {
          kind: 'hook',
          text: 'This paraphrase was never in the email.',
          archetype_slug: 'invented',
          archetype_name: 'Invented',
        },
        {
          kind: 'urgency',
          text: 'Worth a look?',
          archetype_slug: 'urgency',
          archetype_name: 'Urgency',
        },
      ],
    }),
    INPUT,
  );
  assert.deepEqual(parsed, []);
});

test('parseCopyStructureResponse caps pieces per kind', () => {
  const proof = 'Teams like Acme cut ramp time by 42%.';
  const parsed = parseCopyStructureResponse(
    JSON.stringify({
      pieces: Array.from({ length: COPY_PARSE_MAX_PIECES_PER_KIND + 3 }, (_, index) => ({
        kind: 'proof',
        text: proof,
        position: index,
        archetype_slug: `new-proof-${index}`,
        archetype_name: `New proof ${index}`,
      })),
    }),
    INPUT,
  );

  assert.equal(parsed.length, COPY_PARSE_MAX_PIECES_PER_KIND);
});

test('parseCopyStructureResponse allows multiple new archetypes per kind', () => {
  const parsed = parseCopyStructureResponse(
    JSON.stringify({
      pieces: [
        {
          kind: 'hook',
          text: '{Noticed|Saw} {{custom.company}} is hiring.',
          position: 0,
          archetype_slug: 'hiring-signal',
          archetype_name: 'Hiring signal hook',
        },
        {
          kind: 'proof',
          text: 'Teams like Acme cut ramp time by 42%.',
          position: 44,
          archetype_slug: 'quantified-result',
          archetype_name: 'Quantified result proof',
        },
        {
          kind: 'proof',
          text: 'I can send the three-step playbook.',
          position: 81,
          archetype_slug: 'playbook-asset',
          archetype_name: 'Playbook asset proof',
        },
      ],
    }),
    INPUT,
  );

  assert.equal(parsed.length, 3);
  const proofSlugs = parsed.filter((p) => p.kind === 'proof').map((p) => p.archetype.slug);
  assert.equal(proofSlugs.length, 2);
  assert.notEqual(proofSlugs[0], proofSlugs[1]);
});

test('parseCopyStructureResponse fails malformed envelopes rather than returning partial data', () => {
  assert.throws(
    () => parseCopyStructureResponse('not JSON', INPUT),
    CopyStructureParseError,
  );
  assert.throws(
    () => parseCopyStructureResponse('{"pieces":"wrong"}', INPUT),
    /pieces array/,
  );
});

test('parseCopyStructureResponse accepts a top-level pieces array', () => {
  const parsed = parseCopyStructureResponse(
    JSON.stringify([
      {
        kind: 'cta',
        text: 'Worth a look?',
        position: 121,
        archetype_slug: 'permission-question',
        archetype_name: 'Ignored',
      },
    ]),
    INPUT,
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.kind, 'cta');
});

test('parseCopyStructureResponse accepts nested or oddly keyed pieces envelopes', () => {
  const parsed = parseCopyStructureResponse(
    JSON.stringify({
      data: {
        Pieces: [
          {
            kind: 'cta',
            text: 'Worth a look?',
            position: 121,
            archetype_slug: 'permission-question',
            archetype_name: 'Ignored',
          },
        ],
      },
    }),
    INPUT,
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.kind, 'cta');
});

test('parseCopyStructureResponse does not treat truncated JSON as success', () => {
  assert.throws(
    () =>
      parseCopyStructureResponse(
        '{"pieces":[{"kind":"cta","text":"Worth a look?","position":121,"archetype_slug":"permission-question","archetype_name":"X"',
        INPUT,
      ),
    CopyStructureParseError,
  );
});

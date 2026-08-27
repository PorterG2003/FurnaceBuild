import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildReferencesFromAncestorIds,
  buildReplyThreadingHeaders,
  buildStableSubmittedMessageId,
  capReferenceChain,
  formatMessageId,
  formatReferencesHeader,
  normalizeMessageId,
  normalizeThreadTopic,
  parseMessageIds,
  pickWireMessageId,
} from './threadHeaders.js';

describe('normalizeMessageId', () => {
  it('strips brackets and whitespace', () => {
    assert.equal(normalizeMessageId('  <a@b.com>  '), 'a@b.com');
    assert.equal(normalizeMessageId('a@b.com'), 'a@b.com');
    assert.equal(normalizeMessageId('<A@B.com>'), 'a@b.com');
  });

  it('strips only one leading < and trailing > per pass', () => {
    assert.equal(normalizeMessageId('<<a@b.com>>'), '<a@b.com>');
  });

  it('returns null for empty or invalid', () => {
    assert.equal(normalizeMessageId(''), null);
    assert.equal(normalizeMessageId(null), null);
    assert.equal(normalizeMessageId('not-an-id'), null);
  });
});

describe('formatMessageId', () => {
  it('always brackets', () => {
    assert.equal(formatMessageId('a@b.com'), '<a@b.com>');
    assert.equal(formatMessageId('<a@b.com>'), '<a@b.com>');
  });
});

describe('parseMessageIds', () => {
  it('parses multi-value References strings', () => {
    assert.deepEqual(
      parseMessageIds('<a@x.com> <b@x.com> c@x.com'),
      ['a@x.com', 'b@x.com', 'c@x.com'],
    );
  });

  it('parses mailparser arrays without dropping later IDs', () => {
    assert.deepEqual(
      parseMessageIds(['<first@furnace.build>', '<second@furnace.build>', 'third@ex.com']),
      ['first@furnace.build', 'second@furnace.build', 'third@ex.com'],
    );
  });

  it('handles multiline and duplicate tokens', () => {
    assert.deepEqual(
      parseMessageIds('<a@x.com>\r\n\t<a@x.com> <b@x.com>'),
      ['a@x.com', 'b@x.com'],
    );
  });

  it('does not treat the whole chain as one ID', () => {
    const ids = parseMessageIds('<a@x.com> <b@x.com>');
    assert.equal(ids.length, 2);
    assert.ok(!ids.some((id) => id.includes(' ')));
  });
});

describe('buildReplyThreadingHeaders', () => {
  it('sets In-Reply-To to parent and References to ancestry + parent', () => {
    const headers = buildReplyThreadingHeaders({
      parentMessageId: '<b@x.com>',
      parentReferences: '<a@x.com>',
    });
    assert.ok(headers);
    assert.equal(headers!.inReplyTo, '<b@x.com>');
    assert.equal(headers!.references, '<a@x.com> <b@x.com>');
    assert.deepEqual(headers!.referenceMessageIds, ['a@x.com', 'b@x.com']);
  });

  it('handles legacy root-only parent (no parent references)', () => {
    const headers = buildReplyThreadingHeaders({
      parentMessageId: 'root@furnace.build',
      parentReferences: null,
    });
    assert.equal(headers!.inReplyTo, '<root@furnace.build>');
    assert.equal(headers!.references, '<root@furnace.build>');
  });

  it('does not duplicate parent already present in references', () => {
    const headers = buildReplyThreadingHeaders({
      parentMessageId: 'b@x.com',
      parentReferences: ['a@x.com', 'b@x.com'],
    });
    assert.equal(headers!.references, '<a@x.com> <b@x.com>');
  });

  it('returns null without a parent', () => {
    assert.equal(buildReplyThreadingHeaders({ parentMessageId: null }), null);
  });
});

describe('capReferenceChain', () => {
  it('preserves root and recent tail when truncating', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `msg${i}@x.com`);
    const capped = capReferenceChain(ids, 120);
    assert.equal(capped[0], 'msg0@x.com');
    assert.equal(capped[capped.length - 1], 'msg19@x.com');
    assert.ok(capped.length < ids.length);
  });
});

describe('buildStableSubmittedMessageId', () => {
  it('is deterministic from job UUID', () => {
    const a = buildStableSubmittedMessageId('11111111-1111-1111-1111-111111111111');
    const b = buildStableSubmittedMessageId('11111111-1111-1111-1111-111111111111');
    assert.equal(a, b);
    assert.equal(a, '<11111111-1111-1111-1111-111111111111@furnace.build>');
  });
});

describe('normalizeThreadTopic', () => {
  it('strips reply/forward prefixes', () => {
    assert.equal(normalizeThreadTopic('Re: Quick question'), 'Quick question');
    assert.equal(normalizeThreadTopic('RE: FW: Fwd: Hello'), 'Hello');
    assert.equal(normalizeThreadTopic('Quick question'), 'Quick question');
  });

  it('returns null for empty', () => {
    assert.equal(normalizeThreadTopic(''), null);
    assert.equal(normalizeThreadTopic('Re:'), null);
  });
});

describe('pickWireMessageId / buildReferencesFromAncestorIds', () => {
  it('prefers provider over submitted', () => {
    assert.equal(
      pickWireMessageId({
        providerMessageId: '<p@x.com>',
        submittedMessageId: '<s@x.com>',
      }),
      'p@x.com',
    );
    assert.equal(
      pickWireMessageId({
        providerMessageId: null,
        submittedMessageId: '<s@x.com>',
      }),
      's@x.com',
    );
  });

  it('builds chain from ordered ancestors', () => {
    const headers = buildReferencesFromAncestorIds([
      '<a@x.com>',
      '<b@x.com>',
      '<c@x.com>',
    ]);
    assert.equal(headers!.inReplyTo, '<c@x.com>');
    assert.equal(headers!.references, '<a@x.com> <b@x.com> <c@x.com>');
  });
});

describe('formatReferencesHeader', () => {
  it('joins bracketed IDs', () => {
    assert.equal(formatReferencesHeader(['a@x.com', '<b@x.com>']), '<a@x.com> <b@x.com>');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertCumulativeReferences,
  assertImmediateParent,
  assertMimeSemanticParity,
  assertNoThreadingHeaders,
  assertNoUnresolvedTemplate,
  assertNotUiPlaceholder,
  looksLikeUnresolvedTemplate,
  normalizeForSemanticCompare,
} from './threadingAssertions.js';

describe('threadingAssertions', () => {
  it('detects unresolved spintax and merge templates', () => {
    assert.equal(looksLikeUnresolvedTemplate('{CE Training | August 7th}'), true);
    assert.equal(looksLikeUnresolvedTemplate('Re: {A|B}'), true);
    assert.equal(looksLikeUnresolvedTemplate('Hi {{first_name}}'), true);
    assert.equal(looksLikeUnresolvedTemplate('August 7th - CE Training'), false);
    assert.equal(looksLikeUnresolvedTemplate(''), false);
  });

  it('assertNoUnresolvedTemplate passes for rendered subjects', () => {
    assertNoUnresolvedTemplate('August 7th - CE Training');
    assert.throws(() => assertNoUnresolvedTemplate('{A|B}'));
  });

  it('assertImmediateParent normalizes brackets and case', () => {
    assertImmediateParent('<ABC@furnace.build>', 'abc@furnace.build');
    assert.throws(() => assertImmediateParent('<a@x.com>', '<b@x.com>'));
  });

  it('assertNoThreadingHeaders rejects inherited ancestry', () => {
    assertNoThreadingHeaders(null, null);
    assert.throws(() => assertNoThreadingHeaders('<a@x.com>', null));
    assert.throws(() => assertNoThreadingHeaders(null, '<a@x.com>'));
  });

  it('assertCumulativeReferences checks ordered IDs', () => {
    assertCumulativeReferences('<a@x.com> <b@x.com>', ['a@x.com', 'b@x.com']);
    assert.throws(() =>
      assertCumulativeReferences('<a@x.com> <b@x.com>', ['b@x.com', 'a@x.com']),
    );
  });

  it('assertMimeSemanticParity equates text and simple HTML', () => {
    assertMimeSemanticParity('Hello world', '<p>Hello world</p>');
    assert.throws(() => assertMimeSemanticParity('Just let me know!', '<p>Happy to send the link</p>'));
  });

  it('normalizeForSemanticCompare collapses whitespace and tags', () => {
    assert.equal(
      normalizeForSemanticCompare('<p>Hi<br>there</p>'),
      normalizeForSemanticCompare('Hi\nthere'),
    );
  });

  it('assertNotUiPlaceholder rejects display placeholder', () => {
    assertNotUiPlaceholder('');
    assertNotUiPlaceholder('Real subject');
    assert.throws(() => assertNotUiPlaceholder('(No subject)'));
    assert.throws(() => assertNotUiPlaceholder('(no subject)'));
  });
});

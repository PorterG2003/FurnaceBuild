import assert from 'node:assert';
import { describe, it } from 'node:test';
import { formatOwnerDisplayName } from './formatOwnerDisplayName.js';
import { normalizeNameKey } from './normalizeSourceRecord.js';

describe('formatOwnerDisplayName', () => {
  it('namecases person-like owners', () => {
    const result = formatOwnerDisplayName('john mcdonald');
    assert.equal(result.displayName, 'John McDonald');
    assert.equal(result.ownerKind, 'person');
  });

  it('collapses spacing and preserves person punctuation', () => {
    const result = formatOwnerDisplayName("  JOHN   O'CONNOR  ");
    assert.equal(result.cleanName, "JOHN O'CONNOR");
    assert.equal(result.displayName, "John O'Connor");
    assert.equal(result.ownerKind, 'person');
  });

  it('leaves entity-like names unchanged', () => {
    const result = formatOwnerDisplayName('ACME LLC');
    assert.equal(result.displayName, 'ACME LLC');
    assert.equal(result.ownerKind, 'entity');
  });

  it('uses Unknown for empty names', () => {
    const result = formatOwnerDisplayName('   ');
    assert.equal(result.displayName, 'Unknown');
    assert.equal(result.ownerKind, 'unknown');
  });

  it('keeps normalized keys stable for representative person names', () => {
    const raw = "  JOHN   O'CONNOR  ";
    const result = formatOwnerDisplayName(raw);
    assert.equal(normalizeNameKey(raw), normalizeNameKey(result.displayName));
  });
});

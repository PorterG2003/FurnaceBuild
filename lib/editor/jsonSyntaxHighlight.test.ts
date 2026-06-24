import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getJsonTokenColor, tokenizeJsonSyntax } from './jsonSyntaxTokens.js';

describe('getJsonTokenColor', () => {
  it('colors JSON keys and string values differently', () => {
    assert.equal(getJsonTokenColor('"email"', true), '#93C5FD');
    assert.equal(getJsonTokenColor('"casey@example.com"', false), '#86EFAC');
  });

  it('colors booleans, null, numbers, and punctuation', () => {
    assert.equal(getJsonTokenColor('true', false), '#F9A8D4');
    assert.equal(getJsonTokenColor('false', false), '#F9A8D4');
    assert.equal(getJsonTokenColor('null', false), '#C4B5FD');
    assert.equal(getJsonTokenColor('42', false), '#FCA5A5');
    assert.equal(getJsonTokenColor('{', false), '#6B7280');
  });
});

describe('tokenizeJsonSyntax', () => {
  it('tokenizes keys, strings, and merge tags in context', () => {
    const parts = tokenizeJsonSyntax('{\n  "email": "{{email}}"\n}');
    const colored = parts.filter((part) => part.color !== '#E5E7EB').map((part) => part.text);

    assert.deepEqual(colored, ['{', '"email"', ':', '"{{email}}"', '}']);
    assert.equal(parts.find((part) => part.text === '"email"')?.color, '#93C5FD');
    assert.equal(parts.find((part) => part.text === '"{{email}}"')?.color, '#86EFAC');
  });

  it('shows placeholder hint when value is empty', () => {
    const parts = tokenizeJsonSyntax('');
    assert.equal(parts.length, 1);
    assert.equal(parts[0]?.text, '{"key": "value"}');
    assert.equal(parts[0]?.color, '#6B7280');
  });
});

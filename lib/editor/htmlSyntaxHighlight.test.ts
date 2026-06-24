import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tokenizeHtmlSyntax } from './htmlSyntaxTokens.js';

describe('tokenizeHtmlSyntax', () => {
  it('tokenizes tags, attributes, strings, and merge tags', () => {
    const input = '<td class="name">Hello {{first_name}}</td>';
    const parts = tokenizeHtmlSyntax(input);

    assert.ok(parts.some((part) => part.text === '<td' && part.color === '#93C5FD'));
    assert.ok(parts.some((part) => part.text === 'class' && part.color === '#FCD34D'));
    assert.ok(parts.some((part) => part.text === '"name"' && part.color === '#86EFAC'));
    assert.ok(parts.some((part) => part.text === '{{first_name}}' && part.color === '#86EFAC'));
    assert.ok(parts.some((part) => part.text === '</td' && part.color === '#93C5FD'));
    assert.equal(parts.map((part) => part.text).join(''), input);
  });

  it('tokenizes HTML comments', () => {
    const parts = tokenizeHtmlSyntax('<!-- hidden -->');
    assert.equal(parts.length, 1);
    assert.equal(parts[0]?.text, '<!-- hidden -->');
    assert.equal(parts[0]?.color, '#6B7280');
  });

  it('shows placeholder hint when value is empty', () => {
    const parts = tokenizeHtmlSyntax('');
    assert.equal(parts.length, 1);
    assert.equal(parts[0]?.text, '<table>...</table>');
  });
});

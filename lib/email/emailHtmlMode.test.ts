import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalizeEmailContentForSave,
  canonicalizeEmailHtml,
  convertHtmlToRichTextSeed,
  isFullHtmlDocument,
} from './emailHtmlMode.js';

describe('emailHtmlMode', () => {
  it('detects full HTML documents', () => {
    assert.equal(isFullHtmlDocument('<!DOCTYPE html><html><body><p>x</p></body></html>'), true);
    assert.equal(isFullHtmlDocument('<div><p>x</p></div>'), false);
  });

  it('sanitizes dangerous content before save', () => {
    const result = canonicalizeEmailHtml(
      '<div onclick="evil()"><script>alert(1)</script><a href="javascript:evil()">Bad</a><iframe src="https://example.com/embed"></iframe></div>'
    );
    assert.equal(result.html.includes('<script'), false);
    assert.equal(result.html.includes('onclick='), false);
    assert.equal(result.html.includes('javascript:'), false);
    assert.match(result.html, /Open embedded content/);
  });

  it('preserves merge tags in attributes and content best-effort', () => {
    const result = canonicalizeEmailHtml('<a href="{{custom.demo_url}}">Hi {{first_name}}</a>');
    assert.match(result.html, /\{\{custom\.demo_url\}\}/);
    assert.match(result.html, /\{\{first_name\}\}/);
  });

  it('repairs and canonicalizes HTML mode saves', () => {
    const saved = canonicalizeEmailContentForSave({
      editorMode: 'html',
      bodyHtml: '<!DOCTYPE html><html><body><h1>Hi {{first_name}}</h1><p style="color:red; behavior:url(test)">Demo</p></body></html>',
    });
    assert.equal(saved.editorMode, 'html');
    assert.equal(saved.documentKind, 'fullDocument');
    assert.match(saved.bodyHtml, /<html>/i);
    assert.equal(saved.bodyText, 'Hi {{first_name}} Demo');
    assert.equal(saved.template, 'Hi {{first_name}} Demo');
    assert.equal(saved.bodyHtml.includes('behavior:'), false);
  });

  it('builds a rich-text seed from HTML mode content', () => {
    const richSeed = convertHtmlToRichTextSeed(
      '<!DOCTYPE html><html><head><style>.x{color:red}</style></head><body><table><tr><td>Hello</td></tr></table></body></html>'
    );
    assert.match(richSeed, /<table>/);
    assert.equal(richSeed.includes('<html'), false);
    assert.equal(richSeed.includes('<body'), false);
  });

  it('richText save with empty bodyHtml materializes template as body_html', () => {
    const saved = canonicalizeEmailContentForSave({
      editorMode: 'richText',
      bodyHtml: '',
      template: 'Hey {{first_name}}, figured this might help.',
    });
    assert.equal(saved.editorMode, 'richText');
    assert.equal(saved.bodyHtml, '<p>Hey {{first_name}}, figured this might help.</p>');
    assert.equal(saved.template, 'Hey {{first_name}}, figured this might help.');
    assert.equal(saved.bodyText, 'Hey {{first_name}}, figured this might help.');
  });

  it('richText save with omitted bodyHtml materializes template as body_html', () => {
    const saved = canonicalizeEmailContentForSave({
      editorMode: 'richText',
      template: 'Hello {{first_name}} from {{company_name}}',
    });
    assert.equal(saved.bodyHtml, '<p>Hello {{first_name}} from {{company_name}}</p>');
    assert.equal(saved.template, 'Hello {{first_name}} from {{company_name}}');
    assert.equal(saved.bodyText, 'Hello {{first_name}} from {{company_name}}');
  });
});

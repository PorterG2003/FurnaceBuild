import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  sanitizeEmailHtmlForForwardEmbed,
  stripScriptsFromEmailHtml,
  stripUnresolvableCidImages,
} from './forward-embed';

describe('stripScriptsFromEmailHtml', () => {
  it('removes script tags', () => {
    const html = '<p>ok</p><script>evil()</script><p>tail</p>';
    assert.strictEqual(
      stripScriptsFromEmailHtml(html),
      '<p>ok</p><p>tail</p>'
    );
  });
});

describe('stripUnresolvableCidImages', () => {
  it('removes img with cid src', () => {
    const html = '<p>x</p><img src="cid:foo@bar" alt="i"><p>y</p>';
    const out = stripUnresolvableCidImages(html);
    assert.ok(!out.includes('cid:'));
    assert.ok(out.includes('<p>x</p>'));
    assert.ok(out.includes('<p>y</p>'));
  });
});

describe('sanitizeEmailHtmlForForwardEmbed', () => {
  it('strips scripts and cid images after sanitize', () => {
    const html = '<div><script>x</script><img src="cid:a"></div>';
    const out = sanitizeEmailHtmlForForwardEmbed(html);
    assert.ok(!out.toLowerCase().includes('<script'));
    assert.ok(!out.includes('cid:'));
  });
});

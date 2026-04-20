import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  normalizeEmailHtmlForDarkMode,
  MAILBOX_RENDER_LINK_COLOR,
  MAILBOX_RENDER_TEXT_COLOR,
} from './normalize-render-html.js';

describe('normalizeEmailHtmlForDarkMode', () => {
  it('removes inline background styling and unreadable text colors', () => {
    const html = '<span style="background-color: yellow; color: #111111; font-weight: 700">Hello</span>';

    const result = normalizeEmailHtmlForDarkMode(html);

    assert.match(result, new RegExp(`color: ${MAILBOX_RENDER_TEXT_COLOR} !important`));
    assert.doesNotMatch(result, /background-color/i);
    assert.match(result, /font-weight: 700/);
  });

  it('preserves readable colors while stripping legacy background attributes', () => {
    const html = '<td bgcolor="#ffeeaa"><font color="#ffffff">Readable</font></td>';

    const result = normalizeEmailHtmlForDarkMode(html);

    assert.doesNotMatch(result, /\sbgcolor=/i);
    assert.match(result, /color="#ffffff"/i);
  });

  it('normalizes style tag colors and link attributes for dark mode', () => {
    const html = `
      <style>
        .dark-copy { color: #000000; background: #fff000; }
        .readable-copy { color: #f8f8f8; }
      </style>
      <body link="#000000"><p class="dark-copy">Body</p><p class="readable-copy">Body</p></body>
    `;

    const result = normalizeEmailHtmlForDarkMode(html);

    assert.match(result, new RegExp(`\\.dark-copy \\{ color: ${MAILBOX_RENDER_TEXT_COLOR};\\s*\\}`));
    assert.match(result, /\.readable-copy \{ color: #f8f8f8;\s*\}/);
    assert.doesNotMatch(result, /background:\s*#fff000/i);
    assert.match(result, new RegExp(`link="${MAILBOX_RENDER_LINK_COLOR}"`, 'i'));
  });
});

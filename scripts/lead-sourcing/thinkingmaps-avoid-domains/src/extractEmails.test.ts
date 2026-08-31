import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeMailtoTarget,
  extractEmailsFromHtml,
  pickDominantDomain,
  rankEmailDomains,
  stripMailPrefix,
} from './extractEmails.js';

describe('extractEmailsFromHtml', () => {
  it('reads mailto links and visible addresses, dropping vendor and free mail', () => {
    const html = `
      <a href="mailto:jane.doe@sbcusd.com">Jane</a>
      <a href="mailto:help%40edlio.com">vendor</a>
      Contact the office at office@sbcusd.com or principal@gmail.com
      <img src="icon@2x.png">
    `;
    const emails = extractEmailsFromHtml(html);
    assert.deepEqual(emails.sort(), ['jane.doe@sbcusd.com', 'office@sbcusd.com']);
  });

  it('decodes percent-encoded mailto targets', () => {
    assert.equal(decodeMailtoTarget('mailto:info%40alpinedistrict.org'), 'info@alpinedistrict.org');
  });
});

describe('rankEmailDomains', () => {
  it('strips mail. prefixes and flags competing domains', () => {
    assert.equal(stripMailPrefix('mail.lausd.net'), 'lausd.net');
    const ranked = rankEmailDomains([
      'a@sbcusd.com',
      'b@sbcusd.com',
      'c@mail.sbcusd.com',
    ]);
    const picked = pickDominantDomain(ranked);
    assert.equal(picked.domain, 'sbcusd.com');
    assert.equal(picked.competing, false);
  });

  it('marks competing domains when counts tie', () => {
    const picked = pickDominantDomain(
      rankEmailDomains(['a@school.org', 'b@district.net']),
    );
    assert.equal(picked.competing, true);
    assert.match(picked.notes.join(' '), /competing_domains/);
  });
});

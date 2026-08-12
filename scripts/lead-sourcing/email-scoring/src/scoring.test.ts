import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MillionVerifier } from './lib/millionVerifier.js';
import { pickBestEmail } from './lib/scoring.js';

function mockVerifier(): MillionVerifier {
  return new MillionVerifier({ apiKey: 'test', mock: true });
}

describe('pickBestEmail', () => {
  it('picks business email verified by Million Verifier', async () => {
    const best = await pickBestEmail(
      'Gagne, Patrick M',
      ['gagnepat@yahoo.com', 'patrick@pmgconstructioncorporation.com', 'pmgweb3@aol.com'],
      mockVerifier(),
    );
    assert.equal(best, 'patrick@pmgconstructioncorporation.com');
  });

  it('picks consumer email with strongest name match and column order', async () => {
    const best = await pickBestEmail(
      'Ionta, Kevin',
      ['jlionta@gmail.com', 'evbrunner@aol.com', 'kevinionta@gmail.com'],
      mockVerifier(),
    );
    // jlionta@gmail.com scores higher: consumer + name (ionta) + email_1 bonus
    assert.equal(best, 'jlionta@gmail.com');
  });

  it('skips dead domains and prefers surviving consumer email', async () => {
    const best = await pickBestEmail(
      'McDonald, Daniel',
      ['sb2837@att.net', 'sb2837@worldnet.att.net', 'sb2837@bellsouth.net'],
      mockVerifier(),
    );
    assert.equal(best, 'sb2837@att.net');
  });

  it('picks business email when consumer and dead alternatives exist', async () => {
    const best = await pickBestEmail(
      'Claude W Bethea',
      ['claudeb105@aol.com', 's7cbethea@netscape.net', 'claude@exploreinteractive.com'],
      mockVerifier(),
    );
    assert.equal(best, 'claude@exploreinteractive.com');
  });

  it('returns empty when all email columns are blank', async () => {
    const best = await pickBestEmail('Brice Sadler', ['', '', ''], mockVerifier());
    assert.equal(best, '');
  });
});

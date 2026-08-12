import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyHostKind,
  hostPrefix,
  looksLikeChallengeHtml,
  normalizeHost,
  parseRosterJson,
  seedHosts,
} from './rosterHosts.ts';

describe('roster host helpers', () => {
  it('normalizes hosts and extracts prefixes', () => {
    assert.equal(normalizeHost('il.exprealty.com'), 'https://il.exprealty.com');
    assert.equal(normalizeHost('https://www.mfr.exprealty.com/agents.php'), 'https://www.mfr.exprealty.com');
    assert.equal(hostPrefix('https://www.ntx.exprealty.com'), 'ntx');
  });

  it('seeds pilot jurisdictions and www only when required', () => {
    const hosts = seedHosts({ jurisdictions: ['IL', 'TX'], includeWww: true });
    assert.ok(hosts.some((host) => host.host === 'https://il.exprealty.com'));
    assert.ok(!hosts.some((host) => host.host === 'https://www.il.exprealty.com'));
    assert.ok(hosts.some((host) => host.host === 'https://ntx.exprealty.com'));
    assert.ok(hosts.some((host) => host.host === 'https://www.har.exprealty.com'));
    assert.ok(hosts.every((host) => host.jurisdictions.some((j) => j === 'IL' || j === 'TX')));
  });

  it('detects Cloudflare challenge HTML and parses roster JSON', () => {
    assert.equal(
      looksLikeChallengeHtml('<html>Performing security verification by Cloudflare</html>'),
      true,
    );
    assert.equal(looksLikeChallengeHtml('[{"agentid":1}]'), false);
    assert.deepEqual(parseRosterJson('[{"agentid":1,"fname":"A"}]'), [
      { agentid: 1, fname: 'A' },
    ]);
    assert.equal(parseRosterJson('<html>nope</html>'), null);
  });

  it('classifies regional vs personal hosts by roster size', () => {
    assert.equal(classifyHostKind(509, 'il'), 'regional');
    assert.equal(classifyHostKind(2, 'michellesaward'), 'personal');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  brandTokens,
  orgNameMatchesAdvertiser,
  scoreDomainCandidate,
  tokenOverlapRatio,
} from './domainScore.js';
import { normalizeDomain } from './types.js';

describe('domainScore', () => {
  it('extracts brand tokens without legal suffixes', () => {
    const tokens = brandTokens('Acme Robotics Inc');
    assert.ok(tokens.includes('acme'));
    assert.ok(tokens.includes('robotics'));
    assert.ok(!tokens.includes('inc'));
  });

  it('scores knowledge graph + brand domain as high', () => {
    const scored = scoreDomainCandidate('Acme Robotics', {
      domain: 'https://www.acmerobotics.com/about',
      source: 'knowledge_graph',
      title: 'Acme Robotics',
    });
    assert.equal(scored.domain, 'acmerobotics.com');
    assert.equal(scored.tier, 'high');
    assert.ok(scored.score >= 0.7);
  });

  it('scores organic #1 brand host as high', () => {
    const scored = scoreDomainCandidate('ConnectWise', {
      domain: 'https://www.connectwise.com/',
      source: 'organic',
      position: 1,
      title: 'ConnectWise | RMM & PSA Software',
      snippet: 'ConnectWise helps IT providers grow.',
    });
    assert.equal(scored.domain, 'connectwise.com');
    assert.equal(scored.tier, 'high');
    assert.ok(scored.score >= 0.7);
  });

  it('rejects generic domains via normalize', () => {
    assert.equal(normalizeDomain('https://lnkd.in/abc'), '');
    assert.equal(normalizeDomain('zoom.us'), '');
  });

  it('fuzzy matches org names', () => {
    assert.ok(orgNameMatchesAdvertiser('Acme Robotics Inc', 'Acme Robotics'));
    assert.ok(tokenOverlapRatio('Selective Wealth Management', 'Selective Wealth') >= 0.5);
    assert.equal(orgNameMatchesAdvertiser('Acme Robotics', 'Totally Unrelated LLC'), false);
  });
});

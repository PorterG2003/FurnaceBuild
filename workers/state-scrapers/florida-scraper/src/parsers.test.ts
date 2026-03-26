import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  filterFloridaOwnerPeople,
  parseFloridaEntityDetailHtml,
  parseFloridaSearchResultsHtml,
  pickBestFloridaSearchHit,
} from '@furnace/registry-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, '../../../../lib/foundry/registry-server/fixtures');

describe('Florida Sunbiz HTML parsers', () => {
  it('parses entity name search results', () => {
    const html = readFileSync(path.join(fixtures, 'sunbiz-search-results-sample.html'), 'utf8');
    const hits = parseFloridaSearchResultsHtml(html);
    assert.ok(hits.length >= 1);
    const row = hits.find((h) => h.entityName === 'BUY DESIGN LLC');
    assert.ok(row);
    assert.equal(row!.documentNumber, 'L07000048547');
    assert.match(row!.detailHref, /SearchResultDetail/);
    assert.ok(
      !row!.detailHref.includes('&amp;'),
      'detail href must decode &amp; to & for navigation',
    );
  });

  it('parses LLC detail and owner filter', () => {
    const html = readFileSync(path.join(fixtures, 'sunbiz-entity-detail-llc-sample.html'), 'utf8');
    const parsed = parseFloridaEntityDetailHtml(html);
    assert.ok(parsed);
    assert.ok(parsed!.documentNumber.includes('L07000048547'));
    assert.match(parsed!.entityName, /BUY DESIGN LLC/i);
    assert.ok(parsed!.people.length >= 2);
    const owners = filterFloridaOwnerPeople(parsed!);
    assert.ok(owners.length >= 1);
    assert.ok(owners.some((n) => /WIEGAND|BEACHY/i.test(n)));
  });

  it('parses corporation officer detail', () => {
    const html = readFileSync(path.join(fixtures, 'sunbiz-entity-detail-corp-sample.html'), 'utf8');
    const parsed = parseFloridaEntityDetailHtml(html);
    assert.ok(parsed);
    const owners = filterFloridaOwnerPeople(parsed!);
    assert.ok(owners.some((n) => /REECE|PETERSEN|DOWNEY/i.test(n)));
  });

  it('picks active BUY DESIGN LLC row', () => {
    const html = readFileSync(path.join(fixtures, 'sunbiz-search-results-sample.html'), 'utf8');
    const hits = parseFloridaSearchResultsHtml(html);
    const picked = pickBestFloridaSearchHit(hits, 'BUY DESIGN LLC');
    assert.ok(!picked.ambiguous && 'hit' in picked && picked.hit);
    assert.equal(picked.hit!.entityName, 'BUY DESIGN LLC');
  });
});

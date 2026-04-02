import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  compareToTesterRow,
  filterMemberPrincipals,
  ownerRowsForUtahDetail,
  parseEntityDetailHtml,
  parseSearchResultsHtml,
  pickBestSearchHit,
} from '@furnace/registry-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, '../../../../lib/foundry/registry-server/fixtures');

describe('Utah HTML parsers', () => {
  it('parses entity detail principals', () => {
    const html = readFileSync(path.join(fixtures, 'utah-entity-detail-sample.html'), 'utf8');
    const parsed = parseEntityDetailHtml(html);
    assert.ok(parsed);
    assert.ok(parsed!.entityNumber.includes('11672536'));
    assert.ok(parsed!.entityName.includes('365 HEATING'));
    assert.equal(parsed!.principals.length, 1);
    assert.equal(parsed!.principals[0].title, 'Member');
    assert.match(parsed!.principals[0].name, /TANNER.*Mc?MULLIN/i);
    const members = filterMemberPrincipals(parsed!.principals).map((p) => p.name.trim());
    assert.equal(members.length, 1);
    const rows = ownerRowsForUtahDetail(parsed!);
    assert.equal(rows[0].titleRole, 'Member');
  });

  it('parses search results grid', () => {
    const html = readFileSync(path.join(fixtures, 'utah-entity-search-results.html'), 'utf8');
    const hits = parseSearchResultsHtml(html);
    assert.ok(hits.length >= 1);
    const llc = hits.find((h) => h.entityName.includes('365 HEATING') && h.entityName.includes('AIR LLC'));
    assert.ok(llc);
    assert.equal(llc!.businessId, '11672536');
  });

  it('picks LLC over DBA for 365 HEATING query', () => {
    const html = readFileSync(path.join(fixtures, 'utah-entity-search-results.html'), 'utf8');
    const hits = parseSearchResultsHtml(html);
    const picked = pickBestSearchHit(hits, '365 HEATING & AIR LLC');
    assert.ok(!picked.ambiguous && 'hit' in picked && picked.hit);
    assert.match(picked.hit!.entityName, /AIR LLC/);
  });

  it('compareToTesterRow detects name overlap', () => {
    const r = compareToTesterRow(['TANNER WAYNE MCMULLIN'], 'Tanner Wayne McMullin');
    assert.ok(r.outcome === 'match' || r.outcome === 'partial');
  });
});

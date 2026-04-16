import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type IowaEntityDetailParsed,
  ownerRowsForIowaDetail,
  parseIowaEntityDetailHtml,
  parseIowaOfficersHtml,
  parseIowaSearchResultsHtml,
  parseIowaSummaryHtml,
  pickBestIowaSearchHit,
} from '@furnace/registry-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, '../../../../lib/foundry/registry-server/fixtures');

describe('Iowa SOS HTML parsers', () => {
  it('parses business search results grid', () => {
    const html = readFileSync(path.join(fixtures, 'iowa-business-search-results.html'), 'utf8');
    const hits = parseIowaSearchResultsHtml(html);
    assert.ok(hits.length >= 2);
    const llc = hits.find((h) => h.entityName.includes('PRAIRIE HOME SERVICES'));
    assert.ok(llc);
    assert.equal(llc!.businessNumber, '714000');
    assert.equal(llc!.nameType, 'L');
    assert.ok(llc!.summaryHref?.includes('summary.aspx'));
  });

  it('picks LLC legal row over DBA for PRAIRIE HOME query', () => {
    const html = readFileSync(path.join(fixtures, 'iowa-business-search-results.html'), 'utf8');
    const hits = parseIowaSearchResultsHtml(html);
    const picked = pickBestIowaSearchHit(hits, 'PRAIRIE HOME SERVICES LLC');
    assert.ok(!picked.ambiguous && 'hit' in picked && picked.hit);
    assert.match(picked.hit!.entityName, /SERVICES LLC/);
    assert.equal(picked.hit!.nameType, 'L');
  });

  it('parses summary page fields', () => {
    const html = readFileSync(path.join(fixtures, 'iowa-entity-summary-sample.html'), 'utf8');
    const s = parseIowaSummaryHtml(html);
    assert.ok(s);
    assert.equal(s!.businessNumber, '714000');
    assert.match(s!.legalName ?? '', /PRAIRIE HOME SERVICES LLC/);
    assert.equal(s!.status, 'Active');
    assert.ok((s!.entityType ?? '').includes('Limited Liability Company'));
    assert.ok((s!.chapter ?? '').includes('489'));
    assert.ok((s!.registeredAgentName ?? '').includes('REGISTERED AGENTS'));
    assert.ok((s!.principalOfficeLine ?? '').includes('CEDAR RAPIDS'));
  });

  it('parses live-shaped summary (th row then td row)', () => {
    const html = `
      <html><body><table><tbody>
        <tr><th>Business No.</th><th>Legal Name</th><th>Status</th></tr>
        <tr><td>612002</td><td>ADAM BUILDERS LLC</td><td>Active</td></tr>
      </tbody></table></body></html>`;
    const s = parseIowaSummaryHtml(html);
    assert.ok(s);
    assert.equal(s!.businessNumber, '612002');
    assert.equal(s!.legalName, 'ADAM BUILDERS LLC');
    assert.equal(s!.status, 'Active');
  });

  it('parses officers grid and owner rows', () => {
    const officersHtml = readFileSync(path.join(fixtures, 'iowa-entity-officers-sample.html'), 'utf8');
    const rows = parseIowaOfficersHtml(officersHtml);
    assert.equal(rows.length, 2);
    assert.match(rows[0]!.name, /JORDAN K MICHAELS/i);
    assert.equal(rows[0]!.officerType, 'Member');
    const summaryHtml = readFileSync(path.join(fixtures, 'iowa-entity-summary-sample.html'), 'utf8');
    const detail = parseIowaEntityDetailHtml(summaryHtml, officersHtml);
    assert.ok(detail);
    assert.equal(detail!.officers.length, 2);
    const owners = ownerRowsForIowaDetail(detail!);
    assert.ok(owners.some((o) => /RIVERA/i.test(o.ownerName) && (o.titleRole ?? '').includes('Director')));
    assert.ok(owners.some((o) => /MICHAELS/i.test(o.ownerName)));
  });

  it('uses individual registered agent when officer list is empty', () => {
    const detail: IowaEntityDetailParsed = {
      businessNumber: '999',
      legalName: 'EXAMPLE LLC',
      officers: [],
      registeredAgentName: 'Sarah Jane Martinez',
    };
    const owners = ownerRowsForIowaDetail(detail);
    assert.equal(owners.length, 1);
    assert.equal(owners[0]!.ownerName, 'Sarah Jane Martinez');
    assert.equal(owners[0]!.titleRole, 'Registered Agent');
  });

  it('does not use corporate registered agent as owner fallback', () => {
    const detail: IowaEntityDetailParsed = {
      businessNumber: '999',
      legalName: 'EXAMPLE LLC',
      officers: [],
      registeredAgentName: 'C T CORPORATION SYSTEM',
    };
    assert.equal(ownerRowsForIowaDetail(detail).length, 0);
  });
});

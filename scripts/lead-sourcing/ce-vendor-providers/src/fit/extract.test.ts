import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from '../lib/env.js';
import { htmlToText } from '../lib/html.js';
import { detectIsFree } from './isFree.js';
import { detectRegistration } from './registrationHost.js';
import { detectFormalGrantProgram } from './grantProgram.js';
import { detectCeFormatFromHtml } from './ceFormat.js';
import { extractGrant, extractHost, splitSponsorString } from './extract.js';

function load(rel: string): string {
  return readFileSync(join(fixturesDir, rel), 'utf8');
}

describe('fit fields', () => {
  it('detects own-domain free registration', () => {
    const html = load('homepages/acme-windows-ce.html');
    const reg = detectRegistration(html, 'https://acmewindows.example/ce', 'https://acmewindows.example/');
    assert.equal(reg.registration_kind, 'own_domain');
    assert.equal(reg.registration_host_domain, 'acmewindows.example');
    assert.equal(detectIsFree(htmlToText(html)), true);
    assert.equal(detectCeFormatFromHtml(html).has_live_online, true);
  });

  it('detects Eventbrite as third-party registration', () => {
    const html = load('homepages/carebridge-ce.html');
    const reg = detectRegistration(html, 'https://carebridge.example/ce', 'https://carebridge.example/');
    assert.equal(reg.registration_kind, 'third_party');
    assert.ok(reg.registration_host_domain.includes('eventbrite.com'));
  });

  it('treats AEC Daily as third-party even when it is the listed URL', () => {
    const reg = detectRegistration(
      '<html><body>Courses</body></html>',
      'https://www.aecdaily.com/s/3m',
      'https://www.aecdaily.com/s/3m',
    );
    assert.equal(reg.registration_kind, 'third_party');
    assert.equal(reg.registration_host_domain, 'aecdaily.com');
  });

  it('treats CE Strong as a third-party CE platform', () => {
    const reg = detectRegistration(
      '<html><body>Online Courses Archive</body></html>',
      'https://www.cestrong.com/courses/',
      'https://www.cestrong.com/avery-dennison',
    );
    assert.equal(reg.registration_kind, 'third_party');
    assert.equal(reg.registration_host_domain, 'cestrong.com');
  });

  it('does not use search-results or wp-json as registration', () => {
    const html = `
      <html><body>
        <a href="https://greengirt.com/search-results/">Search</a>
        <form action="https://www.xypex.com/contenthub/wp-json/ws-form/v1/submit"></form>
        <a href="https://greengirt.com/education/register">Register</a>
      </body></html>`;
    const reg = detectRegistration(html, 'https://greengirt.com/education', 'https://greengirt.com/');
    assert.equal(reg.registration_url, 'https://greengirt.com/education/register');
  });

  it('detects paid tuition copy', () => {
    const html = load('homepages/cpe-institute.html');
    assert.equal(detectIsFree(htmlToText(html)), false);
  });

  it('extracts host language and rejects faculty COI', () => {
    const hostHtml = load('pages/host-therapymatch.html');
    const coiHtml = load('pages/faculty-coi.html');
    const host = extractHost(htmlToText(hostHtml));
    const coiHost = extractHost(htmlToText(coiHtml));
    const coiGrant = extractGrant(htmlToText(coiHtml));
    assert.equal(host?.coiRejected, false);
    assert.match(host?.host ?? '', /TherapyMatch/i);
    assert.equal(coiHost?.coiRejected ?? true, true);
    assert.equal(coiGrant, null);
  });

  it('extracts grant sponsors and keeps Eli Lilly and Company intact', () => {
    const html = load('pages/grant-novo-activity.html');
    const extracted = extractGrant(htmlToText(html));
    assert.ok(extracted && !extracted.coiRejected);
    assert.match(extracted.sponsorsRaw, /Novo Nordisk/i);
    const split = splitSponsorString('Genentech, AstraZeneca, and Eli Lilly and Company');
    assert.deepEqual(split.names, ['Genentech', 'AstraZeneca', 'Eli Lilly and Company']);
    assert.deepEqual(splitSponsorString('Johnson & Johnson').names, ['Johnson & Johnson']);
  });

  it('flags formal grant program pages', () => {
    assert.equal(detectFormalGrantProgram(htmlToText(load('pages/novo-grant-portal.html'))), true);
    assert.equal(detectFormalGrantProgram(htmlToText(load('pages/grant-midmarket-activity.html'))), false);
  });
});

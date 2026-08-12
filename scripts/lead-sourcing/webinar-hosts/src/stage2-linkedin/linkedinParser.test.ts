import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fixturesDir } from '../lib/env.js';
import {
  classifyAuthorName,
  entityTypeFromProfileUrl,
  extractRegistrationUrls,
  parseLinkedInPostHtml,
  parseLinkedInProfileHtml,
  resolveEntityType,
} from './linkedinParser.js';

describe('linkedinParser', () => {
  it('detects entity type from profile url', () => {
    assert.equal(entityTypeFromProfileUrl('https://www.linkedin.com/company/acme'), 'company');
    assert.equal(entityTypeFromProfileUrl('https://www.linkedin.com/in/jane'), 'person');
  });

  it('classifies author names', () => {
    assert.equal(classifyAuthorName('Jane Doe'), 'person');
    assert.equal(classifyAuthorName('Acme Corp'), 'company');
    assert.equal(classifyAuthorName('Acme LLC'), 'company');
  });

  it('extracts registration urls', () => {
    const urls = extractRegistrationUrls('Register at https://zoom.us/j/123 and https://lu.ma/event');
    assert.ok(urls.some((u) => u.includes('zoom.us')));
    assert.ok(urls.some((u) => u.includes('lu.ma')));
    const lnkd = extractRegistrationUrls('Register here: https://lnkd.in/eKFHEbgU');
    assert.ok(lnkd.some((u) => u.includes('lnkd.in/eKFHEbgU')));
  });

  it('parses company fixture html', () => {
    const html = readFileSync(join(fixturesDir, 'linkedin/post-company.html'), 'utf8');
    const parsed = parseLinkedInPostHtml(html);
    assert.equal(parsed.extraction_status, 'ok');
    assert.equal(parsed.entity_type, 'company');
    assert.ok(parsed.registration_urls.some((u) => u.includes('zoom.us')));
    assert.equal(resolveEntityType(parsed.author_profile_url, parsed.author_name), 'company');
  });

  it('parses blocked fixture html', () => {
    const html = readFileSync(join(fixturesDir, 'linkedin/post-blocked.html'), 'utf8');
    const parsed = parseLinkedInPostHtml(html);
    assert.equal(parsed.extraction_status, 'blocked');
  });

  it('parses og metadata on guest pages with join linkedin banner', () => {
    const html = `<!DOCTYPE html><html><head>
      <meta property="og:title" content="Register for our Webinar | Lizzie Beecroft" />
      <meta property="og:description" content="Join us for a live panel on presenting." />
      <meta property="og:see_also" content="https://www.linkedin.com/in/lizzie-beecroft" />
    </head><body><h1>Join LinkedIn</h1></body></html>`;
    const parsed = parseLinkedInPostHtml(html);
    assert.equal(parsed.extraction_status, 'ok');
    assert.equal(parsed.author_name, 'Lizzie Beecroft');
    assert.ok(parsed.post_text.includes('live panel'));
    assert.equal(parsed.entity_type, 'person');
    assert.equal(parsed.extraction_error, 'login_wall_meta_only');
  });

  it('parses json-ld author profile and lnkd.in registration links', () => {
    const html = `<!DOCTYPE html><html><head>
      <meta property="og:title" content="Register for our Webinar | Lizzie Beecroft" />
      <meta property="og:url" content="https://www.linkedin.com/posts/lizzie-beecroft-a741a8388_register-for-our-webinar-activity-1-Livk" />
      <script type="application/ld+json">
        {"@type":"SocialMediaPosting","articleBody":"Panel on June 30","datePublished":"2026-06-18T06:32:14.237Z","author":{"name":"Lizzie Beecroft","url":"https://uk.linkedin.com/in/lizzie-beecroft-a741a8388","@type":"Person"},"sharedContent":{"headline":"Register: https://lnkd.in/eKFHEbgU","author":{"name":"slideAcross","url":"https://www.linkedin.com/showcase/slideacross/"}}}
      </script>
    </head><body><h1>Join LinkedIn</h1></body></html>`;
    const parsed = parseLinkedInPostHtml(html);
    assert.equal(parsed.extraction_status, 'ok');
    assert.equal(parsed.author_profile_url, 'https://www.linkedin.com/in/lizzie-beecroft-a741a8388');
    assert.ok(parsed.registration_urls.some((u) => u.includes('lnkd.in/eKFHEbgU')));
    assert.equal(parsed.posted_at, '2026-06-18T06:32:14.237Z');
  });

  it('parses profile html for employer name and company url', () => {
    const html = readFileSync(join(fixturesDir, 'linkedin/profile-jane-doe-12345.html'), 'utf8');
    const parsed = parseLinkedInProfileHtml(html);
    assert.equal(parsed.employer_name, 'GrowthCo');
    assert.equal(parsed.employer_linkedin_url, 'https://www.linkedin.com/company/growthco');
  });
});

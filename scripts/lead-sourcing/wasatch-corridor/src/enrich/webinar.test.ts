import assert from 'node:assert/strict';
import test from 'node:test';
import { heuristicWebinar } from './webinar.js';
import type { CrawledSite } from './crawl.js';

const homepage =
  'Acme builds jobsite software for construction companies. Our engineers ship weekly. Contact sales. Register for a demo.';

function site(pages: CrawledSite['pages']): CrawledSite {
  return { company_id: 'dom:acme.test', homepage: 'https://acme.test', pages, live_site: true };
}

function page(path: string, text: string, html = `<body>${text}</body>`): CrawledSite['pages'][number] {
  return { url: `https://acme.test${path === '/' ? '' : path}`, path, status: 200, text, html };
}

test('SPA 200 on /webinar with no webinar copy does not count', () => {
  const result = heuristicWebinar(
    site([
      page('/', homepage),
      page('/webinar', homepage),
      page('/webinars', homepage),
      page('/events', homepage),
      page('/resources', homepage),
      page('/training', homepage),
      page('/live', homepage),
    ]),
  );
  assert.equal(result.runs_webinars, 0);
  assert.deepEqual(result.webinar_pages, []);
  assert.equal(result.audience_is_ce_profession, false);
  assert.equal(result.ce_profession, '');
});

test('homepage engineers copy is not a CE profession without a real webinar page', () => {
  const result = heuristicWebinar(site([page('/', 'We hire engineers and accountants. Book a demo.')]));
  assert.equal(result.runs_webinars, 0);
  assert.equal(result.audience_is_ce_profession, false);
});

test('real webinar page with registration still scores', () => {
  const copy =
    'Live CE webinar for licensed mental health therapists. Register to save your seat. Join us live on Zoom Webinars. March 12, 2026';
  const result = heuristicWebinar(
    site([
      page('/', 'Wasatch CE Institute. Continuing education.'),
      page('/webinars', copy, `<form><input type="email" /></form><p>${copy}</p>`),
    ]),
  );
  assert.ok(result.runs_webinars >= 0.6);
  assert.deepEqual(result.webinar_pages, ['/webinars']);
  assert.equal(result.has_registration_page, true);
  assert.equal(result.audience_is_ce_profession, true);
  assert.equal(result.webinar_platform.toLowerCase().includes('zoom') || result.webinar_platform.length > 0, true);
});

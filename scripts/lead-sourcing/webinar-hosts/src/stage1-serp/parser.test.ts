import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeStage1Rows,
  extractLinkedInActivityId,
  extractSlugHint,
  filterAndMapSerpResults,
  isLinkedInPostUrl,
  normalizeLinkedInUrl,
  toCanonicalLinkedInPostUrl,
} from './parser.js';

describe('stage1 parser', () => {
  it('filters non-linkedin post urls', () => {
    assert.equal(
      isLinkedInPostUrl(
        'https://www.linkedin.com/posts/acme-corp_register-for-our-webinar-activity-1234567890-abcd',
      ),
      true,
    );
    assert.equal(isLinkedInPostUrl('https://www.linkedin.com/posts/foo'), false);
    assert.equal(
      isLinkedInPostUrl('https://www.linkedin.com/feed/update/urn:li:activity:1234567890/'),
      true,
    );
    assert.equal(isLinkedInPostUrl('https://example.com/posts/foo'), false);
  });

  it('normalizes to canonical feed/update urls', () => {
    const slugUrl =
      'https://www.linkedin.com/posts/lizzie-beecroft-a741a8388_register-for-our-webinar-activity-7473261274219565056-Livk?utm=1';
    assert.equal(
      toCanonicalLinkedInPostUrl(slugUrl),
      'https://www.linkedin.com/feed/update/urn:li:activity:7473261274219565056/',
    );
    assert.equal(extractLinkedInActivityId(slugUrl), '7473261274219565056');
  });

  it('extracts slug hint', () => {
    const url =
      'https://www.linkedin.com/posts/acme-corp_register-for-our-webinar-activity-1234567890-abcd';
    assert.equal(extractSlugHint(url), 'acme corp register for our webinar');
  });

  it('dedupes and merges also_matched_queries', () => {
    const rows = dedupeStage1Rows([
      {
        result_url: 'https://www.linkedin.com/posts/acme-corp_post-activity-1',
        result_title: 'A',
        result_snippet: '',
        search_query: 'query-a',
        serp_position: '1',
        serp_page: '1',
        collected_at: 't',
        slug_hint: 'acme',
        also_matched_queries: '',
      },
      {
        result_url: 'https://www.linkedin.com/posts/acme-corp_post-activity-1',
        result_title: 'A',
        result_snippet: '',
        search_query: 'query-b',
        serp_position: '2',
        serp_page: '1',
        collected_at: 't',
        slug_hint: 'acme',
        also_matched_queries: '',
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.also_matched_queries, 'query-b');
  });

  it('maps serp results', () => {
    const mapped = filterAndMapSerpResults([
      {
        url: 'https://www.linkedin.com/posts/acme-corp_post-activity-1?utm=1',
        title: 'Title',
        snippet: 'Snippet',
        searchQuery: 'q',
        serpPosition: 1,
        serpPage: 1,
        collectedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    assert.equal(mapped.length, 1);
    assert.equal(normalizeLinkedInUrl(mapped[0]!.result_url).includes('utm='), false);
  });
});

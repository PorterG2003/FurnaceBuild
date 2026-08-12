import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serperSearch, serperSearchAllPagesForQuery } from './serperClient.js';

describe('serperClient', () => {
  it('loads organic results from fixture', async () => {
    const response = await serperSearch({
      query: 'webinar site:linkedin.com/posts',
      page: 1,
      timeFilter: 'qdr:m',
      useFixtures: true,
    });
    assert.ok((response.organic?.length ?? 0) >= 3);
    assert.ok(response.organic?.some((r) => r.link?.includes('linkedin.com/posts/')));
  });

  it('paginates until a partial page in fixture mode', async () => {
    const pages: number[] = [];
    await serperSearchAllPagesForQuery({
      query: 'webinar site:linkedin.com/posts',
      timeFilter: 'qdr:m',
      useFixtures: true,
      onPage: async (serpPage) => {
        pages.push(serpPage);
      },
    });
    assert.deepEqual(pages, [1]);
  });

  it('shouldStop breaks pagination early', async () => {
    const pages: number[] = [];
    await serperSearchAllPagesForQuery({
      query: 'webinar site:linkedin.com/posts',
      timeFilter: 'qdr:m',
      useFixtures: true,
      shouldStop: () => pages.length >= 1,
      onPage: async (serpPage) => {
        pages.push(serpPage);
      },
    });
    assert.deepEqual(pages, [1]);
  });

  it('filters linkedin post urls from serper fixture', async () => {
    const response = await serperSearch({
      query: 'test',
      page: 1,
      timeFilter: 'qdr:m',
      useFixtures: true,
    });
    const linkedin = (response.organic ?? []).filter((r) => r.link?.includes('linkedin.com/posts/'));
    assert.ok(linkedin.length >= 2);
  });
});

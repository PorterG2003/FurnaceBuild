import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTopicsToRows,
  buildPostTextByActivityId,
  linkedInActivityId,
  withTopicsOutputPath,
} from './backfillSalesTopics.js';

describe('backfillSalesTopics helpers', () => {
  it('parses LinkedIn activity ids from feed and posts urls', () => {
    assert.equal(
      linkedInActivityId('https://www.linkedin.com/feed/update/urn:li:activity:7464730507591864320/'),
      '7464730507591864320',
    );
    assert.equal(
      linkedInActivityId(
        'https://www.linkedin.com/posts/joesanfelippo_leadfromwhoyouare-activity-7480274599557885952-1-bK',
      ),
      '7480274599557885952',
    );
    assert.equal(linkedInActivityId(''), null);
    assert.equal(linkedInActivityId('https://example.com'), null);
  });

  it('builds activityId -> post_text map from stage2 rows', () => {
    const map = buildPostTextByActivityId([
      {
        result_url: 'https://www.linkedin.com/feed/update/urn:li:activity:111/',
        post_text: 'first',
      },
      {
        result_url: 'https://www.linkedin.com/feed/update/urn:li:activity:111/',
        post_text: 'duplicate ignored',
      },
      {
        result_url: 'https://www.linkedin.com/feed/update/urn:li:activity:222/',
        post_text: '  ',
      },
      {
        result_url: 'https://www.linkedin.com/feed/update/urn:li:activity:333/',
        post_text: 'third',
      },
    ]);

    assert.equal(map.size, 2);
    assert.equal(map.get('111'), 'first');
    assert.equal(map.get('333'), 'third');
    assert.equal(map.has('222'), false);
  });

  it('applies topics onto sales rows and reports merge summary', () => {
    const { rows, summary } = applyTopicsToRows(
      [
        {
          company_name: 'A',
          sample_post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:111/',
          webinar_topic: '',
        },
        {
          company_name: 'B',
          sample_post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:222/',
          webinar_topic: '',
        },
        {
          company_name: 'C',
          sample_post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:999/',
          webinar_topic: '',
        },
        {
          company_name: 'D',
          sample_post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:333/',
          webinar_topic: '',
        },
      ],
      new Map([
        ['111', 'Unlocking Webinar Success with Data Analytics'],
        ['222', ''],
        ['333', 'How to Upskill This Summer'],
      ]),
    );

    assert.equal(rows[0]!.webinar_topic, 'Unlocking Webinar Success with Data Analytics');
    assert.equal(rows[1]!.webinar_topic, '');
    assert.equal(rows[2]!.webinar_topic, '');
    assert.equal(rows[3]!.webinar_topic, 'How to Upskill This Summer');
    assert.deepEqual(summary, {
      rows: 4,
      filled: 2,
      skippedNoText: 1,
      skippedEmptyTopic: 1,
      errors: 0,
    });
  });

  it('derives -with-topics output path', () => {
    assert.equal(
      withTopicsOutputPath('/tmp/meta-ads-full-yes-only-2026-07-15.csv'),
      '/tmp/meta-ads-full-yes-only-2026-07-15-with-topics.csv',
    );
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  competitorExamplesAreSingleAdvertiser,
  extractGoogleAdsAdvertiserId,
  filterExamplesToAdvertiser,
  getCompetitorAdAuditConsistencyIssues,
  getCompetitorRowAdvertiserIds,
} from './fluxCompetitorAuditAdvertiser.js';

test('extractGoogleAdsAdvertiserId parses advertiser ids from transparency urls', () => {
  assert.equal(
    extractGoogleAdsAdvertiserId(
      'https://adstransparency.google.com/advertiser/AR11550926466527002625/creative/CR06891629215205031937?region=US',
    ),
    'AR11550926466527002625',
  );
});

test('getCompetitorRowAdvertiserIds returns unique advertiser ids in encounter order', () => {
  const ids = getCompetitorRowAdvertiserIds([
    { sourceUrl: 'https://adstransparency.google.com/advertiser/AR1ABCDEFGH/creative/CR1?region=US' },
    { sourceUrl: 'https://adstransparency.google.com/advertiser/AR2ABCDEFGH/creative/CR2?region=US' },
    { sourceUrl: 'https://adstransparency.google.com/advertiser/AR1ABCDEFGH/creative/CR3?region=US' },
  ]);
  assert.deepEqual(ids, ['AR1ABCDEFGH', 'AR2ABCDEFGH']);
});

test('competitorExamplesAreSingleAdvertiser returns false for prod-like mixed advertiser rows', () => {
  assert.equal(
    competitorExamplesAreSingleAdvertiser([
      {
        sourceUrl:
          'https://adstransparency.google.com/advertiser/AR11550926466527002625/creative/CR06891629215205031937?region=US',
      },
      {
        sourceUrl:
          'https://adstransparency.google.com/advertiser/AR00365012073437986817/creative/CR08847700258315042817?region=US',
      },
    ]),
    false,
  );
});

test('filterExamplesToAdvertiser keeps only the selected advertiser cluster', () => {
  const examples = [
    {
      headline: 'A',
      sourceUrl:
        'https://adstransparency.google.com/advertiser/AR08607200154371489793/creative/CR09252723482578386945?region=US',
    },
    {
      headline: 'B',
      sourceUrl:
        'https://adstransparency.google.com/advertiser/AR04171424726394077185/creative/CR09070879540837875713?region=US',
    },
    {
      headline: 'C',
      sourceUrl:
        'https://adstransparency.google.com/advertiser/AR08607200154371489793/creative/CR05046974159238725633?region=US',
    },
  ];

  assert.deepEqual(
    filterExamplesToAdvertiser(examples, 'AR08607200154371489793').map((example) => example.headline),
    ['A', 'C'],
  );
});

test('getCompetitorAdAuditConsistencyIssues reports mixed rows and duplicate advertiser rows', () => {
  const issues = getCompetitorAdAuditConsistencyIssues([
    {
      name: 'Anytime Fitness',
      examples: [
        {
          sourceUrl:
            'https://adstransparency.google.com/advertiser/AR11550926466527002625/creative/CR06891629215205031937?region=US',
        },
        {
          sourceUrl:
            'https://adstransparency.google.com/advertiser/AR00365012073437986817/creative/CR08847700258315042817?region=US',
        },
      ],
    },
    {
      name: 'VASA Fitness',
      examples: [
        {
          sourceUrl:
            'https://adstransparency.google.com/advertiser/AR05044827027778043905/creative/CR14151655565142523905?region=US',
        },
      ],
    },
    {
      name: 'VASA Fitness Duplicate',
      examples: [
        {
          sourceUrl:
            'https://adstransparency.google.com/advertiser/AR05044827027778043905/creative/CR18115521951098208257?region=US',
        },
      ],
    },
  ]);

  assert.equal(issues.length, 2);
  assert.match(issues[0]!, /mix advertiser IDs/);
  assert.match(issues[1]!, /shares advertiser ID AR05044827027778043905/);
});

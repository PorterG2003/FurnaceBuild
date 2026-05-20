import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublishedCompetitorExamples } from './fluxCompetitorAuditPublish.js';

test('buildPublishedCompetitorExamples keeps single-advertiser samples', () => {
  const published = buildPublishedCompetitorExamples({
    domain: 'anytimefitness.com',
    maxExamples: 2,
    selectedAdvertiserId: 'AR08607200154371489793',
    samples: [
      {
        headline: 'Self Esteem Brands, LLC',
        body: 'Ad funded by: ROR Partners info',
        sourceUrl:
          'https://adstransparency.google.com/advertiser/AR08607200154371489793/creative/CR09252723482578386945?region=US',
      },
      {
        headline: 'Self Esteem Brands, LLC',
        body: 'View the full creative on Google Ads Transparency (link below).',
        sourceUrl:
          'https://adstransparency.google.com/advertiser/AR08607200154371489793/creative/CR05046974159238725633?region=US',
      },
    ],
  });

  assert.equal(published.selectedAdvertiserId, 'AR08607200154371489793');
  assert.equal(published.examples.length, 2);
});

test('buildPublishedCompetitorExamples rejects mixed advertiser samples', () => {
  assert.throws(
    () =>
      buildPublishedCompetitorExamples({
        domain: 'anytimefitness.com',
        maxExamples: 2,
        selectedAdvertiserId: 'AR11550926466527002625',
        samples: [
          {
            headline: 'Jerome Dean',
            body: 'Ad funded by: jerome dean info',
            sourceUrl:
              'https://adstransparency.google.com/advertiser/AR11550926466527002625/creative/CR06891629215205031937?region=US',
          },
          {
            headline: 'Hype Consulting LLC',
            body: 'View the full creative on Google Ads Transparency (link below).',
            sourceUrl:
              'https://adstransparency.google.com/advertiser/AR00365012073437986817/creative/CR08847700258315042817?region=US',
          },
        ],
      }),
    /Mixed advertiser samples/,
  );
});

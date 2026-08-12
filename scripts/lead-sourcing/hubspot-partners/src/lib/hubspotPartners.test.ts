import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSearchFilter,
  buildSearchRequest,
  labelMapsFromFilterConfigs,
} from './hubspotClient.ts';
import { cardToSearchRow, mergeDetail } from './mapRows.ts';
import { unwrapChirpValue } from './unwrap.ts';
import type { LabelMaps, PartnerDetail, SearchCard } from './types.ts';

describe('buildSearchFilter', () => {
  it('uses SOLUTIONS_PARTNER_PROFILE and LONG accreditation id', () => {
    const filter = buildSearchFilter(43003);
    const fields = filter.filterGroups[0].filtersByField;
    assert.deepEqual(fields.PRODUCT_TYPE[0].values, ['SOLUTIONS_PARTNER_PROFILE']);
    assert.equal(
      fields.PRODUCT_TYPE[0].__typename,
      'com.hubspot.marketplace.search.models.filters.StringFilterQuery',
    );
    assert.deepEqual(fields.PROFILE_ACCREDITATIONS[0].values, [43003]);
    assert.equal(
      fields.PROFILE_ACCREDITATIONS[0].__typename,
      'com.hubspot.marketplace.search.models.filters.LongFilterQuery',
    );
  });
});

describe('buildSearchRequest', () => {
  it('includes offset/length and empty sorts', () => {
    const req = buildSearchRequest({ accreditationId: 43003, offset: 50, length: 25 });
    assert.equal(req.offset, 50);
    assert.equal(req.length, 25);
    assert.deepEqual(req.sorts, []);
    assert.equal(req.language, 'en');
  });
});

describe('unwrapChirpValue', () => {
  it('unwraps nested MapFieldValue wrappers', () => {
    const wrapped = {
      __typename: 'com.hubspot.chirp.ext.models.MapFieldValue',
      '@type': 'map',
      value: {
        companyUrl: {
          __typename: 'StringField',
          value: 'https://example.com',
        },
        services: {
          value: [5, 1],
          __typename: 'ListField',
        },
      },
    };
    const plain = unwrapChirpValue(wrapped) as PartnerDetail;
    assert.equal(plain.companyUrl, 'https://example.com');
    assert.deepEqual(plain.services, [5, 1]);
  });
});

describe('cardToSearchRow + mergeDetail', () => {
  const labels: LabelMaps = {
    services: { '5': 'CRM Implementation', '1': 'Branding' },
    industries: { TECHNOLOGY_SOFTWARE: 'Technology/software' },
    budgets: { UPPER: '$5,000+' },
    certifications: {},
    accreditations: { '43003': 'CRM Implementation' },
    tiers: { elite: 'Elite' },
  };

  const card: SearchCard = {
    listingId: 1,
    listingName: 'Acme Partner',
    companyName: 'Acme Partner',
    providerName: 'Acme',
    description: 'We implement HubSpot',
    iconUrl: 'https://cdn.example/logo.png',
    slug: 'acme-partner',
    products: [{ partnerTier: 'elite', partnerType: 'partner' }],
    reviewSummary: {
      overallRating: 4.9,
      overallAdjustedRating: 4.8,
      reviewCount: 12,
    },
  };

  it('maps search card fields and profile url', () => {
    const row = cardToSearchRow(card, {
      accreditationId: 43003,
      accreditationName: 'CRM Implementation',
      scrapedAt: '2026-07-26T00:00:00.000Z',
    });
    assert.equal(row.slug, 'acme-partner');
    assert.equal(
      row.profile_url,
      'https://ecosystem.hubspot.com/marketplace/solutions/acme-partner',
    );
    assert.equal(row.partner_tier, 'elite');
    assert.equal(row.overall_rating, '4.9');
    assert.equal(row.review_count, '12');
  });

  it('merges detail firmographics and label maps', () => {
    const searchRow = cardToSearchRow(card, {
      accreditationId: 43003,
      accreditationName: 'CRM Implementation',
      scrapedAt: '2026-07-26T00:00:00.000Z',
    });
    const detail: PartnerDetail = {
      companyUrl: 'https://acme.example',
      languages: ['en'],
      services: [5, 1],
      industryChoice: ['TECHNOLOGY_SOFTWARE'],
      budgetChoice: ['UPPER'],
      regionChoice: ['NORTH_AMERICA'],
      officeLocation: ['REMOTE'],
      remoteLocations: [
        { remoteLocation: { full: 'Austin, TX, USA', locality: 'Austin', state: 'TX', country: 'US' } },
      ],
      companySizeSpecialty: ['RANGE_51_200'],
      sourceId: '99',
      listingVersionId: 123,
    };
    const enriched = mergeDetail(searchRow, detail, labels, {
      detail_status: 'ok',
      detail_error: '',
    });
    assert.equal(enriched.website, 'https://acme.example');
    assert.equal(enriched.service_names, 'CRM Implementation; Branding');
    assert.equal(enriched.industries, 'Technology/software');
    assert.equal(enriched.budget, '$5,000+');
    assert.equal(enriched.locations, 'Austin, TX, USA');
    assert.equal(enriched.detail_status, 'ok');
  });
});

describe('labelMapsFromFilterConfigs', () => {
  it('flattens options into value->text maps', () => {
    const maps = labelMapsFromFilterConfigs({
      PROFILE_CATALOG_SERVICES: {
        options: [{ value: '5', text: 'CRM Implementation' }],
      },
      PROFILE_INDUSTRIES: {
        options: [{ value: 'TECHNOLOGY_SOFTWARE', text: 'Technology/software' }],
      },
      PROFILE_BUDGET: { options: [{ value: 'UPPER', text: '$5,000+' }] },
      PROFILE_CERTIFICATIONS: { options: [] },
      PROFILE_ACCREDITATIONS: {
        options: [{ value: 43003, text: 'CRM Implementation' }],
      },
      PROFILE_SOLUTIONS_PARTNER_TIER: {
        options: [{ value: 'elite', text: 'Elite' }],
      },
    });
    assert.equal(maps.services['5'], 'CRM Implementation');
    assert.equal(maps.accreditations['43003'], 'CRM Implementation');
  });
});

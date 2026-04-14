import type { CsvBuilderToolJobConfig } from '../../registry-types.js';
import {
  canonicalizeWebsiteUrl,
  type WebsiteVerificationBundle,
  type WebsiteVerificationCrawlResult,
  type WebsiteVerificationScoredResult,
} from '../websiteVerification.js';

function asString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function buildCsvBuilderWebsiteVerificationBundle(
  rowValues: Record<string, unknown>,
  _config: CsvBuilderToolJobConfig,
  rowId: string,
): WebsiteVerificationBundle {
  const legalName = asString(rowValues.company_name) ?? '';
  const website = asString(rowValues.website);
  const phone = asString(rowValues.phone);
  const city = asString(rowValues.city);
  const state = asString(rowValues.state);
  return {
    company_id: `csv-builder-row:${rowId}`,
    legal_name: legalName,
    normalized_key: legalName ? legalName.toLowerCase().replace(/[^a-z0-9]+/g, '') : null,
    notes: 'csv_builder_row',
    locations: city || state
      ? [
          {
            id: `csv-builder-location:${rowId}`,
            line1: null,
            line2: null,
            city,
            state_region: state,
            postal_code: null,
            country: 'US',
            is_primary: true,
          },
        ]
      : [],
    source_records: [
      {
        source_business_record_id: `csv-builder-source:${rowId}`,
        link_status: 'linked',
        link_score: 1,
        website,
        phone,
        address_raw: [city, state].filter(Boolean).join(', ') || null,
        line1: null,
        city,
        state_region: state,
        postal_code: null,
        categories: [],
        raw_payload: {},
        resolution_meta: {},
      },
    ],
    registry_entities: [],
    owners: [],
  };
}

export function pickCsvBuilderWebsiteInputUrl(
  rowValues: Record<string, unknown>,
  _config: CsvBuilderToolJobConfig,
): string | null {
  return canonicalizeWebsiteUrl(asString(rowValues.website));
}

export function summarizeCsvBuilderWebsiteVerificationResult(
  crawl: WebsiteVerificationCrawlResult,
  scored: WebsiteVerificationScoredResult,
): string {
  const finalUrl = crawl.final_url ?? crawl.input_url;
  return `${scored.band.replace(/_/g, ' ')} (${scored.score}) at ${finalUrl}`;
}

export function buildCsvBuilderWebsiteVerificationRowResult(args: {
  crawl: WebsiteVerificationCrawlResult;
  scored: WebsiteVerificationScoredResult;
}): Record<string, unknown> {
  return {
    band: args.scored.band,
    score: args.scored.score,
    input_url: args.crawl.input_url,
    final_url: args.crawl.final_url,
    reason_summary: summarizeCsvBuilderWebsiteVerificationResult(args.crawl, args.scored),
    signals: args.scored.signals,
    crawl_stats: args.scored.crawl_stats,
  };
}

export function buildCsvBuilderWebsiteVerificationErrorResult(
  inputUrl: string | null,
  message: string,
): Record<string, unknown> {
  return {
    band: null,
    score: null,
    input_url: inputUrl,
    final_url: null,
    reason_summary: message,
    error: message,
    signals: {},
    crawl_stats: { pages_visited: 0, max_depth_reached: 0 },
  };
}

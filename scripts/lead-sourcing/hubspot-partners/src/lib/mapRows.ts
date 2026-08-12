import type {
  LabelMaps,
  PartnerDetail,
  PartnerEnrichedRow,
  PartnerSearchRow,
  SearchCard,
} from './types.ts';
import {
  DEFAULT_ACCREDITATION_NAME,
  PROFILE_URL_BASE,
} from './types.ts';

function str(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

function joinList(values: unknown): string {
  if (!Array.isArray(values)) return '';
  return values
    .map((v) => str(v).trim())
    .filter(Boolean)
    .join('; ');
}

function mapLabels(ids: unknown, labels: Record<string, string>): string {
  if (!Array.isArray(ids)) return '';
  return ids
    .map((id) => {
      const key = str(id);
      return labels[key] ?? key;
    })
    .filter(Boolean)
    .join('; ');
}

function flattenLocations(detail: PartnerDetail): string {
  const remotes = detail.remoteLocations ?? [];
  const parts: string[] = [];
  for (const entry of remotes) {
    const loc = entry.remoteLocation;
    if (!loc) continue;
    if (loc.full?.trim()) {
      parts.push(loc.full.trim());
      continue;
    }
    const bits = [loc.locality, loc.state, loc.country].filter((x) => x && String(x).trim());
    if (bits.length) parts.push(bits.join(', '));
  }
  return parts.join('; ');
}

export function cardToSearchRow(
  card: SearchCard,
  options: {
    accreditationId: number;
    accreditationName: string;
    scrapedAt: string;
  },
): PartnerSearchRow {
  const product = card.products?.[0];
  const reviews = card.reviewSummary;
  const slug = str(card.slug);
  return {
    listing_id: str(card.listingId),
    slug,
    listing_name: str(card.listingName),
    company_name: str(card.companyName || card.listingName),
    provider_name: str(card.providerName),
    description: str(card.description),
    logo_url: str(card.iconUrl),
    profile_url: slug ? `${PROFILE_URL_BASE}/${slug}` : '',
    partner_tier: str(product?.partnerTier),
    partner_type: str(product?.partnerType),
    overall_rating: reviews?.overallRating != null ? str(reviews.overallRating) : '',
    adjusted_rating:
      reviews?.overallAdjustedRating != null ? str(reviews.overallAdjustedRating) : '',
    review_count: reviews?.reviewCount != null ? str(reviews.reviewCount) : '',
    accreditation_id: str(options.accreditationId),
    accreditation_name: options.accreditationName || DEFAULT_ACCREDITATION_NAME,
    scraped_at: options.scrapedAt,
  };
}

export function mergeDetail(
  searchRow: PartnerSearchRow,
  detail: PartnerDetail | null,
  labels: LabelMaps,
  status: { detail_status: string; detail_error: string },
): PartnerEnrichedRow {
  return {
    ...searchRow,
    website: str(detail?.companyUrl),
    languages: joinList(detail?.languages),
    services: joinList(detail?.services),
    service_names: mapLabels(detail?.services, labels.services),
    industries: mapLabels(detail?.industryChoice, labels.industries),
    budget: mapLabels(detail?.budgetChoice, labels.budgets),
    regions: joinList(detail?.regionChoice),
    office_location: joinList(detail?.officeLocation),
    locations: detail ? flattenLocations(detail) : '',
    company_size_specialty: joinList(detail?.companySizeSpecialty),
    source_id: str(detail?.sourceId),
    listing_version_id: detail?.listingVersionId != null ? str(detail.listingVersionId) : '',
    detail_status: status.detail_status,
    detail_error: status.detail_error,
  };
}

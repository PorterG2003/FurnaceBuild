import { TAG_PRESET_COLORS } from '@/lib/tags/tag-colors';

export type LeadTagGroupKey = 'provider' | 'signal' | 'other';

export type LeadTagCatalogEntry = {
  group: LeadTagGroupKey;
  name: string;
  aliases: string[];
};

export const LEAD_TAG_GROUPS: Array<{ key: LeadTagGroupKey; name: string }> = [
  { key: 'provider', name: 'Provider' },
  { key: 'signal', name: 'Signal' },
  { key: 'other', name: 'Other' },
];

export const LEAD_TAG_CATALOG: LeadTagCatalogEntry[] = [
  { group: 'provider', name: 'Apollo', aliases: ['Apollo.io', 'Apollo Match'] },
  { group: 'provider', name: 'Hunter', aliases: ['Hunter.io'] },
  { group: 'provider', name: 'Prospeo', aliases: ['Prospeo.io'] },
  { group: 'provider', name: 'Clay', aliases: ['Clay Table', 'Clay Waterfall'] },
  { group: 'provider', name: 'Apify', aliases: ['Apify Actor', 'Scraper Run'] },
  { group: 'provider', name: 'Serper', aliases: ['SERP Scrape', 'Google Search Scrape'] },
  { group: 'provider', name: 'Google Maps', aliases: ['Google Places', 'GMB', 'Maps Scrape'] },
  { group: 'provider', name: 'LinkedIn Sales Navigator', aliases: ['Sales Nav', 'LinkedIn Scrape', 'Wiza'] },
  { group: 'provider', name: 'Website Crawl', aliases: ['Site Crawl', 'Site Intel', 'LLM Site Read'] },
  { group: 'provider', name: 'SkipSherpa', aliases: ['Postal Enrichment', 'Skip Trace'] },
  { group: 'provider', name: 'Meta Ad Library', aliases: ['Facebook Ad Library', 'FB Ads Library'] },
  { group: 'provider', name: 'LinkedIn Ad Library', aliases: ['LI Ad Library'] },
  { group: 'provider', name: 'Google Ads Transparency', aliases: ['Ads Transparency Center', 'GATC'] },
  { group: 'provider', name: 'Business Registry', aliases: ['Secretary Of State', 'SOS Filing', 'Entity Registry'] },
  { group: 'provider', name: 'License Roster', aliases: ['State Board List', 'Licensee List', 'NPI'] },
  { group: 'provider', name: 'HubSpot', aliases: ['HubSpot CSV', 'HS Export'] },
  { group: 'provider', name: 'Salesforce', aliases: ['SFDC', 'Salesforce Export'] },
  { group: 'provider', name: 'Client CSV', aliases: ['Client List', 'Customer Upload'] },
  { group: 'provider', name: 'Webinar Registrant List', aliases: ['Registrant List', 'Webinar Signups'] },
  { group: 'provider', name: 'Demo Request', aliases: ['Inbound Demo', 'Book A Call'] },
  { group: 'provider', name: 'Content Download', aliases: ['Gated Asset', 'Lead Magnet', 'Newsletter Signup'] },
  { group: 'provider', name: 'Referral', aliases: ['Partner Referral', 'Intro'] },
  { group: 'signal', name: 'Running Meta Ads', aliases: ['Facebook Ads Active', 'Meta Advertiser'] },
  { group: 'signal', name: 'Running Google Ads', aliases: ['Adwords Active', 'PPC Active'] },
  { group: 'signal', name: 'Running LinkedIn Ads', aliases: ['LI Advertiser'] },
  { group: 'signal', name: 'Webinar Or Event Ad', aliases: ['Webinar Advertiser', 'Masterclass Ad', 'Workshop Ad'] },
  { group: 'signal', name: 'Qualifying Ad Copy', aliases: ['Ad Phrase Match', 'Ad Copy Match'] },
  { group: 'signal', name: 'Ads Paused', aliases: ['Ad Stopped', 'Ad Disposition Off'] },
  { group: 'signal', name: 'Hiring Intent', aliases: ['Job Post', 'Actively Hiring', 'Open Roles'] },
  { group: 'signal', name: 'Recently Funded', aliases: ['New Funding', 'Raised Round'] },
  { group: 'signal', name: 'Tech Match', aliases: ['Stack Fit', 'Uses Target Tech', 'Competitor Tech'] },
  { group: 'signal', name: 'Regulated Or Licensed', aliases: ['Licensed Professional', 'Compliance Heavy'] },
  { group: 'signal', name: 'Verified Business', aliases: ['Real Company', 'Site Verified'] },
  { group: 'signal', name: 'ICP Fit', aliases: ['Title Fit', 'Persona Match', 'Function Fit'] },
  { group: 'signal', name: 'Decision Maker', aliases: ['DM', 'Buyer', 'Budget Holder'] },
  { group: 'signal', name: 'Owner Operator', aliases: ['Owner', 'Principal', 'Founder'] },
  { group: 'signal', name: 'Local Business', aliases: ['Home Service', 'Brick And Mortar'] },
  { group: 'signal', name: 'Engaged', aliases: ['LinkedIn Engaged', 'Content Engaged', 'Post Engager'] },
  { group: 'signal', name: 'Webinar Attendee', aliases: ['Attended', 'Showed Up'] },
  { group: 'signal', name: 'Webinar No Show', aliases: ['Registered Not Attended', 'No Show'] },
  { group: 'other', name: 'Catch-All Domain', aliases: ['Accept All', 'Catchall'] },
  { group: 'other', name: 'Role Account', aliases: ['Info Address', 'Generic Inbox', 'Shared Mailbox'] },
  { group: 'other', name: 'Needs Review', aliases: ['Manual Check', 'Review Queue'] },
  { group: 'other', name: 'Do Not Send', aliases: ['Suppress', 'Exclude'] },
  { group: 'other', name: 'Existing Customer', aliases: ['Current Client', 'Active Account'] },
  { group: 'other', name: 'Open Opportunity', aliases: ['In Pipeline', 'Active Deal'] },
  { group: 'other', name: 'Previously Contacted', aliases: ['Prior Touch', 'Already Emailed'] },
  { group: 'other', name: 'High Fit', aliases: ['Priority', 'A List'] },
  { group: 'other', name: 'Low Fit', aliases: ['C List', 'Nurture Only'] },
  { group: 'other', name: 'EU Contact', aliases: ['Europe', 'GDPR Region', 'UK'] },
];

export function catalogColorForIndex(index: number): string {
  return TAG_PRESET_COLORS[index % TAG_PRESET_COLORS.length];
}

export const EMAIL_VERIFICATION_STATUSES = [
  'ok',
  'catch_all',
  'invalid',
  'unknown',
  'disposable',
] as const;

export type EmailVerificationStatus = (typeof EMAIL_VERIFICATION_STATUSES)[number];

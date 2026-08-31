import type { ListedSchool } from '../types.js';
import type { PlatformId } from '../platformDetect.js';

export type PersonEvidence = 'location_field' | 'school_url' | 'heading' | 'path';

export type HarvestedPerson = {
  first_name: string;
  last_name: string;
  title: string;
  email: string;
  school_hint: string;
  source_url: string;
  evidence: PersonEvidence;
  platform: string;
  external_id?: string;
};

export type JsonTap = {
  url: string;
  body: unknown;
};

export type FetchedPage = {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  jsonTaps: JsonTap[];
};

export type PageClient = {
  fetch(url: string): Promise<FetchedPage>;
  openProfile?(listingUrl: string, constituentId: string): Promise<FetchedPage>;
};

export type AdapterContext = {
  client: PageClient;
  website: string;
  origin: string;
  schools: ListedSchool[];
  maxPages: number;
  platform: PlatformId;
};

export type AdapterResult = {
  people: HarvestedPerson[];
  pages: number;
  directoryUrls: string[];
  notes: string[];
  xhrEndpoints: Array<{ platform: string; url: string }>;
};

export type DirectoryAdapter = (ctx: AdapterContext) => Promise<AdapterResult>;

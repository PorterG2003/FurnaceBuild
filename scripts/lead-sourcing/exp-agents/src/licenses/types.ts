export type {
  LicenseMatchMethod,
  LicenseMatchResult,
  LicenseRecord,
} from '../brokerExpansionTypes.ts';

export type LicenseSourceMeta = {
  source: 'ca_dre' | 'tx_trec' | 'fl_dbpr';
  path: string;
  copiedTo: string;
  sha256: string;
  downloadedAt: string;
  sourceUrl: string;
  rowCount: number;
};

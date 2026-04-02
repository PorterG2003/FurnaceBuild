export type ExportReadyFilter = 'ready' | 'all' | 'blocked';

export type ExportTriFilter = 'any' | 'yes' | 'no';

export const DEFAULT_EXPORT_READY: ExportReadyFilter = 'ready';

export function countNonDefaultExportFilters(params: {
  exportReady: ExportReadyFilter;
  registryState: string;
  linkedFilter: ExportTriFilter;
  ownerFilter: ExportTriFilter;
  reviewFilter: ExportTriFilter;
  parseFilter: ExportTriFilter;
}): number {
  let n = 0;
  if (params.exportReady !== DEFAULT_EXPORT_READY) n += 1;
  if (params.registryState.trim().length > 0) n += 1;
  if (params.linkedFilter !== 'any') n += 1;
  if (params.ownerFilter !== 'any') n += 1;
  if (params.reviewFilter !== 'any') n += 1;
  if (params.parseFilter !== 'any') n += 1;
  return n;
}

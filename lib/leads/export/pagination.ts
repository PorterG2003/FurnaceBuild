import { SAVED_LIST_PAGE_MAX } from './constants';

export function shouldContinueOffsetPagination(rowCount: number, pageSize: number): boolean {
  return rowCount >= pageSize;
}

export function shouldContinueSavedListExportPagination(rowCount: number): boolean {
  return shouldContinueOffsetPagination(rowCount, SAVED_LIST_PAGE_MAX);
}

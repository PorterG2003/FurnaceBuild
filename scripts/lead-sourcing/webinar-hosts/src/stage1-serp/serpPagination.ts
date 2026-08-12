export const SERP_RESULTS_PER_PAGE = 10;

export function isLastSerpPage(organicResultCount: number): boolean {
  return organicResultCount === 0 || organicResultCount < SERP_RESULTS_PER_PAGE;
}

export type EnrollmentProgressState = 'not_started' | 'active' | 'paused' | 'completed' | 'stopped';

export type EnrollmentRawState = 'active' | 'paused' | 'completed' | 'stopped' | null | undefined;

export function getEnrollmentProgressState(
  rawState: EnrollmentRawState,
  hasBeenContacted: boolean,
): EnrollmentProgressState {
  if (!rawState) return 'not_started';
  if (rawState === 'paused' || rawState === 'completed' || rawState === 'stopped') {
    return rawState;
  }
  if (rawState === 'active') {
    return hasBeenContacted ? 'active' : 'not_started';
  }
  return 'not_started';
}

export function matchesEnrollmentProgressFilter(
  progressState: EnrollmentProgressState,
  selectedFilters: EnrollmentProgressState[],
): boolean {
  if (selectedFilters.length === 0) return true;
  return selectedFilters.includes(progressState);
}

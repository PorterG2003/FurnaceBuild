import { useSmoothLoading, type UseSmoothLoadingOptions } from './useSmoothLoading';

export function usePageSkeleton(
  isLoading: boolean,
  options?: UseSmoothLoadingOptions,
) {
  const showSkeleton = useSmoothLoading(isLoading, options);
  return {
    isLoading,
    showSkeleton,
    showPlaceholder: isLoading || showSkeleton,
  };
}

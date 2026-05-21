import type { FluxImageFit } from './types';

export function fluxImageResizeMode(
  fit: FluxImageFit | undefined,
  fallback: FluxImageFit,
): FluxImageFit {
  return fit ?? fallback;
}

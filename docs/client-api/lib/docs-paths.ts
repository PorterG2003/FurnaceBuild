export const DOCS_BASE_PATH = process.env.NEXT_PUBLIC_DOCS_BASE_PATH ?? '/docs';

/** Prefix an app-relative docs path for plain anchors and static assets. */
export function docsAssetPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized.startsWith(`${DOCS_BASE_PATH}/`) || normalized === DOCS_BASE_PATH) {
    return normalized;
  }
  return `${DOCS_BASE_PATH}${normalized}`;
}

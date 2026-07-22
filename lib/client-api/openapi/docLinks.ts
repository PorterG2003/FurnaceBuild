export type DocLinkMode = 'openapi' | 'docs';

const DOCS_BASE = '/docs';

/** Public URL path on the API host (includes /docs). */
export function docsPublicPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized.startsWith(`${DOCS_BASE}/`) || normalized === DOCS_BASE) {
    return normalized;
  }
  return `${DOCS_BASE}${normalized}`;
}

/** App-relative path — same as public path now that all URLs use /docs prefix. */
export function docsAppPath(path: string): string {
  return docsPublicPath(path);
}

/** @deprecated Use docsPublicPath */
export function docsPath(path: string): string {
  return docsPublicPath(path);
}

export function schemaDocPath(schemaName: string, mode: DocLinkMode = 'docs'): string {
  const path = `/reference/schemas/${schemaName}/`;
  if (mode === 'docs') {
    return docsAppPath(path);
  }
  return docsPublicPath(path);
}

export function modelLink(schemaName: string, mode: DocLinkMode = 'openapi'): string {
  return `[${schemaName}](${schemaDocPath(schemaName, mode)})`;
}

export function modelsLink(mode: DocLinkMode, ...schemaNames: string[]): string {
  return schemaNames.map((name) => modelLink(name, mode)).join(', ');
}

export function guideLink(label: string, path: string, mode: DocLinkMode = 'openapi'): string {
  if (mode === 'docs') {
    return `[${label}](${docsAppPath(path)})`;
  }
  return `[${label}](${docsPublicPath(path)})`;
}

export function referenceLink(label: string, path = '/reference/', mode: DocLinkMode = 'openapi'): string {
  return guideLink(label, path, mode);
}

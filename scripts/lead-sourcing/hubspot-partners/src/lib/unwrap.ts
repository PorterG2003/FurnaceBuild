/** Unwrap HubSpot Chirp MapFieldValue / field wrappers into plain JSON. */
export function unwrapChirpValue(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => unwrapChirpValue(item));
  }
  if (!node || typeof node !== 'object') {
    return node;
  }

  const obj = node as Record<string, unknown>;
  const hasWrapperMeta = '__typename' in obj || '@type' in obj;

  if ('value' in obj && hasWrapperMeta) {
    return unwrapChirpValue(obj.value);
  }

  if (
    'value' in obj &&
    Object.keys(obj).every((k) =>
      ['value', '__typename', '@type', 'name', 'fieldType'].includes(k),
    )
  ) {
    return unwrapChirpValue(obj.value);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '__typename' || key === '@type') continue;
    out[key] = unwrapChirpValue(value);
  }
  return out;
}

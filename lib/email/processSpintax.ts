/**
 * Process spintax: {option1|option2|option3} → pick one option per occurrence.
 * Supports nested spintax. Options may contain variables {{var}}; runs before variable merge.
 *
 * Selection modes:
 * - `seed` present → FNV-1a hash of seed + scope + path + raw options (preview/send parity)
 * - `deterministic: true` (no seed) → first option (threading / fallback callers)
 * - otherwise → Math.random()
 */

export type SpintaxScope = 'subject' | 'body' | 'body_text';

export interface ProcessSpintaxOptions {
  /**
   * When true and no seed is provided, pick the first option.
   * Ignored when `seed` is set (seeded hash selection wins).
   */
  deterministic?: boolean;
  /**
   * Versioned identity seed from `buildSpintaxSeed`. When present, options are
   * selected via FNV-1a instead of Math.random.
   */
  seed?: string;
  /** Content scope mixed into the per-occurrence hash (subject vs body vs body_text). */
  scope?: SpintaxScope;
}

/** Seed namespace / algorithm version. Bump only when intentionally changing parity. */
export const SPINTAX_SEED_VERSION = 'spintax:v1';

/**
 * Stable stand-in when a historical message_job has no variant_id.
 * Must stay identical in preview and send-worker for those jobs.
 */
export const LEGACY_MISSING_VARIANT_ID = 'legacy-missing-variant';

export interface SpintaxSeedIdentity {
  campaignId: string;
  leadId: string;
  variantId?: string | null;
}

/**
 * Build the shared preview/send spintax seed. Both surfaces must call this helper
 * with the same identity fields — do not assemble the string ad hoc.
 */
export function buildSpintaxSeed(identity: SpintaxSeedIdentity): string {
  const campaignId = String(identity.campaignId ?? '').trim();
  const leadId = String(identity.leadId ?? '').trim();
  const variantRaw = identity.variantId != null ? String(identity.variantId).trim() : '';
  const variantId = variantRaw.length > 0 ? variantRaw : LEGACY_MISSING_VARIANT_ID;
  return `${SPINTAX_SEED_VERSION}:${campaignId}:${leadId}:${variantId}`;
}

/** FNV-1a 32-bit — sync, no deps, identical in browser and Node. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

export function selectSpintaxOptionIndex(
  optionCount: number,
  params: { seed: string; scope: string; path: string; optionsRaw: string }
): number {
  if (optionCount <= 0) return 0;
  const key = `${params.seed}\0${params.scope}\0${params.path}\0${params.optionsRaw}`;
  return fnv1a32(key) % optionCount;
}

type SpintaxGroup = { start: number; end: number; inner: string };

/**
 * Find top-level `{a|b}` groups. Skips `{{var}}` placeholders. Requires a
 * top-level `|` so literal `{foo}` braces are left alone.
 */
function findTopLevelSpintaxGroups(str: string): SpintaxGroup[] {
  const groups: SpintaxGroup[] = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === '{' && str[i + 1] === '{') {
      const close = str.indexOf('}}', i + 2);
      i = close === -1 ? str.length : close + 2;
      continue;
    }
    if (str[i] === '{') {
      let depth = 1;
      let j = i + 1;
      let hasPipe = false;
      while (j < str.length && depth > 0) {
        if (str[j] === '{' && str[j + 1] === '{') {
          const close = str.indexOf('}}', j + 2);
          j = close === -1 ? str.length : close + 2;
          continue;
        }
        if (str[j] === '{') {
          depth += 1;
          j += 1;
          continue;
        }
        if (str[j] === '}') {
          depth -= 1;
          j += 1;
          continue;
        }
        if (str[j] === '|' && depth === 1) hasPipe = true;
        j += 1;
      }
      if (depth === 0 && hasPipe) {
        groups.push({ start: i, end: j, inner: str.slice(i + 1, j - 1) });
        i = j;
        continue;
      }
    }
    i += 1;
  }
  return groups;
}

/** Split spintax options on top-level `|`, respecting nested braces and `{{var}}`. */
function splitTopLevelOptions(inner: string): string[] {
  const options: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '{' && inner[i + 1] === '{') {
      const close = inner.indexOf('}}', i + 2);
      i = close === -1 ? inner.length : close + 1;
      continue;
    }
    if (inner[i] === '{') {
      depth += 1;
      continue;
    }
    if (inner[i] === '}') {
      depth -= 1;
      continue;
    }
    if (inner[i] === '|' && depth === 0) {
      options.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  options.push(inner.slice(start).trim());
  return options;
}

function processSpintaxRecursive(
  str: string,
  options: ProcessSpintaxOptions | undefined,
  pathPrefix: string
): string {
  const groups = findTopLevelSpintaxGroups(str);
  if (groups.length === 0) return str;

  const deterministic = options?.deterministic ?? false;
  const seed = options?.seed;
  const scope = options?.scope ?? 'body';

  let out = '';
  let cursor = 0;
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g]!;
    out += str.slice(cursor, group.start);
    cursor = group.end;

    const optionsList = splitTopLevelOptions(group.inner);
    if (optionsList.length < 2) {
      out += str.slice(group.start, group.end);
      continue;
    }

    const path = pathPrefix ? `${pathPrefix}.${g}` : String(g);
    let idx: number;
    if (seed) {
      idx = selectSpintaxOptionIndex(optionsList.length, {
        seed,
        scope,
        path,
        optionsRaw: group.inner,
      });
    } else if (deterministic) {
      idx = 0;
    } else {
      idx = Math.floor(Math.random() * optionsList.length);
    }

    const chosen = optionsList[idx] ?? optionsList[0] ?? '';
    out += processSpintaxRecursive(chosen, options, path);
  }
  out += str.slice(cursor);
  return out;
}

/**
 * Replace {a|b|c} with one of the options.
 * Seeded mode is preferred for campaign preview/send parity.
 */
export function processSpintax(str: string, options?: ProcessSpintaxOptions): string {
  if (!str) return '';
  return processSpintaxRecursive(str, options, '');
}

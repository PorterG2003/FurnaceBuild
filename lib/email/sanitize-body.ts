/**
 * Defensive sanitizer for email bodies that may still contain encoding artifacts.
 * This is a safety net for malformed historical payloads and edge-case MIME output.
 */

export type SanitizeEmailBodyOptions = {
  format?: 'text' | 'html';
};

const RESIDUAL_ENCODING_ARTIFACT_PATTERN =
  /=([A-Fa-f0-9]{2})|=\r?\n|Â|Ã.|â[\u0080-\u00BF]{1,2}|[\u0080-\u009F]|�/;

const NAMED_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  bull: '\u2022',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
};

function hasQuotedPrintableArtifacts(input: string): boolean {
  return /=[A-Fa-f0-9]{2}|=\r?\n|=\s+[A-Za-z0-9<]/.test(input);
}

/**
 * Decode quoted-printable-ish content. Handles:
 * - =XX hex octets
 * - soft breaks: =\r\n and =\n
 * - broken soft-wraps where whitespace replaced line breaks ("S= ending")
 */
function decodeQuotedPrintableLoose(input: string): string {
  let normalized = input
    .replace(/=\r\n/g, '')
    .replace(/=\n/g, '')
    .replace(/([A-Za-z0-9])=\s+([A-Za-z0-9<])/g, '$1$2');

  if (!/=[A-Fa-f0-9]{2}/.test(normalized)) {
    return normalized;
  }

  // Convert QP octets into latin1 byte string first, then decode as utf8.
  normalized = normalized.replace(/=([A-Fa-f0-9]{2})/g, (_m, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );

  try {
    return Buffer.from(normalized, 'latin1').toString('utf8');
  } catch {
    return normalized;
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
      if (!entity) return match;
      if (entity[0] === '#') {
        const isHex = entity[1]?.toLowerCase() === 'x';
        const num = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
        if (!Number.isFinite(num)) return match;
        try {
          return String.fromCodePoint(num);
        } catch {
          return match;
        }
      }

      const named = NAMED_ENTITY_MAP[entity.toLowerCase()];
      return named ?? match;
    })
    .replace(/&am=\s*p;/gi, '&');
}

function mojibakeScore(input: string): number {
  let score = 0;
  score += (input.match(/Â/g) ?? []).length * 2;
  score += (input.match(/Ã./g) ?? []).length * 2;
  score += (input.match(/â[\u0080-\u00BF]{1,2}/g) ?? []).length * 3;
  score += (input.match(/[\u0080-\u009F]/g) ?? []).length * 3;
  score += (input.match(/�/g) ?? []).length * 4;
  return score;
}

/**
 * Repair common UTF-8 mojibake that appears when UTF-8 bytes are decoded as latin1,
 * e.g. "Â " (NBSP) and "â¯" (narrow no-break space).
 */
function maybeRepairUtf8Mojibake(input: string): string {
  if (!/[ÂÃâ]|[\u0080-\u009F]/.test(input)) {
    return input;
  }

  try {
    let current = input;
    let currentScore = mojibakeScore(current);

    // Some payloads are double-mojibake (e.g. "Ã¢ÂÂ¯").
    // Iteratively repair while the score improves.
    for (let i = 0; i < 3; i++) {
      const repaired = Buffer.from(current, 'latin1').toString('utf8');
      if (!repaired || repaired === current) {
        break;
      }
      const repairedScore = mojibakeScore(repaired);
      if (repairedScore < currentScore) {
        current = repaired;
        currentScore = repairedScore;
      } else {
        break;
      }
    }

    return current;
  } catch {
    return input;
  }
}

/**
 * Normalize known post-decode mojibake remnants seen in Gmail quoted HTML.
 * - U+00C2 U+00A0 ("Â ") -> U+00A0
 * - U+00E2 U+0080 U+00AF ("â¯") -> U+202F
 * - Stray U+00C2 before whitespace/tag boundaries -> removed
 */
function normalizeKnownMojibakeRemnants(input: string): string {
  return input
    .replace(/\u00E2\u0080\u00AF/g, '\u202F')
    .replace(/\u00C2\u00A0/g, '\u00A0')
    .replace(/\u00C2(?=[\u00A0\s<])/g, '');
}

function repairMalformedHtml(input: string): string {
  return input
    .replace(/<=\s*\/\s*([a-zA-Z0-9:_-]+)\s*>/g, '</$1>')
    .replace(/<=\s*([a-zA-Z0-9:_-]+)\s*>/g, '<$1>')
    .replace(/&am=\s*p;/gi, '&amp;');
}

export function sanitizeEmailBody(
  body: string | null | undefined,
  options: SanitizeEmailBodyOptions = {}
): string {
  if (!body) return '';

  const format = options.format ?? 'text';
  let out = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (hasQuotedPrintableArtifacts(out)) {
    out = decodeQuotedPrintableLoose(out);
  }

  out = maybeRepairUtf8Mojibake(out);
  out = normalizeKnownMojibakeRemnants(out);
  out = decodeHtmlEntities(out);
  out = maybeRepairUtf8Mojibake(out);
  out = normalizeKnownMojibakeRemnants(out);

  if (format === 'html') {
    out = repairMalformedHtml(out);
  }

  return out.replace(/\u0000/g, '').trim();
}

export function hasResidualEncodingArtifacts(body: string | null | undefined): boolean {
  if (!body) return false;
  return RESIDUAL_ENCODING_ARTIFACT_PATTERN.test(body);
}


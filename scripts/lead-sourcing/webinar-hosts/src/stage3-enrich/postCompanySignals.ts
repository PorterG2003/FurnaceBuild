const CORP_SUFFIX =
  /\b(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LLP|GMBH|AI|CO\.)\b/i;

const WEBINAR_NOISE =
  /^(only\s+\d+\s+days?\s+left|last\s+(?:chance|call)\s+to\s+register|register\s+for|don'?t\s+miss|join\s+us|happening\s+tomorrow|reserve\s+your\s+spot)/i;

const WEBINAR_BOILERPLATE =
  /\b(professional\s+and\s+certified|implementers?|register\s+for\s+our\s+webinar|webinar\s+on\s+pay\s+transparency)\b/gi;

function normalizeCandidate(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/[.!…]+$/g, '').trim();
}

export function isNoisyCompanyCandidate(name: string): boolean {
  const cleaned = normalizeCandidate(name);
  if (cleaned.length < 3) return true;
  if (WEBINAR_NOISE.test(cleaned)) return true;
  if (/^register\b/i.test(cleaned)) return true;
  if (/linkedin$/i.test(cleaned)) return true;
  if (/^only\s+\d+/i.test(cleaned)) return true;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 2 && !CORP_SUFFIX.test(cleaned)) {
    const looksLikePerson = words.every((w) => /^[A-Z][a-z'.-]+$/.test(w));
    if (looksLikePerson) return true;
  }
  return false;
}

export function addCandidate(candidates: string[], raw: string): void {
  const cleaned = normalizeCandidate(raw);
  if (!cleaned || isNoisyCompanyCandidate(cleaned)) return;
  candidates.push(cleaned);
}

/** Trim webinar-for phrases to a shorter company-like name (e.g. EOS Worldwide). */
export function trimWebinarForPhrase(phrase: string): string[] {
  const out: string[] = [];
  let cleaned = normalizeCandidate(phrase.replace(WEBINAR_BOILERPLATE, ' '));
  cleaned = cleaned.replace(/\s+on\s+[A-Za-z0-9 ,]+$/i, '').trim();
  if (cleaned) out.push(cleaned);

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  for (let len = Math.min(4, tokens.length); len >= 2; len--) {
    const tail = tokens.slice(-len).join(' ');
    if (!isNoisyCompanyCandidate(tail)) out.push(tail);
  }
  return out;
}

export function extractNameCandidatesFromPost(text: string): string[] {
  if (!text.trim()) return [];

  const candidates: string[] = [];
  const pushUnique = (raw: string) => {
    const before = candidates.length;
    addCandidate(candidates, raw);
    if (candidates.length === before) {
      for (const variant of trimWebinarForPhrase(raw)) addCandidate(candidates, variant);
    }
  };

  for (const match of text.matchAll(/@([A-Za-z0-9][A-Za-z0-9\s&.'-]{1,60})/g)) {
    pushUnique(match[1] ?? '');
  }

  for (const match of text.matchAll(/\bat\s+([A-Z][A-Za-z0-9\s&.'-]{2,60})(?:\s|,|\.|$)/g)) {
    pushUnique(match[1] ?? '');
  }

  for (const match of text.matchAll(
    /webinar\s+(?:for|with|by)\s+(.+?)(?:\s+on\s+[A-Za-z0-9 ,]+|\s+happening|\s+register|\.|,|\!|$)/gi,
  )) {
    for (const variant of trimWebinarForPhrase(match[1] ?? '')) pushUnique(variant);
  }

  for (const match of text.matchAll(
    /\((?:[^(),]{2,80}?,\s*)([A-Za-z0-9][A-Za-z0-9\s&.'-]{1,60})\)/g,
  )) {
    pushUnique(match[1] ?? '');
  }

  for (const match of text.matchAll(
    /(?:hosted|led|presented)\s+by\s+([A-Z][A-Za-z0-9\s&.'-]{2,60})/gi,
  )) {
    pushUnique(match[1] ?? '');
  }

  for (const match of text.matchAll(/join\s+([A-Z][A-Za-z0-9\s&.'-]{2,40}?)\s+for/gi)) {
    pushUnique(match[1] ?? '');
  }

  for (const match of text.matchAll(
    /(?:with|and)\s+([A-Z][A-Za-z0-9\s&.'-]{2,40}?)\s+(?:will\s+welcome|for\s+a\s+webinar|on\s+[A-Z])/gi,
  )) {
    pushUnique(match[1] ?? '');
  }

  for (const match of text.matchAll(
    /([A-Z][A-Za-z0-9&.'-]{1,30})\s+and\s+([A-Z][A-Za-z0-9\s&.'-]{2,40}?)\s+will\s+welcome/gi,
  )) {
    pushUnique(match[1] ?? '');
    pushUnique(match[2] ?? '');
  }

  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = c.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

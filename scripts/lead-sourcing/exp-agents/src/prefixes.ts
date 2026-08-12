import { SUGGESTION_CAP } from './types.ts';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

/** Default seed: two-letter prefixes aa–zz. */
export function defaultTwoLetterPrefixes(): string[] {
  const out: string[] = [];
  for (const a of LETTERS) {
    for (const b of LETTERS) out.push(`${a}${b}`);
  }
  return out;
}

/** Children of a prefix that hit the suggestion cap (prefix + a…z). */
export function deepenPrefix(prefix: string, prioritizeFromNames: string[] = []): string[] {
  const seen = new Set<string>();
  const prioritized: string[] = [];
  for (const name of prioritizeFromNames) {
    const lower = name.toLowerCase();
    if (!lower.startsWith(prefix.toLowerCase())) continue;
    const next = lower.slice(prefix.length, prefix.length + 1);
    if (!next || !LETTERS.includes(next) || seen.has(next)) continue;
    seen.add(next);
    prioritized.push(`${prefix}${next}`);
  }
  const rest = LETTERS.filter((letter) => !seen.has(letter)).map((letter) => `${prefix}${letter}`);
  return [...prioritized, ...rest];
}

export function shouldDeepen(suggestionCount: number, cap = SUGGESTION_CAP): boolean {
  return suggestionCount >= cap;
}

/**
 * Merge a freshly completed prefix result into the BFS queue.
 * Returns updated queue (excluding already-completed prefixes).
 */
export function enqueueAfterPrefix(options: {
  prefix: string;
  suggestionCount: number;
  queue: string[];
  completed: Set<string>;
  cap?: number;
  names?: string[];
}): string[] {
  const { prefix, suggestionCount, completed, cap = SUGGESTION_CAP, names = [] } = options;
  const queue = options.queue.filter((p) => p !== prefix && !completed.has(p));
  if (!shouldDeepen(suggestionCount, cap)) return queue;

  const next = deepenPrefix(prefix, names).filter((p) => !completed.has(p) && !queue.includes(p));
  // Append deepen children (breadth-first): finish sibling 2-letter seeds before
  // grinding a capped branch. Faster unique-name growth and gentler on rate limits.
  return [...queue, ...next];
}

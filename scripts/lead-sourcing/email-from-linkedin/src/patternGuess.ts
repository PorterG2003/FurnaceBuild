function cleanToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export type EmailPatternGuess = {
  email: string;
  pattern: 'first.last' | 'flast' | 'firstlast' | 'first_last' | 'first';
};

/**
 * Common K-12 email patterns for first+last@domain.
 */
export function guessEmailPatterns(
  firstName: string,
  lastName: string,
  domain: string,
): EmailPatternGuess[] {
  const first = cleanToken(firstName);
  const last = cleanToken(lastName.split(/\s+/).pop() ?? lastName);
  const host = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

  if (!first || !last || !host || !host.includes('.')) return [];

  const guesses: EmailPatternGuess[] = [
    { email: `${first}.${last}@${host}`, pattern: 'first.last' },
    { email: `${first[0]}${last}@${host}`, pattern: 'flast' },
    { email: `${first}${last}@${host}`, pattern: 'firstlast' },
    { email: `${first}_${last}@${host}`, pattern: 'first_last' },
    { email: `${first}@${host}`, pattern: 'first' },
  ];

  const seen = new Set<string>();
  return guesses.filter((guess) => {
    if (seen.has(guess.email)) return false;
    seen.add(guess.email);
    return true;
  });
}

export function acceptPatternResult(
  pattern: EmailPatternGuess['pattern'],
  result: string,
): boolean {
  if (result === 'ok') return true;
  if (result === 'catch_all' && (pattern === 'first.last' || pattern === 'flast')) return true;
  return false;
}

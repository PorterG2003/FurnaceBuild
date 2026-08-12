export type ParsedName = {
  firstName: string;
  lastName: string;
};

export function parsePersonName(personName: string): ParsedName | null {
  const trimmed = personName.trim();
  if (!trimmed) return null;

  if (trimmed.includes(',')) {
    const [lastPart, firstPart] = trimmed.split(',', 2);
    const lastTokens = lastPart.trim().split(/\s+/).filter(Boolean);
    const firstTokens = (firstPart ?? '').trim().split(/\s+/).filter(Boolean);
    if (lastTokens.length === 0 || firstTokens.length === 0) return null;
    return {
      lastName: lastTokens[0]!.toLowerCase(),
      firstName: firstTokens[0]!.toLowerCase(),
    };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  return {
    firstName: tokens[0]!.toLowerCase(),
    lastName: tokens[tokens.length - 1]!.toLowerCase(),
  };
}

export function hasNameMatch(localPart: string, personName: string): boolean {
  const parsed = parsePersonName(personName);
  if (!parsed) return false;

  const local = localPart.toLowerCase();
  return local.includes(parsed.firstName) || local.includes(parsed.lastName);
}

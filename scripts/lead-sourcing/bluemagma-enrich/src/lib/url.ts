export function stripWww(host: string): string {
  return host.replace(/^www\./i, '').toLowerCase();
}

export function hostnameOf(url: string): string {
  try {
    return stripWww(new URL(url).hostname);
  } catch {
    return '';
  }
}

export function hostMatchesCompany(candidateHost: string, companyHost: string): boolean {
  const a = stripWww(candidateHost);
  const b = stripWww(companyHost);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

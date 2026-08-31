export const PLATFORM_IDS = [
  'finalsite',
  'apptegy',
  'edlio',
  'schoolwires',
  'campussuite',
  'googlesites',
  'wordpress',
  'other',
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

const FINGERPRINTS: Array<{ id: Exclude<PlatformId, 'other'>; re: RegExp }> = [
  { id: 'finalsite', re: /finalsite|resources\.finalsite\.net|fsElement|fsConstituent|FS\.util\.insertEmail/i },
  { id: 'apptegy', re: /apptegy|thrillshare|cmsv2-shared-assets/i },
  { id: 'edlio', re: /\bedlio\b/i },
  { id: 'schoolwires', re: /schoolwires|blackboard|\/site\/Default\.aspx/i },
  { id: 'campussuite', re: /campussuite|campus-suite/i },
  { id: 'googlesites', re: /sites\.google\.com/i },
  { id: 'wordpress', re: /wp-content|wp-json/i },
];

export function detectPlatform(html: string, url = ''): PlatformId {
  const hay = `${url}\n${html.slice(0, 400_000)}`;
  for (const row of FINGERPRINTS) {
    if (row.re.test(hay)) return row.id;
  }
  return 'other';
}

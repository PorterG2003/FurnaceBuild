import { canonicalSchoolName, jaccard, looksLikeSchoolName, schoolHintFromHost, schoolTokenSet } from './schoolNames.js';
import type { HarvestedPerson } from './adapters/types.js';
import type { ListedSchool, RawSchoolContact } from './types.js';

export type Attribution = {
  contact: RawSchoolContact | null;
  review_reason: string;
  score: number;
  ncessch: string;
  school_name: string;
};

const TYPE_TOKENS = new Set([
  'elementary',
  'middle',
  'high',
  'junior',
  'intermediate',
  'academy',
  'charter',
  'primary',
  'school',
  'schools',
]);

function acronymsForSchool(school: ListedSchool): Set<string> {
  const words = school.school_name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word && !/^(the|of|and|a|an|at|for|usd|isd)$/i.test(word));
  const set = new Set<string>();
  const initials = words.map((word) => word[0]!.toUpperCase()).join('');
  if (initials.length >= 2 && initials.length <= 6) set.add(initials);
  const distinctive = words.filter(
    (word) => !/^(elementary|middle|high|junior|school|intermediate|primary|academy|charter|elem)$/i.test(word),
  );
  const stem = distinctive.map((word) => word[0]!.toUpperCase()).join('');
  if (!stem) return set;
  const name = school.school_name.toLowerCase();
  if (/\belementary\b|\belem\b|\bes\b/.test(name)) {
    for (const suffix of ['E', 'ES', 'S']) set.add(`${stem}${suffix}`);
  }
  if (/\bmiddle\b/.test(name)) {
    for (const suffix of ['M', 'MS']) set.add(`${stem}${suffix}`);
  }
  if (/\bhigh\b/.test(name) && !/\bjunior\b/.test(name)) {
    for (const suffix of ['H', 'HS']) set.add(`${stem}${suffix}`);
  }
  if (/\bjunior\b/.test(name)) {
    for (const suffix of ['JH', 'JHS']) set.add(`${stem}${suffix}`);
  }
  return set;
}

export type SchoolGrade = 'elementary' | 'middle' | 'high' | 'intermediate' | 'primary' | '';

export function hintFragments(hay: string): string[] {
  const parts = hay
    .split(/[,;]/)
    .map((part) => part.replace(/\s*\/\s*/g, ', ').trim())
    .flatMap((part) => part.split(',').map((inner) => inner.trim()))
    .filter((part) => part.length >= 3);
  return parts.length > 0 ? parts : hay.trim() ? [hay.trim()] : [];
}

export function gradeFromTitle(title: string): SchoolGrade {
  const value = title.toLowerCase();
  if (/\bhigh\b|\bhs\b/.test(value) && !/\bjunior\b/.test(value)) return 'high';
  if (/\bmiddle\b|\bjunior\b|\bms\b|\bjhs\b/.test(value)) return 'middle';
  if (/\bintermediate\b/.test(value)) return 'intermediate';
  if (/\bprimary\b|\bpri\b/.test(value)) return 'primary';
  if (/\belementary\b|\belem\b|\bes\b/.test(value)) return 'elementary';
  return '';
}

export function gradeFromSchoolName(name: string): SchoolGrade {
  const value = name.toLowerCase();
  if (/\bhigh\b/.test(value) && !/\bjunior\b/.test(value)) return 'high';
  if (/\bmiddle\b|\bjunior\b/.test(value)) return 'middle';
  if (/\bintermediate\b/.test(value)) return 'intermediate';
  if (/\bprimary\b/.test(value)) return 'primary';
  if (/\belementary\b|\belem\b/.test(value)) return 'elementary';
  return '';
}

function gradesCompatible(titleGrade: SchoolGrade, schoolGrade: SchoolGrade): boolean {
  if (!titleGrade || !schoolGrade) return false;
  if (titleGrade === schoolGrade) return true;
  return (
    (titleGrade === 'elementary' && schoolGrade === 'primary') ||
    (titleGrade === 'primary' && schoolGrade === 'elementary')
  );
}

function scoreHint(hay: string, school: ListedSchool): number {
  if (!hay.trim()) return 0;
  const compact = hay.trim().toUpperCase();
  const acronym =
    /^[A-Z]{2,5}$/.test(compact) && acronymsForSchool(school).has(compact) ? 1 : 0;
  const exact =
    canonicalSchoolName(hay, school.state) === canonicalSchoolName(school.school_name, school.state) ? 1 : 0;
  const a = schoolTokenSet(hay, school.state);
  const b = schoolTokenSet(school.school_name, school.state);
  const jac = jaccard(a, b);
  const distinctive = [...a].filter((token) => !TYPE_TOKENS.has(token) && token.length >= 4);
  const contained = distinctive.length > 0 && distinctive.every((token) => b.has(token)) ? 0.8 : 0;
  return Math.max(acronym, exact, jac, contained);
}

function scoreFragment(frag: string, title: string, school: ListedSchool): number {
  const base = scoreHint(frag, school);
  if (base < 0.4) return base;
  const titleGrade = gradeFromTitle(title);
  const schoolGrade = gradeFromSchoolName(school.school_name);
  if (gradesCompatible(titleGrade, schoolGrade)) return Math.min(1, base + 0.2);
  if (titleGrade && schoolGrade && !gradesCompatible(titleGrade, schoolGrade)) {
    return Math.max(0, base - 0.15);
  }
  return base;
}

function uniqueHitForFragment(
  frag: string,
  title: string,
  schools: ListedSchool[],
): { school: ListedSchool; score: number } | null {
  const scored = schools
    .map((school) => ({ school, score: scoreFragment(frag, title, school) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < 0.55) return null;
  if (second && best.score - second.score < 0.08 && best.score < 0.95) return null;
  return best;
}

const GENERIC_PATH = /^(directory|staff|faculty|our staff|schools|home|index|search)?$/i;

function hintFromPerson(person: HarvestedPerson): string {
  if (person.school_hint.trim()) return person.school_hint;
  const fromHost = schoolHintFromHost(person.source_url);
  if (fromHost) return fromHost;
  if (person.evidence !== 'school_url' && person.evidence !== 'path' && person.evidence !== 'heading') return '';
  try {
    const parsed = new URL(person.source_url);
    const fromPath = decodeURIComponent(parsed.pathname).replace(/[-_/]+/g, ' ').trim();
    if (fromPath && !GENERIC_PATH.test(fromPath) && looksLikeSchoolName(fromPath)) return fromPath;
  } catch {
    // ignore
  }
  return '';
}

export function attributePerson(person: HarvestedPerson, schools: ListedSchool[]): Attribution {
  const hay = hintFromPerson(person);
  if (!hay) {
    return { contact: null, review_reason: 'missing_school_hint', score: 0, ncessch: '', school_name: '' };
  }
  const fragments = hintFragments(hay);
  const uniqueHits = fragments
    .map((frag, index) => {
      const hit = uniqueHitForFragment(frag, person.title, schools);
      return hit ? { ...hit, index } : null;
    })
    .filter((row): row is { school: ListedSchool; score: number; index: number } => Boolean(row));

  const titleGrade = gradeFromTitle(person.title);
  const gradeHits = titleGrade
    ? uniqueHits.filter((row) => gradesCompatible(titleGrade, gradeFromSchoolName(row.school.school_name)))
    : uniqueHits;
  const pool = gradeHits.length > 0 ? gradeHits : uniqueHits;
  pool.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = pool[0];

  if (!best) {
    const scored = schools
      .map((school) => ({ school, score: scoreFragment(hay, person.title, school) }))
      .sort((a, b) => b.score - a.score);
    const whole = scored[0];
    const second = scored[1];
    if (!whole || whole.score < 0.55) {
      return {
        contact: null,
        review_reason: 'low_school_score',
        score: whole?.score ?? 0,
        ncessch: '',
        school_name: '',
      };
    }
    if (second && whole.score - second.score < 0.08 && whole.score < 0.95) {
      return {
        contact: null,
        review_reason: 'ambiguous_school',
        score: whole.score,
        ncessch: '',
        school_name: '',
      };
    }
    return finishAttribution(person, whole.school, whole.score);
  }

  return finishAttribution(person, best.school, best.score);
}

function finishAttribution(person: HarvestedPerson, school: ListedSchool, score: number): Attribution {
  if (school.excluded) {
    return {
      contact: null,
      review_reason: 'excluded_school',
      score,
      ncessch: school.ncessch,
      school_name: school.school_name,
    };
  }
  const first = person.first_name.replace(/\b\w/g, (ch) => ch.toUpperCase());
  const last = person.last_name.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return {
    contact: {
      ncessch: school.ncessch,
      leaid: school.leaid,
      school_name: school.school_name,
      first_name: first,
      last_name: last,
      title: person.title,
      email: person.email.toLowerCase(),
      linkedin_url: '',
      company: school.school_name,
      phone: '',
      provider: 'directory',
      email_risk: '',
      person_id: person.email || `${school.ncessch}:${first}:${last}`,
    },
    review_reason: '',
    score,
    ncessch: school.ncessch,
    school_name: school.school_name,
  };
}

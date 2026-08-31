import type { SchoolRole } from './types.js';

const TEACHER_RE =
  /\b(teacher|classroom educator|grade\s*\d+|kindergarten|1st grade|2nd grade|3rd grade|4th grade|5th grade)\b/i;
const DISTRICT_RE =
  /\b(superintendent|assistant superintendent|deputy superintendent|chief academic officer|board member)\b/i;
const EXCLUDE_RE =
  /\b(cafeteria|custodian|bus driver|nurse|secretary|clerk|receptionist|paraprofessional|aide|substitute|administrative assistant|assistant to the)\b/i;
const ASSISTANT_PRINCIPAL_RE =
  /\b(assistant principal|asst\.?\s*principal|ast\.?\s*principal|vice principal|vice-principal|associate principal)\b/i;
const PRINCIPAL_RE = /\bprincipal\b/i;
const CURRICULUM_RE =
  /\b(instructional coach|instruc(?:tional)?\s*coach|inst(?:ruc)?\s*coach|academic coach|learning coach|literacy coach|math coach|curriculum|instruction(al)?\s+(coordinator|specialist|director|leader)|director of (curriculum|instruction)|instructional specialist|tosa)\b/i;

export const ROLE_FILL_ORDER: SchoolRole[] = ['curriculum', 'assistant_principal', 'principal'];

export function classifySchoolRole(title: string | undefined): SchoolRole {
  const value = (title ?? '').trim();
  if (!value) return 'unknown';
  if (EXCLUDE_RE.test(value)) return 'excluded';
  if (DISTRICT_RE.test(value)) return 'district';
  if (TEACHER_RE.test(value) && !CURRICULUM_RE.test(value) && !ASSISTANT_PRINCIPAL_RE.test(value)) {
    return 'teacher';
  }
  if (ASSISTANT_PRINCIPAL_RE.test(value)) return 'assistant_principal';
  if (PRINCIPAL_RE.test(value)) return 'principal';
  if (CURRICULUM_RE.test(value)) return 'curriculum';
  return 'unknown';
}

export function roleIsEligible(role: SchoolRole): boolean {
  return role === 'curriculum' || role === 'assistant_principal' || role === 'principal';
}

export function moltsetsTitleForRole(role: SchoolRole): string {
  if (role === 'curriculum') return 'Instructional Coach';
  if (role === 'assistant_principal') return 'Assistant Principal';
  return 'Principal';
}

export function apolloTitlesForRoles(roles: SchoolRole[]): string[] {
  const titles: string[] = [];
  for (const role of roles) {
    if (role === 'curriculum') {
      titles.push(
        'Instructional Coach',
        'Curriculum Coordinator',
        'Director of Curriculum',
        'Director of Instruction',
      );
    } else if (role === 'assistant_principal') {
      titles.push('Assistant Principal', 'Vice Principal', 'Associate Principal');
    } else if (role === 'principal') {
      titles.push('Principal');
    }
  }
  return [...new Set(titles)];
}

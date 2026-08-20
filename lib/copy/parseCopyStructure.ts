import { isCopyPieceKind, type CopyPieceKind } from './kinds';
import {
  isVerbatimCopySpan,
  normalizeCopyWhitespace,
  renderCopyDisplayText,
} from './normalizeCopy';

export const COPY_PARSE_PROMPT_VERSION = 3;
export const COPY_PARSE_MAX_SPAN_LENGTH = 600;
export const COPY_PARSE_MAX_PIECES_PER_KIND = 6;
export const COPY_PARSE_MAX_ARCHETYPE_CANDIDATES_PER_KIND = 30;

export interface CopyArchetypeCandidate {
  id: string;
  kind: CopyPieceKind;
  slug: string;
  name: string;
  description?: string | null;
}

export interface CopyStructurePromptInput {
  subject: string;
  body: string;
  archetypes?: readonly CopyArchetypeCandidate[];
}

export interface ParsedCopyPiece {
  kind: CopyPieceKind;
  rawText: string;
  displayText: string;
  position: number;
  archetype: {
    existingId: string | null;
    slug: string;
    name: string;
    description: string | null;
  };
}

export class CopyStructureParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopyStructureParseError';
  }
}

export function buildCopyStructurePrompt(input: CopyStructurePromptInput): {
  system: string;
  user: string;
} {
  const candidateCounts = new Map<CopyPieceKind, number>();
  const candidates = (input.archetypes ?? [])
    .filter((candidate) => {
      const count = candidateCounts.get(candidate.kind) ?? 0;
      if (count >= COPY_PARSE_MAX_ARCHETYPE_CANDIDATES_PER_KIND) return false;
      candidateCounts.set(candidate.kind, count + 1);
      return true;
    })
    .map((candidate) => ({
      kind: candidate.kind,
      slug: candidate.slug,
      name: candidate.name,
      description: candidate.description ?? '',
    }));

  const system = [
    'You extract reusable copy structures from cold-outreach email templates.',
    '',
    'Allowed kinds:',
    '- subject: the email subject line',
    '- hook: the opening angle that earns attention',
    '- problem: the pain, risk, or missed opportunity described',
    '- proof: evidence, credibility, example, result, or social proof',
    '- offer: what the sender proposes to provide or do',
    '- cta: the requested next action or question',
    '',
    'Rules:',
    '1. Return only spans that appear VERBATIM in the supplied subject or body.',
    '2. Preserve merge tags and spintax exactly. Never paraphrase or render them.',
    '3. Multiple pieces of a kind are allowed, especially proof bullets.',
    `4. Return at most ${COPY_PARSE_MAX_PIECES_PER_KIND} pieces per kind and ${COPY_PARSE_MAX_SPAN_LENGTH} characters per span.`,
    '5. Reuse a candidate archetype slug ONLY when the candidate uses the same persuasion angle, emotional lever, or structural approach. Do not match solely because two pieces share a kind.',
    '6. If no candidate matches, propose a new short stable kebab-case slug. Multiple new archetypes per kind are allowed when the pieces use distinct strategies.',
    '7. Archetype names must describe the specific strategy or angle (e.g. "Growth-capacity pain", "ROI case study proof", "Compliance-risk urgency"). Never use generic names like "Email Subject", "Main Hook", or "Call to Action".',
    '8. For subject pieces: use the subject text itself (cleaned of merge tags) as the archetype name. Two subjects share an archetype ONLY when they convey the same message in nearly identical words.',
    '9. position is the zero-based character offset in the subject/body source.',
    '',
    'Respond with only JSON:',
    '{"pieces":[{"kind":"subject|hook|problem|proof|offer|cta","text":"verbatim span","position":0,"archetype_slug":"stable-slug","archetype_name":"Readable name","archetype_description":"Short description"}]}',
  ].join('\n');

  const user = [
    'SUBJECT:',
    input.subject || '(none)',
    '',
    'BODY:',
    input.body || '(none)',
    '',
    'AVAILABLE ARCHETYPES:',
    candidates.length > 0 ? JSON.stringify(candidates) : '[]',
  ].join('\n');

  return { system, user };
}

function coerceJsonObject(parsed: unknown): Record<string, unknown> | null {
  if (Array.isArray(parsed)) return { pieces: parsed };
  if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  return null;
}

function stripTrailingCommas(value: string): string {
  return value.replace(/,\s*([}\]])/g, '$1');
}

function tryParseJsonObject(candidate: string): Record<string, unknown> | null {
  for (const variant of [candidate, stripTrailingCommas(candidate)]) {
    try {
      const coerced = coerceJsonObject(JSON.parse(variant));
      if (coerced) return coerced;
    } catch {
      // Try the next repair.
    }
  }
  return null;
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    candidates.push(trimmed.slice(braceStart, braceEnd + 1));
  }
  const bracketStart = trimmed.indexOf('[');
  const bracketEnd = trimmed.lastIndexOf(']');
  if (bracketStart >= 0 && bracketEnd > bracketStart) {
    candidates.push(trimmed.slice(bracketStart, bracketEnd + 1));
  }

  for (const candidate of candidates) {
    const parsed = tryParseJsonObject(candidate);
    if (parsed) return parsed;
  }
  throw new CopyStructureParseError('Model returned malformed JSON');
}

function piecesFromEnvelope(parsed: Record<string, unknown>, depth = 0): unknown[] | null {
  if (depth > 2) return null;
  for (const [key, value] of Object.entries(parsed)) {
    if (key.toLowerCase() === 'pieces' && Array.isArray(value)) return value;
  }
  for (const value of Object.values(parsed)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = piecesFromEnvelope(value as Record<string, unknown>, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function sanitizeSlug(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function sourceForKind(
  kind: CopyPieceKind,
  subject: string,
  body: string,
): string {
  return kind === 'subject' ? subject : body;
}

/**
 * Parse and defensively validate model output. Invalid spans are dropped; an
 * invalid response envelope throws so callers can retry without partial data.
 */
export function parseCopyStructureResponse(
  raw: string,
  input: CopyStructurePromptInput,
): ParsedCopyPiece[] {
  const parsed = extractJsonObject(raw);
  const pieceRows = piecesFromEnvelope(parsed);
  if (!pieceRows) {
    throw new CopyStructureParseError('Model response must contain a pieces array');
  }

  const candidatesByKey = new Map(
    (input.archetypes ?? []).map((candidate) => [
      `${candidate.kind}:${candidate.slug}`,
      candidate,
    ]),
  );
  const counts = new Map<CopyPieceKind, number>();
  const result: ParsedCopyPiece[] = [];

  for (const item of pieceRows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (!isCopyPieceKind(row.kind) || typeof row.text !== 'string') continue;

    const kind = row.kind;
    if ((counts.get(kind) ?? 0) >= COPY_PARSE_MAX_PIECES_PER_KIND) continue;

    const rawText = row.text;
    if (
      rawText.length === 0 ||
      rawText.length > COPY_PARSE_MAX_SPAN_LENGTH ||
      !isVerbatimCopySpan(rawText, sourceForKind(kind, input.subject, input.body))
    ) {
      continue;
    }

    const slug = sanitizeSlug(row.archetype_slug);
    if (!slug) continue;
    const existing = candidatesByKey.get(`${kind}:${slug}`);

    let archetype: ParsedCopyPiece['archetype'];
    if (existing) {
      archetype = {
        existingId: existing.id,
        slug: existing.slug,
        name: existing.name,
        description: existing.description ?? null,
      };
    } else {
      const name =
        typeof row.archetype_name === 'string'
          ? normalizeCopyWhitespace(row.archetype_name).slice(0, 120)
          : '';
      archetype = {
        existingId: null,
        slug,
        name: name || slug.replace(/-/g, ' '),
        description:
          typeof row.archetype_description === 'string'
            ? normalizeCopyWhitespace(row.archetype_description).slice(0, 500) || null
            : null,
      };
    }

    result.push({
      kind,
      rawText,
      displayText: renderCopyDisplayText(rawText),
      position:
        typeof row.position === 'number' && Number.isFinite(row.position)
          ? Math.max(0, Math.trunc(row.position))
          : 0,
      archetype,
    });
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return result;
}

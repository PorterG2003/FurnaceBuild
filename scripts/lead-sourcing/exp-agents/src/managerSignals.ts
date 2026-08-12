export type ManagerConfidence = 'high' | 'medium' | 'none';

export type ManagerSignalInput = {
  title?: string;
  positionTypes?: string[];
  description?: string;
};

export type ManagerSignalResult = {
  confidence: ManagerConfidence;
  score: number;
  categories: string[];
  evidence: string[];
};

function clean(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function addSignal(
  result: Omit<ManagerSignalResult, 'confidence'>,
  options: {
    score: number;
    category: string;
    evidence: string;
  },
): void {
  result.score = Math.max(result.score, options.score);
  if (!result.categories.includes(options.category)) {
    result.categories.push(options.category);
  }
  if (!result.evidence.includes(options.evidence)) {
    result.evidence.push(options.evidence);
  }
}

const EXPLICIT_BROKERAGE_ROLE =
  /\b(designated managing broker|broker of record|broker[- ]in[- ]charge)\b/i;

const EXPLICIT_TEAM_ROLE =
  /\b(team (leader|lead|owner|president|ceo)|broker[ /-]*owner|owner[ /-]*broker)\b/i;

const QUANTIFIED_AGENT_ORG =
  /\b(manag(?:e|es|ing)|overse(?:e|es|eing)|lead(?:s|ing)?|support(?:s|ing)?)\b.{0,40}\b\d{1,3}(?:,\d{3})*\s*(agents?|realtors?)\b/i;

// Proper-noun "X Team" only (capital T). Avoid "a team of professionals".
// Keep "of|at" adjacent to founder/owner so later "at eXp" does not steal the match.
const FOUNDER_OF_TEAM =
  /\b(?:[Ff]ounder|[Oo]wner|[Cc]o-?[Ff]ounder)\s+(?:of|at)\s+(?:the\s+)?(?:[A-Z][\w'&.-]*\s+){1,6}Team\b/;

/**
 * Classify first-party roster signals for people who manage agents.
 * Prefer structured title/position fields; only accept strong description phrases.
 */
export function classifyManagerSignals(input: ManagerSignalInput): ManagerSignalResult {
  const title = clean(input.title ?? '');
  const positions = clean((input.positionTypes ?? []).join(' | '));
  const description = clean(input.description ?? '');
  const structured = [title, positions].filter(Boolean).join(' | ');
  const result: Omit<ManagerSignalResult, 'confidence'> = {
    score: 0,
    categories: [],
    evidence: [],
  };

  // High: explicit brokerage-management roles (structured preferred, description allowed).
  if (EXPLICIT_BROKERAGE_ROLE.test(structured) || EXPLICIT_BROKERAGE_ROLE.test(description)) {
    addSignal(result, {
      score: 95,
      category: 'brokerage_manager',
      evidence: 'explicit brokerage-management role',
    });
  }

  // High: explicit team ownership/leadership in structured fields.
  if (EXPLICIT_TEAM_ROLE.test(structured)) {
    addSignal(result, {
      score: 90,
      category: 'team_leader',
      evidence: 'explicit team ownership or leadership',
    });
  } else if (EXPLICIT_TEAM_ROLE.test(description) || FOUNDER_OF_TEAM.test(description)) {
    // Description-only team signals are slightly weaker but still high when explicit.
    addSignal(result, {
      score: 85,
      category: 'team_leader',
      evidence: 'explicit team ownership or leadership in profile description',
    });
  }

  // High: quantified agent-organization leadership (structured or description).
  if (QUANTIFIED_AGENT_ORG.test(structured) || QUANTIFIED_AGENT_ORG.test(description)) {
    addSignal(result, {
      score: 90,
      category: 'agent_organization_leader',
      evidence: 'explicitly manages or supports a quantified agent organization',
    });
  }

  if (/\b(director|head|vp|vice president) of operations\b/i.test(structured)) {
    addSignal(result, {
      score: 80,
      category: 'operations_leader',
      evidence: 'structured operations-leadership title',
    });
  }

  // Medium: unqualified managing/principal broker titles (license-like, not proof of agent management).
  // Do NOT treat bare "state broker" / "WA State Broker" as management.
  if (/\b(principal broker|managing broker)\b/i.test(structured)) {
    addSignal(result, {
      score: 65,
      category: 'possible_brokerage_manager',
      evidence: 'broker-management title without proof of agent supervision',
    });
  }

  const confidence: ManagerConfidence =
    result.score >= 80 ? 'high' : result.score >= 50 ? 'medium' : 'none';
  return { ...result, confidence };
}

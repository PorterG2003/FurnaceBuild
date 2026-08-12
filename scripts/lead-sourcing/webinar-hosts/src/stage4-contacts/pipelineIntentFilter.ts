export type PipelineIntentDecision = {
  pass: boolean;
  reason: string;
};

type DenyPattern = {
  id: string;
  re: RegExp;
};

const DENY_PATTERNS: DenyPattern[] = [
  {
    id: 'internal_only',
    re: /\b(all[- ]hands|town hall|staff meeting|mandatory staff training|internal (webinar|training)|for employees only|team members only)\b/i,
  },
  {
    id: 'recruiting_only',
    re: /\b(job fair|career fair|recruitment webinar|we['']?re hiring|open positions|apply now for (this|the) role)\b/i,
  },
  {
    id: 'pure_civic',
    re: /\b(voter registration|public hearing|census|ballot measure)\b/i,
  },
  {
    id: 'memorial_support',
    re: /\b(grief support|memorial service|bereavement|in memoriam)\b/i,
  },
  {
    id: 'academic_formal',
    re: /\b(thesis defense|dissertation defense|oral exam|phd defense)\b/i,
  },
];

export function evaluatePipelineIntent(postText: string): PipelineIntentDecision {
  const text = postText.trim();
  if (!text) {
    return { pass: true, reason: 'no_post_text' };
  }

  for (const pattern of DENY_PATTERNS) {
    if (pattern.re.test(text)) {
      return { pass: false, reason: `pipeline_${pattern.id}` };
    }
  }

  return { pass: true, reason: 'pipeline_plausible' };
}

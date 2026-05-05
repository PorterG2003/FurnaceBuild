import type {
  QuizAndBookBlockProps,
  QuizAndBookQuestion,
  QuizAndBookQuestionOption,
  QuizAndBookQuestionType,
} from './types';

export const QUIZ_AND_BOOK_QUESTION_TYPES = [
  'single_select',
  'multi_select',
  'text',
  'textarea',
  'dropdown',
] as const satisfies readonly QuizAndBookQuestionType[];

export const DEFAULT_QUIZ_AND_BOOK_CALENDLY_URL = 'https://calendly.com/drfoottraffic/15min';
export const DEFAULT_QUIZ_AND_BOOK_SUMMARY_HEADING = 'Perfect.';
export const DEFAULT_QUIZ_AND_BOOK_SUMMARY_BODY =
  'Next step is scheduling our meeting to review your strategy and discuss options.';

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createQuizAndBookOption(label = ''): QuizAndBookQuestionOption {
  return {
    id: randomId('quiz-opt'),
    label,
  };
}

export function createQuizAndBookQuestion(
  type: QuizAndBookQuestionType = 'single_select',
  prompt = 'Question',
): QuizAndBookQuestion {
  const base: QuizAndBookQuestion = {
    id: randomId('quiz-q'),
    type,
    prompt,
    required: true,
  };
  if (type === 'single_select' || type === 'multi_select' || type === 'dropdown') {
    return {
      ...base,
      options: [createQuizAndBookOption('Option 1'), createQuizAndBookOption('Option 2')],
    };
  }
  return {
    ...base,
    placeholder: type === 'textarea' ? 'Type your answer...' : 'Your answer',
  };
}

export function createDefaultQuizAndBookProps(): QuizAndBookBlockProps {
  return {
    heading: 'A few quick questions before we build your plan.',
    subheading: 'Use this block to qualify interest, tailor the conversation, and move straight into booking.',
    questions: [createQuizAndBookQuestion()],
    summaryHeading: DEFAULT_QUIZ_AND_BOOK_SUMMARY_HEADING,
    summaryBody: DEFAULT_QUIZ_AND_BOOK_SUMMARY_BODY,
    calendlyUrl: DEFAULT_QUIZ_AND_BOOK_CALENDLY_URL,
  };
}

export function questionTypeSupportsOptions(type: QuizAndBookQuestionType): boolean {
  return type === 'single_select' || type === 'multi_select' || type === 'dropdown';
}

export function questionTypeSupportsPlaceholder(type: QuizAndBookQuestionType): boolean {
  return type === 'text' || type === 'textarea';
}

export function questionTypeLabel(type: QuizAndBookQuestionType): string {
  switch (type) {
    case 'single_select':
      return 'Single select';
    case 'multi_select':
      return 'Multi select';
    case 'text':
      return 'Text';
    case 'textarea':
      return 'Textarea';
    case 'dropdown':
      return 'Dropdown';
    default:
      return type;
  }
}

export type QuizAndBookResponseValue = string | string[];

export function formatQuizAndBookAnswer(
  question: QuizAndBookQuestion,
  value: QuizAndBookResponseValue | undefined,
): string {
  if (value == null) return '';
  if (Array.isArray(value)) {
    const labels = value
      .map((id) => question.options?.find((option) => option.id === id)?.label?.trim() ?? '')
      .filter(Boolean);
    return labels.join(', ');
  }
  if (questionTypeSupportsOptions(question.type)) {
    return question.options?.find((option) => option.id === value)?.label?.trim() ?? '';
  }
  return value.trim();
}

export function normalizeQuizAndBookResponseValue(
  question: QuizAndBookQuestion,
  raw: unknown,
): QuizAndBookResponseValue | undefined {
  if (question.type === 'multi_select') {
    if (!Array.isArray(raw)) return undefined;
    const valid = new Set((question.options ?? []).map((option) => option.id));
    const selected = raw
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => valid.has(value));
    return selected.length > 0 ? selected : undefined;
  }
  if (questionTypeSupportsOptions(question.type)) {
    if (typeof raw !== 'string') return undefined;
    const valid = new Set((question.options ?? []).map((option) => option.id));
    const next = raw.trim();
    return valid.has(next) ? next : undefined;
  }
  if (typeof raw !== 'string') return undefined;
  const next = raw.trim();
  return next ? next : undefined;
}

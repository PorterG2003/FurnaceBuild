import { isErrorPage, pageBodyText } from '../lib/html.js';

export type CeFormat = 'live_online' | 'in_person' | 'on_demand';

export type CeFormatDetection = {
  ce_formats: CeFormat[];
  ce_formats_csv: string;
  primary_ce_format: CeFormat | 'unknown';
  has_live_online: boolean;
};

const FORMAT_ORDER: CeFormat[] = ['live_online', 'in_person', 'on_demand'];

const EMPTY_FORMAT: CeFormatDetection = {
  ce_formats: [],
  ce_formats_csv: '',
  primary_ce_format: 'unknown',
  has_live_online: false,
};

const LUNCH_RE = /lunch[\s-]*(?:&|and)[\s-]*learn/i;

/** Live online including on-request 1:1 virtual sessions — not a public calendar requirement. */
const LIVE_ONLINE_RE =
  /\b(?:live\s+online|online\s+live|live\s+virtual|virtual\s+live|live\s+webinar|live\s+webcast|live\s+event|webcast|web\s*cast|virtual\s+(?:lunch|session|presentation|event|class|ceu|ce|course|duration)|(?:book|schedule|request|booked)\s+a\s+virtual|join\s+(?:us\s+)?(?:via\s+)?zoom|zoom\s+webinar|microsoft\s+teams|google\s+meet|virtual\s+or\s+in[-\s]?person|in[-\s]?person\s+or\s+virtual|online\s+lunch(?:[\s-]*(?:&|and)[\s-]*learn)?|(?:host(?:ed)?|present(?:ed)?|deliver(?:ed)?)\s+(?:the\s+)?(?:presentation|course|session)s?\s+virtually|virtually\s+(?:via|so\s+you\s+can\s+attend))\b/i;

/** Bare "Webinars" in a nav is not enough; need live/join/upcoming context. */
const LIVE_WEBINAR_RE =
  /\b(?:live|upcoming|next|join(?:\s+us)?(?:\s+for)?(?:\s+our)?|register(?:\s+for)?(?:\s+our)?|ceu|free)\s+[^.]{0,40}\bwebinars?\b|\bwebinars?\b[^.]{0,40}\b(?:live|upcoming|register|join)\b|\bvia\s+webinars?\b|\bceu\s+webinars?\b/i;

const RECORDED_WEBINAR_RE =
  /\b(?:recorded|on[-\s]?demand|archived)\s+webinars?\b|\bwebinar\s+(?:recording|replay|archive)s?\b/i;

const IN_PERSON_RE =
  /\b(?:in[-\s]?person|in[-\s]?office|at\s+your\s+(?:firm|office|practice|agency)|in\s+your\s+(?:office|firm|practice)|on[-\s]?site\s+(?:lunch|training|presentation|ceu|ce))\b/i;

const ON_DEMAND_RE =
  /\b(?:on[-\s]?demand|self[-\s]?paced|at\s+your\s+own\s+pace|article\s+and\s+quiz|read\s+(?:the\s+)?article|take\s+(?:the|a)\s+quiz|complete\s+(?:the\s+)?quiz|recorded\s+webinar|webinar\s+recording|start\s+the\s+course|watch\s+(?:the\s+)?(?:recording|replay))\b/i;

const MIXED_LIVE_ON_DEMAND_RE =
  /\b(?:live\s+and\s+on[-\s]?demand|on[-\s]?demand\s+and\s+live|live\s*&\s*on[-\s]?demand)\b/i;

const LIVE_DATE_RE =
  /\blive:\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d)/i;

const UPCOMING_TRAINING_RE =
  /\b(?:upcoming\s+trainings?|register\s+for\s+(?:our\s+)?live)\b/i;

const LIVE_TRAINING_PHRASE_RE =
  /\b(?:upcoming\s+live|live\s+trainings?|live\s+workshops?|live\s+classes?)\b/gi;

/** Scheduled class copy — not bare "you live" and not "recorded live training". */
export function hasScheduledLive(text: string): boolean {
  if (MIXED_LIVE_ON_DEMAND_RE.test(text) || LIVE_DATE_RE.test(text) || UPCOMING_TRAINING_RE.test(text)) {
    return true;
  }
  LIVE_TRAINING_PHRASE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LIVE_TRAINING_PHRASE_RE.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 28), match.index).toLowerCase();
    if (/(?:recorded|on[-\s]?demand|archived)\s+$/.test(before)) continue;
    return true;
  }
  return false;
}

export function detectCeFormat(text: string): CeFormatDetection {
  const found = new Set<CeFormat>();

  const livePhrase = LIVE_ONLINE_RE.test(text);
  const liveWebinar = LIVE_WEBINAR_RE.test(text);
  const scheduledLive = hasScheduledLive(text);
  const recordedWebinar = RECORDED_WEBINAR_RE.test(text);
  if (livePhrase || liveWebinar || scheduledLive) found.add('live_online');
  if (recordedWebinar) found.add('on_demand');

  if (ON_DEMAND_RE.test(text)) found.add('on_demand');
  if (IN_PERSON_RE.test(text)) found.add('in_person');

  if (LUNCH_RE.test(text)) {
    if (livePhrase) found.add('live_online');
    if (IN_PERSON_RE.test(text) || !livePhrase) found.add('in_person');
  }

  const ce_formats = FORMAT_ORDER.filter((f) => found.has(f));
  const primary_ce_format = ce_formats[0] ?? 'unknown';
  return {
    ce_formats,
    ce_formats_csv: ce_formats.join('|'),
    primary_ce_format,
    has_live_online: found.has('live_online'),
  };
}

export function detectCeFormatFromHtml(html: string, extraText = ''): CeFormatDetection {
  if (!html.trim() && !extraText.trim()) return EMPTY_FORMAT;
  if (html.trim() && isErrorPage(html)) {
    return extraText.trim() ? detectCeFormat(extraText) : EMPTY_FORMAT;
  }
  const body = html.trim() ? pageBodyText(html) : '';
  return detectCeFormat(`${extraText} ${body}`.trim());
}

export function parseCeFormatsCsv(value: string | undefined): CeFormat[] {
  if (!value) return [];
  return value
    .split('|')
    .map((part) => part.trim())
    .filter((part): part is CeFormat => part === 'live_online' || part === 'in_person' || part === 'on_demand');
}

export function mergeCeFormats(rows: Array<{ ce_formats?: string; has_live_online?: unknown }>): CeFormatDetection {
  const found = new Set<CeFormat>();
  let liveFlag = false;
  for (const row of rows) {
    for (const format of parseCeFormatsCsv(row.ce_formats)) found.add(format);
    if (row.has_live_online === true || row.has_live_online === 'true') liveFlag = true;
  }
  if (liveFlag) found.add('live_online');
  const ce_formats = FORMAT_ORDER.filter((f) => found.has(f));
  const primary_ce_format = ce_formats[0] ?? 'unknown';
  return {
    ce_formats,
    ce_formats_csv: ce_formats.join('|'),
    primary_ce_format,
    has_live_online: ce_formats.includes('live_online'),
  };
}

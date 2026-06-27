/**
 * Professional demo copy for onboarding clips (no real PII, no QA tags).
 */

export const DEMO_ACCOUNT_NAME = 'Acme Example Co.';
export const DEMO_OWNER_NAME = 'Porter Gardiner';
export const DEMO_OWNER_FIRST_NAME = 'Porter';
export const DEMO_OWNER_LAST_NAME = 'Gardiner';

export const DEMO_CAMPAIGN_NAMES = [
  'Q2 Founder Outreach',
  'Webinar Follow-up',
  'Legacy Re-engagement',
  'Enterprise Sequence v2',
] as const;

const MAILBOX_DISPLAY_NAMES = [
  'Porter Gardiner',
  'Alex on Sales',
  'Jordan Chen',
  'Morgan Lee',
  'Taylor Brooks',
  'Casey Nguyen',
  'Riley Patel',
  'Sam Ortiz',
  'Jamie Walsh',
  'Drew Kim',
  'Avery Santos',
  'Quinn Rivera',
  'Blake Morgan',
  'Cameron Ellis',
  'Dakota Hughes',
  'Emery Foster',
  'Finley Gray',
  'Harper Reed',
  'Indigo Shaw',
  'Jules Bennett',
  'Kai Morrison',
  'Lane Porter',
  'Marlowe Hayes',
  'Noel Bryant',
  'Oakley Price',
  'Parker Sloan',
  'Reese Dalton',
  'Sage Holloway',
  'Tatum Archer',
  'Wren Collins',
] as const;

const LEAD_PERSONAS = [
  { firstName: 'Sarah', lastName: 'Mitchell', company: 'Brightline Analytics' },
  { firstName: 'Marcus', lastName: 'Webb', company: 'Northwind Systems' },
  { firstName: 'Elena', lastName: 'Torres', company: 'Summit HR Partners' },
  { firstName: 'David', lastName: 'Park', company: 'Clearpath Logistics' },
  { firstName: 'Priya', lastName: 'Sharma', company: 'Vertex Cloud' },
  { firstName: 'James', lastName: 'Holland', company: 'Redwood Capital' },
  { firstName: 'Lisa', lastName: 'Nguyen', company: 'Atlas Manufacturing' },
  { firstName: 'Chris', lastName: 'Brennan', company: 'Horizon Legal Group' },
  { firstName: 'Amanda', lastName: 'Foster', company: 'Pulse Health Tech' },
  { firstName: 'Ryan', lastName: 'Cooper', company: 'Sterling Advisory' },
  { firstName: 'Nina', lastName: 'Patel', company: 'Lumen Data' },
  { firstName: 'Kevin', lastName: 'Walsh', company: 'Bridgepoint Media' },
] as const;

const THREAD_SUBJECTS = [
  'Re: quick question about your outbound',
  'Following up from the webinar',
  'Re: intro from Alex on Sales',
  'Re: timing for a quick call',
  'Re: your note on pipeline coverage',
  'Re: Acme Example Co. outreach',
  'Re: resources you mentioned',
  'Re: next steps for the team',
  'Re: scheduling a demo',
  'Re: pricing overview',
] as const;

export function demoCampaignName(index: number): string {
  return DEMO_CAMPAIGN_NAMES[index] ?? DEMO_CAMPAIGN_NAMES[0];
}

export function demoMailboxDisplayName(index: number): string {
  return MAILBOX_DISPLAY_NAMES[index % MAILBOX_DISPLAY_NAMES.length] ?? DEMO_OWNER_NAME;
}

export function demoLeadPersona(index: number) {
  const persona = LEAD_PERSONAS[index % LEAD_PERSONAS.length] ?? LEAD_PERSONAS[0];
  return {
    firstName: persona.firstName,
    lastName: persona.lastName,
    name: `${persona.firstName} ${persona.lastName}`,
    companyName: persona.company,
  };
}

export function demoThreadSubject(index: number): string {
  return THREAD_SUBJECTS[index % THREAD_SUBJECTS.length] ?? THREAD_SUBJECTS[0];
}

export function demoOutboundBody(index: number): string {
  return `Hi — reaching out from ${DEMO_ACCOUNT_NAME} about your team's outbound workflow. Open to a quick chat this week? (${index + 1})`;
}

export function demoReplyBody(index: number, tone: 'interested' | 'neutral' | 'not_interested' | 'ooo'): string {
  switch (tone) {
    case 'interested':
      return 'Thanks for reaching out — this is relevant. Can you send a few times for a call next week?';
    case 'neutral':
      return "Appreciate the note. We're evaluating vendors later this quarter and will circle back.";
    case 'not_interested':
      return "Thanks, but we're all set on outbound tooling for now.";
    case 'ooo':
      return "I'm out of the office until next Tuesday with limited email access.";
    default:
      return demoReplyBody(index, 'neutral');
  }
}

export const DEMO_HERO_THREAD_KEYS = {
  interested: 'hero-interested',
  neutral: 'hero-neutral',
  ooo: 'hero-ooo',
  replacedOld: 'hero-replaced-old',
  replacedNew: 'hero-replaced-new',
  unread: 'hero-unread',
  multiMessage: 'hero-multi-message',
  notInterested: 'hero-not-interested',
} as const;

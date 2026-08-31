export const DOOR_IDS = ['cold_email', 'webinar', 'pe_sourcing'] as const;
export type DoorId = (typeof DOOR_IDS)[number];

export const PROOF_WEIGHT: Record<DoorId, number> = {
  webinar: 1.15,
  cold_email: 1.0,
  pe_sourcing: 0.7,
};

export const PE_DOOR_ENABLED = false;

export const SECONDARY_DOOR_DELTA = 15;

export const COLD_EMAIL_HEADCOUNT_CEILING = 200;
export const LOW_END_REVENUE = 400_000;
export const FUNDING_WINDOW_MONTHS = 18;
export const COLD_EMAIL_MIN_SCORE = 40;

export const WEBINAR_RUNS_THRESHOLD = 0.6;
export const WEBINAR_RECENCY_MONTHS = 12;

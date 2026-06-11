export interface CampaignSchedule {
  timezone: string;
  start_hour: number;
  end_hour: number;
  days_of_week: number[] | null;
}

export declare function isWithinSchedule(time: Date, schedule: CampaignSchedule): boolean;
export declare function calculateNextAllowedTime(baseTime: Date, schedule: CampaignSchedule): Date;
export declare function applyJitter(
  scheduledTime: Date,
  baseTime: Date,
  jitterPercentage: number,
): Date;
export declare function calculateNextRunAt(baseTime: Date, schedule: CampaignSchedule | null): string;
export declare function calculateScheduledAt(
  baseTime: Date,
  schedule: CampaignSchedule | null,
  jitterPercentage?: number,
): string;
export declare function findMostRecentScheduleStart(
  currentTime: Date,
  schedule: CampaignSchedule,
): Date;

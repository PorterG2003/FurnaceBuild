/** Dev-only ECS lease helpers (pure logic; no AWS SDK). */

export const DEV_AWS_ACCOUNT_ID = '686255981838';

export const MAX_LEASE_MS = 8 * 60 * 60 * 1000;
export const DEFAULT_LEASE_MS = 2 * 60 * 60 * 1000;
export const EXTENSION_GUARD_MS = 10 * 60 * 1000;
export const DRAIN_DELAY_MS = 5 * 60 * 1000;

export const ECS_UPDATE_SERVICE_TARGET_ARN = 'arn:aws:scheduler:::aws-sdk:ecs:updateService';

export const LEASE_SCHEDULE_NAMES = {
  scheduler: 'furnace-dev-lease-stop-scheduler',
  send: 'furnace-dev-lease-stop-send',
  inbox: 'furnace-dev-lease-stop-inbox',
} as const;

export type LeaseWorkerKey = keyof typeof LEASE_SCHEDULE_NAMES;

export const ALL_LEASE_SCHEDULE_NAMES: readonly string[] = Object.values(LEASE_SCHEDULE_NAMES);

export const DEV_LEASE_STACK_NAME = 'WorkerStack-Dev';

/** Expected CloudFormation output keys (added by worker-stack CDK). */
export const DEV_LEASE_STACK_OUTPUT_KEYS = {
  scheduleGroupName: 'DevLeaseScheduleGroupName',
  executionRoleArn: 'DevLeaseScheduleExecutionRoleArn',
  dlqArn: 'DevLeaseScheduleDlqArn',
  clusterName: 'ClusterName',
} as const;

export interface WorkerServiceNames {
  scheduler: string;
  send: string;
  inbox: string;
}

export interface ShutdownScheduleEntry {
  name: string;
  worker: LeaseWorkerKey;
  runAtMs: number;
  scheduleExpression: string;
  clusterName: string;
  serviceName: string;
  desiredCount: 0;
  targetArn: typeof ECS_UPDATE_SERVICE_TARGET_ARN;
  actionAfterCompletion: 'DELETE';
  flexibleTimeWindowMode: 'OFF';
  maximumRetryAttempts: 0;
  maximumEventAgeInSeconds: 60;
}

export interface ShutdownSchedulePlan {
  schedulerAtMs: number;
  sendAtMs: number;
  inboxAtMs: number;
  schedules: ShutdownScheduleEntry[];
}

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(h|m|s)$/i;

/** Parse duration strings like `2h`, `90m`, `30m` into milliseconds. */
export function parseDuration(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Duration is required (e.g. 2h, 90m, 30m)');
  }

  const match = DURATION_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration "${input}". Use formats like 2h, 90m, or 30m.`);
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Duration must be positive: "${input}"`);
  }

  const unit = match[2].toLowerCase();
  const multiplier =
    unit === 'h' ? 60 * 60 * 1000 : unit === 'm' ? 60 * 1000 : 1000;

  return Math.round(amount * multiplier);
}

/** Reject lease durations over MAX_LEASE_MS (8 hours). */
export function assertLeaseWithinMax(leaseMs: number): void {
  if (leaseMs <= 0) {
    throw new Error('Lease duration must be positive');
  }
  if (leaseMs > MAX_LEASE_MS) {
    throw new Error(
      `Lease duration exceeds maximum of ${MAX_LEASE_MS / (60 * 60 * 1000)}h (${leaseMs}ms requested)`,
    );
  }
}

export function assertDevOnlyAccount(accountId: string): void {
  if (accountId.trim() !== DEV_AWS_ACCOUNT_ID) {
    throw new Error(
      `Refusing dev lease operation: AWS account must be ${DEV_AWS_ACCOUNT_ID}, got "${accountId}"`,
    );
  }
}

/** Reject cluster/service/role names that target prod resources. */
export function assertNoProdTarget(value: string): void {
  if (/prod/i.test(value)) {
    throw new Error(`Refusing dev lease operation: prod target detected in "${value}"`);
  }
}

/** EventBridge Scheduler one-time expression: at(YYYY-MM-DDThh:mm:ss) in UTC. */
export function formatAtScheduleExpression(runAt: Date): string {
  const iso = runAt.toISOString(); // 2026-08-05T01:02:03.456Z
  const withoutMs = iso.slice(0, 19); // 2026-08-05T01:02:03
  return `at(${withoutMs})`;
}

function buildScheduleEntry(
  worker: LeaseWorkerKey,
  runAtMs: number,
  clusterName: string,
  serviceNames: WorkerServiceNames,
): ShutdownScheduleEntry {
  const serviceName = serviceNames[worker];
  return {
    name: LEASE_SCHEDULE_NAMES[worker],
    worker,
    runAtMs,
    scheduleExpression: formatAtScheduleExpression(new Date(runAtMs)),
    clusterName,
    serviceName,
    desiredCount: 0,
    targetArn: ECS_UPDATE_SERVICE_TARGET_ARN,
    actionAfterCompletion: 'DELETE',
    flexibleTimeWindowMode: 'OFF',
    maximumRetryAttempts: 0,
    maximumEventAgeInSeconds: 60,
  };
}

/**
 * Build shutdown schedules: scheduler first, send/inbox +5 minutes (drain delay).
 * Prefer cost leakage over interrupted work.
 */
export function buildShutdownSchedulePlan(params: {
  now: number;
  leaseMs: number;
  clusterName: string;
  serviceNames: WorkerServiceNames;
}): ShutdownSchedulePlan {
  const { now, leaseMs, clusterName, serviceNames } = params;

  assertNoProdTarget(clusterName);
  for (const serviceName of Object.values(serviceNames)) {
    assertNoProdTarget(serviceName);
  }

  const schedulerAtMs = now + leaseMs;
  const sendAtMs = schedulerAtMs + DRAIN_DELAY_MS;
  const inboxAtMs = schedulerAtMs + DRAIN_DELAY_MS;

  const schedules: ShutdownScheduleEntry[] = [
    buildScheduleEntry('scheduler', schedulerAtMs, clusterName, serviceNames),
    buildScheduleEntry('send', sendAtMs, clusterName, serviceNames),
    buildScheduleEntry('inbox', inboxAtMs, clusterName, serviceNames),
  ];

  return {
    schedulerAtMs,
    sendAtMs,
    inboxAtMs,
    schedules,
  };
}

/** Extension allowed only when more than EXTENSION_GUARD_MS remain before scheduler expiry. */
export function canExtendLease(params: { now: number; schedulerExpiryMs: number }): boolean {
  return params.schedulerExpiryMs - params.now > EXTENSION_GUARD_MS;
}

/** Refuse a new lease while any prior shutdown schedules still exist. */
export function shouldRefuseNewLease(params: { unresolvedScheduleNames: string[] }): boolean {
  return params.unresolvedScheduleNames.length > 0;
}

/** Map schedule list entries to unresolved names among the known lease schedules. */
export function findUnresolvedLeaseSchedules(existingScheduleNames: string[]): string[] {
  const existing = new Set(existingScheduleNames);
  return ALL_LEASE_SCHEDULE_NAMES.filter((name) => existing.has(name));
}

export function buildEcsUpdateServiceTargetInput(entry: ShutdownScheduleEntry): string {
  return JSON.stringify({
    Cluster: entry.clusterName,
    Service: entry.serviceName,
    DesiredCount: entry.desiredCount,
  });
}

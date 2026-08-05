/**
 * IaC source of truth for ECS worker desired counts (bin/workers.ts).
 * Dev stays at 0; prod must never be 0 — a deploy would stop all production workers.
 */
export const WORKER_DESIRED_COUNTS = {
  dev: { send: 0, scheduler: 0, inbox: 0 },
  prod: { send: 1, scheduler: 1, inbox: 1 },
} as const;

export type WorkerEnvironment = keyof typeof WORKER_DESIRED_COUNTS;

/** Shape used by WorkerStack props.desiredCount */
export function workerDesiredCountForStack(environment: WorkerEnvironment): {
  sendWorker: number;
  schedulerWorker: number;
  inboxCheckerWorker: number;
} {
  const counts = WORKER_DESIRED_COUNTS[environment];
  return {
    sendWorker: counts.send,
    schedulerWorker: counts.scheduler,
    inboxCheckerWorker: counts.inbox,
  };
}

/**
 * Intended Container Insights policy (worker-stack should match after CDK update).
 * Dev off to avoid cost; prod on for observability.
 */
export const WORKER_CONTAINER_INSIGHTS: Record<WorkerEnvironment, boolean> = {
  dev: false,
  prod: true,
};

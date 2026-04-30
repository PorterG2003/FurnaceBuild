/**
 * One JSON line per event on **stdout** (not stderr). Many ECS/CloudWatch setups only ingest stdout,
 * so `console.error` from the competitor audit was invisible next to docker-entrypoint `echo`s.
 */
export function workerJsonLog(event: string, data?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = {
    source: 'google-ads-verification',
    event,
    at: new Date().toISOString(),
    ...(data ?? {}),
  };
  try {
    console.log(JSON.stringify(payload));
  } catch {
    console.log(
      JSON.stringify({
        source: 'google-ads-verification',
        event: `${event}_log_serialize_failed`,
        at: new Date().toISOString(),
      }),
    );
  }
}

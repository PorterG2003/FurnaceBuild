/**
 * Leveled, deterministically-sampled logger for the scheduler worker.
 *
 * Env vars (read at createLogger() time):
 *   SCHEDULER_LOG_LEVEL       – debug | info | warn | error  (default: info)
 *   SCHEDULER_LOG_SAMPLE_RATE – 0–1 fraction of enrollments whose debug
 *                               traces are emitted at info level  (default: 0.01)
 *
 * Never log mailbox addresses, message subjects, secrets, or full payloads.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_NUMS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function parseLevel(raw: string | undefined): LogLevel {
  const l = (raw ?? 'info').toLowerCase();
  if (l === 'debug' || l === 'info' || l === 'warn' || l === 'error') return l as LogLevel;
  return 'info';
}

function parseSampleRate(raw: string | undefined): number {
  const v = parseFloat(raw ?? '0.01');
  if (Number.isNaN(v) || v < 0) return 0.01;
  return Math.min(v, 1);
}

/**
 * FNV-1a 32-bit hash — fast, no-dependency, deterministic per input string.
 * Produces a uniform-ish distribution over [0, 2^32).
 */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

export interface SchedulerLogger {
  /** Deterministic: same enrollmentId always returns the same decision for a fixed rate. */
  shouldSample(enrollmentId: string): boolean;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /**
   * Emit at debug level only when EITHER debug logging is enabled globally OR
   * the enrollmentId passes the deterministic sample gate.
   * Use for per-enrollment step traces that would be too noisy at 100%.
   */
  debugSampled(enrollmentId: string, ...args: unknown[]): void;
}

export function createLogger(options?: {
  level?: LogLevel;
  sampleRate?: number;
}): SchedulerLogger {
  const minNum = LEVEL_NUMS[options?.level ?? parseLevel(process.env.SCHEDULER_LOG_LEVEL)];
  const rate = options?.sampleRate ?? parseSampleRate(process.env.SCHEDULER_LOG_SAMPLE_RATE);

  function shouldSample(id: string): boolean {
    // Divide by 2^32 to get a value in [0, 1)
    return (fnv1a32(id) / 4294967296) < rate;
  }

  function emit(level: LogLevel, args: unknown[]): void {
    switch (level) {
      case 'debug': console.debug(...args); break;
      case 'info':  console.log(...args);   break;
      case 'warn':  console.warn(...args);  break;
      case 'error': console.error(...args); break;
    }
  }

  return {
    shouldSample,

    debug(...args: unknown[]): void {
      if (LEVEL_NUMS.debug >= minNum) emit('debug', args);
    },

    info(...args: unknown[]): void {
      if (LEVEL_NUMS.info >= minNum) emit('info', args);
    },

    warn(...args: unknown[]): void {
      if (LEVEL_NUMS.warn >= minNum) emit('warn', args);
    },

    error(...args: unknown[]): void {
      if (LEVEL_NUMS.error >= minNum) emit('error', args);
    },

    debugSampled(enrollmentId: string, ...args: unknown[]): void {
      if (LEVEL_NUMS.debug >= minNum || shouldSample(enrollmentId)) {
        emit('debug', args);
      }
    },
  };
}

/** Default singleton reading SCHEDULER_LOG_LEVEL / SCHEDULER_LOG_SAMPLE_RATE env vars. */
export const logger: SchedulerLogger = createLogger();

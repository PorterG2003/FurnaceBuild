export type CliOptions = {
  input?: string;
  avoid?: string;
  runDir?: string;
  dryRun: boolean;
  live: boolean;
  fixtures: boolean;
  refresh: boolean;
  maxRows: number | null;
  concurrency: number | null;
  stage?: string;
  matches?: string;
  schools?: string;
  quickenrichResult?: string;
};

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    live: false,
    fixtures: false,
    refresh: false,
    maxRows: null,
    concurrency: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      options.input = argv[++i];
    } else if (arg === '--avoid' && argv[i + 1]) {
      options.avoid = argv[++i];
    } else if (arg === '--run-dir' && argv[i + 1]) {
      options.runDir = argv[++i];
    } else if (arg === '--stage' && argv[i + 1]) {
      options.stage = argv[++i];
    } else if (arg === '--max-rows' && argv[i + 1]) {
      options.maxRows = Number(argv[++i]) || null;
    } else if (arg === '--concurrency' && argv[i + 1]) {
      const n = Number(argv[++i]);
      options.concurrency = Number.isFinite(n) && n > 0 ? n : null;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--live') {
      options.live = true;
    } else if (arg === '--fixtures') {
      options.fixtures = true;
    } else if (arg === '--refresh') {
      options.refresh = true;
    } else if (arg === '--matches' && argv[i + 1]) {
      options.matches = argv[++i];
    } else if (arg === '--schools' && argv[i + 1]) {
      options.schools = argv[++i];
    } else if (arg === '--quickenrich-result' && argv[i + 1]) {
      options.quickenrichResult = argv[++i];
    }
  }

  if (options.maxRows == null) {
    const n = Number(process.env.MAX_ROWS?.trim());
    if (Number.isFinite(n) && n > 0) options.maxRows = n;
  }

  return options;
}

export function createRunDir(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `output/runs/${stamp}`;
}

export function truncateRows<T>(rows: T[], maxRows: number | null): T[] {
  if (maxRows == null || maxRows <= 0) return rows;
  return rows.slice(0, maxRows);
}

export function requireLiveForPaid(options: {
  live: boolean;
  dryRun: boolean;
  fixtures: boolean;
  vendor: string;
}): void {
  if (options.fixtures || options.dryRun) return;
  if (!options.live) {
    throw new Error(
      `Live ${options.vendor} spend requires --live after explicit spend OK. Use --dry-run to print the estimate, or --fixtures for $0 tests.`,
    );
  }
}

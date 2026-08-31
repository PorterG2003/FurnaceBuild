export type CliOptions = {
  input?: string;
  runDir?: string;
  resume?: string;
  dryRun: boolean;
  live: boolean;
  fixtures: boolean;
  mode: 'host' | 'grant' | null;
  directory?: string;
  wave: number;
  maxRows: number | null;
  maxQueries: number | null;
  maxPages: number | null;
  concurrency: number;
  headless: boolean;
};

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    live: false,
    fixtures: false,
    mode: null,
    wave: 1,
    maxRows: null,
    maxQueries: null,
    maxPages: null,
    concurrency: 12,
    headless: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      options.input = argv[++i];
    } else if (arg === '--run-dir' && argv[i + 1]) {
      options.runDir = argv[++i];
    } else if (arg === '--resume' && argv[i + 1]) {
      options.resume = argv[++i];
    } else if (arg === '--directory' && argv[i + 1]) {
      options.directory = argv[++i];
    } else if (arg === '--mode' && argv[i + 1]) {
      const mode = argv[++i];
      options.mode = mode === 'grant' ? 'grant' : 'host';
    } else if (arg === '--wave' && argv[i + 1]) {
      options.wave = Number(argv[++i]) || 1;
    } else if (arg === '--max-rows' && argv[i + 1]) {
      options.maxRows = Number(argv[++i]) || null;
    } else if (arg === '--max-queries' && argv[i + 1]) {
      options.maxQueries = Number(argv[++i]) || null;
    } else if (arg === '--max-pages' && argv[i + 1]) {
      options.maxPages = Number(argv[++i]) || null;
    } else if (arg === '--concurrency' && argv[i + 1]) {
      options.concurrency = Number(argv[++i]) || 12;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--live') {
      options.live = true;
    } else if (arg === '--fixtures') {
      options.fixtures = true;
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '--headed') {
      options.headless = false;
    }
  }

  if (options.maxRows == null) {
    const n = Number(process.env.MAX_ROWS?.trim());
    if (Number.isFinite(n) && n > 0) options.maxRows = n;
  }
  if (options.maxQueries == null) {
    const n = Number(process.env.MAX_QUERIES?.trim());
    if (Number.isFinite(n) && n > 0) options.maxQueries = n;
  }
  if (options.maxPages == null) {
    const n = Number(process.env.MAX_PAGES?.trim());
    if (Number.isFinite(n) && n > 0) options.maxPages = n;
  }
  const envConcurrency = Number(process.env.CONCURRENCY?.trim());
  if (Number.isFinite(envConcurrency) && envConcurrency > 0) {
    options.concurrency = envConcurrency;
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

export function requireLiveForSerper(options: { live: boolean; dryRun: boolean; fixtures: boolean }): void {
  if (options.fixtures || options.dryRun) return;
  if (!options.live) {
    throw new Error(
      'Live Serper spend requires --live after explicit spend OK. Use --dry-run to print the query list, or --fixtures for $0 tests.',
    );
  }
}

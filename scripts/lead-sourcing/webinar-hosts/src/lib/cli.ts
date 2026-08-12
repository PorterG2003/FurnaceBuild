export type CliOptions = {
  input?: string;
  output?: string;
  stage2Input?: string;
  runDir?: string;
  resume?: string;
  retryErrors: boolean;
  dryRun: boolean;
  confirmScale: boolean;
  fromStage: number;
  maxRows: number | null;
  maxApolloCalls: number | null;
  maxEnrichmentCredits: number | null;
  concurrency: number | null;
  fixtures: boolean;
};

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliOptions {
  const options: CliOptions = {
    retryErrors: false,
    dryRun: false,
    confirmScale: false,
    fromStage: 1,
    maxRows: null,
    maxApolloCalls: null,
    maxEnrichmentCredits: null,
    concurrency: null,
    fixtures: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      options.input = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      options.output = argv[++i];
    } else if (arg === '--stage2-input' && argv[i + 1]) {
      options.stage2Input = argv[++i];
    } else if (arg === '--run-dir' && argv[i + 1]) {
      options.runDir = argv[++i];
    } else if (arg === '--resume' && argv[i + 1]) {
      options.resume = argv[++i];
    } else if (arg === '--retry-errors') {
      options.retryErrors = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm-scale') {
      options.confirmScale = true;
    } else if (arg === '--from-stage' && argv[i + 1]) {
      options.fromStage = Number(argv[++i]) || 1;
    } else if (arg === '--max-rows' && argv[i + 1]) {
      options.maxRows = Number(argv[++i]) || null;
    } else if (arg === '--max-apollo-calls' && argv[i + 1]) {
      options.maxApolloCalls = Number(argv[++i]) || null;
    } else if (arg === '--max-enrichment-credits' && argv[i + 1]) {
      options.maxEnrichmentCredits = Number(argv[++i]) || null;
    } else if (arg === '--concurrency' && argv[i + 1]) {
      options.concurrency = Number(argv[++i]) || null;
    } else if (arg === '--fixtures') {
      options.fixtures = true;
    }
  }

  if (options.maxRows == null) {
    const envMax = process.env.MAX_ROWS?.trim();
    if (envMax) {
      const n = Number(envMax);
      if (Number.isFinite(n) && n > 0) options.maxRows = n;
    }
  }

  if (options.maxApolloCalls == null) {
    const envMax = process.env.MAX_APOLLO_CALLS?.trim();
    if (envMax) {
      const n = Number(envMax);
      if (Number.isFinite(n) && n > 0) options.maxApolloCalls = n;
    }
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

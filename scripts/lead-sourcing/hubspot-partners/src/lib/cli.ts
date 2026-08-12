export type CliOptions = {
  runDir?: string;
  resume: boolean;
  dryRun: boolean;
  fixtures: boolean;
  maxRows: number | null;
  accreditationId: number;
  pageSize: number;
  rateMs: number;
};

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliOptions {
  const options: CliOptions = {
    resume: false,
    dryRun: false,
    fixtures: false,
    maxRows: null,
    accreditationId: 43003,
    pageSize: 50,
    rateMs: 400,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--run-dir' || arg === '--resume') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      if (arg === '--resume') options.resume = true;
      options.runDir = argv[++i];
    } else if (arg === '--resume') {
      options.resume = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--fixtures') {
      options.fixtures = true;
    } else if (arg === '--max-rows' && argv[i + 1]) {
      options.maxRows = Number(argv[++i]) || null;
    } else if (arg === '--accreditation-id' && argv[i + 1]) {
      options.accreditationId = Number(argv[++i]) || 43003;
    } else if (arg === '--page-size' && argv[i + 1]) {
      options.pageSize = Number(argv[++i]) || 50;
    } else if (arg === '--rate-ms' && argv[i + 1]) {
      options.rateMs = Number(argv[++i]) || 400;
    }
  }

  if (options.maxRows == null) {
    const envMax = process.env.MAX_ROWS?.trim();
    if (envMax) {
      const n = Number(envMax);
      if (Number.isFinite(n) && n > 0) options.maxRows = n;
    }
  }

  return options;
}

export function createRunDir(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `output/runs/${stamp}`;
}

export type CliOptions = {
  input?: string;
  output?: string;
  dryRun: boolean;
  maxRows: number | null;
  fixtures: boolean;
};

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    maxRows: null,
    fixtures: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      options.input = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      options.output = argv[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--max-rows' && argv[i + 1]) {
      options.maxRows = Number(argv[++i]) || null;
    } else if (arg === '--fixtures') {
      options.fixtures = true;
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

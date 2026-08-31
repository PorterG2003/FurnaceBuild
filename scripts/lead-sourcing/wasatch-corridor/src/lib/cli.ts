export const STAGES = ['acquire', 'admit', 'org-enrich', 'enrich', 'doors', 'export', 'streets', 'contacts', 'all'] as const;
export type Stage = (typeof STAGES)[number];

export const PILOT_CITIES = ['Lehi', 'Midvale', 'Payson'] as const;
export const PILOT_BANDS = ['11,20', '21,50'] as const;

export type CliOptions = {
  runDir?: string;
  stage: Stage;
  dryRun: boolean;
  live: boolean;
  fixtures: boolean;
  pilot: boolean;
  cities: string[];
  bands: string[];
  skipFsq: boolean;
  skipEpa: boolean;
  skipPeople: boolean;
  skipGeo: boolean;
  county: string;
  maxRows: number | null;
  maxApolloCalls: number | null;
  maxOrgEnrich: number | null;
  fsqExtract?: string;
};

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliOptions {
  const options: CliOptions = {
    stage: 'all',
    dryRun: false,
    live: false,
    fixtures: false,
    pilot: false,
    cities: [],
    bands: [],
    skipFsq: false,
    skipEpa: false,
    skipPeople: false,
    skipGeo: false,
    county: '',
    maxRows: null,
    maxApolloCalls: null,
    maxOrgEnrich: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--run-dir' && argv[i + 1]) options.runDir = argv[++i];
    else if (arg === '--stage' && argv[i + 1]) {
      const stage = argv[++i] as Stage;
      if (!STAGES.includes(stage)) throw new Error(`Unknown --stage ${stage}`);
      options.stage = stage;
    } else if (arg === '--max-rows' && argv[i + 1]) options.maxRows = Number(argv[++i]) || null;
    else if (arg === '--max-apollo-calls' && argv[i + 1]) options.maxApolloCalls = Number(argv[++i]) || null;
    else if (arg === '--max-org-enrich' && argv[i + 1]) options.maxOrgEnrich = Number(argv[++i]) || null;
    else if (arg === '--fsq-extract' && argv[i + 1]) options.fsqExtract = argv[++i];
    else if (arg === '--cities' && argv[i + 1]) {
      options.cities = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--bands' && argv[i + 1]) {
      options.bands = argv[++i].split('|').map((s) => s.trim()).filter(Boolean);
    }     else if (arg === '--skip-fsq') options.skipFsq = true;
    else if (arg === '--skip-epa') options.skipEpa = true;
    else if (arg === '--skip-people') options.skipPeople = true;
    else if (arg === '--skip-geo') options.skipGeo = true;
    else if (arg === '--county' && argv[i + 1]) options.county = argv[++i].trim();
    else if (arg === '--pilot') options.pilot = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--live') options.live = true;
    else if (arg === '--fixtures') options.fixtures = true;
  }

  if (options.pilot) {
    if (!options.cities.length) options.cities = [...PILOT_CITIES];
    if (!options.bands.length) options.bands = [...PILOT_BANDS];
    options.skipFsq = true;
    options.skipEpa = true;
    if (options.maxApolloCalls == null) options.maxApolloCalls = 12;
  }

  if (options.maxRows == null) {
    const n = Number(process.env.MAX_ROWS?.trim());
    if (Number.isFinite(n) && n > 0) options.maxRows = n;
  }
  if (options.maxApolloCalls == null) {
    const n = Number(process.env.MAX_APOLLO_CALLS?.trim());
    if (Number.isFinite(n) && n > 0) options.maxApolloCalls = n;
  }

  return options;
}

export function createRunDir(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `output/runs/${stamp}`;
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

import type { CliOptions } from './types.ts';

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliOptions {
  const options: CliOptions = {
    country: 'both',
    resume: false,
    maxSuggestions: null,
    maxAgents: null,
    prefixes: null,
    rateMs: 600,
    headed: true,
    suggestOnly: false,
    legacyPrefixes: false,
    waitHuman: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--run-dir' || arg === '--resume') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      if (arg === '--resume') options.resume = true;
      options.runDir = argv[++i];
    } else if (arg === '--resume') {
      options.resume = true;
    } else if (arg === '--country' && argv[i + 1]) {
      const v = argv[++i].toLowerCase();
      if (v === 'us' || v === 'ca' || v === 'both') options.country = v;
      else throw new Error(`Invalid --country ${v}; use us|ca|both`);
    } else if (arg === '--max-suggestions' && argv[i + 1]) {
      options.maxSuggestions = Number(argv[++i]) || null;
    } else if (arg === '--max-agents' && argv[i + 1]) {
      options.maxAgents = Number(argv[++i]) || null;
    } else if ((arg === '--prefixes' || arg === '--prefix') && argv[i + 1]) {
      options.prefixes = argv[++i]
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === '--rate-ms' && argv[i + 1]) {
      options.rateMs = Number(argv[++i]) || 600;
    } else if (arg === '--headed') {
      options.headed = true;
    } else if (arg === '--headless') {
      options.headed = false;
    } else if (arg === '--suggest-only') {
      options.suggestOnly = true;
      options.legacyPrefixes = true;
    } else if (arg === '--legacy-prefixes') {
      options.legacyPrefixes = true;
    } else if (arg === '--user-data-dir' && argv[i + 1]) {
      options.userDataDir = argv[++i];
    } else if (arg === '--cdp-url' && argv[i + 1]) {
      options.cdpUrl = argv[++i];
    } else if (arg === '--wait-human') {
      options.waitHuman = true;
    }
  }

  return options;
}

export function createRunDir(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `output/runs/${stamp}`;
}

export function countriesFromCli(country: CliOptions['country']): Array<'US' | 'CA'> {
  if (country === 'us') return ['US'];
  if (country === 'ca') return ['CA'];
  return ['CA', 'US'];
}

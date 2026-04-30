import type { SeedModule } from '../types';

/** Placeholder scenario: validates CLI + registry only. Add real modules later. */
export const minimalModule: SeedModule = {
  id: 'minimal',
  description: 'No-op scaffold (logs and exits)',
  async run(ctx) {
    if (ctx.dryRun) {
      ctx.log(`scenario=${ctx.scenarioId} module=minimal [dry-run] — no writes`);
      return;
    }
    ctx.log(`scenario=${ctx.scenarioId} module=minimal — no writes (scaffold)`);
  },
};

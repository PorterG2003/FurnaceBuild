import { resolveFit } from './fit/run.js';

resolveFit().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

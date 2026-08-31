import { classifyEntries } from './classify/run.js';

classifyEntries().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

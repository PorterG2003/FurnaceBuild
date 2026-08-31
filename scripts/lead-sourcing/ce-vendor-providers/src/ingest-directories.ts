import { ingestDirectories } from './directories/ingest.js';

ingestDirectories().then(({ runDir, rows }) => {
  console.error(`Wrote ${rows.length} directory entries to ${runDir}/directory_entries.csv`);
}).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

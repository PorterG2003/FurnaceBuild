import { spawn } from 'node:child_process';

const child = spawn(
  'node',
  [
    '--import',
    'tsx',
    'workers/state-scrapers/google-ads-verification-worker/src/local.ts',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    cwd: process.cwd(),
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

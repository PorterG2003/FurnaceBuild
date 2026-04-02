function logBootstrap(event: string, data?: Record<string, unknown>): void {
  console.log(
    JSON.stringify({ source: 'florida-bootstrap', event, at: new Date().toISOString(), ...data }),
  );
}

async function main(): Promise<void> {
  logBootstrap('bootstrap-start', {
    cwd: process.cwd(),
    nodeVersion: process.version,
    runMode: process.env.RUN_MODE ?? null,
  });
  await import('./run-reconciliation.js');
  logBootstrap('bootstrap-imported');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logBootstrap('bootstrap-import-failed', { error: message });
  process.exit(1);
});

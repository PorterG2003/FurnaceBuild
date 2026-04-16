# Iowa SOS scraper (local / ECS)

Browser automation for the Iowa Secretary of State business search. Shared parsers and `ownerRowsForIowaDetail` live in [`lib/foundry/registry-server`](../../../lib/foundry/registry-server/).

## Scripts

- **`npm run compare-csv`** — offline baseline vs a CSV (`run-csv-compare.ts`). **Testing only**; see the file header for which names are compared (officers + RA) vs what persistence uses (`ownerRowsForIowaDetail`).
- **`npx tsx src/run-query.ts`** — ad hoc lookup / persistence experiments (not the main ECS batch entrypoint unless you wire it).

## Headless / Chrome

Set `IOWA_HEADLESS=1` for headless runs when supported; some sites require headed Chrome (see comments in `iowaBrowser.ts`). Match Playwright to the Docker base image when you add an ECS Dockerfile ([state scraper ECS playbook](../../../docs/foundry/engineering/state-scraper-ecs-playbook.md)).

# Playwright base includes Chromium + OS deps for headless Utah portal automation.
# Keep in sync with package.json `playwright` version (browser bundles must match).
FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

COPY lib/foundry/registry-server ./lib/foundry/registry-server
COPY workers/utah-scraper ./workers/utah-scraper

WORKDIR /app/workers/utah-scraper
RUN npm install

ENV NODE_ENV=production
# Override at run time: CSV path inside container, report output dir
ENV INPUT_CSV=/data/input.csv
ENV OUTPUT_JSON=/out/utah-scrape-report.json

CMD ["sh", "-c", "if [ \"$RUN_MODE\" = \"reconciliation\" ]; then npx tsx src/run-reconciliation.ts; else npx tsx src/run.ts \"$INPUT_CSV\" --out \"$OUTPUT_JSON\"; fi"]
